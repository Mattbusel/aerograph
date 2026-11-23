//! End-to-end HTTP test: POST simulated city-mesh reports to a live aggregator,
//! then read back the fused state, nodes and CoT over real HTTP.

use aerograph_aggregator::{build_router, spawn_snapshot_loop, App};
use aerograph_fusion::sim::{GridSim, GridSimConfig, SimNode};

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

#[tokio::test]
async fn serves_the_live_grid_over_http() {
    let app = App::new();
    spawn_snapshot_loop(app.clone());
    let router = build_router(app);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    let reports = GridSim::new(test_config()).all_reports();
    let base = format!("http://{addr}");

    // All HTTP calls run on a blocking thread (ureq is blocking).
    let out = tokio::task::spawn_blocking(move || {
        // healthz
        let health = ureq::get(&format!("{base}/healthz")).call().unwrap();
        assert_eq!(health.status(), 200);

        // ingest the whole stream, in chunks as a mesh of nodes would.
        for chunk in reports.chunks(2000) {
            let resp = ureq::post(&format!("{base}/ingest"))
                .send_json(chunk)
                .unwrap();
            assert_eq!(resp.status(), 200);
        }

        // give the 2 Hz snapshot loop a beat to fuse
        std::thread::sleep(std::time::Duration::from_millis(700));

        // state
        let state: serde_json::Value = ureq::get(&format!("{base}/state"))
            .call()
            .unwrap()
            .into_json()
            .unwrap();
        let flood = state["flood"]["level"].as_str().unwrap().to_string();
        let entities = state["entities"].as_array().unwrap().len();
        let pins = state["triangulation"].as_array().unwrap().len();

        // nodes
        let nodes: serde_json::Value = ureq::get(&format!("{base}/nodes"))
            .call()
            .unwrap()
            .into_json()
            .unwrap();
        let node_count = nodes.as_array().unwrap().len();

        // cot
        let cot = ureq::get(&format!("{base}/cot"))
            .call()
            .unwrap()
            .into_string()
            .unwrap();

        (flood, entities, pins, node_count, cot)
    })
    .await
    .unwrap();

    let (flood, entities, pins, node_count, cot) = out;
    assert_eq!(flood, "flooded", "flood should be flagged");
    assert!(entities >= 1, "expected fused entities");
    assert!(pins >= 1, "expected a triangulated puppeteer pin");
    assert_eq!(node_count, 5, "all nodes registered");
    assert!(cot.contains("<event"), "cot should be CoT XML");
    assert!(
        cot.contains("puppeteer"),
        "cot should include the spoofer marker"
    );
}
