// Aerograph connection-graph builder.
// Resolves REAL Tensorust Ontology relations (gathered live via MCP in-workflow)
// into site/data/graph.json. The deployed function is a pure reader of this file.
// Every node and edge traces to a public source. Nothing invented. No em dashes.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = "C:/Users/Matthew/aerograph";
const attribution = JSON.parse(readFileSync(join(ROOT, "site/data/attribution.json"), "utf8"));

// owner name -> resolved tails in the live attribution set
const tailsByOwner = {};
for (const hex of Object.keys(attribution.byHex)) {
  const e = attribution.byHex[hex];
  if (!e.owner) continue;
  (tailsByOwner[e.owner] = tailsByOwner[e.owner] || []).push(e.tail);
}

const nodes = [];
const edges = [];
const nodeIds = new Set();
function addNode(n) {
  if (nodeIds.has(n.id)) return;
  nodeIds.add(n.id);
  nodes.push(n);
}
function addEdge(source, target, kind, evidence, props) {
  edges.push({ source, target, kind, evidence, ...(props || {}) });
}

// ---- Lobbying firms per owner (Senate LDA, source: lda). Complete visible rosters. ----
const firms = {
  "org:AMERICAN AIRLINES": [
    ["org:PENN AVENUE PARTNERS", "PENN AVENUE PARTNERS"],
    ["org:CGCN GROUP", "CGCN GROUP, LLC"],
    ["org:EMPIRE CONSULTING GROUP", "EMPIRE CONSULTING GROUP"],
    ["org:VENABLE", "VENABLE LLP"],
    ["org:WILLIAMS AND JENSEN", "WILLIAMS AND JENSEN, PLLC"],
    ["org:ELEVATE GOVERNMENT AFFAIRS", "ELEVATE GOVERNMENT AFFAIRS, LLC"],
    ["org:SIMMONS AND RUSSELL GROUP", "THE SIMMONS & RUSSELL GROUP, LLC"],
    ["org:CASSIDY AND ASSOCIATES", "CASSIDY & ASSOCIATES, INC."],
    ["org:COVENANT GOVERNMENT AFFAIRS", "COVENANT GOVERNMENT AFFAIRS, LLC"],
    ["org:AKIN GUMP STRAUSS HAUER AND FELD", "AKIN GUMP STRAUSS HAUER & FELD"],
  ],
  "org:DELTA AIR LINES": [
    ["org:MILLER STRATEGIES", "MILLER STRATEGIES, LLC"],
    ["org:AVOQ", "AVOQ LLC"],
    ["org:TEAM HALLAHAN", "TEAM HALLAHAN LLC"],
    ["org:CAPITOL COUNSEL", "CAPITOL COUNSEL LLC"],
    ["org:THOLOS GOVERNMENT RELATIONS", "THOLOS GOVERNMENT RELATIONS"],
    ["org:LIZ WILLIAMS AND", "LIZ WILLIAMS AND COMPANY"],
    ["org:THEGROUP DC", "THEGROUP DC, LLC"],
    ["org:SIGHTLINE ADVOCACY", "SIGHTLINE ADVOCACY, LLC"],
    ["org:ROWLAND STRATEGY GROUP", "ROWLAND STRATEGY GROUP LLC"],
    ["org:WILLIAMS GROUP", "THE WILLIAMS GROUP"],
  ],
  "org:UNITED AIRLINES": [
    ["org:MICHAEL BEST STRATEGIES", "MICHAEL BEST STRATEGIES LLC"],
    ["org:BALLARD PARTNERS", "BALLARD PARTNERS"],
    ["org:DUBERSTEIN GROUP", "THE DUBERSTEIN GROUP INC."],
    ["org:CORNERSTONE GOVERNMENT AFFAIRS", "CORNERSTONE GOVERNMENT AFFAIRS, INC."],
    ["org:MEHLMAN CONSULTING", "MEHLMAN CONSULTING, INC."],
    ["org:ALIGNMENT GOVERNMENT STRATEGIES", "ALIGNMENT GOVERNMENT STRATEGIES"],
  ],
  "org:SOUTHWEST AIRLINES": [
    ["org:SQUIRE PATTON BOGGS", "SQUIRE PATTON BOGGS"],
    ["org:S 3 GROUP", "S-3 GROUP"],
    ["org:JERRY COSTELLO GROUP", "THE JERRY COSTELLO GROUP, LLC"],
    ["org:O KEEFFE SHAHMORADI STRATEGIES", "O'KEEFFE SHAHMORADI STRATEGIES, LLC"],
    ["org:MONDELLO GROUP", "THE MONDELLO GROUP LLC"],
    ["org:PUBLIC STRATEGIES WASHINGTON", "PUBLIC STRATEGIES WASHINGTON, INC."],
  ],
  "org:JETBLUE AIRWAYS": [
    ["org:FGS GLOBAL US LLC FKA FGH HOLDINGS", "FGS GLOBAL (US) LLC (FKA FGH HOLDINGS LLC)"],
    ["org:FEDERAL HILL GROUP", "FEDERAL HILL GROUP, LLC"],
    ["org:JTR STRATEGIES", "JTR STRATEGIES LLC"],
    ["org:HOLLIS PUBLIC AFFAIRS", "HOLLIS PUBLIC AFFAIRS"],
    ["org:ECKERT SEAMANS CHERIN AND MELLOTT", "ECKERT SEAMANS CHERIN & MELLOTT, LLC"],
  ],
  "org:EXAMWORKS": [
    ["org:KING AND SPALDING", "KING & SPALDING LLP"],
  ],
};
const firmCountTotal = { "org:AMERICAN AIRLINES": 13, "org:DELTA AIR LINES": 11, "org:UNITED AIRLINES": 6, "org:SOUTHWEST AIRLINES": 6, "org:JETBLUE AIRWAYS": 5, "org:EXAMWORKS": 1 };

