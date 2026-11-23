// build-convergence.mjs  --  precompute the sky-convergence index for Aerograph.
//
// The convergence flex is "two jets, one owner, one place, right now": group the
// currently-live aircraft by control group, and flag any control group with 2+
// aircraft co-located that is NOT a fractional / charter / EMS operator or a
// scheduled airline (their co-location is routine noise, not a deal), and not a
// bare owner-trustee (a trustee bank is the registered holder for many unrelated
// real owners, so merging them would invent a group that does not exist).
//
// This script is OFFLINE and derives only from the already-resolved, real
// attribution set (site/data/attribution.json). It does NOT touch the ontology or
// the live feed. It emits the small set of corporate / private control groups
// that have 2+ attributed aircraft (the only groups that can ever converge), with
// each group's member hexes and its public-record overlay (PAC, lobbying total,
// federal awards count). The live intersection and co-location test happen in the
// browser against the national feed it already loads, so no extra upstream calls
// and no per-dot requests. The deployed api/convergence.js is a pure reader of the
// bundled output.
//
// Classification is keyword-based on the FAA-registered owner / SEC parent name,
// plus the real trustee/government flags already in each record. The suppressed
// families are listed explicitly (the task names NetJets / Flexjet / Air Methods);
// the lists are easy to extend as new operators appear. A group is only surfaced
// when it is corporate/private. Nothing is invented: a group with no PAC or no
// lobbying record simply carries null there.
//
// Run:  node scripts/build-convergence.mjs
// Writes: site/data/convergence-groups.json   (human-readable, inspectable)
//         site/api/_convergenceData.js         (bundled ES module the fn imports)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const JSON_IN = join(ROOT, "site", "data", "attribution.json");
const JSON_OUT = join(ROOT, "site", "data", "convergence-groups.json");
const MODULE_OUT = join(ROOT, "site", "api", "_convergenceData.js");

// --- operator classification -------------------------------------------------
// Each regex matches the registered-owner or parent name (case-insensitive).
// Order matters: EMS and charter are checked before the broad airline pattern.

const EMS = /\b(AIR METHODS|LIFE ?FLIGHT|AIR EVAC|AIREVAC|MED ?EVAC|MEDEVAC|AIR AMBULANCE|AIR MEDICAL|MEDICAL (TRANSPORT|AVIATION|HELICOPTER)|REACH (AIR|MEDICAL)|PHI AIR MEDICAL|METRO AVIATION|GUARDIAN FLIGHT|CLASSIC AIR MEDICAL|SURVIVAL FLIGHT|STAR ?FLIGHT|CARE ?FLIGHT|MERCY (AIR|FLIGHT)|CALSTAR|BOSTON MEDFLIGHT|LIFEGUARD|LIFE ?NET|PEDIFLITE|ANGEL ?MED|TRANSMEDICS|ORGAN (PROCUREMENT|TRANSPORT))\b/i;

// Fractional, charter, and other commercial fleet operators whose business IS
// flying (tour, utility, firefighting rotor fleets). Their identical-type fleets
// base and co-locate as a matter of routine, so a cluster is noise, not a deal.
const CHARTER_FRACTIONAL = /\b(NETJETS|NET ?JETS|EXECUTIVE ?JET|FLEXJET|FLIGHT ?OPTIONS|XOJET|XO ?JET|WHEELS ?UP|VISTA ?JET|SENTIENT ?JET|PLANESENSE|PLANE ?SENSE|NICHOLAS AIR|JET ?LINX|JET ?SUITE|JETSUITE|SET ?JET|AIRSHARE|AIR ?SHARE|JET ?IT|VOLATO|JET ?AVIATION|DELTA PRIVATE JETS|CLAY LACY|SOLAIRUS|GAMA AVIATION|JET ?EDGE|PRIORITY (JET|AIR)|CHARTER|AIR ?CHARTER|FLIGHT ?DEPARTMENT LLC|FLEXFLIGHT|THRIVE AVIATION|LATITUDE 33|SILVERHAWK|DISCOVERY HELICOPTERS?|PAPILLON|MAVERICK HELICOPTER|BLADE|HELINET|AIR TOUR|HELICOPTER TOUR|ROTORCRAFT (LEASING|SERVICES))\b/i;

// Scheduled / cargo carriers, their regional affiliates, and the leasing shells
// that stand in for them on the registry. Co-location at a hub is expected.
const AIRLINE = /\b(AIR ?LINES?|AIRWAYS|UNITED AIRLINES|DELTA AIR LINES|AMERICAN AIRLINES|SOUTHWEST AIRLINES|JETBLUE|ALASKA AIRLINES|HAWAIIAN|SPIRIT AIR|FRONTIER (AIRLINES|GROUP)|ALLEGIANT|SUN COUNTRY|BREEZE|AVELO|ENVOY AIR|ENDEAVOR AIR|REPUBLIC AIRWAYS|SKYWEST|MESA AIRLINES|PSA AIRLINES|PIEDMONT AIRLINES|HORIZON AIR|GOJET|AIR WISCONSIN|COMMUTAIR|CAPE AIR|SILVER AIRWAYS|CARGO AIRCRAFT MANAGEMENT|ATLAS AIR|KALITTA AIR|OMNI AIR|AMERIJET|ABX AIR|AIR TRANSPORT (SERVICES|INTERNATIONAL)|AMERIFLIGHT|FEDERAL EXPRESS|FEDEX|UNITED PARCEL|\bUPS\b|AIRLINES HOLDINGS|AIR LINES HOLDINGS)\b/i;

