//! Aerograph aggregator binary.
//!
//! Many nodes POST `DetectionReport`s here. The aggregator re-decodes each one,
//! fuses them into one live `GridState` with the real crate code, and serves
//! the live picture over HTTP and a WebSocket. A flood of fakes from one radio
//! is collapsed to a single triangulated pin on the operator. See the library
//! crate for the app and router.

use std::net::SocketAddr;

use aerograph_aggregator::{build_router, spawn_snapshot_loop, App};
use aerograph_fusion::sim::{GridSim, GridSimConfig};

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let addr: SocketAddr = args
        .iter()
        .position(|a| a == "--bind")
        .and_then(|i| args.get(i + 1))
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| "0.0.0.0:8787".parse().unwrap());
    let seed = args.iter().any(|a| a == "--demo");

    let app = App::new();

    // Optional self-contained demo: an internal labelled simulated city mesh
    // feeds the aggregator, so the service shows a live grid with no external
    // nodes. The map must present this as a simulation.
    if seed {
        spawn_demo_feed(app.clone());
    }
    spawn_snapshot_loop(app.clone());

    let router = build_router(app);
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    eprintln!("aerograph-aggregator listening on http://{addr}");
    eprintln!("  POST /ingest   GET /state  /ws  /nodes  /cot  /healthz");
    axum::serve(listener, router).await.expect("serve");
}

fn spawn_demo_feed(app: App) {
    tokio::spawn(async move {
        let mut sim = GridSim::new(GridSimConfig::manhattan());
        let mut tick = tokio::time::interval(std::time::Duration::from_millis(500));
        loop {
            tick.tick().await;
            let reports = sim.step();
            app.ingest_all(&reports);
        }
    });
}
