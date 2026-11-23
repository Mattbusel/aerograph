//! A labelled live simulation of a city sensor mesh.
//!
//! There is no real hardware behind the public demo, so the input is a
//! realistic simulated grid: several virtual $6 nodes across a city, each
//! turning [`remoteid_scenario`] traffic into [`DetectionReport`]s exactly as a
//! real node would. Benign drones broadcast from their own moving position; one
//! puppeteer radio floods the field with fakes from a single fixed ground
//! point, and every node hears that one radio at a strength set by its distance
//! to it (the same log-distance physics the solver inverts). The fusion that
//! runs over this is the real crate code; only the input is simulated, and the
//! page must label it as such.

use remoteid::{Message, OperatorLocationType, Transmitter};
use remoteid_scenario::{generate, EmittedFrame, Scenario, ScenarioKind};

use crate::report::{
    to_hex, transmitter_label, Decoded, DetectionReport, MisbEcho, NodeInfo, Sighting, SCHEMA,
};
use crate::triangulate::{ground_distance_m, rssi_at};

/// A virtual sensor on the map.
#[derive(Debug, Clone)]
pub struct SimNode {
    pub id: String,
    pub lat: f64,
    pub lon: f64,
}

/// Configuration for the simulated city mesh.
#[derive(Debug, Clone)]
pub struct GridSimConfig {
    /// City centre (map view).
    pub center_lat: f64,
    pub center_lon: f64,
    /// The virtual nodes.
    pub nodes: Vec<SimNode>,
    /// Number of benign moving drones.
    pub benign: u32,
    /// Fake IDs the puppeteer floods with.
    pub flood_ids: u32,
    /// The puppeteer radio's true ground position (what triangulation should
    /// recover). Its fakes claim to be elsewhere.
    pub puppeteer_lat: f64,
    pub puppeteer_lon: f64,
    /// Step at which the flood turns on.
    pub flood_at_step: u32,
    /// Below this RSSI a node does not hear the frame, dBm.
    pub hearing_floor_dbm: f64,
}

impl GridSimConfig {
    /// A Manhattan default: five nodes, a handful of benign drones and one
    /// puppeteer a few blocks from the centre.
    pub fn manhattan() -> Self {
        let (clat, clon) = (40.7411, -73.9897);
        GridSimConfig {
            center_lat: clat,
            center_lon: clon,
            nodes: vec![
                SimNode {
                    id: "node-0001".into(),
                    lat: 40.7440,
                    lon: -73.9930,
                },
                SimNode {
                    id: "node-0002".into(),
                    lat: 40.7388,
                    lon: -73.9869,
                },
                SimNode {
                    id: "node-0003".into(),
                    lat: 40.7455,
                    lon: -73.9858,
                },
                SimNode {
                    id: "node-0004".into(),
                    lat: 40.7379,
                    lon: -73.9938,
                },
                SimNode {
                    id: "node-0005".into(),
                    lat: 40.7415,
                    lon: -73.9901,
                },
            ],
            benign: 4,
            flood_ids: 120,
            puppeteer_lat: 40.7402,
            puppeteer_lon: -73.9881,
            flood_at_step: 0,
            hearing_floor_dbm: -99.0,
        }
    }
}

/// True source of a frame's radio, for the RSSI physics.
#[derive(Clone, Copy)]
enum Source {
    /// Follow the drone's own broadcast position.
    Drone,
    /// A fixed ground radio (the puppeteer).
    Fixed(f64, f64),
}

struct SimFrame {
    frame: EmittedFrame,
    source: Source,
}

/// The simulated grid. Precomputes the full stream, then serves it per step.
pub struct GridSim {
    cfg: GridSimConfig,
    frames: Vec<SimFrame>,
    /// Distinct capture times, ascending, one per step.
    steps: Vec<u64>,
    step: usize,
    /// One benign drone also carries a MISB camera feed; this is its radio.
    watcher: Option<Transmitter>,
    /// The fixed ground point that drone's camera loiters on.
    watch_lat: f64,
    watch_lon: f64,
}

