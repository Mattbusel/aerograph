// build-attribution.mjs  --  the ONLY producer of site/data/attribution.json.
//
// This runs IN-SESSION, where the Tensorust Ontology MCP tools are attached (the
// deployed Vercel function can never reach them). It has two phases so the real
// MCP resolution (which only the agent can drive) slots cleanly in the middle:
//
//   node scripts/build-attribution.mjs --stage [--live <url>] [--limit N]
//       Pulls a REAL national sweep from the live ADS-B proxy, converts every US
//       ADS-B hex to its N-number offline (faa-hex.mjs), and writes a staging file
//       data/_staged-tails.json: [{hex, tail}]. Non-US (non-0xA) hexes are dropped;
//       the FAA registry does not cover them and we never invent a tail.
//
//   <agent resolves each staged tail through the ontology MCP in-session:
//    aircraft_owner(n_number) then lookup_organization(owner), and writes the raw
//    results to data/_resolved.json as { "<TAIL>": <dossier-ish>, ... }.>
//
//   node scripts/build-attribution.mjs --merge
//       Joins staged {hex,tail} with the resolved dossiers, validates/normalizes
//       every field (drops anything not backed by a real source, never guesses a
//       parent or lobbying), and writes site/data/attribution.json keyed by BOTH
//       hex and tail, with build metadata.
//
// REAL DATA ONLY. The merge step fabricates nothing: a missing parent or lobbying
// record becomes null, not a guess. Labels downstream say exactly what the record
// supports.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hexToTail } from "./faa-hex.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "site", "data");
const STAGED = join(DATA, "_staged-tails.json");
const RESOLVED = join(DATA, "_resolved.json");
const OUT = join(DATA, "attribution.json");

function ensureData() {
  if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
}

async function stage() {
  const arg = (k, d) => {
    const i = process.argv.indexOf(k);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
  };
  const live = arg("--live", "https://aerograph.tensorust.com/api/live?national=1");
  const limit = parseInt(arg("--limit", "0"), 10) || 0;
  ensureData();
  console.error("staging from live feed:", live);
  const r = await fetch(live, { headers: { "User-Agent": "aerograph-build (github.com/Mattbusel/aerograph)" } });
  if (!r.ok) throw new Error(`live feed HTTP ${r.status}`);
  const data = await r.json();
  const ac = Array.isArray(data.aircraft) ? data.aircraft : [];
  const seen = new Set();
  const staged = [];
  let foreign = 0;
  for (const a of ac) {
    if (!a.hex || seen.has(a.hex)) continue;
    seen.add(a.hex);
    const tail = hexToTail(a.hex);
    if (!tail) { foreign++; continue; }
    staged.push({ hex: String(a.hex).toUpperCase(), tail, flight: (a.flight || "").trim(), type: a.type || a.t || null });
  }
  const out = limit > 0 ? staged.slice(0, limit) : staged;
  writeFileSync(STAGED, JSON.stringify(out, null, 2));
  console.error(`staged ${out.length} US tails (${foreign} foreign/non-0xA dropped) -> ${STAGED}`);
  // Print just the tails so the agent can resolve them via MCP.
  console.log(out.map((s) => s.tail).join("\n"));
}

// --- merge helpers: normalize ONE raw ontology result into the dossier shape ---

function cleanLobbying(props) {
  if (!props) return null;
  const total = props.lobbying_total != null ? String(props.lobbying_total).replace(/,/g, "") : null;
  if (!total) return null; // no lobbying record -> null, never a guess
  const n = Number(total);
  return {
    total: Number.isFinite(n) ? n : null,
    issues: props.lobbying_issues || null,
    periods: props.lobbying_periods || null,
    firms: props.lobbying_firms != null ? Number(props.lobbying_firms) : null,
    firm_names: Array.isArray(props.lobbying_firm_names) ? props.lobbying_firm_names : null,
  };
}

function firstPreview(link) {
  if (!link || !Array.isArray(link.preview)) return null;
  return link.preview[0] || null;
}

