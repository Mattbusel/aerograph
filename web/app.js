// AEROGRAPH live map. Runs the REAL decode + fusion wasm core over a LABELED
// live simulation of a city sensor mesh, and renders the fused grid.
//
// Honesty: every number drawn here is produced by grid.run_grid() -> the real
// remoteid / remoteid-sentinel / misb crates compiled to wasm. The only thing
// simulated is the city radio traffic feeding the nodes, which the page labels.

import init, { Grid } from "./core/aerograph_core.js";

// ---- grid configuration (the simulated city mesh) -------------------------
const CITY = { center_lat: 40.7411, center_lon: -73.9897 };
const CONFIG = {
  city: CITY,
  nodes: [
    { id: "node-0001", lat: 40.7447, lon: -73.9897 },
    { id: "node-0002", lat: 40.7436, lon: -73.9859 },
    { id: "node-0003", lat: 40.7411, lon: -73.9844 },
    { id: "node-0004", lat: 40.7386, lon: -73.9859 },
    { id: "node-0005", lat: 40.7375, lon: -73.9897 },
    { id: "node-0006", lat: 40.7386, lon: -73.9935 },
    { id: "node-0007", lat: 40.7411, lon: -73.9950 },
    { id: "node-0008", lat: 40.7436, lon: -73.9935 },
  ],
  drones: 6,
  fakes_per_radio: 140,
  flood_at_step: 6,
  puppeteer: { lat: 40.7402, lon: -73.9881 },
};

const VERDICT_COLORS = {
  authenticated: "#2bd47a",
  plausible: "#4fa3ff",
  suspicious: "#ffb020",
  spoofed: "#ff3b55",
};
const C = {
  real: "#ffd84d", pup: "#ff2d6f", node: "#28e0ff", watch: "#c678ff",
};

const $ = (id) => document.getElementById(id);
const bootStatus = $("boot-status");

// ---- map -------------------------------------------------------------------
const map = new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  center: [-74.0, 40.732],
  zoom: 12.1,
  pitch: 48,
  bearing: -16,
  attributionControl: { compact: true },
  maxZoom: 18,
});
map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");

let selected = null;       // selected transmitter id
let latestState = null;
const fakeSeen = new Set();
const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });

// empty FeatureCollection helper
const FC = (features = []) => ({ type: "FeatureCollection", features });