// ---- Owner organizations (resolved in the ontology) ----
const owners = [
  { id: "org:AMERICAN AIRLINES", label: "American Airlines, Inc", ownerName: "AMERICAN AIRLINES INC",
    props: { state: "FL", lobbying_total: 12045000, lobbying_firms: 13, sources: ["bdc_borrower","faa","fec","lda","usaspending"] },
    pac: ["pac:C00107300", "American Airlines Inc. PAC (AAPAC)"],
    awards: [["award:all:MSYJX48BX3G6","Federal awards FY2025+ to American Airlines, Inc","all"],["award:dod:MSYJX48BX3G6","DoD prime contracts FY2024-26 to American Airlines, Inc","dod"]],
    loan: { id: "loan:AMERICAN AIRLINES", label: "American Airlines INC first-lien term loan", par: 2850000, maturity: "2029-06-30",
      funds: [["fund:CRESCENT PRIVATE CREDIT INCOME CORP","Crescent Private Credit Income Corp","Crescent",0.9855],["fund:BARINGS PRIVATE CREDIT CORP","Barings Private Credit Corp","Barings",0.9869]] } },
  { id: "org:DELTA AIR LINES", label: "Delta Air Lines, Inc.", ownerName: "DELTA AIR LINES INC",
    props: { state: "NY", ticker: "DAL", lobbying_total: 12450000, lobbying_firms: 11, sources: ["dol_5500","faa","lda","sec_frames","usaspending"] },
    awards: [["award:all:W14ZM8ZS2625","Federal awards FY2025+ to Delta Air Lines, Inc.","all"],["award:dod:W14ZM8ZS2625","DoD prime contracts FY2024-26 to Delta Air Lines, Inc.","dod"]] },
  { id: "org:UNITED AIRLINES", label: "United Airlines, Inc.", ownerName: "UNITED AIRLINES INC",
    props: { state: "CO", lobbying_total: 10320000, lobbying_firms: 6, sources: ["bdc_borrower","dol_5500","faa","fec","lda","usaspending"] },
    parent: ["org:UNITED AIRLINES HOLDINGS", "United Airlines Holdings, Inc.", "usaspending_parent / sec_frames"],
    pac: ["pac:C00101766", "United Airlines, Inc. PAC (UAPAC)"],
    awards: [["award:all:JD7QTHZX2CM7","Federal awards FY2025+ to United Airlines, Inc.","all"],["award:dod:JD7QTHZX2CM7","DoD prime contracts FY2024-26 to United Airlines, Inc.","dod"]],
    rules: [["rule:DFARS-FOCI","DFARS-FOCI","proposed","1 DoD award above $5M (DFARS Case 2021-D011, 91 FR 24783)"]],
    loan: { id: "loan:UNITED AIRLINES", label: "United Airlines INC first-lien term loan", par: 3667000, maturity: null,
      funds: [["fund:NUVEEN CHURCHILL PRIVATE CAPITAL INCOME FUND","Nuveen Churchill Private Capital Income Fund","Nuveen",1.0003]] } },
  { id: "org:SOUTHWEST AIRLINES", label: "Southwest Airlines Co", ownerName: "SOUTHWEST AIRLINES CO",
    props: { state: "TX", ticker: "LUV", lobbying_total: 3170000, lobbying_firms: 6, sources: ["dol_5500","faa","fec","lda","sec_frames","usaspending"] },
    pac: ["pac:C00341602", "Southwest Airlines Co. PAC (SWAPAC)"],
    awards: [["award:all:TA21AQVF3977","Federal awards FY2025+ to Southwest Airlines Co.","all"],["award:dod:TA21AQVF3977","DoD prime contracts FY2024-26 to Southwest Airlines Co.","dod"]] },
  { id: "org:JETBLUE AIRWAYS", label: "JetBlue Airways Corp", ownerName: "JETBLUE AIRWAYS CORP",
    props: { state: "NY", ticker: "JBLU", lobbying_total: 3783000, lobbying_firms: 5, sources: ["dol_5500","faa","lda","sec_frames","usaspending"] },
    awards: [["award:all:FDLJFLVDKP66","Federal awards FY2025+ to JetBlue Airways Corporation","all"],["award:dod:FDLJFLVDKP66","DoD prime contracts FY2024-26 to JetBlue Airways Corporation","dod"]] },
  { id: "org:EXAMWORKS", label: "ExamWorks, LLC", ownerName: "EXAMWORKS LLC",
    props: { state: "CA", lobbying_total: 160000, lobbying_firms: 1, lobbying_issues: "HCR", sources: ["dol_5500","faa","lda","usaspending"] },
    parent: ["org:ONTIC ENGINEERING AND MANUFACTURING #HMTETTKQESG9", "Ontic Engineering and Manufacturing, Inc.", "usaspending_parent"],
    awards: [["award:all:G9UJLAHSPTN7","Federal awards FY2025+ to ExamWorks, LLC","all"]] },
  { id: "org:ALTIUS AVIATION", label: "Altius Aviation LLC", ownerName: "ALTIUS AVIATION LLC",
    props: { state: "NY", sources: ["dol_5500","faa"] } },
  { id: "org:THUNDERUN AVIATION", label: "Thunderun Aviation Corp", ownerName: "THUNDERUN AVIATION CORP",
    props: { state: "NY", owns_count: 4, sources: ["dol_5500","faa"] } },
];