// raw = { aircraft: <aircraft_owner result>, org: <lookup_organization result> }
function normalizeRecord(hex, tail, raw) {
  const air = raw.aircraft || {};
  const org = raw.org || {};
  const links = org.links || {};
  const props = org.props || {};

  const parentPrev = firstPreview(links.SUBSIDIARY_OF);
  const parent = parentPrev ? { name: parentPrev.name, oid: parentPrev.oid } : null;

  const awards = (links.RECEIVED && Array.isArray(links.RECEIVED.preview))
    ? links.RECEIVED.preview.map((a) => ({ oid: a.oid, name: a.name }))
    : [];

  const firmNames = (links["~LOBBIES_FOR"] && Array.isArray(links["~LOBBIES_FOR"].preview))
    ? links["~LOBBIES_FOR"].preview.map((f) => f.name)
    : [];
  const lobbying = cleanLobbying(props);
  if (lobbying && !lobbying.firm_names && firmNames.length) lobbying.firm_names = firmNames;

  // sources: only what the ontology actually cited for this owner
  const sources = Array.isArray(org.sources) ? org.sources : (air.owner ? ["faa"] : []);

  const owner = air.owner || org.name || null;
  return {
    tail,
    hex,
    owner,
    model: air.model || null,
    category: air.category || null,
    trustee: air.trustee === true,
    government: air.government === true,
    parent,
    awards,
    lobbying,
    sources,
    resolved_at: raw.resolved_at || new Date().toISOString(),
    note: "Ownership and control from public records. Not a claim about this flight.",
  };
}

function merge() {
  ensureData();
  if (!existsSync(STAGED)) throw new Error(`missing ${STAGED}; run --stage first`);
  if (!existsSync(RESOLVED)) throw new Error(`missing ${RESOLVED}; agent must resolve staged tails via MCP first`);
  const staged = JSON.parse(readFileSync(STAGED, "utf8"));
  const resolved = JSON.parse(readFileSync(RESOLVED, "utf8"));
  const byTail = new Map(staged.map((s) => [s.tail, s]));

  const byHexKey = {};
  const byTailKey = {};
  let kept = 0;
  const sourceSet = new Set();

  for (const [tail, raw] of Object.entries(resolved)) {
    if (!raw || (!raw.aircraft && !raw.org)) continue;
    if (raw.aircraft && raw.aircraft.found === false) continue;
    const staj = byTail.get(tail);
    // hex: prefer staged hex; the tail is authoritative either way.
    const hex = (staj && staj.hex) || (raw.hex ? String(raw.hex).toUpperCase() : null);
    const rec = normalizeRecord(hex, tail, raw);
    if (!rec.owner) continue; // no registered owner resolved -> leave it out, honestly
    byTailKey[tail] = rec;
    if (hex) byHexKey[hex] = rec;
    rec.sources.forEach((s) => sourceSet.add(s));
    kept++;
  }

  const outObj = {
    meta: {
      generated_at: new Date().toISOString(),
      producer: "scripts/build-attribution.mjs",
      note: "REAL public-record attribution. FAA registry (owner/model), SEC subsidiary lists (parent), USAspending (federal awards), Senate LDA (lobbying), DOL Form 5500. Nothing invented. hex->tail computed offline via the FAA ICAO scheme.",
      sources: [...sourceSet].sort(),
      count: kept,
      staged: staged.length,
    },
    byHex: byHexKey,
    byTail: byTailKey,
  };
  writeFileSync(OUT, JSON.stringify(outObj, null, 2));
  // Also emit the cache as an importable ES module. Vercel compiles API functions
  // from ESM to CommonJS, which breaks a runtime fs/createRequire JSON read; a
  // plain `export default <object>` compiles cleanly and is always bundled, so the
  // provider imports this instead of reading a file at request time. The .json
  // above stays as the static asset the aggregate fleet/power view fetches.
  const MODULE = join(ROOT, "site", "api", "_attributionData.js");
  writeFileSync(
    MODULE,
    "// AUTO-GENERATED by scripts/build-attribution.mjs. Do not edit by hand.\n" +
      "// REAL public-record attribution, bundled as an ES module so the Vercel\n" +
      "// function can import it after the ESM->CommonJS compile. Rebuild to refresh.\n" +
      "export default " + JSON.stringify(outObj) + ";\n"
  );
  console.error(`wrote ${OUT} and ${MODULE}: ${kept} attributed aircraft (${Object.keys(byHexKey).length} keyed by hex, ${Object.keys(byTailKey).length} by tail)`);
}

const mode = process.argv[2];
if (mode === "--stage") {
  await stage();
} else if (mode === "--merge") {
  merge();
} else {
  console.error("usage: node scripts/build-attribution.mjs --stage [--live <url>] [--limit N] | --merge");
  process.exit(2);
}