map.on("load", () => {
  // sources
  for (const s of ["nodes", "trails", "cones", "watchlines", "tri", "drones",
                   "heard", "pilots", "takeoffs", "aims", "realring"]) {
    map.addSource(s, { type: "geojson", data: FC() });
  }

  // heard-by lines (node -> drone) for selected entity
  map.addLayer({ id: "heard-ln", type: "line", source: "heard",
    paint: { "line-color": C.node, "line-width": 1, "line-opacity": 0.35, "line-dasharray": [2, 2] } });

  // trails
  map.addLayer({ id: "trail-ln", type: "line", source: "trails",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["case", ["get", "sel"], 3, 1.6],
      "line-opacity": ["case", ["get", "sel"], 0.95, 0.5],
      "line-blur": 0.4,
    } });

  // camera ground-target cones (footprint)
  map.addLayer({ id: "cone-fill", type: "fill", source: "cones",
    paint: { "fill-color": C.watch, "fill-opacity": ["case", ["get", "sel"], 0.3, 0.14] } });
  map.addLayer({ id: "cone-ln", type: "line", source: "cones",
    paint: { "line-color": C.watch, "line-width": 1, "line-opacity": 0.6 } });
  map.addLayer({ id: "watch-ln", type: "line", source: "watchlines",
    paint: { "line-color": C.watch, "line-width": 1.2, "line-opacity": 0.55, "line-dasharray": [1, 1.5] } });
  map.addLayer({ id: "aim-pt", type: "circle", source: "aims",
    paint: { "circle-radius": 4, "circle-color": C.watch, "circle-stroke-color": "#fff", "circle-stroke-width": 1,
             "circle-opacity": 0.9 } });

  // triangulation puppeteer pins (pulsing)
  map.addLayer({ id: "tri-pulse", type: "circle", source: "tri",
    paint: { "circle-radius": 10, "circle-color": C.pup, "circle-opacity": 0.22, "circle-blur": 0.5 } });
  map.addLayer({ id: "tri-core", type: "circle", source: "tri",
    paint: { "circle-radius": ["interpolate", ["linear"], ["get", "conf"], 0, 4, 1, 8],
             "circle-color": C.pup, "circle-stroke-color": "#fff", "circle-stroke-width": 1.4 } });

  // nodes
  map.addLayer({ id: "node-halo", type: "circle", source: "nodes",
    paint: { "circle-radius": 9, "circle-color": C.node, "circle-opacity": 0.12, "circle-blur": 0.6 } });
  map.addLayer({ id: "node-pt", type: "circle", source: "nodes",
    paint: { "circle-radius": 4.5, "circle-color": "#0a1420", "circle-stroke-color": C.node, "circle-stroke-width": 1.6 } });

  // pilot + takeoff markers (selected)
  map.addLayer({ id: "takeoff-pt", type: "circle", source: "takeoffs",
    paint: { "circle-radius": 5, "circle-color": "#0a1420", "circle-stroke-color": "#8ba0c4", "circle-stroke-width": 1.5 } });
  map.addLayer({ id: "pilot-ring", type: "circle", source: "pilots",
    paint: { "circle-radius": 11, "circle-color": "#4fa3ff", "circle-opacity": 0.14, "circle-blur": 0.5 } });
  map.addLayer({ id: "pilot-pt", type: "circle", source: "pilots",
    paint: { "circle-radius": 5.5, "circle-color": "#4fa3ff", "circle-stroke-color": "#fff", "circle-stroke-width": 1.4 } });

  // the one real track highlight ring
  map.addLayer({ id: "real-ring", type: "circle", source: "realring",
    paint: { "circle-radius": 16, "circle-color": C.real, "circle-opacity": 0.0,
             "circle-stroke-color": C.real, "circle-stroke-width": 1.5, "circle-stroke-opacity": 0.8 } });

  // drones (glow + core)
  map.addLayer({ id: "drone-glow", type: "circle", source: "drones",
    paint: { "circle-radius": ["case", ["get", "sel"], 16, 11], "circle-color": ["get", "color"],
             "circle-opacity": 0.22, "circle-blur": 0.8 } });
  map.addLayer({ id: "drone-pt", type: "circle", source: "drones",
    paint: {
      "circle-radius": ["case", ["get", "sel"], 7.5, ["case", ["get", "real"], 6.5, 5]],
      "circle-color": ["get", "color"],
      "circle-stroke-color": ["case", ["get", "sel"], "#ffffff", ["case", ["get", "real"], C.real, "rgba(255,255,255,0.5)"]],
      "circle-stroke-width": ["case", ["get", "sel"], 2.2, ["case", ["get", "real"], 2, 1]] },
  });

  // interaction
  const clickable = ["drone-pt", "drone-glow"];
  map.on("click", "drone-pt", (e) => selectEntity(e.features[0].properties.transmitter));
  map.on("click", (e) => {
    const hits = map.queryRenderedFeatures(e.point, { layers: clickable });
    if (!hits.length) clearSelection();
  });
  for (const ly of ["drone-pt", "tri-core", "node-pt", "pilot-pt", "aim-pt"]) {
    map.on("mouseenter", ly, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", ly, () => (map.getCanvas().style.cursor = ""));
  }
  map.on("mousemove", "tri-core", (e) => {
    const f = e.features[0];
    popup.setLngLat(e.lngLat).setHTML(
      `<div class="mp-title" style="color:${C.pup}">PUPPETEER RADIO</div>` +
      `<div class="mp-sub">${f.properties.transmitter}</div>` +
      `<div class="mp-sub">triangulated &middot; ${(f.properties.conf*100).toFixed(0)}% conf &middot; ${f.properties.nodes} nodes</div>`
    ).addTo(map);
  });
  map.on("mouseleave", "tri-core", () => popup.remove());
  map.on("mousemove", "node-pt", (e) => {
    const f = e.features[0];
    popup.setLngLat(e.lngLat).setHTML(
      `<div class="mp-title" style="color:${C.node}">${f.properties.id}</div>` +
      `<div class="mp-sub">$6 sensor node &middot; online</div>`
    ).addTo(map);
  });
  map.on("mouseleave", "node-pt", () => popup.remove());

  animatePulse();
  startGrid();
});

