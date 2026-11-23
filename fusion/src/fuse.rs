//! The stateful fuser: many [`DetectionReport`]s in, one [`GridState`] out.
//!
//! Everything here is a real crate call. Reports are re-decoded with
//! [`remoteid`] (the `raw_hex` bytes, never the display echo), tracked per
//! transmitter, graded field-wide by [`remoteid_sentinel`], and any flood
//! source is localized to a ground point by [`crate::triangulate`]. The same
//! [`Grid`] runs on the aggregator and, compiled to wasm, in the browser.

use std::collections::{BTreeMap, VecDeque};

use remoteid::{Message, Observation, OperatorLocationType, Transmitter, Transport, UasData};
use remoteid_sentinel::{FieldAssessment, Signature};

use crate::report::{from_hex, transmitter_from_label, transport_from_name, DetectionReport};
use crate::state::{
    DroneEntity, FloodState, GridState, NodeState, Pos, Registration, TickerEvent, Triangulation,
    Watching,
};
use crate::triangulate::{self, ground_distance_m, NodeRange};

/// How long a sighting stays in the field window, ms.
const WINDOW_MS: u64 = 12_000;
/// How long a track stays live after its last sighting, ms.
const EXPIRE_MS: u64 = 15_000;
/// Max positions kept in a drone trail.
const TRAIL_MAX: usize = 60;
/// Aimpoint is "dwelling" while it stays within this radius, metres.
const DWELL_RADIUS_M: f64 = 30.0;
/// Max ticker lines kept.
const TICKER_MAX: usize = 40;

/// One raw sighting kept in the rolling field window. Owns its bytes so the
/// sentinel can borrow them when the field is assessed.
struct WindowObs {
    tx: Transmitter,
    transport: Transport,
    counter: Option<u8>,
    bytes: Vec<u8>,
    rssi: i8,
    ts_ms: u64,
    receiver: u16,
}

/// Per-transmitter accumulated state.
struct Track {
    transport: Transport,
    uas: UasData,
    last_seen_ms: u64,
    trail: Vec<[f64; 2]>,
    /// node_id -> (node lat, node lon, last rssi dbm).
    per_node: BTreeMap<String, (f64, f64, f64)>,
    /// Last aimpoint (lat, lon, ts_ms) for dwell geometry.
    aim_last: Option<(f64, f64, u64)>,
    dwell_s: f64,
    watching: Option<Watching>,
    model: Option<String>,
}

impl Track {
    fn new(transport: Transport) -> Self {
        Track {
            transport,
            uas: UasData::default(),
            last_seen_ms: 0,
            trail: Vec::new(),
            per_node: BTreeMap::new(),
            aim_last: None,
            dwell_s: 0.0,
            watching: None,
            model: None,
        }
    }
}

/// The live grid. Feed it reports; ask it for snapshots.
#[derive(Default)]
pub struct Grid {
    nodes: BTreeMap<String, NodeState>,
    node_ids: BTreeMap<String, u16>,
    tracks: BTreeMap<String, Track>,
    window: VecDeque<WindowObs>,
    ticker: VecDeque<TickerEvent>,
    last_flood_level: Option<String>,
    now_ms: u64,
}

impl Grid {
    /// A fresh, empty grid.
    pub fn new() -> Self {
        Grid::default()
    }

    fn receiver_id(&mut self, node_id: &str) -> u16 {
        let next = self.node_ids.len() as u16;
        *self.node_ids.entry(node_id.to_string()).or_insert(next)
    }