// ---- Build owner nodes + their edges ----
for (const o of owners) {
  addNode({ id: o.id, type: "owner", label: o.label,
    props: { ...o.props, resolved_tails: tailsByOwner[o.ownerName] || [] } });

  if (o.parent) {
    addNode({ id: o.parent[0], type: "parent", label: o.parent[1], props: {} });
    addEdge(o.id, o.parent[0], "SUBSIDIARY_OF", `SEC Exhibit 21 / USAspending parent UEI (${o.parent[2]})`);
  }
  for (const [fid, fname] of (firms[o.id] || [])) {
    addNode({ id: fid, type: "firm", label: fname, props: {} });
    addEdge(fid, o.id, "LOBBIES_FOR", "Senate LDA lobbying report (lda)");
  }
  if (o.pac) {
    addNode({ id: o.pac[0], type: "pac", label: o.pac[1], props: {} });
    addEdge(o.id, o.pac[0], "HAS_PAC", "FEC connected organization (fec)");
  }
  for (const [aid, aname, kind] of (o.awards || [])) {
    addNode({ id: aid, type: "award", label: aname, props: { scope: kind } });
    addEdge(o.id, aid, "RECEIVED", kind === "dod" ? "USAspending DoD prime contracts (usaspending)" : "USAspending federal awards (usaspending)");
  }
  if (o.loan) {
    addNode({ id: o.loan.id, type: "loan", label: o.loan.label, props: { par_usd: o.loan.par, maturity: o.loan.maturity } });
    addEdge(o.id, o.loan.id, "BORROWS", "SEC BDC 10-Q schedule of investments, first-lien term loan (bdc_borrower)");
    for (const [fundId, fundName, mgr, mark] of o.loan.funds) {
      addNode({ id: fundId, type: "fund", label: fundName, props: { manager: mgr } });
      addEdge(fundId, o.loan.id, "LENDS_TO", `SEC BDC 10-Q (${mgr}), fair value ${(mark*100).toFixed(2)}% of par as of 2026-06-30`, { mark });
    }
  }
  for (const [rid, rlabelShort, status, ev] of (o.rules || [])) {
    addNode({ id: rid, type: "rule", label: "DFARS-FOCI: DoD SF 328 / beneficial ownership disclosure (proposed)", props: { status, citation: "DFARS Case 2021-D011, 91 FR 24783" } });
    addEdge(o.id, rid, "SUBJECT_TO", ev, { status });
  }
}