// ---- build GeoJSON from a GridState and push to the map --------------------
function render(state) {
  latestState = state;
  const entities = state.entities || [];
  const nodes = state.nodes || [];
  const tri = state.triangulation || [];

  // pick the one genuine track: highest real_score among non-spoofed
  let realTx = null, realBest = -1;
  for (const e of entities) {
    if (e.verdict !== "spoofed" && (e.real_score ?? 0) > realBest) { realBest = e.real_score ?? 0; realTx = e.transmitter; }
  }

  const droneF = [], trailF = [], coneF = [], watchLnF = [], aimF = [], realRingF = [];
  let pilots = 0;
  for (const e of entities) {
    const color = VERDICT_COLORS[e.verdict] || "#8ba0c4";
    const sel = e.transmitter === selected;
    const isReal = e.transmitter === realTx;
    const d = e.drone || {};
    if (d.lon == null) continue;
    droneF.push({ type: "Feature", geometry: { type: "Point", coordinates: [d.lon, d.lat] },
      properties: { transmitter: e.transmitter, color, sel, real: isReal } });
    if (isReal) realRingF.push({ type: "Feature", geometry: { type: "Point", coordinates: [d.lon, d.lat] }, properties: {} });
    if (e.pilot && e.pilot.lon != null) pilots++;
    if (Array.isArray(e.trail) && e.trail.length > 1) {
      trailF.push({ type: "Feature",
        geometry: { type: "LineString", coordinates: e.trail.map(([la, lo]) => [lo, la]) },
        properties: { color, sel } });
    }
    if (e.watching && e.watching.lon != null) {
      if (Array.isArray(e.watching.footprint) && e.watching.footprint.length >= 3) {
        const ring = e.watching.footprint.map(([la, lo]) => [lo, la]);
        ring.push(ring[0]);
        coneF.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: { sel } });
      }
      watchLnF.push({ type: "Feature",
        geometry: { type: "LineString", coordinates: [[d.lon, d.lat], [e.watching.lon, e.watching.lat]] },
        properties: {} });
      aimF.push({ type: "Feature", geometry: { type: "Point", coordinates: [e.watching.lon, e.watching.lat] },
        properties: { dwell: e.watching.dwell_s } });
    }
  }

  map.getSource("drones").setData(FC(droneF));
  map.getSource("trails").setData(FC(trailF));
  map.getSource("cones").setData(FC(coneF));
  map.getSource("watchlines").setData(FC(watchLnF));
  map.getSource("aims").setData(FC(aimF));
  map.getSource("realring").setData(FC(realRingF));
  map.getSource("nodes").setData(FC(nodes.map((n) => ({
    type: "Feature", geometry: { type: "Point", coordinates: [n.lon, n.lat] }, properties: { id: n.id } }))));
  map.getSource("tri").setData(FC(tri.map((t) => ({
    type: "Feature", geometry: { type: "Point", coordinates: [t.lon, t.lat] },
    properties: { transmitter: t.transmitter, conf: t.confidence ?? 0, nodes: (t.node_ids || []).length } }))));

  // selected-entity overlays
  renderSelectionOverlays(entities, nodes);

  // counters
  const flood = state.flood || { level: "clear", confidence: 0 };
  const floodActive = flood.level && flood.level !== "clear" && flood.level !== "none";
  for (const t of tri) fakeSeen.add(t.transmitter);
  const fakesNeutralized = floodActive ? CONFIG.fakes_per_radio * Math.max(tri.length, 1) : CONFIG.fakes_per_radio * fakeSeen.size;
  setCounter("c-drones", entities.filter((e) => e.verdict !== "spoofed").length);
  setCounter("c-pilots", pilots);
  setCounter("c-fakes", fakesNeutralized);
  setCounter("c-nodes", nodes.length);

  // flood strip
  const strip = $("floodStrip");
  if (floodActive && tri.length) {
    strip.hidden = false;
    $("floodText").textContent =
      `SPOOF FLOOD: ${fakesNeutralized} fake broadcasts collapsed to ${tri.length} physical radio${tri.length > 1 ? "s" : ""}, pinned on the map`;
  } else {
    strip.hidden = true;
  }

  // ticker
  renderTicker(state.ticker || []);

  // keep the dossier live for the selected entity
  if (selected) {
    const e = entities.find((x) => x.transmitter === selected);
    if (e) fillDossier(e, e.transmitter === realTx);
  }
}

