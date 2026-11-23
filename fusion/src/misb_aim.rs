//! Real MISB ST 0601 aimpoint: what a drone's camera is filming.
//!
//! The node hears a platform's MPEG-TS KLV feed; this is the piece that turns it
//! into an aimpoint. We build a genuine ST 0601 local set with the `misb` crate
//! (frame center plus the four offset corner points), encode it to KLV bytes,
//! and decode it straight back with [`misb::st0601::Packet`]. The lat/lon the
//! map shows is therefore a number the misb decoder produced from KLV, not one
//! we made up. On a real node the same `Packet::frame_center` / `corners` runs
//! over bytes off the air; here it runs over bytes we just encoded, which is why
//! the demo is honest about being a simulation.

use misb::st0601::{Builder, Packet, Tag};

/// Encode and re-decode an ST 0601 aimpoint. `half_deg` is the half-size of the
/// footprint quad in degrees (kept within the +/-0.075 offset range).
///
/// Returns the misb-decoded `(frame_center_lat, frame_center_lon, footprint)`,
/// where footprint is `[[lat, lon]; 4]`.
pub fn aimpoint(
    ts_us: u64,
    center_lat: f64,
    center_lon: f64,
    half_deg: f64,
) -> Option<(f64, f64, Vec<[f64; 2]>)> {
    let h = half_deg.clamp(0.0, 0.07);
    let mut b = Builder::new(ts_us);
    b.float(Tag::FrameCenterLatitude, center_lat).ok()?;
    b.float(Tag::FrameCenterLongitude, center_lon).ok()?;
    // Upper-left, upper-right, lower-right, lower-left, as offsets from centre.
    let quad = [(-h, -h), (-h, h), (h, h), (h, -h)];
    let tags = [
        (
            Tag::OffsetCornerLatitudePoint1,
            Tag::OffsetCornerLongitudePoint1,
        ),
        (
            Tag::OffsetCornerLatitudePoint2,
            Tag::OffsetCornerLongitudePoint2,
        ),
        (
            Tag::OffsetCornerLatitudePoint3,
            Tag::OffsetCornerLongitudePoint3,
        ),
        (
            Tag::OffsetCornerLatitudePoint4,
            Tag::OffsetCornerLongitudePoint4,
        ),
    ];
    for (&(dlat, dlon), &(tla, tlo)) in quad.iter().zip(tags.iter()) {
        b.float(tla, dlat).ok()?;
        b.float(tlo, dlon).ok()?;
    }
    let packet = b.finish();

    // Decode it back with the real misb decoder (full UL-keyed packet with its
    // checksum, exactly as it would arrive in an MPEG-TS KLV stream).
    let (pkt, _) = Packet::parse(&packet).ok()?;
    let fc = pkt.frame_center()?;
    let footprint = pkt
        .corners()
        .map(|c| c.iter().map(|g| [g.lat, g.lon]).collect())
        .unwrap_or_default();
    Some((fc.lat, fc.lon, footprint))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_the_aimpoint_it_encoded() {
        let (lat, lon, quad) = aimpoint(1_700_000_000_000_000, 40.7401, -73.9890, 0.0005).unwrap();
        // ST 0601 lat/lon quantize to ~ a few cm; well under a metre.
        assert!((lat - 40.7401).abs() < 1e-4, "lat {lat}");
        assert!((lon + 73.9890).abs() < 1e-4, "lon {lon}");
        assert_eq!(quad.len(), 4);
        // The footprint surrounds the centre.
        assert!(quad.iter().any(|p| p[0] < lat) && quad.iter().any(|p| p[0] > lat));
    }
}