    /// Ingest one report. Re-decodes `raw_hex`, updates the node registry, the
    /// per-transmitter track, and the rolling field window.
    pub fn ingest(&mut self, report: &DetectionReport) {
        let ts = report.sighting.ts_ms;
        self.now_ms = self.now_ms.max(ts).max(report.node.clock_ms);

        // Node registry.
        self.nodes
            .entry(report.node.id.clone())
            .and_modify(|n| n.last_seen_ms = n.last_seen_ms.max(ts))
            .or_insert_with(|| NodeState {
                id: report.node.id.clone(),
                lat: report.node.lat,
                lon: report.node.lon,
                last_seen_ms: ts,
            });

        let tx = match transmitter_from_label(&report.sighting.transmitter) {
            Some(tx) => tx,
            None => return,
        };
        let transport = transport_from_name(&report.sighting.transport);
        let bytes = match from_hex(&report.sighting.raw_hex) {
            Some(b) if b.len() == 25 => b,
            _ => return, // not a decodable ASTM frame; drop rather than trust the echo
        };
        let counter = (report.sighting.counter & 0xff) as u8;
        let rssi = report.sighting.rssi_dbm.clamp(-128, 127) as i8;
        let receiver = self.receiver_id(&report.node.id);

        // Re-decode the bytes (honest path) and fold into the track's UasData.
        let label = report.sighting.transmitter.clone();
        let track = self
            .tracks
            .entry(label)
            .or_insert_with(|| Track::new(transport));
        track.last_seen_ms = ts;
        track.transport = transport;
        track.per_node.insert(
            report.node.id.clone(),
            (report.node.lat, report.node.lon, rssi as f64),
        );

        if let Ok(msg) = Message::decode(&bytes) {
            track.uas.update(&msg);
            if let Message::Location(loc) = &msg {
                if let Some((lat, lon)) = loc.position() {
                    let push = track
                        .trail
                        .last()
                        .map(|p| ground_distance_m(p[0], p[1], lat, lon) > 0.5)
                        .unwrap_or(true);
                    if push {
                        track.trail.push([lat, lon]);
                        if track.trail.len() > TRAIL_MAX {
                            track.trail.remove(0);
                        }
                    }
                }
            }
            if let Message::BasicId(id) = &msg {
                track.model = Some(format!("{:?}", id.ua_type));
            }
        }

        // MISB aimpoint (the node already ran the real misb decode; we take the
        // aimpoint point and compute dwell with the real Trajectory geometry).
        if let Some(m) = &report.sighting.misb {
            let (lat, lon) = (m.frame_center_lat, m.frame_center_lon);
            let dt = track
                .aim_last
                .map(|(_, _, t)| (ts.saturating_sub(t)) as f64 / 1000.0)
                .unwrap_or(0.0);
            let moved = track
                .aim_last
                .map(|(plat, plon, _)| ground_distance_m(plat, plon, lat, lon))
                .unwrap_or(0.0);
            if moved <= DWELL_RADIUS_M {
                track.dwell_s += dt;
            } else {
                track.dwell_s = 0.0;
            }
            track.aim_last = Some((lat, lon, ts));
            track.watching = Some(Watching {
                lat,
                lon,
                dwell_s: track.dwell_s,
                footprint: m.corners.clone(),
            });
        }

        // Rolling field window for the sentinel.
        self.window.push_back(WindowObs {
            tx,
            transport,
            counter: Some(counter),
            bytes,
            rssi,
            ts_ms: ts,
            receiver,
        });
    }

    /// Ingest a batch.
    pub fn ingest_all(&mut self, reports: &[DetectionReport]) {
        for r in reports {
            self.ingest(r);
        }
    }

    fn prune(&mut self) {
        let cutoff = self.now_ms.saturating_sub(WINDOW_MS);
        while let Some(front) = self.window.front() {
            if front.ts_ms < cutoff {
                self.window.pop_front();
            } else {
                break;
            }
        }
        let expire = self.now_ms.saturating_sub(EXPIRE_MS);
        self.tracks.retain(|_, t| t.last_seen_ms >= expire);
    }

    fn tick(&mut self, text: impl Into<String>) {
        self.ticker.push_back(TickerEvent {
            ts_ms: self.now_ms,
            text: text.into(),
        });
        while self.ticker.len() > TICKER_MAX {
            self.ticker.pop_front();
        }
    }

