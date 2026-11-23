//! Spoofer triangulation by log-distance path-loss multilateration.
//!
//! When one radio floods the field with hundreds of fake drones, every node
//! still hears that one physical transmitter, each at a signal strength set by
//! its own distance to it. Inverting the log-distance path-loss model turns
//! each node's RSSI into a range estimate, and a least-squares intersection of
//! those ranges drops a pin on the operator. This is the honest geometry: no
//! node ever reports a position for the puppeteer, only how loud it was.

/// Reference received power at 1 m, dBm. The grid's agreed `P_tx` for the
/// inversion. The node encodes RSSI with the same constant. ~0 dBm is a typical
/// Bluetooth advertising transmit level.
pub const TX_POWER_DBM: f64 = 0.0;

/// Log-distance path-loss exponent. ~2.5 models an urban mesh (free space is
/// 2.0, heavy clutter 3.5+). With `TX_POWER_DBM = 0`, a sensor hears a drone at
/// -50 dBm at 100 m and -75 dBm at 1 km, the range a real BLE Remote ID node
/// covers.
pub const PATH_LOSS_EXP: f64 = 2.5;

/// Metres per degree of latitude (and of longitude at the equator).
const METERS_PER_DEG: f64 = 111_320.0;

/// Forward model: expected RSSI (dBm) at `distance_m` from the transmitter.
/// The node uses this to encode; exposed so the simulation and the solver agree
/// on one physics.
pub fn rssi_at(distance_m: f64) -> f64 {
    let d = distance_m.max(1.0);
    TX_POWER_DBM - 10.0 * PATH_LOSS_EXP * d.log10()
}

/// Inverse model: range estimate (metres) from a measured RSSI.
pub fn range_from_rssi(rssi_dbm: f64) -> f64 {
    10f64.powf((TX_POWER_DBM - rssi_dbm) / (10.0 * PATH_LOSS_EXP))
}

/// One node's measurement of a radio: its fixed position and the RSSI it heard.
#[derive(Debug, Clone, Copy)]
pub struct NodeRange {
    pub lat: f64,
    pub lon: f64,
    pub rssi_dbm: f64,
}

/// A triangulation result in geographic coordinates.
#[derive(Debug, Clone, Copy)]
pub struct Fix {
    pub lat: f64,
    pub lon: f64,
    /// 0..1, from the RMS range residual (1 m residual -> ~1.0, large -> ~0).
    pub confidence: f32,
}

/// Solve for a transmitter position from three or more node RSSI measurements.
///
/// Returns `None` with fewer than three ranges (a unique 2-D fix needs three).
/// Works in a local equirectangular plane centred on the node centroid, inverts
/// each RSSI to a range, and least-squares solves the linearized circle
/// intersection.
pub fn locate(nodes: &[NodeRange]) -> Option<Fix> {
    if nodes.len() < 3 {
        return None;
    }

    // Local plane centred on the node centroid.
    let lat0 = nodes.iter().map(|n| n.lat).sum::<f64>() / nodes.len() as f64;
    let lon0 = nodes.iter().map(|n| n.lon).sum::<f64>() / nodes.len() as f64;
    let coslat = lat0.to_radians().cos();

    struct P {
        x: f64,
        y: f64,
        r: f64,
    }
    let pts: Vec<P> = nodes
        .iter()
        .map(|n| P {
            x: (n.lon - lon0) * METERS_PER_DEG * coslat,
            y: (n.lat - lat0) * METERS_PER_DEG,
            r: range_from_rssi(n.rssi_dbm),
        })
        .collect();

    // Linearize by subtracting the first circle equation from every other:
    //   (x - xi)^2 + (y - yi)^2 = ri^2
    // minus the i=0 equation gives, for each i >= 1, a linear row:
    //   2(xi - x0) X + 2(yi - y0) Y = ri0 ... (see below)
    let p0 = &pts[0];
    let (mut a11, mut a12, mut a22) = (0.0f64, 0.0f64, 0.0f64);
    let (mut b1, mut b2) = (0.0f64, 0.0f64);
    for p in &pts[1..] {
        let ax = 2.0 * (p.x - p0.x);
        let ay = 2.0 * (p.y - p0.y);
        let bb = p0.r * p0.r - p.r * p.r - (p0.x * p0.x - p.x * p.x) - (p0.y * p0.y - p.y * p.y);
        // Accumulate normal equations A^T A and A^T b.
        a11 += ax * ax;
        a12 += ax * ay;
        a22 += ay * ay;
        b1 += ax * bb;
        b2 += ay * bb;
    }

    // Solve the 2x2 normal system.
    let det = a11 * a22 - a12 * a12;
    if det.abs() < 1e-9 {
        return None;
    }
    let x = (b1 * a22 - b2 * a12) / det;
    let y = (a11 * b2 - a12 * b1) / det;

    // RMS residual between the solved point's ranges and the measured ranges.
    let mut sq = 0.0;
    for p in &pts {
        let d = ((x - p.x).powi(2) + (y - p.y).powi(2)).sqrt();
        sq += (d - p.r).powi(2);
    }
    let rms = (sq / pts.len() as f64).sqrt();
    // Confidence: a soft falloff on the residual, scaled by a 50 m tolerance.
    let confidence = (1.0 / (1.0 + rms / 50.0)) as f32;

    Some(Fix {
        lat: lat0 + y / METERS_PER_DEG,
        lon: lon0 + x / (METERS_PER_DEG * coslat),
        confidence,
    })
}

/// Great-circle-ish ground distance between two points, metres (equirectangular
/// approximation, fine at city scale).
pub fn ground_distance_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let coslat = ((lat1 + lat2) / 2.0).to_radians().cos();
    let dx = (lon2 - lon1) * METERS_PER_DEG * coslat;
    let dy = (lat2 - lat1) * METERS_PER_DEG;
    (dx * dx + dy * dy).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rssi_inverts() {
        for d in [10.0, 50.0, 200.0, 800.0] {
            let r = rssi_at(d);
            assert!((range_from_rssi(r) - d).abs() < 1e-6, "d={d} r={r}");
        }
    }

    #[test]
    fn locates_a_known_emitter() {
        // Emitter at a known point; four nodes around it in Manhattan.
        let (elat, elon) = (40.7411, -73.9897);
        let node_pts = [
            (40.7440, -73.9930),
            (40.7390, -73.9870),
            (40.7450, -73.9860),
            (40.7385, -73.9935),
        ];
        let nodes: Vec<NodeRange> = node_pts
            .iter()
            .map(|&(lat, lon)| NodeRange {
                lat,
                lon,
                rssi_dbm: rssi_at(ground_distance_m(lat, lon, elat, elon)),
            })
            .collect();
        let fix = locate(&nodes).expect("fix");
        let err = ground_distance_m(fix.lat, fix.lon, elat, elon);
        assert!(err < 15.0, "localized {err:.1} m from truth");
        assert!(fix.confidence > 0.9);
    }

    #[test]
    fn needs_three_nodes() {
        let nodes = [
            NodeRange {
                lat: 40.74,
                lon: -73.99,
                rssi_dbm: -60.0,
            },
            NodeRange {
                lat: 40.75,
                lon: -73.98,
                rssi_dbm: -62.0,
            },
        ];
        assert!(locate(&nodes).is_none());
    }
}