// ---- Ontic corporate family (ExamWorks's parent group), resolved live ----
// Sibling of ExamWorks under the shared parent node (usaspending parent UEI).
addNode({ id: "org:ONTIC ENGINEERING AND MANUFACTURING UK", type: "related", label: "Ontic Engineering & Manufacturing UK Limited", props: { note: "UK affiliate; sibling of ExamWorks under shared parent" } });
addEdge("org:ONTIC ENGINEERING AND MANUFACTURING UK", "org:ONTIC ENGINEERING AND MANUFACTURING #HMTETTKQESG9", "SUBSIDIARY_OF", "USAspending parent UEI (usaspending_parent)");

// Separate Ontic resolution: the DoD prime-contractor record (same real company, distinct ontology node from a different source).
addNode({ id: "org:ONTIC ENGINEERING AND MANUFACTURING #GMLHMNMB79G9", type: "related", label: "Ontic Engineering & Manufacturing, Inc (DoD contractor record)",
  props: { state: "CA", sources: ["usaspending"], note: "Same real company as ExamWorks's parent; resolved as a separate node from USAspending award data" } });
for (const [aid, aname, kind] of [["award:all:GMLHMNMB79G9","Federal awards FY2025+ to Ontic Engineering & Manufacturing, Inc","all"],["award:dod:GMLHMNMB79G9","DoD prime contracts FY2024-26 to Ontic Engineering & Manufacturing, Inc","dod"]]) {
  addNode({ id: aid, type: "award", label: aname, props: { scope: kind } });
  addEdge("org:ONTIC ENGINEERING AND MANUFACTURING #GMLHMNMB79G9", aid, "RECEIVED", kind === "dod" ? "USAspending DoD prime contracts (usaspending)" : "USAspending federal awards (usaspending)");
}
// Ensure the DFARS rule node exists then connect Ontic-DoD to it (shared-rule cross-link with United).
addNode({ id: "rule:DFARS-FOCI", type: "rule", label: "DFARS-FOCI: DoD SF 328 / beneficial ownership disclosure (proposed)", props: { status: "proposed", citation: "DFARS Case 2021-D011, 91 FR 24783" } });
addEdge("org:ONTIC ENGINEERING AND MANUFACTURING #GMLHMNMB79G9", "rule:DFARS-FOCI", "SUBJECT_TO", "2 DoD awards above $5M (DFARS Case 2021-D011, 91 FR 24783)", { status: "proposed" });

