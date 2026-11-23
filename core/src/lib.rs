//! Aerograph wasm fusion core: the JS bridge.
//!
//! All the real work lives in the shared [`aerograph_fusion`] crate, which the
//! server aggregator uses too, so the browser and the server run byte-identical
//! fusion. This crate is a thin wasm wrapper that:
//!
//! 1. builds the LABELED simulation of a city sensor mesh
//!    ([`aerograph_fusion::sim::GridSim`]): several virtual $6 nodes, a handful
//!    of honest moving drones, and one radio flooding the field with fake
//!    Remote ID identities from a single ground point,
//! 2. feeds each tick's [`DetectionReport`]s into the real fusion
//!    ([`aerograph_fusion::Grid`]), and
//! 3. returns the fused [`aerograph_fusion::GridState`] as JSON for the map.
//!
//! The simulation is only the INPUT. The decode, the trust verdicts, the flood
//! assessment, the camera aimpoint and the spoofer triangulation are the
//! production crate code. The camera aimpoint shown on the map is built as a
//! real MISB ST 0601 packet and parsed back with the `misb` crate here, so even
//! the simulated feed shows only a number a crate produced. The page must label
//! the mesh as a live simulation of the grid.

use std::collections::HashMap;

use aerograph_fusion::sim::{with_aimpoint, GridSim, GridSimConfig, SimNode};
use aerograph_fusion::Grid as FusionGrid;
use serde::Deserialize;
use wasm_bindgen::prelude::*;

// ---- Config from JS. ----
#[derive(Deserialize)]
struct CityCfg {
    center_lat: f64,
    center_lon: f64,
}
#[derive(Deserialize)]
struct NodeCfg {
    id: String,
    lat: f64,
    lon: f64,
}
#[derive(Deserialize)]
struct PuppeteerCfg {
    lat: f64,
    lon: f64,
}
#[derive(Deserialize)]
struct Config {
    city: CityCfg,
    #[serde(default)]
    nodes: Vec<NodeCfg>,
    #[serde(default = "d_drones")]
    drones: u32,
    #[serde(default = "d_flood_at")]
    flood_at_step: u32,
    /// Fake identities the flooding radio injects.
    #[serde(default = "d_fakes")]
    fakes_per_radio: u32,
    /// The flooding radio's true ground position. Defaults to a point a few
    /// hundred meters from the city center (what triangulation should recover).
    #[serde(default)]
    puppeteer: Option<PuppeteerCfg>,
    /// Below this RSSI (dBm) a node does not hear a frame.
    #[serde(default = "d_floor")]
    hearing_floor_dbm: f64,
}
fn d_drones() -> u32 {
    5
}
fn d_flood_at() -> u32 {
    0
}
fn d_fakes() -> u32 {
    120
}
fn d_floor() -> f64 {
    -99.0
}

/// Offset a lat/lon by meters east/north.
fn offset(lat: f64, lon: f64, east_m: f64, north_m: f64) -> (f64, f64) {
    let mlat = 111_320.0_f64;
    let mlon = 111_320.0_f64 * lat.to_radians().cos();
    (lat + north_m / mlat, lon + east_m / mlon.max(1.0))
}

/// The grid handle the browser keeps for the whole session.
#[wasm_bindgen]
pub struct Grid {
    sim: GridSim,
    grid: FusionGrid,
    /// The one drone we model as carrying a camera (the most-moving benign
    /// track), so the map shows a real MISB aimpoint on it.
    camera_label: Option<String>,
}

