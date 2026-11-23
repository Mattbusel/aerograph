//! The wire contract between a node and the aggregator.
//!
//! A [`DetectionReport`] is what one sensor emits per decoded Remote ID
//! frame-burst. Every field maps to something a real crate computes from a real
//! captured frame. The `decoded` and `misb` blocks are display echoes: the
//! aggregator re-decodes `raw_hex` with [`remoteid`] before it trusts them, so
//! the map never shows a number no crate produced.

use remoteid::{Transmitter, Transport};
use serde::{Deserialize, Serialize};

/// The schema tag every report carries.
pub const SCHEMA: &str = "aerograph.report.v1";

/// One decoded Remote ID sighting from one node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionReport {
    /// Always [`SCHEMA`].
    pub schema: String,
    /// The sensor that heard it.
    pub node: NodeInfo,
    /// The sighting itself.
    pub sighting: Sighting,
}

impl DetectionReport {
    /// A report with the schema tag set.
    pub fn new(node: NodeInfo, sighting: Sighting) -> Self {
        DetectionReport {
            schema: SCHEMA.to_string(),
            node,
            sighting,
        }
    }
}

/// The reporting node's own fixed position (needed for triangulation).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeInfo {
    /// Stable per sensor, e.g. `node-0007`.
    pub id: String,
    /// Node's own fixed GPS latitude.
    pub lat: f64,
    /// Node's own fixed GPS longitude.
    pub lon: f64,
    /// Node unix ms at capture.
    pub clock_ms: u64,
}

/// What the node decoded for one drone.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sighting {
    /// Capture time of the frame, unix ms.
    pub ts_ms: u64,
    /// Transport the frame arrived on, see [`transport_name`].
    pub transport: String,
    /// The [`remoteid::Transmitter`] label (MAC/addr or dji key); the dedupe
    /// key across nodes, e.g. `ble:aa:bb:cc:dd:ee:ff`.
    pub transmitter: String,
    /// Required for multi-node triangulation (log-distance path loss).
    pub rssi_dbm: i32,
    /// Remote ID message counter (trust continuity).
    pub counter: u32,
    /// The exact bytes the node decoded; the aggregator re-decodes this.
    pub raw_hex: String,
    /// Echo of what the node decoded, for convenience. `raw_hex` is the source
    /// of truth.
    pub decoded: Decoded,
    /// Present only if the node also heard a MISB 0601 KLV feed for this
    /// platform.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub misb: Option<MisbEcho>,
}

/// Display echo of the decoded Remote ID fields. Every field is optional: a
/// node omits what a frame did not carry rather than invent it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Decoded {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uas_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operator_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drone_lat: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drone_lon: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alt_m: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height_m: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pilot_lat: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pilot_lon: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub takeoff_lat: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub takeoff_lon: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub yaw_deg: Option<f64>,
}

/// Camera aimpoint echo, present only when a MISB 0601 feed was heard.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MisbEcho {
    /// `misb` Packet::frame_center, the point the camera is filming.
    pub frame_center_lat: f64,
    /// `misb` Packet::frame_center longitude.
    pub frame_center_lon: f64,
    /// `misb` Packet::corners, the footprint quad: `[[lat, lon], ...]`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub corners: Vec<[f64; 2]>,
}

/// Short lower-case transport name used on the wire.
pub fn transport_name(t: Transport) -> &'static str {
    match t {
        Transport::Bluetooth4 => "bluetooth4",
        Transport::Bluetooth5 => "bluetooth5",
        Transport::WifiBeacon => "wifi_beacon",
        Transport::WifiNan => "wifi_nan",
        Transport::Other => "dji_ocusync",
        Transport::Unknown => "unknown",
    }
}

/// Parse a wire transport name back to a [`Transport`].
pub fn transport_from_name(s: &str) -> Transport {
    match s {
        "bluetooth4" => Transport::Bluetooth4,
        "bluetooth5" => Transport::Bluetooth5,
        "wifi_beacon" => Transport::WifiBeacon,
        "wifi_nan" => Transport::WifiNan,
        "dji_ocusync" | "dji_wifi" => Transport::Other,
        _ => Transport::Unknown,
    }
}

/// Format a [`Transmitter`] as the stable wire label used as the dedupe key.
pub fn transmitter_label(tx: &Transmitter) -> String {
    match tx {
        Transmitter::Ble(a) => format!(
            "ble:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}",
            a[0], a[1], a[2], a[3], a[4], a[5]
        ),
        Transmitter::Wifi(a) => format!(
            "wifi:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}",
            a[0], a[1], a[2], a[3], a[4], a[5]
        ),
        Transmitter::Other(v) => format!("other:{v}"),
    }
}

/// Parse a wire transmitter label back to a [`Transmitter`]. Returns `None` for
/// a malformed label.
pub fn transmitter_from_label(s: &str) -> Option<Transmitter> {
    let (kind, rest) = s.split_once(':')?;
    match kind {
        "ble" | "wifi" => {
            let mut addr = [0u8; 6];
            let mut parts = rest.split(':');
            for b in addr.iter_mut() {
                *b = u8::from_str_radix(parts.next()?, 16).ok()?;
            }
            if parts.next().is_some() {
                return None;
            }
            Some(if kind == "ble" {
                Transmitter::Ble(addr)
            } else {
                Transmitter::Wifi(addr)
            })
        }
        "other" => rest.parse().ok().map(Transmitter::Other),
        _ => None,
    }
}

/// Hex-encode bytes for `raw_hex`.
pub fn to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Decode a `raw_hex` string into bytes.
pub fn from_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transmitter_round_trips() {
        let tx = Transmitter::Ble([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
        let label = transmitter_label(&tx);
        assert_eq!(label, "ble:aa:bb:cc:dd:ee:ff");
        assert_eq!(transmitter_from_label(&label), Some(tx));
    }

    #[test]
    fn hex_round_trips() {
        let bytes = [0x1e, 0x16, 0xfa, 0xff, 0x0d, 0x07];
        let hex = to_hex(&bytes);
        assert_eq!(hex, "1e16faff0d07");
        assert_eq!(from_hex(&hex).as_deref(), Some(&bytes[..]));
    }
}