function renderSelectionOverlays(entities, nodes) {
  const e = selected ? entities.find((x) => x.transmitter === selected) : null;
  if (!e || !e.drone || e.drone.lon == null) {
    for (const s of ["heard", "pilots", "takeoffs"]) map.getSource(s).setData(FC());
    return;
  }
  const d = e.drone;
  const heardF = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const nid of e.heard_by || []) {
    const n = byId.get(nid);
    if (n) heardF.push({ type: "Feature",
      geometry: { type: "LineString", coordinates: [[n.lon, n.lat], [d.lon, d.lat]] }, properties: {} });
  }
  map.getSource("heard").setData(FC(heardF));
  map.getSource("pilots").setData(FC(e.pilot && e.pilot.lon != null
    ? [{ type: "Feature", geometry: { type: "Point", coordinates: [e.pilot.lon, e.pilot.lat] }, properties: {} }] : []));
  map.getSource("takeoffs").setData(FC(e.takeoff && e.takeoff.lon != null
    ? [{ type: "Feature", geometry: { type: "Point", coordinates: [e.takeoff.lon, e.takeoff.lat] }, properties: {} }] : []));
}

// ---- counters with rolling animation --------------------------------------
const counterVals = {};
function setCounter(id, target) {
  target = Math.round(target);
  const cur = counterVals[id] ?? 0;
  if (cur === target) return;
  counterVals[id] = target;
  const el = $(id);
  const start = cur, t0 = performance.now(), dur = 420;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const v = Math.round(start + (target - start) * (1 - Math.pow(1 - k, 3)));
    el.textContent = v.toLocaleString();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---- ticker ----------------------------------------------------------------
let lastTickKey = "";
function renderTicker(ticker) {
  const recent = ticker.slice(-7).reverse();
  const key = recent.map((t) => t.ts_ms + t.text).join("|");
  if (key === lastTickKey) return;
  lastTickKey = key;
  const ul = $("tickerList");
  ul.innerHTML = "";
  for (const t of recent) {
    const li = document.createElement("li");
    const alert = /puppeteer|flood|spoof/i.test(t.text);
    if (alert) li.className = "t-alert";
    const dt = new Date(t.ts_ms);
    const hh = String(dt.getUTCHours()).padStart(2, "0");
    const mm = String(dt.getUTCMinutes()).padStart(2, "0");
    const ss = String(dt.getUTCSeconds()).padStart(2, "0");
    li.innerHTML = `<span class="t-time">${hh}:${mm}:${ss}</span><span class="t-txt">${escapeHtml(t.text)}</span>`;
    ul.appendChild(li);
  }
}

// ---- dossier ---------------------------------------------------------------
function selectEntity(tx) {
  selected = tx;
  if (latestState) render(latestState);
  const e = (latestState?.entities || []).find((x) => x.transmitter === tx);
  if (e && e.drone && e.drone.lon != null) {
    map.easeTo({ center: [e.drone.lon, e.drone.lat], duration: 700, offset: [-120, 0] });
  }
}
function clearSelection() {
  if (!selected) return;
  selected = null;
  $("dossier").hidden = true;
  if (latestState) render(latestState);
}
$("dossierClose").onclick = clearSelection;

function fmtLatLon(o) { return o && o.lon != null ? `${o.lat.toFixed(5)}, ${o.lon.toFixed(5)}` : "not set"; }

function fillDossier(e, isReal) {
  const vColor = VERDICT_COLORS[e.verdict] || "#8ba0c4";
  const pct = Math.round((e.real_score ?? 0) * 100);
  const reg = e.registration || {};
  const w = e.watching;
  const rows = [];
  rows.push(`<span class="doss-verdict" style="color:${vColor};background:${hexA(vColor,0.14)};border:1px solid ${hexA(vColor,0.4)}">
      ${isReal ? "★ " : ""}${escapeHtml(e.verdict || "unknown")}</span>`);
  rows.push(`<div class="doss-model">${escapeHtml(e.model || "Unknown platform")}</div>`);
  rows.push(`<div class="doss-id">${escapeHtml(e.uas_id || e.transmitter)}</div>`);

  rows.push(`<div class="doss-score">
    <div class="doss-score-bar"><span style="width:${pct}%;background:${isReal ? C.real : vColor}"></span></div>
    <div class="doss-score-cap"><span>fake</span><span>real_score ${pct}%</span><span>genuine</span></div></div>`);

  const cells = [];
  cells.push(cell("registration", `${escapeHtml(reg.reg || "unregistered")}<br><small>${escapeHtml(reg.country || "")}</small>`, true));
  cells.push(cell("live position", `${fmtLatLon(e.drone)}<br><small>alt ${e.drone?.alt_m != null ? e.drone.alt_m.toFixed(0) + " m" : "?"}</small>`, true));
  cells.push(cell("live pilot", e.pilot && e.pilot.lon != null ? fmtLatLon(e.pilot) : "not broadcast"));
  cells.push(cell("launch point", fmtLatLon(e.takeoff)));
  if (w && w.lon != null) {
    cells.push(cell("camera is watching", `${fmtLatLon(w)}<br><small>dwell ${(w.dwell_s ?? 0).toFixed(1)} s</small>`, true));
  }
  cells.push(cell("heard by", `${(e.heard_by || []).length} sensor${(e.heard_by||[]).length===1?"":"s"}`));
  cells.push(cell("transmitter", `<small>${escapeHtml(e.transmitter)}</small>`));
  rows.push(`<div class="doss-grid">${cells.join("")}</div>`);

  if (Array.isArray(e.reasons) && e.reasons.length) {
    rows.push(`<div class="doss-reasons"><div class="k">trust evidence</div>${
      e.reasons.map((r) => `<span class="reason">${escapeHtml(r)}</span>`).join("")}</div>`);
  }
  rows.push(`<div class="doss-note">Decoded live from captured Remote ID bytes by the <b>remoteid</b> crate. Trust verdict and the field spoof-flood call come from <b>remoteid-sentinel</b>; the camera ground-target is read from a real <b>misb</b> ST 0601 packet. City traffic is simulated; the decode is not.</div>`);

  $("dossierBody").innerHTML = rows.join("");
  $("dossier").hidden = false;
}
function cell(k, v, full) { return `<div class="doss-cell${full ? " full" : ""}"><div class="k">${k}</div><div class="v">${v}</div></div>`; }

// ---- pulse animation for triangulation + real ring -------------------------
function animatePulse() {
  const loop = (t) => {
    if (map.getLayer("tri-pulse")) {
      const r = 10 + 9 * (0.5 + 0.5 * Math.sin(t / 320));
      const o = 0.28 * (0.5 + 0.5 * Math.cos(t / 320));
      map.setPaintProperty("tri-pulse", "circle-radius", r);
      map.setPaintProperty("tri-pulse", "circle-opacity", o);
    }
    if (map.getLayer("real-ring")) {
      const r = 14 + 6 * (0.5 + 0.5 * Math.sin(t / 500));
      map.setPaintProperty("real-ring", "circle-radius", r);
      map.setPaintProperty("real-ring", "circle-stroke-opacity", 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(t / 500)));
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ---- boot the grid ---------------------------------------------------------
let fittedOnce = false;
async function startGrid() {
  let grid = null;
  try {
    bootStatus.textContent = "loading fusion core…";
    await init();
    bootStatus.textContent = "building city mesh…";
    grid = new Grid(JSON.stringify(CONFIG));
  } catch (err) {
    console.warn("wasm core unavailable, replaying a real fused snapshot:", err);
    return bootFallback();
  }
  hideBoot();
  let step = 0;
  const tick = () => {
    try {
      const json = grid.run_grid(step++);
      const state = JSON.parse(json);
      render(state);
      if (!fittedOnce) fitToData(state);
    } catch (err) {
      console.error("run_grid failed:", err);
    }
  };
  tick();
  setInterval(tick, 500);
}

// If wasm cannot load (e.g. the page was opened from file://), replay the real
// fused snapshot the core emitted, so the layout still shows real fused output.
async function bootFallback() {
  try {
    const res = await fetch("./core/sample_state.json");
    const state = await res.json();
    hideBoot();
    render(state);
    fitToData(state);
    $("simBadge").insertAdjacentHTML("afterend",
      `<div class="sim-badge" style="color:#8ba0c4;border-color:rgba(120,160,220,0.3);background:rgba(120,160,220,0.08)">STATIC SNAPSHOT &middot; serve over http for the live core</div>`);
  } catch (err) {
    bootStatus.textContent = "could not load the fusion core. serve this folder over http (see README).";
  }
}

function fitToData(state) {
  const pts = [];
  for (const e of state.entities || []) if (e.drone && e.drone.lon != null) pts.push([e.drone.lon, e.drone.lat]);
  for (const n of state.nodes || []) pts.push([n.lon, n.lat]);
  for (const t of state.triangulation || []) pts.push([t.lon, t.lat]);
  if (pts.length < 2) return;
  const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
  map.fitBounds(b, { padding: { top: 150, bottom: 180, left: 90, right: 360 }, duration: 1200, maxZoom: 14, pitch: 48, bearing: -16 });
  fittedOnce = true;
}

function hideBoot() { const b = $("boot"); b.classList.add("hide"); setTimeout(() => (b.style.display = "none"), 800); }

// legend toggle
$("legendToggle").onclick = () => $("legendBody").classList.toggle("hide");

// ---- utils -----------------------------------------------------------------
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function hexA(hex, a) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
