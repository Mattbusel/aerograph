// Live aircraft proxy + trust layer for Aerograph. REAL data only, from the
// adsb.lol crowd-sourced ADS-B / MLAT network (free, no key). Unlike a plane-
// spotting map, this does not just plot tracks: it judges each one using the
// real ADS-B integrity metadata (NIC / NACp / SIL), the squawk/emergency
// fields, and whether the position is self-reported, mesh-triangulated (MLAT)
// or rebroadcast (TIS-B). No simulation anywhere.

const CONUS_SWEEP = [
  [40.7, -74.0], [34.05, -118.24], [41.88, -87.63], [32.78, -96.8],
  [33.75, -84.39], [25.76, -80.19], [47.61, -122.33], [39.74, -104.99],
  [29.76, -95.37], [38.9, -77.04], [44.98, -93.27], [36.17, -115.14],
];
const EMERGENCY_SQUAWK = new Set(["7500", "7600", "7700"]);

function classify(a) {
  const sq = a.squawk != null ? String(a.squawk) : "";
  const emg = a.emergency && a.emergency !== "none" && a.emergency !== "";
  if (EMERGENCY_SQUAWK.has(sq) || emg) return "emergency";
  // Position present but zero integrity: the shape a spoofed / ghost track
  // takes, and what honest equipment almost never looks like.
  const hasPos = a.lat != null && a.lon != null;
  const nic = a.nic, sil = a.sil, nacp = a.nac_p;
  if (hasPos && (nic === 0 || sil === 0 || nacp === 0)) return "unverified";
  if (Array.isArray(a.mlat) ? a.mlat.length > 0 : !!a.mlat) return "mlat";
  if (Array.isArray(a.tisb) ? a.tisb.length > 0 : !!a.tisb) return "tisb";
  return "ok";
}

function normalize(ac) {
  return ac.filter((a) => a.lat != null && a.lon != null).map((a) => ({
    hex: a.hex, flight: (a.flight || "").trim(), lat: a.lat, lon: a.lon,
    alt_baro: a.alt_baro, gs: a.gs, track: a.track, type: a.t,
    squawk: a.squawk, emergency: a.emergency,
    nic: a.nic, nac_p: a.nac_p, sil: a.sil,
    cls: classify(a),
  }));
}

async function fetchPoint(lat, lon, radius) {
  const url = `https://api.adsb.lol/v2/point/${lat}/${lon}/${Math.round(radius)}`;
  const r = await fetch(url, { headers: { "User-Agent": "aerograph-live (open drone awareness grid; github.com/Mattbusel/aerograph)" } });
  if (!r.ok) return [];
  const data = await r.json();
  return normalize(Array.isArray(data.ac) ? data.ac : []);
}

async function pooled(items, cap, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: cap }, async () => {
    while (i < items.length) { const idx = i++; try { out.push(await fn(items[idx])); } catch { out.push([]); } }
  }));
  return out;
}

export default async function handler(req, res) {
  const q = req.query || {};
  const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  try {
    let aircraft = [];
    if (q.national != null) {
      const seen = new Set();
      const batches = await pooled(CONUS_SWEEP, 3, ([la, lo]) => fetchPoint(la, lo, 250));
      for (const b of batches) for (const a of b) { if (a.hex && !seen.has(a.hex)) { seen.add(a.hex); aircraft.push(a); } }
    } else {
      const lat = num(q.lat, 39.5), lon = num(q.lon, -98.35);
      const radius = Math.min(250, Math.max(1, num(q.radius, 250)));
      aircraft = await fetchPoint(lat, lon, radius);
    }
    const count = (c) => aircraft.filter((a) => a.cls === c).length;
    const summary = {
      total: aircraft.length,
      emergency: count("emergency"),
      unverified: count("unverified"),
      mlat: count("mlat"),
      flagged: count("emergency") + count("unverified"),
    };
    if (aircraft.length > 0) res.setHeader("Cache-Control", "s-maxage=12, stale-while-revalidate=600");
    else res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ source: "adsb.lol", ...summary, aircraft });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ source: "adsb.lol", total: 0, emergency: 0, unverified: 0, mlat: 0, flagged: 0, aircraft: [], error: String(e) });
  }
}
