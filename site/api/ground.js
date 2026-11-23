// ground.js  --  Aerograph GROUND endpoint (who-owns-your-street). Given a US
// residential address, or a landlord group name/id, returns the REAL public-record
// answer: the owner of record on the county roll, the control group behind the
// shell LLC, how many single-family homes that group holds in coverage, how many
// legal entities it hides behind, the ROAD Act mega-investor flag, and which
// counties the count comes from. With no query it returns the roster: the covered
// counties and every institutional landlord group the public rolls surface.
//
// Pure reader. It never calls the ontology at request time and never fabricates a
// field. The only producer is scripts/build-landlords.mjs (run in-workflow where
// the Tensorust Ontology MCP is attached: road_monitor_summary, road_investor_group,
// who_owns_home over 17 county property rolls + state registries + SEC Exhibit 21).
// A miss returns resolved:false with the honest coverage note, never a guess.
//
// COVERAGE IS HONEST. Entity-owned single-family homes in 17 large counties only.
// Every home count is a FLOOR for the group's national total. A shared mailing
// address is evidence of shared management, not proof of control. Purchases before
// the ROAD Act effective date (2027-01-07) are not violations. All framed as "what
// the rolls show", never as advice or a forecast.
//
// The data is imported as a bundled ES module (not a disk JSON read) because Vercel
// compiles API functions from ESM to CommonJS, which breaks import.meta.url / require
// JSON reads but always bundles a plain module import. The static site/data/landlords.json
// still exists for anyone who wants the whole set.

import LANDLORDS from "./_landlordsData.js";

const DATA = LANDLORDS && LANDLORDS.groups ? LANDLORDS : { meta: {}, covered_counties: [], groups: [], all_covered_groups: [], address_index: {} };

// Normalize an address + zip into the index key the builder used: uppercased,
// internal whitespace collapsed, joined "ADDRESS|ZIP". Matches build-landlords.mjs.
function keyFor(address, zip) {
  const a = String(address || "").trim().toUpperCase().replace(/\s+/g, " ");
  const z = String(zip || "").trim();
  return z ? `${a}|${z}` : a;
}

// Find a group's full record by numeric id or by a loose name match.
function findGroup({ groupId, name }) {
  if (groupId != null && groupId !== "") {
    const id = Number(groupId);
    const g = DATA.groups.find((x) => x.group_id === id);
    if (g) return g;
  }
  if (name) {
    const n = String(name).trim().toLowerCase();
    // exact label/control_group first, then substring
    return (
      DATA.groups.find((x) => x.label.toLowerCase() === n || (x.control_group || "").toLowerCase() === n) ||
      DATA.groups.find((x) => x.label.toLowerCase().includes(n) || (x.control_group || "").toLowerCase().includes(n)) ||
      null
    );
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const q = req.query || {};
  const meta = DATA.meta || {};

  // --- Mode 1: address lookup -------------------------------------------------
  if (q.address != null && String(q.address).trim() !== "") {
    const address = String(q.address);
    const zip = q.zip != null ? String(q.zip) : "";

    // The index keys are "ADDRESS|ZIP". If a zip is given, key directly; if not,
    // scan for any key whose address half matches (the zip disambiguates duplicates).
    const idx = DATA.address_index || {};
    let hit = null;
    let matchedKey = null;
    const directKey = keyFor(address, zip);
    if (zip && idx[directKey]) {
      hit = idx[directKey];
      matchedKey = directKey;
    } else {
      const addrHalf = keyFor(address, "");
      for (const k of Object.keys(idx)) {
        if (k.split("|")[0] === addrHalf) {
          hit = idx[k];
          matchedKey = k;
          break;
        }
      }
    }

    if (hit) {
      // Ownership of record is static; cache hard at the edge.
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
      const [matchedAddress, matchedZip] = matchedKey.split("|");
      return res.status(200).json({
        resolved: true,
        query: { address, zip: zip || null },
        matched: { address: matchedAddress, zip: matchedZip || null },
        owner_of_record: hit.owner_of_record,
        group: hit.group,
        group_id: hit.group_id,
        control_group: hit.control_group,
        road_act_large_investor: hit.road_act_large_investor === true,
        group_homes_in_coverage: hit.group_homes_in_coverage,
        group_entities: hit.group_entities,
        county: hit.county,
        state: hit.state,
        year_built: hit.year_built != null ? hit.year_built : null,
        coverage_note: meta.coverage_note,
        rule: meta.rule,
        note:
          "Owner of record from the county property roll. The control group is the institution the shell LLC resolves to; home and entity counts are a FLOOR across " +
          (DATA.covered_counties ? DATA.covered_counties.length : 17) +
          " covered counties. What the rolls show, not a forecast.",
        monitor_as_of: meta.monitor_as_of,
        data_version: meta.data_version,
      });
    }

    // Miss: no-store so a later build can fill it in. Honest about coverage.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      resolved: false,
      query: { address, zip: zip || null },
      reason: "not in the indexed institutional-landlord set",
      coverage_note: meta.coverage_note,
      covered_counties: (DATA.covered_counties || []).map((c) => `${c.county}, ${c.state}`),
      note:
        "An empty result does not mean the home is owner-occupied. The index covers institution-owned single-family homes in " +
        (DATA.covered_counties ? DATA.covered_counties.length : 17) +
        " large counties only. If the address is outside those counties, or held by an owner-occupant or a small landlord, it will not appear here.",
    });
  }

  // --- Mode 2: one group's full detail ---------------------------------------
  if ((q.group != null && String(q.group).trim() !== "") || (q.group_id != null && String(q.group_id).trim() !== "")) {
    const g = findGroup({ groupId: q.group_id, name: q.group });
    if (g) {
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
      return res.status(200).json({
        resolved: true,
        group: g,
        coverage_note: meta.coverage_note,
        rule: meta.rule,
        monitor_as_of: meta.monitor_as_of,
        data_version: meta.data_version,
      });
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      resolved: false,
      reason: "no named group matches that query",
      note: "Try an institution name such as Progress Residential, Invitation Homes, or FirstKey.",
    });
  }

  // --- Mode 3: the roster (default) ------------------------------------------
  // The browse view: covered counties + every named landlord group with full
  // detail, plus the compact roster of all covered groups the monitor surfaces.
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).json({
    meta,
    covered_counties: DATA.covered_counties || [],
    groups: DATA.groups || [],
    all_covered_groups: DATA.all_covered_groups || [],
    indexed_address_count: DATA.address_index ? Object.keys(DATA.address_index).length : 0,
  });
}