// Bare owner-trustee names (when the record is not flagged trustee for some
// reason, this still catches it by name).
const TRUSTEE_NAME = /\b(TRUSTEE|BANK OF UTAH|WILMINGTON TRUST|UMB BANK|TVPX|WELLS FARGO (BANK )?NORTHWEST|FIRST SECURITY|AIRCRAFT GUARANTY|JETSTREAM AVIATION CAPITAL)\b/i;

function classify(rec) {
  if (rec.government === true) return { class: "government", surface: false, reason: "government fleet (expected at base)" };
  if (rec.trustee === true) return { class: "trustee", surface: false, reason: "owner-trustee: beneficial owner hidden, not a real control group" };
  const name = `${rec.owner || ""} ${(rec.parent && rec.parent.name) || ""}`.trim();
  if (EMS.test(name)) return { class: "ems", surface: false, reason: "air-medical / EMS operator (co-location is routine)" };
  if (CHARTER_FRACTIONAL.test(name)) return { class: "charter_fractional", surface: false, reason: "fractional / charter operator (shared fleet, co-location is routine)" };
  if (TRUSTEE_NAME.test(name)) return { class: "trustee", surface: false, reason: "owner-trustee: beneficial owner hidden, not a real control group" };
  if (AIRLINE.test(name)) return { class: "airline", surface: false, reason: "scheduled / cargo carrier (hub co-location is routine)" };
  return { class: "corporate", surface: true, reason: "corporate / private operator" };
}

// --- build -------------------------------------------------------------------
const data = JSON.parse(readFileSync(JSON_IN, "utf8"));
const recs = Object.values(data.byHex || {});

// Group by control group = SEC parent name when present, else the registered owner.
const groups = new Map();
const suppressedTally = {};

for (const rec of recs) {
  const c = classify(rec);
  const key = ((rec.parent && rec.parent.name) || rec.owner || "").toUpperCase().trim();
  if (!key) continue;
  if (!groups.has(key)) {
    groups.set(key, {
      key,
      display: (rec.parent && rec.parent.name) || rec.owner,
      class: c.class,
      surface: c.surface,
      reason: c.reason,
      pac: null,
      lobbying: null,
      awards_count: 0,
      members: [],
    });
  }
  const g = groups.get(key);
  // A control group's class is corporate only if every member classifies corporate.
  if (!c.surface) { g.surface = false; g.class = c.class; g.reason = c.reason; }
  g.members.push({ hex: rec.hex, tail: rec.tail, owner: rec.owner, model: rec.model });
  // Carry the richest overlay found on any member (owner records share the group's
  // PAC/lobbying; different registrant entities under one parent may each carry it).
  if (rec.pac && !g.pac) g.pac = rec.pac;
  if (rec.lobbying && (!g.lobbying || (rec.lobbying.total || 0) > (g.lobbying.total || 0))) g.lobbying = rec.lobbying;
  if (Array.isArray(rec.awards)) g.awards_count = Math.max(g.awards_count, rec.awards.length);
}

// Surface only corporate/private groups that have 2+ attributed aircraft (the
// only groups that can ever converge). Everything else is tallied for honesty.
const surfaced = [];
for (const g of groups.values()) {
  if (g.surface && g.members.length >= 2) {
    surfaced.push(g);
  } else if (!g.surface) {
    suppressedTally[g.class] = (suppressedTally[g.class] || 0) + 1;
  }
}
surfaced.sort((a, b) => b.members.length - a.members.length || a.display.localeCompare(b.display));

const out = {
  meta: {
    generated_at: new Date().toISOString(),
    producer: "scripts/build-convergence.mjs",
    source: "site/data/attribution.json (real public-record attribution)",
    note: "Corporate / private control groups with 2+ attributed aircraft. The live intersection and co-location test run client-side against the national ADS-B feed. Suppressed: airline, charter/fractional, EMS, owner-trustee, government (their co-location is routine noise, not a deal). Flag, do not predict: a surfaced group means 2+ of its aircraft are visibly co-located now, nothing more.",
    attribution_count: recs.length,
    surfaced_groups: surfaced.length,
    suppressed_groups: suppressedTally,
  },
  groups: surfaced,
};

writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));

const header =
  "// AUTO-GENERATED by scripts/build-convergence.mjs. Do not edit by hand.\n" +
  "// Corporate / private control groups (real public-record attribution) with 2+\n" +
  "// aircraft, bundled as an ES module so the Vercel function imports it after the\n" +
  "// ESM->CommonJS compile. Rebuild from attribution.json to refresh.\n";
writeFileSync(MODULE_OUT, header + "export default " + JSON.stringify(out) + ";\n");

console.log(`attribution records: ${recs.length}`);
console.log(`surfaced corporate groups (2+ aircraft): ${surfaced.length}`);
for (const g of surfaced) {
  const money = g.lobbying && g.lobbying.total ? ` $${g.lobbying.total.toLocaleString()} lobbying` : "";
  const pac = g.pac ? ` PAC ${g.pac.id}` : "";
  console.log(`  ${g.members.length}x ${g.display}${pac}${money} :: ${g.members.map(m => m.tail).join(", ")}`);
}
console.log("suppressed groups by class:", JSON.stringify(suppressedTally));
console.log(`\nwrote ${JSON_OUT}`);
console.log(`wrote ${MODULE_OUT}`);
