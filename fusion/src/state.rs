//! The fused live picture the aggregator serves and the page draws.

use serde::{Deserialize, Serialize};

/// A full current snapshot of the grid. Served by `/state` and pushed over
/// `/ws`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GridState {
    /// Snapshot time, unix ms.
    pub ts_ms: u64,
    /// Every known node and when it was last heard from.
    pub nodes: Vec<NodeState>,
    /// One fused entity per drone.
    pub entities: Vec<DroneEntity>,
    /// Field-wide flood verdict from remoteid-sentinel.
    pub flood: FloodState,
    /// Puppeteer pins: radios triangulated to a ground point.
    pub triangulation: Vec<Triangulation>,
    /// Event feed strings, newest last.
    pub ticker: Vec<TickerEvent>,
}

/// A node on the map.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeState {
    pub id: String,
    pub lat: f64,
    pub lon: f64,
    pub last_seen_ms: u64,
}

/// Field flood verdict.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FloodState {
    /// `clear`, `elevated` or `flooded`.
    pub level: String,
    /// 0..1 confidence.
    pub confidence: f32,
}

/// A triangulated puppeteer pin.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Triangulation {
    /// The radio (transmitter label) that was localized.
    pub transmitter: String,
    pub lat: f64,
    pub lon: f64,
    /// 0..1 confidence from the multilateration residual.
    pub confidence: f32,
    /// Nodes that contributed a range to the fix.
    pub node_ids: Vec<String>,
}

/// One line in the event ticker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TickerEvent {
    pub ts_ms: u64,
    pub text: String,
}

/// A latitude / longitude, optionally with altitude.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pos {
    pub lat: f64,
    pub lon: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alt_m: Option<f64>,
}

/// Registering country and clean registration string.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Registration {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reg: Option<String>,
}

/// What a drone's camera is looking at, from the MISB aimpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Watching {
    /// Aimpoint (camera frame center).
    pub lat: f64,
    pub lon: f64,
    /// Seconds the aimpoint has dwelt within a small radius, from the real
    /// [`remoteid::Trajectory`] on the aimpoint track.
    pub dwell_s: f64,
    /// Footprint quad: `[[lat, lon], ...]`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub footprint: Vec<[f64; 2]>,
}

/// One fused drone.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DroneEntity {
    /// Dedupe key: the transmitter label.
    pub transmitter: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uas_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub registration: Registration,
    /// remoteid trust verdict: authenticated / plausible / suspicious / spoofed.
    pub verdict: String,
    /// The reasons behind the verdict.
    pub reasons: Vec<String>,
    /// 0 (certainly fake) .. 1 (most likely the real drone).
    pub real_score: f32,
    /// Last reported drone position.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drone: Option<Pos>,
    /// Live pilot position, if broadcast.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pilot: Option<Pos>,
    /// Takeoff point, if broadcast.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub takeoff: Option<Pos>,
    /// What its camera is watching, if a MISB feed was heard.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub watching: Option<Watching>,
    /// Reported flight path, `[lat, lon]` samples.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub trail: Vec<[f64; 2]>,
    /// Nodes that heard this drone.
    pub heard_by: Vec<String>,
}
