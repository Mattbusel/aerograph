//! Aerograph aggregator library: the axum app, its shared state, and the fusion
//! loop. Split out so integration tests can drive the real HTTP stack.

pub mod cot;

use std::sync::{Arc, Mutex};

use aerograph_fusion::report::DetectionReport;
use aerograph_fusion::state::{GridState, NodeState};
use aerograph_fusion::Grid;
use axum::extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;

/// Shared service state.
#[derive(Clone)]
pub struct App {
    grid: Arc<Mutex<Grid>>,
    latest: Arc<Mutex<GridState>>,
    tx: broadcast::Sender<String>,
}

impl Default for App {
    fn default() -> Self {
        App::new()
    }
}

impl App {
    /// A fresh app with an empty grid.
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel::<String>(64);
        App {
            grid: Arc::new(Mutex::new(Grid::new())),
            latest: Arc::new(Mutex::new(GridState::default())),
            tx,
        }
    }

    /// Ingest reports directly (used by the demo feed and tests).
    pub fn ingest_all(&self, reports: &[DetectionReport]) {
        self.grid.lock().unwrap().ingest_all(reports);
    }

    /// Run one fusion snapshot, store it as the latest, and broadcast it.
    pub fn pump(&self) -> GridState {
        let snap = self.grid.lock().unwrap().snapshot();
        if let Ok(json) = serde_json::to_string(&snap) {
            let _ = self.tx.send(json);
        }
        *self.latest.lock().unwrap() = snap.clone();
        snap
    }

    /// The latest stored snapshot.
    pub fn latest(&self) -> GridState {
        self.latest.lock().unwrap().clone()
    }

    /// Known nodes.
    pub fn nodes(&self) -> Vec<NodeState> {
        self.grid.lock().unwrap().nodes()
    }
}

/// Build the router for an app.
pub fn build_router(app: App) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/ingest", post(ingest))
        .route("/state", get(state))
        .route("/nodes", get(nodes))
        .route("/cot", get(cot_stream))
        .route("/ws", get(ws_upgrade))
        // Nodes send small reports, but an aggregator or a replay may batch many
        // at once. Allow a generous body.
        .layer(axum::extract::DefaultBodyLimit::max(64 * 1024 * 1024))
        .layer(CorsLayer::permissive())
        .with_state(app)
}

/// Spawn the 2 Hz snapshot + broadcast loop.
pub fn spawn_snapshot_loop(app: App) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_millis(500));
        loop {
            tick.tick().await;
            app.pump();
        }
    });
}

/// One or a batch of reports.
#[derive(serde::Deserialize)]
#[serde(untagged)]
enum Ingest {
    One(Box<DetectionReport>),
    Many(Vec<DetectionReport>),
}

async fn ingest(State(app): State<App>, Json(body): Json<Ingest>) -> impl IntoResponse {
    let n = match body {
        Ingest::One(r) => {
            app.ingest_all(std::slice::from_ref(&r));
            1
        }
        Ingest::Many(rs) => {
            app.ingest_all(&rs);
            rs.len()
        }
    };
    Json(serde_json::json!({ "accepted": n }))
}

async fn state(State(app): State<App>) -> impl IntoResponse {
    Json(app.latest())
}

async fn nodes(State(app): State<App>) -> impl IntoResponse {
    Json(app.nodes())
}

async fn healthz() -> impl IntoResponse {
    (StatusCode::OK, "ok")
}

async fn cot_stream(State(app): State<App>) -> impl IntoResponse {
    let xml = cot::grid_to_cot(&app.latest());
    ([(axum::http::header::CONTENT_TYPE, "application/xml")], xml)
}

async fn ws_upgrade(ws: WebSocketUpgrade, State(app): State<App>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| ws_run(socket, app))
}

async fn ws_run(mut socket: WebSocket, app: App) {
    let cold = serde_json::to_string(&app.latest()).unwrap_or_default();
    if socket.send(WsMessage::Text(cold)).await.is_err() {
        return;
    }
    let mut rx = app.tx.subscribe();
    loop {
        match rx.recv().await {
            Ok(json) => {
                if socket.send(WsMessage::Text(json)).await.is_err() {
                    break;
                }
            }
            Err(broadcast::error::RecvError::Lagged(_)) => continue,
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }
}
