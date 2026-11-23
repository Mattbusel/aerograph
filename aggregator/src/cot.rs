//! Fused entities to Cursor on Target.
//!
//! The `/cot` endpoint renders the live grid as CoT XML so a TAK client can
//! consume the exact same picture as the map, proof that the grid produces real
//! operational output. The XML is built by `uas_cot`'s own [`Event`] type, with
//! the trust verdict carried in the remarks. Takeoff and pilot points, when a
//! drone broadcasts them, become their own ground markers.

use aerograph_fusion::state::GridState;
use uas_cot::{Event, Point};

/// How long each marker stays valid on a TAK map, seconds.
const STALE_SECS: u64 = 60;

/// Render the whole grid as a sequence of CoT events, newline separated.
pub fn grid_to_cot(grid: &GridState) -> String {
    let now_us = grid.ts_ms.saturating_mul(1000);
    let mut out = String::new();
    for e in &grid.entities {
        let id = e.uas_id.clone().unwrap_or_else(|| e.transmitter.clone());
        if let Some(drone) = &e.drone {
            let mut ev = Event::new(
                format!("aerograph-{id}"),
                "a-u-A", // unknown air track
                now_us,
                STALE_SECS,
            );
            ev.point = Point::new(drone.lat, drone.lon, drone.alt_m.unwrap_or(0.0));
            ev.callsign = Some(match &e.model {
                Some(m) => format!("{id} ({m})"),
                None => id.clone(),
            });
            let reasons = if e.reasons.is_empty() {
                String::new()
            } else {
                format!(" [{}]", e.reasons.join(", "))
            };
            ev.remarks = Some(format!(
                "Aerograph verdict: {} (real_score {:.2}){reasons}. Heard by {} node(s).",
                e.verdict,
                e.real_score,
                e.heard_by.len()
            ));
            out.push_str(&ev.to_xml());
            out.push('\n');
        }
        // Takeoff marker, kept separate from the aircraft and the pilot.
        if let Some(t) = &e.takeoff {
            let mut ev = Event::new(
                format!("aerograph-takeoff-{id}"),
                "b-m-p-s-p-loc",
                now_us,
                STALE_SECS,
            );
            ev.point = Point::new(t.lat, t.lon, 0.0);
            ev.callsign = Some(format!("Takeoff of {id}"));
            out.push_str(&ev.to_xml());
            out.push('\n');
        }
        // Live pilot marker.
        if let Some(p) = &e.pilot {
            let mut ev = Event::new(format!("aerograph-pilot-{id}"), "a-u-G", now_us, STALE_SECS);
            ev.point = Point::new(p.lat, p.lon, 0.0);
            ev.callsign = Some(format!("Operator of {id}"));
            out.push_str(&ev.to_xml());
            out.push('\n');
        }
    }
    // Triangulated puppeteers as hostile ground markers.
    for pin in &grid.triangulation {
        let mut ev = Event::new(
            format!("aerograph-puppeteer-{}", pin.transmitter),
            "a-h-G", // hostile ground
            now_us,
            STALE_SECS,
        );
        ev.point = Point::new(pin.lat, pin.lon, 0.0);
        ev.callsign = Some(format!("Spoofer radio {}", pin.transmitter));
        ev.remarks = Some(format!(
            "Triangulated flood source, confidence {:.2}, {} nodes.",
            pin.confidence,
            pin.node_ids.len()
        ));
        out.push_str(&ev.to_xml());
        out.push('\n');
    }
    out
}