impl GridSim {
    /// Build the simulation from config.
    pub fn new(cfg: GridSimConfig) -> Self {
        let mut frames: Vec<SimFrame> = Vec::new();

        // Benign drones: honest, each on its own moving track.
        let benign = Scenario::new(ScenarioKind::Clean, cfg.benign.max(1));
        for mut f in generate(&benign) {
            // A drone in flight broadcasts the operator's live GNSS fix. The
            // scenario leaves the System type at its default (Takeoff), so the
            // operator position reads only as a launch point and the live pilot
            // never surfaces. Retype the single System frame as LiveGnss so the
            // grid locates the pilot. (Emitting a second System frame here would
            // duplicate the per-cycle counter and trip the trust scorer's
            // counter-conflict check, flagging the real drone as spoofed.)
            if let Message::System(sys) = &mut f.message {
                sys.operator_location_type = OperatorLocationType::LiveGnss;
            }
            frames.push(SimFrame {
                frame: f,
                source: Source::Drone,
            });
        }

        // The puppeteer: one shared radio flooding many fake IDs from one spot.
        if cfg.flood_ids > 0 {
            let flood = Scenario::new(ScenarioKind::Flood, cfg.flood_ids);
            for f in generate(&flood) {
                frames.push(SimFrame {
                    frame: f,
                    source: Source::Fixed(cfg.puppeteer_lat, cfg.puppeteer_lon),
                });
            }
        }

        frames.sort_by_key(|f| f.frame.time_us);
        let mut steps: Vec<u64> = frames.iter().map(|f| f.frame.time_us).collect();
        steps.dedup();

        // Make the first benign drone a camera platform loitering over a fixed
        // ground point, so the grid shows a real "what is it watching" dossier.
        let watcher = frames
            .iter()
            .find(|f| matches!(f.source, Source::Drone))
            .map(|f| f.frame.transmitter);
        let watch_lat = cfg.center_lat - 0.0015;
        let watch_lon = cfg.center_lon + 0.0010;

        GridSim {
            cfg,
            frames,
            steps,
            step: 0,
            watcher,
            watch_lat,
            watch_lon,
        }
    }

    /// Number of distinct time steps in the stream.
    pub fn step_count(&self) -> usize {
        self.steps.len()
    }

    /// The virtual nodes.
    pub fn nodes(&self) -> &[SimNode] {
        &self.cfg.nodes
    }

    /// Every report in the whole stream, for one-shot tests.
    pub fn all_reports(&self) -> Vec<DetectionReport> {
        let mut last_pos: std::collections::HashMap<Transmitter, (f64, f64)> =
            std::collections::HashMap::new();
        let mut out = Vec::new();
        for sf in &self.frames {
            self.emit_frame(sf, &mut last_pos, &mut out);
        }
        out
    }

    /// Reports for the next time step; wraps around at the end. Drives the live
    /// loop at ~2 Hz.
    pub fn step(&mut self) -> Vec<DetectionReport> {
        if self.steps.is_empty() {
            return Vec::new();
        }
        let t = self.steps[self.step % self.steps.len()];
        // Rebuild last_pos up to this step so benign RSSI uses the current
        // position even after a wrap.
        let mut last_pos: std::collections::HashMap<Transmitter, (f64, f64)> =
            std::collections::HashMap::new();
        for sf in self.frames.iter().filter(|f| f.frame.time_us <= t) {
            if let Message::Location(loc) = &sf.frame.message {
                last_pos.insert(sf.frame.transmitter, (loc.latitude, loc.longitude));
            }
        }
        let mut out = Vec::new();
        for sf in self.frames.iter().filter(|f| f.frame.time_us == t) {
            self.emit_frame(sf, &mut last_pos, &mut out);
        }
        self.step += 1;
        out
    }