#[wasm_bindgen]
impl Grid {
    /// Create a grid from a JSON config:
    /// `{ city:{center_lat,center_lon}, nodes:[{id,lat,lon}], drones, flood_at_step, fakes_per_radio, puppeteer:{lat,lon}, hearing_floor_dbm }`.
    /// Only `city` is required; everything else defaults to a Manhattan mesh.
    #[wasm_bindgen(constructor)]
    pub fn new(config_json: &str) -> Result<Grid, JsValue> {
        let cfg: Config = serde_json::from_str(config_json)
            .map_err(|e| JsValue::from_str(&format!("bad config: {e}")))?;

        // Nodes: use the configured mesh, or a ring of 6 around the center.
        let nodes: Vec<SimNode> = if cfg.nodes.is_empty() {
            (0..6)
                .map(|i| {
                    let ang = (i as f64) * std::f64::consts::TAU / 6.0;
                    let (lat, lon) = offset(
                        cfg.city.center_lat,
                        cfg.city.center_lon,
                        ang.sin() * 500.0,
                        ang.cos() * 500.0,
                    );
                    SimNode {
                        id: format!("node-{:04}", i + 1),
                        lat,
                        lon,
                    }
                })
                .collect()
        } else {
            cfg.nodes
                .into_iter()
                .map(|n| SimNode {
                    id: n.id,
                    lat: n.lat,
                    lon: n.lon,
                })
                .collect()
        };

        // The puppeteer: configured, or ~250 m north-east of the center.
        let (plat, plon) = match cfg.puppeteer {
            Some(p) => (p.lat, p.lon),
            None => offset(cfg.city.center_lat, cfg.city.center_lon, 180.0, 180.0),
        };

        let sim_cfg = GridSimConfig {
            center_lat: cfg.city.center_lat,
            center_lon: cfg.city.center_lon,
            nodes,
            benign: cfg.drones.max(1),
            flood_ids: cfg.fakes_per_radio,
            puppeteer_lat: plat,
            puppeteer_lon: plon,
            flood_at_step: cfg.flood_at_step,
            hearing_floor_dbm: cfg.hearing_floor_dbm,
        };

        let sim = GridSim::new(sim_cfg);

        // Pick the camera drone once: the transmitter that moves the most, i.e.
        // a genuine benign drone rather than a frozen fake.
        let camera_label = pick_camera_label(&sim);

        Ok(Grid {
            sim,
            grid: FusionGrid::new(),
            camera_label,
        })
    }

    /// Advance the grid one tick and return the fused GridState JSON. The page
    /// loops this at about 2 Hz; the `step` argument is accepted for API
    /// symmetry but the simulation advances its own internal clock.
    pub fn run_grid(&mut self, _step: u32) -> String {
        let mut reports = self.sim.step();

        // Attach a real MISB aimpoint to the camera drone's sightings, built
        // and parsed with the misb crate so the number is crate-produced.
        if let Some(cam) = &self.camera_label {
            // Find the camera drone's current position and heading this tick.
            let mut here: Option<(f64, f64, f64, u64)> = None;
            for r in &reports {
                if &r.sighting.transmitter == cam {
                    if let (Some(lat), Some(lon)) =
                        (r.sighting.decoded.drone_lat, r.sighting.decoded.drone_lon)
                    {
                        let yaw = r.sighting.decoded.yaw_deg.unwrap_or(0.0);
                        here = Some((lat, lon, yaw, r.sighting.ts_ms));
                        break;
                    }
                }
            }
            if let Some((lat, lon, yaw, ts)) = here {
                // The camera looks ~70 m ahead along the heading, at the ground.
                let (clat, clon) = offset(
                    lat,
                    lon,
                    yaw.to_radians().sin() * 70.0,
                    yaw.to_radians().cos() * 70.0,
                );
                if let Some((flat, flon, corners)) = misb_aimpoint(ts * 1000, clat, clon) {
                    for r in reports.iter_mut() {
                        if &r.sighting.transmitter == cam {
                            with_aimpoint(r, flat, flon, corners.clone());
                        }
                    }
                }
            }
        }

        self.grid.ingest_all(&reports);
        let state = self.grid.snapshot();
        serde_json::to_string(&state).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
    }
}

/// Scan the whole simulated stream once and pick the transmitter with the most
/// distinct reported positions: a moving, genuine drone, the natural place to
/// put the demo camera.
fn pick_camera_label(sim: &GridSim) -> Option<String> {
    let mut seen: HashMap<String, std::collections::HashSet<(i64, i64)>> = HashMap::new();
    for r in sim.all_reports() {
        if let (Some(lat), Some(lon)) = (r.sighting.decoded.drone_lat, r.sighting.decoded.drone_lon)
        {
            let key = ((lat * 1e5) as i64, (lon * 1e5) as i64);
            seen.entry(r.sighting.transmitter.clone())
                .or_default()
                .insert(key);
        }
    }
    seen.into_iter()
        .max_by_key(|(_, p)| p.len())
        .filter(|(_, p)| p.len() >= 3)
        .map(|(label, _)| label)
}