    /// Fuse the current window into a full snapshot.
    pub fn snapshot(&mut self) -> GridState {
        self.prune();
        let now = self.now_ms;

        // Field assessment over the whole window (real sentinel over real
        // re-decoded frames).
        let obs_pairs: Vec<(Transmitter, Observation<'_>)> = self
            .window
            .iter()
            .map(|w| {
                let obs = Observation::new(w.transport, w.counter, &w.bytes, w.ts_ms)
                    .with_rssi(w.rssi)
                    .with_receiver(w.receiver);
                (w.tx, obs)
            })
            .collect();
        let field = FieldAssessment::from_observations(obs_pairs, now);

        // Index the field's per-track scores by transmitter label.
        let mut scores: BTreeMap<String, &remoteid_sentinel::TrackScore> = BTreeMap::new();
        for t in &field.tracks {
            scores.insert(crate::report::transmitter_label(&t.transmitter), t);
        }
        let most_real = field
            .most_likely_real
            .as_ref()
            .map(|t| crate::report::transmitter_label(&t.transmitter));

        // Build one entity per live track.
        let mut entities = Vec::new();
        let mut triangulation = Vec::new();
        for (label, track) in &self.tracks {
            let score = scores.get(label);
            let (verdict, reasons, real_score, signals) = match score {
                Some(s) => (
                    s.per_unit.verdict.name().to_string(),
                    s.per_unit
                        .reasons
                        .iter()
                        .map(|r| r.name().to_string())
                        .collect::<Vec<_>>(),
                    s.real_score,
                    s.fake_signals,
                ),
                None => (
                    "plausible".to_string(),
                    Vec::new(),
                    0.0,
                    remoteid_sentinel::SignatureSet::default(),
                ),
            };

            let uas = &track.uas;
            let uas_id = uas.primary_id().map(|s| s.to_string());
            let drone = uas.location.as_ref().and_then(|l| {
                l.position().map(|(lat, lon)| Pos {
                    lat,
                    lon,
                    alt_m: l.altitude_geo.map(|a| a as f64),
                })
            });
            // Remote ID sends one ground position tagged by what it is: the
            // takeoff point, the live operator GNSS fix, or a fixed location.
            // Keep takeoff and live pilot apart, as a security team must.
            let sys = uas.system.as_ref();
            let takeoff = sys
                .filter(|s| s.operator_location_type == OperatorLocationType::Takeoff)
                .and_then(|s| s.operator_position())
                .map(|(lat, lon)| Pos {
                    lat,
                    lon,
                    alt_m: None,
                });
            let pilot = sys
                .filter(|s| s.operator_location_type != OperatorLocationType::Takeoff)
                .and_then(|s| s.operator_position())
                .map(|(lat, lon)| Pos {
                    lat,
                    lon,
                    alt_m: None,
                });
            let registration = uas
                .operator_id
                .as_ref()
                .and_then(|o| o.operator_id_str())
                .filter(|s| !s.is_empty())
                .map(parse_registration)
                .unwrap_or_default();

            let heard_by: Vec<String> = track.per_node.keys().cloned().collect();

            // Triangulate any flagged flood source heard by >= 3 nodes.
            let flagged = !signals.is_empty()
                || verdict == "spoofed"
                || signals.contains(Signature::OneSourceManyIds);
            if flagged && track.per_node.len() >= 3 {
                let ranges: Vec<NodeRange> = track
                    .per_node
                    .values()
                    .map(|&(lat, lon, rssi)| NodeRange {
                        lat,
                        lon,
                        rssi_dbm: rssi,
                    })
                    .collect();
                if let Some(fix) = triangulate::locate(&ranges) {
                    triangulation.push(Triangulation {
                        transmitter: label.clone(),
                        lat: fix.lat,
                        lon: fix.lon,
                        confidence: fix.confidence,
                        node_ids: heard_by.clone(),
                    });
                }
            }

            entities.push(DroneEntity {
                transmitter: label.clone(),
                uas_id,
                model: track.model.clone(),
                registration,
                verdict,
                reasons,
                real_score,
                drone,
                pilot,
                takeoff,
                watching: track.watching.clone(),
                trail: track.trail.clone(),
                heard_by,
            });
        }
        // Most-likely-real first, then by score.
        entities.sort_by(|a, b| {
            let am = Some(&a.transmitter) == most_real.as_ref();
            let bm = Some(&b.transmitter) == most_real.as_ref();
            bm.cmp(&am).then(
                b.real_score
                    .partial_cmp(&a.real_score)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
        });

        let flood = FloodState {
            level: field.flood.level.name().to_string(),
            confidence: field.flood.confidence,
        };

        // Ticker on flood transitions and new puppeteer pins.
        if self.last_flood_level.as_deref() != Some(flood.level.as_str()) {
            self.tick(format!(
                "flood level {} ({:.0}% confidence)",
                flood.level,
                flood.confidence * 100.0
            ));
            self.last_flood_level = Some(flood.level.clone());
        }
        for pin in &triangulation {
            self.tick(format!(
                "puppeteer radio {} localized to {:.5}, {:.5} ({} nodes)",
                pin.transmitter,
                pin.lat,
                pin.lon,
                pin.node_ids.len()
            ));
        }

        GridState {
            ts_ms: now,
            nodes: self.nodes.values().cloned().collect(),
            entities,
            flood,
            triangulation,
            ticker: self.ticker.iter().cloned().collect(),
        }
    }

    /// Current node list (for `/nodes`).
    pub fn nodes(&self) -> Vec<NodeState> {
        self.nodes.values().cloned().collect()
    }
}

/// Split an operator ID into its registering country code and a clean
/// registration string. An EN 4709-002 operator ID leads with an ISO 3166
/// country code (e.g. `FIN87astrdge12k8`); the FAA format is digits only. This
/// takes the leading alphabetic run as the country code when present.
fn parse_registration(id: &str) -> Registration {
    let code_len = id.chars().take_while(|c| c.is_ascii_alphabetic()).count();
    if (2..=3).contains(&code_len) {
        Registration {
            country: Some(id[..code_len].to_uppercase()),
            reg: Some(id.to_string()),
        }
    } else {
        Registration {
            country: None,
            reg: Some(id.to_string()),
        }
    }
}