    fn emit_frame(
        &self,
        sf: &SimFrame,
        last_pos: &mut std::collections::HashMap<Transmitter, (f64, f64)>,
        out: &mut Vec<DetectionReport>,
    ) {
        // Determine the radio's true physical position.
        if let Message::Location(loc) = &sf.frame.message {
            last_pos.insert(sf.frame.transmitter, (loc.latitude, loc.longitude));
        }
        let source = match sf.source {
            Source::Fixed(lat, lon) => Some((lat, lon)),
            Source::Drone => last_pos.get(&sf.frame.transmitter).copied(),
        };
        let source = match source {
            Some(s) => s,
            None => return, // no position known yet for this benign drone
        };

        let bytes = match sf.frame.message.encode() {
            Ok(b) => b,
            Err(_) => return,
        };
        let ts_ms = sf.frame.time_us / 1000;
        let label = transmitter_label(&sf.frame.transmitter);
        let decoded = decoded_echo(&sf.frame.message);

        // The camera platform's MISB aimpoint, produced by the real misb
        // encoder/decoder (see `misb_aim`). Attached to every node that hears
        // the feed; the aggregator dedupes it to one entity.
        let misb = if Some(sf.frame.transmitter) == self.watcher {
            crate::misb_aim::aimpoint(sf.frame.time_us, self.watch_lat, self.watch_lon, 0.0005).map(
                |(lat, lon, corners)| MisbEcho {
                    frame_center_lat: lat,
                    frame_center_lon: lon,
                    corners,
                },
            )
        } else {
            None
        };

        for node in &self.cfg.nodes {
            let dist = ground_distance_m(node.lat, node.lon, source.0, source.1);
            let rssi = rssi_at(dist);
            if rssi < self.cfg.hearing_floor_dbm {
                continue; // too far to hear
            }
            out.push(DetectionReport {
                schema: SCHEMA.to_string(),
                node: NodeInfo {
                    id: node.id.clone(),
                    lat: node.lat,
                    lon: node.lon,
                    clock_ms: ts_ms,
                },
                sighting: Sighting {
                    ts_ms,
                    transport: "bluetooth4".to_string(),
                    transmitter: label.clone(),
                    rssi_dbm: rssi.round() as i32,
                    counter: sf.frame.counter as u32,
                    raw_hex: to_hex(&bytes),
                    decoded: decoded.clone(),
                    misb: misb.clone(),
                },
            });
        }
    }
}

/// Fill the display echo from one decoded message (honest: only what the frame
/// carried).
fn decoded_echo(msg: &Message) -> Decoded {
    let mut d = Decoded::default();
    match msg {
        Message::BasicId(id) => {
            d.uas_id = id.uas_id_str().map(|s| s.to_string());
            d.model = Some(format!("{:?}", id.ua_type));
        }
        Message::Location(loc) => {
            d.drone_lat = Some(loc.latitude);
            d.drone_lon = Some(loc.longitude);
            d.alt_m = loc.altitude_geo.map(|a| a as f64);
            d.height_m = loc.height.map(|h| h as f64);
            d.yaw_deg = loc.direction.map(|h| h as f64);
        }
        Message::System(sys) => {
            if let Some((lat, lon)) = sys.operator_position() {
                match sys.operator_location_type {
                    remoteid::OperatorLocationType::Takeoff => {
                        d.takeoff_lat = Some(lat);
                        d.takeoff_lon = Some(lon);
                    }
                    _ => {
                        d.pilot_lat = Some(lat);
                        d.pilot_lon = Some(lon);
                    }
                }
            }
        }
        Message::OperatorId(op) => {
            d.operator_id = op.operator_id_str().map(|s| s.to_string());
        }
        _ => {}
    }
    d
}

/// Attach a MISB aimpoint echo to the sightings of one transmitter, as if a
/// node also heard that platform's ST 0601 feed. `corners` may be empty.
pub fn with_aimpoint(
    report: &mut DetectionReport,
    frame_center_lat: f64,
    frame_center_lon: f64,
    corners: Vec<[f64; 2]>,
) {
    report.sighting.misb = Some(MisbEcho {
        frame_center_lat,
        frame_center_lon,
        corners,
    });
}