// ---- Compute cross-links: nodes shared by 2+ distinct owner/related entities ----
const ownerTypeIds = new Set(nodes.filter(n => n.type === "owner" || n.type === "parent" || n.type === "related").map(n => n.id));
const sharedTargets = {}; // target -> set of owner-side sources that connect to it
for (const e of edges) {
  // a shared node is one reached from (LOBBIES_FOR in: firm->owner) or owner->(pac/loan/rule/fund via loan)
  // we detect shared firm/pac/fund/rule across 2+ owners
  const bridgeKinds = { LOBBIES_FOR: "src", HAS_PAC: "tgt", SUBJECT_TO: "tgt" };
}
// Shared lobbying firm: firm with 2+ owner clients
const firmClients = {};
for (const e of edges) if (e.kind === "LOBBIES_FOR") (firmClients[e.source] = firmClients[e.source] || []).push(e.target);
const sharedFirms = Object.entries(firmClients).filter(([, v]) => new Set(v).size >= 2);
// Shared rule: rule with 2+ subjects
const ruleSubjects = {};
for (const e of edges) if (e.kind === "SUBJECT_TO") (ruleSubjects[e.target] = ruleSubjects[e.target] || []).push(e.source);
const sharedRules = Object.entries(ruleSubjects).filter(([, v]) => new Set(v).size >= 2);
// Shared parent: parent with 2+ subsidiaries
const parentSubs = {};
for (const e of edges) if (e.kind === "SUBSIDIARY_OF") (parentSubs[e.target] = parentSubs[e.target] || []).push(e.source);
const sharedParents = Object.entries(parentSubs).filter(([, v]) => new Set(v).size >= 2);

const crossLinks = [];
for (const [rid, subs] of sharedRules) crossLinks.push({ hub: rid, kind: "shared_rule", members: [...new Set(subs)] });
for (const [pid, subs] of sharedParents) crossLinks.push({ hub: pid, kind: "shared_parent", members: [...new Set(subs)] });
for (const [fid, cl] of sharedFirms) crossLinks.push({ hub: fid, kind: "shared_lobbyist", members: [...new Set(cl)] });

const graph = {
  meta: {
    generated_at: new Date().toISOString(),
    producer: "scripts/build-graph.mjs",
    note: "REAL Tensorust Ontology relations for the owners of resolved aircraft and their parents. Every edge cites a public source (FAA registry, SEC Exhibit 21, USAspending, Senate LDA, FEC, SEC BDC 10-Q, DFARS/Federal Register). Nothing invented. Edges are what is visible in public records, not a claim about any flight.",
    link_types: ["SUBSIDIARY_OF","LOBBIES_FOR","HAS_PAC","RECEIVED","BORROWS","LENDS_TO","SUBJECT_TO"],
    node_count: nodes.length,
    edge_count: edges.length,
    owners_resolved: owners.length,
    owners_unresolved: ["SKYWEST AIRLINES INC","REPUBLIC AIRWAYS INC","CARGO AIRCRAFT MANAGEMENT INC","N121LJ LLC","CT EQUIPMENT LEASING LLC"],
    trustee_or_government_owners: ["BANK OF UTAH TRUSTEE","WILMINGTON TRUST CO TRUSTEE","UMB BANK NA TRUSTEE","PENNSYLVANIA STATE POLICE"],
    honest_gaps: "Among the current (airline-heavy) resolved set no two owners share a lobbying firm (each carrier uses a separate LDA roster) and the two carriers with BDC first-lien loans (American, United) are held by different funds. The real cross-links are structural (shared parent, shared federal rule). Expanding attribution to non-airline corporate tails is expected to surface shared firm and lender hubs.",
    cross_links: crossLinks,
  },
  nodes,
  edges,
};

const OUT = join(ROOT, "site/data/graph.json");
writeFileSync(OUT, JSON.stringify(graph, null, 1));
console.log("wrote", OUT);
console.log("nodes", nodes.length, "edges", edges.length);
console.log("cross_links", JSON.stringify(crossLinks, null, 1));
const byType = {};
for (const n of nodes) byType[n.type] = (byType[n.type]||0)+1;
console.log("node types", byType);
const byKind = {};
for (const e of edges) byKind[e.kind] = (byKind[e.kind]||0)+1;
console.log("edge kinds", byKind);
