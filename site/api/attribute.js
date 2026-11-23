// attribute.js  --  Aerograph ATTRIBUTION endpoint. Given an aircraft (ADS-B hex
// and/or N-number tail), returns the REAL public-record dossier: registered owner
// and model (FAA registry), the owner's parent / control group (SEC subsidiary
// lists), federal awards (USAspending) and lobbying (Senate LDA). This is what
// turns a dot on the map into "who is really behind that dot".
//
// Pure reader. It never calls the ontology at request time and never fabricates a
// field: a missing parent or lobbying record is null, not a guess. The only
// producer of the data is scripts/build-attribution.mjs (run in-session where the
// MCP is attached). Labels downstream say exactly what each record supports.
//
// Resolution order:
//   1. If only a hex is given and it is a US civil address (0xA block), convert
//      hex -> N-number locally (offline FAA scheme, zero network).
//   2. Look up by hex, then by tail, in the precomputed cache (via the one
//      provider module, _attributionSource.js).
//   3. Hit -> 200 resolved:true with the full dossier.
//   4. US tail not cached -> 200 resolved:false, "not in current attribution cache".
//   5. Foreign / non-0xA hex -> 200 resolved:false, FAA registry does not cover it.

import { hexToTail } from "./_faaHex.js";
import { resolveAircraft, datasetMeta } from "./_attributionSource.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const q = req.query || {};

  let hex = q.hex != null ? String(q.hex).trim().toUpperCase().replace(/^0X/, "") : "";
  // tail accepts ?tail= or the ?n_number= / ?reg= aliases (same FAA N-number).
  const rawTail = q.tail != null ? q.tail : (q.n_number != null ? q.n_number : q.reg);
  let tail = rawTail != null ? String(rawTail).trim().toUpperCase() : "";
  if (tail && !tail.startsWith("N")) tail = "N" + tail;

  if (!hex && !tail) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(400).json({ resolved: false, reason: "provide ?hex=A1B2C3 or ?tail=N295QS" });
  }

  // Step 1: derive the tail from the hex locally when we can (US 0xA block only).
  const derivedTail = hex ? hexToTail(hex) : null;
  const lookupTail = tail || derivedTail;

  // Step 2: resolve from the cache (hex preferred, then tail).
  const { record, provider } = resolveAircraft({ hex, tail: lookupTail });

  if (record) {
    // Ownership is static; a hit can be cached hard at the edge.
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({
      resolved: true,
      tail: record.tail,
      hex: record.hex || hex || null,
      owner: record.owner,
      model: record.model,
      category: record.category,
      trustee: record.trustee === true,
      government: record.government === true,
      parent: record.parent || null,
      awards: Array.isArray(record.awards) ? record.awards : [],
      lobbying: record.lobbying || null,
      sources: Array.isArray(record.sources) ? record.sources : [],
      resolved_at: record.resolved_at || null,
      note: record.note || "Ownership and control from public records. Not a claim about this flight.",
      provider,
      cache_generated_at: datasetMeta().generated_at || null,
    });
  }

  // Misses: no-store so a later cache refresh can fill them in.
  res.setHeader("Cache-Control", "no-store");

  // Step 5: a hex that is not a US civil (0xA) address has no FAA registration.
  if (hex && !derivedTail && !tail) {
    return res.status(200).json({
      resolved: false,
      hex,
      reason: "non-US registration; FAA registry does not cover it",
    });
  }

  // Step 4: a US tail we simply have not attributed yet.
  return res.status(200).json({
    resolved: false,
    hex: hex || null,
    tail: lookupTail || null,
    reason: "not in current attribution cache",
  });
}
