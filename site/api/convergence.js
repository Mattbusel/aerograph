// convergence.js  --  Aerograph SKY CONVERGENCE index endpoint.
//
// Returns the precomputed set of REAL corporate / private control groups that
// have 2+ attributed aircraft (the only groups that can ever converge), each with
// its member ADS-B hexes and its public-record overlay (PAC, lobbying total,
// federal awards count). The browser loads this once, then intersects it against
// the national ADS-B feed it already fetches and runs the co-location test
// client-side: zero extra upstream calls, zero per-dot requests.
//
// Pure reader. It never fabricates and never calls the ontology or the live feed
// at request time. Airline, charter/fractional, EMS, owner-trustee and government
// groups are already filtered out upstream (their co-location is routine noise).
// The only producer is scripts/build-convergence.mjs, run in-session from the real
// attribution set. "Flag, do not predict": a group here only means 2+ of its
// aircraft can be visibly co-located, never a forecast or advice.

import CONVERGENCE from "./_convergenceData.js";

const DATA = CONVERGENCE && Array.isArray(CONVERGENCE.groups)
  ? CONVERGENCE
  : { meta: {}, groups: [] };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Ownership and control are static; cache hard at the edge. The live
  // intersection is done by the client against the (uncached) feed.
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).json({
    meta: DATA.meta || {},
    groups: DATA.groups || [],
  });
}
