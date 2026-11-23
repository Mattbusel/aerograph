// seed-convergence-fleets.mjs  --  add REAL, MCP-verified corporate flight
// departments (multi-jet control groups) to the attribution set, so the sky
// convergence flex has genuine corporate content to surface. Every field here
// was resolved live from the Tensorust Ontology in the workflow where the MCP is
// attached (FAA aircraft registry for owner/model/state, FEC for the PAC, Senate
// LDA for lobbying). NOTHING is invented: a field with no public record is left
// null/empty. hex is computed offline from the N-number via the FAA ICAO scheme.
//
// This is additive. It reads site/data/attribution.json, merges these records
// (keyed by hex and tail), updates meta.count, and rewrites BOTH the JSON and the
// bundled ES module site/api/_attributionData.js the Vercel function imports.
//
// Run:  node scripts/seed-convergence-fleets.mjs
//
// Provenance for each fleet is recorded in SOURCE_NOTE below. Re-running is safe
// (idempotent): it overwrites the same keys with the same values.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tailToHex } from "../site/api/_faaHex.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const JSON_PATH = join(ROOT, "site", "data", "attribution.json");
const MODULE_PATH = join(ROOT, "site", "api", "_attributionData.js");

const RESOLVED_AT = new Date().toISOString();
const NOTE = "Ownership and control from public records. Not a claim about this flight.";

// ---------------------------------------------------------------------------
// REAL corporate flight departments. Resolved via the Tensorust Ontology MCP:
//   aircraft_owner(n_number)  -> owner, model, category, state, trustee=false
//   lookup_organization(name) -> HAS_PAC (FEC), lobbying_total (Senate LDA)
// Walmart confirmed: PAC C00093054, lobbying $17,217,000 across 13 firms, OWNS 6
// aircraft (N15DP/N16CP/N17ZP Citation 680s, N45GH/N45HK/N986BL Learjet 45s).
// ---------------------------------------------------------------------------
const FLEETS = [
  {
    owner: "WALMART INC",
    state: "AR",
    category: "large transport (proxy: >20,000 lb)",
    pac: { name: "WALMART INC. PAC FOR RESPONSIBLE GOVERNMENT", id: "C00093054" },
    lobbying: {
      total: 17217000,
      issues: "TRD, TAX, CSP, LAW, BAN, HCR, LBR, FOO",
      periods: "2025 Q1, 2025 Q2, 2025 Q3, 2025 Q4, 2026 Q1, 2026 Q2, 2026 Q3",
      firms: 13,
      firm_names: ["MEHLMAN CONSULTING, INC.", "THE NICKLES GROUP, LLC", "CAPITOL COUNSEL LLC"],
    },
    sources: ["faa", "fec", "lda"],
    aircraft: [
      { tail: "N15DP", model: "TEXTRON AVIATION INC 680" },
      { tail: "N16CP", model: "TEXTRON AVIATION INC 680" },
      { tail: "N17ZP", model: "TEXTRON AVIATION INC 680" },
      { tail: "N45GH", model: "LEARJET INC 45" },
      { tail: "N45HK", model: "LEARJET INC 45" },
      { tail: "N986BL", model: "LEARJET INC 45" },
    ],
  },
];

function recordFor(fleet, ac) {
  const hex = tailToHex(ac.tail);
  if (!hex) throw new Error(`no hex for ${ac.tail} (not a US 0xA civil N-number?)`);
  return {
    tail: ac.tail,
    hex,
    owner: fleet.owner,
    model: ac.model,
    category: fleet.category,
    trustee: false,
    government: false,
    parent: fleet.parent || null,
    awards: fleet.awards || [],
    lobbying: fleet.lobbying || null,
    pac: fleet.pac || null,
    sources: fleet.sources,
    resolved_at: RESOLVED_AT,
    note: NOTE,
  };
}

const data = JSON.parse(readFileSync(JSON_PATH, "utf8"));
data.byHex = data.byHex || {};
data.byTail = data.byTail || {};

let added = 0;
for (const fleet of FLEETS) {
  for (const ac of fleet.aircraft) {
    const rec = recordFor(fleet, ac);
    const isNew = !data.byHex[rec.hex] && !data.byTail[rec.tail];
    data.byHex[rec.hex] = rec;
    data.byTail[rec.tail] = rec;
    if (isNew) added++;
    console.log(`${isNew ? "+" : "~"} ${rec.tail} ${rec.hex} ${rec.owner}`);
  }
}

// Keep meta honest: count = resolved records in byHex.
data.meta = data.meta || {};
data.meta.count = Object.keys(data.byHex).length;
data.meta.generated_at = RESOLVED_AT;
const srcs = new Set(data.meta.sources || []);
for (const s of ["faa", "fec", "lda"]) srcs.add(s);
data.meta.sources = [...srcs].sort();

const jsonText = JSON.stringify(data, null, 1);
writeFileSync(JSON_PATH, jsonText);

const header =
  "// AUTO-GENERATED (attribution cache bundled as an ES module). Do not edit by hand.\n" +
  "// REAL public-record attribution, bundled so the Vercel function can import it\n" +
  "// after the ESM->CommonJS compile. Rebuild from attribution.json to refresh.\n";
writeFileSync(MODULE_PATH, header + "export default " + JSON.stringify(data) + ";\n");

console.log(`\nseeded ${added} new record(s); attribution now has ${data.meta.count} aircraft.`);
console.log(`wrote ${JSON_PATH}`);
console.log(`wrote ${MODULE_PATH}`);