/// Build a real MISB ST 0601 KLV local set whose frame center is the ground
/// point the camera is looking at, then parse it back with `misb` and return
/// the crate's own frame_center and footprint. This keeps the simulated camera
/// feed honest: the aimpoint is a number the misb crate produced, not invented.
fn misb_aimpoint(timestamp_us: u64, lat: f64, lon: f64) -> Option<(f64, f64, Vec<[f64; 2]>)> {
    use misb::st0601::{Builder, Packet, Tag};
    let mut b = Builder::new(timestamp_us);
    b.float(Tag::FrameCenterLatitude, lat).ok()?;
    b.float(Tag::FrameCenterLongitude, lon).ok()?;
    let (n, _) = offset(lat, lon, 0.0, 20.0);
    let (s, _) = offset(lat, lon, 0.0, -20.0);
    let (_, e) = offset(lat, lon, 20.0, 0.0);
    let (_, w) = offset(lat, lon, -20.0, 0.0);
    b.float(Tag::CornerLatitudePoint1Full, n).ok()?;
    b.float(Tag::CornerLongitudePoint1Full, e).ok()?;
    b.float(Tag::CornerLatitudePoint2Full, n).ok()?;
    b.float(Tag::CornerLongitudePoint2Full, w).ok()?;
    b.float(Tag::CornerLatitudePoint3Full, s).ok()?;
    b.float(Tag::CornerLongitudePoint3Full, w).ok()?;
    b.float(Tag::CornerLatitudePoint4Full, s).ok()?;
    b.float(Tag::CornerLongitudePoint4Full, e).ok()?;
    let klv = b.finish();

    let (packet, _) = Packet::parse_unverified(&klv).ok()?;
    let fc = packet.frame_center()?;
    let corners = packet
        .corners()
        .map(|cs| cs.iter().map(|p| [p.lat, p.lon]).collect())
        .unwrap_or_default();
    Some((fc.lat, fc.lon, corners))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manhattan_cfg() -> String {
        let center = [40.7411, -73.9897];
        let mut nodes = String::new();
        for i in 0..8 {
            let ang = (i as f64) * std::f64::consts::TAU / 8.0;
            let (lat, lon) = offset(center[0], center[1], ang.sin() * 500.0, ang.cos() * 500.0);
            if i > 0 {
                nodes.push(',');
            }
            nodes.push_str(&format!(
                "{{\"id\":\"node-{:04}\",\"lat\":{lat},\"lon\":{lon}}}",
                i + 1
            ));
        }
        format!(
            "{{\"city\":{{\"center_lat\":{},\"center_lon\":{}}},\"nodes\":[{}],\"drones\":4,\"fakes_per_radio\":120,\"puppeteer\":{{\"lat\":40.7402,\"lon\":-73.9881}}}}",
            center[0], center[1], nodes
        )
    }

    #[test]
    fn bridge_runs_and_fuses() {
        let mut grid = match Grid::new(&manhattan_cfg()) {
            Ok(g) => g,
            Err(_) => panic!("config rejected"),
        };
        let mut last = String::new();
        for s in 0..20 {
            last = grid.run_grid(s);
        }
        let v: serde_json::Value = serde_json::from_str(&last).unwrap();
        let ents = v["entities"].as_array().unwrap().len();
        let flood = v["flood"]["level"].as_str().unwrap_or("");
        let tri = v["triangulation"].as_array().unwrap().len();
        let watching = v["entities"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e.get("watching").map(|w| !w.is_null()).unwrap_or(false))
            .count();
        println!(
            "entities={ents} flood={flood} triangulation={tri} watching={watching}"
        );
        assert!(ents >= 1, "should fuse at least one drone");
        assert!(
            v["nodes"].as_array().unwrap().len() >= 3,
            "nodes should register"
        );
    }

    #[test]
    fn camera_aimpoint_is_crate_produced() {
        let out = misb_aimpoint(1_732_300_000_000_000, 40.7401, -73.9890).expect("misb None");
        assert!((out.0 - 40.7401).abs() < 0.01);
        assert!((out.1 + 73.9890).abs() < 0.01);
        assert_eq!(out.2.len(), 4, "footprint should have four corners");
    }
}
