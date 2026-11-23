//! End-to-end grid test over a simulated multi-node city mesh with a known
//! spoof flood. The fusion is the real crate code; only the input is the
//! labelled simulation. We assert the aggregator fuses the one genuine drone,
//! flags the flood, and localizes the puppeteer radio within tolerance.

use aerograph_fusion::sim::{GridSim, GridSimConfig, SimNode};
use aerograph_fusion::triangulate::ground_distance_m;
use aerograph_fusion::Grid;

fn test_config() -> GridSimConfig {
    GridSimConfig {
        center_lat: 40.7411,
        center_lon: -73.9897,
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
        benign: 3,
        flood_ids: 60,
        puppeteer_lat: 40.7402,
        puppeteer_lon: -73.9881,
        flood_at_step: 0,
        hearing_floor_dbm: -99.0,
    }
}

#[test]
fn fuses_flags_and_localizes() {
    let cfg = test_config();
    let (plat, plon) = (cfg.puppeteer_lat, cfg.puppeteer_lon);
    let sim = GridSim::new(cfg);
    let reports = sim.all_reports();
    assert!(!reports.is_empty(), "sim produced reports");

    let mut grid = Grid::new();
    grid.ingest_all(&reports);
    let state = grid.snapshot();

    // Nodes are on the map.
    assert_eq!(state.nodes.len(), 5, "all five nodes registered");

    // The flood is flagged: one radio broadcasting many IDs drives the
    // sentinel's fan-out term.
    assert_eq!(
        state.flood.level, "flooded",
        "flood level was {:?} (confidence {})",
        state.flood.level, state.flood.confidence
    );
    assert!(state.flood.confidence >= 0.6);

    // At least one genuine drone was fused and graded as not-fake.
    let genuine = state
        .entities
        .iter()
        .filter(|e| e.real_score > 0.5 && e.drone.is_some())
        .count();
    assert!(
        genuine >= 1,
        "expected a genuine drone, entities: {}",
        state.entities.len()
    );

    // Every entity was deduped across multiple nodes.
    let multi_node = state
        .entities
        .iter()
        .filter(|e| e.heard_by.len() >= 3)
        .count();
    assert!(multi_node >= 1, "entities should be heard by several nodes");

    // One drone carries a MISB camera feed; its aimpoint and footprint come
    // from the real misb decoder, and dwell accumulates while it loiters.
    let watcher = state
        .entities
        .iter()
        .find(|e| e.watching.is_some())
        .expect("a camera platform");
    let w = watcher.watching.as_ref().unwrap();
    assert_eq!(w.footprint.len(), 4, "misb footprint quad");
    assert!(w.dwell_s > 0.0, "dwell should accumulate while loitering");

    // The puppeteer is triangulated to its true ground point.
    assert!(!state.triangulation.is_empty(), "expected a puppeteer pin");
    let best = state
        .triangulation
        .iter()
        .map(|t| (t, ground_distance_m(t.lat, t.lon, plat, plon)))
        .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
        .unwrap();
    assert!(
        best.1 < 60.0,
        "puppeteer localized {:.1} m from truth (pin {:.5},{:.5}) with {} nodes, conf {:.2}",
        best.1,
        best.0.lat,
        best.0.lon,
        best.0.node_ids.len(),
        best.0.confidence
    );
    assert!(best.0.node_ids.len() >= 3, "fix used at least three nodes");
}

#[test]
fn honest_decode_round_trip() {
    // A report's raw_hex re-decodes to the same thing the node echoed: the
    // aggregator never trusts the echo, it re-runs the real decoder.
    let sim = GridSim::new(test_config());
    let reports = sim.all_reports();
    let with_pos = reports
        .iter()
        .find(|r| r.sighting.decoded.drone_lat.is_some())
        .expect("a location report");
    let bytes = aerograph_fusion::report::from_hex(&with_pos.sighting.raw_hex).unwrap();
    let msg = remoteid::Message::decode(&bytes).unwrap();
    if let remoteid::Message::Location(loc) = msg {
        assert!((loc.latitude - with_pos.sighting.decoded.drone_lat.unwrap()).abs() < 1e-6);
    } else {
        panic!("expected a re-decoded Location");
    }
}
