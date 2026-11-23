// graph.js  --  Aerograph CONNECTION-GRAPH endpoint. Serves the REAL Tensorust
// Ontology relation graph behind the owners of attributed aircraft: who lobbies
// for whom (Senate LDA), who owns whom (SEC subsidiary lists / USAspending parent
// UEI), who holds whose debt (SEC BDC 10-Q), who gives to which PAC (FEC), who
// takes federal money (USAspending) and which federal rule binds whom (DFARS /
// Federal Register). This is the "past-possible" layer: a walkable web of hidden
// connections, every edge a real public record.
//
// PURE READER. It never calls the ontology at request time and never fabricates
// an edge. The only producer is scripts/build-graph.mjs (resolved in-session via
// the MCP) -> site/data/graph.json -> bundled by scripts/build-graphdata.mjs into
// _graphData.js. A connection that does not exist in public records is simply
// absent; nothing is invented to fill a gap.
//
// Modes (all read the same bundled graph):
//   (default / ?full=1)       whole graph: { meta, nodes, edges, tail_to_owner }
//   ?node=<id>                one node + its incident edges + neighbor nodes
//   ?from=<id>&to=<id>        BFS shortest path over real edges (how are these
//                             two connected?), with the evidence on every hop
//   ?q=<text>                 node search by label / id
//   ?tail=<N-number>          the owning-org node id for an aircraft tail, or null

import GRAPH from "./_graphData.js";

const NODES = Array.isArray(GRAPH.nodes) ? GRAPH.nodes : [];
const EDGES = Array.isArray(GRAPH.edges) ? GRAPH.edges : [];
const TAIL_TO_OWNER = GRAPH.tail_to_owner || {};

// id -> node, and an undirected adjacency list carrying the real edge on each hop.
const NODE_BY_ID = new Map(NODES.map((n) => [n.id, n]));
const ADJ = new Map();
for (const n of NODES) ADJ.set(n.id, []);
for (const e of EDGES) {
  if (ADJ.has(e.source)) ADJ.get(e.source).push({ to: e.target, edge: e, dir: "out" });
  if (ADJ.has(e.target)) ADJ.get(e.target).push({ to: e.source, edge: e, dir: "in" });
}

function incidentEdges(id) {
  return EDGES.filter((e) => e.source === id || e.target === id);
}

function neighborIds(id) {
  const set = new Set();
  for (const e of incidentEdges(id)) set.add(e.source === id ? e.target : e.source);
  return [...set];
}

// BFS shortest path over the UNDIRECTED edge set. Returns the ordered node ids and
// the exact edges walked (so the UI can label every hop with its real relation and
// public source). Empty path => honestly not connected in the public record.
function shortestPath(fromId, toId) {
  if (!NODE_BY_ID.has(fromId) || !NODE_BY_ID.has(toId)) return null;
  if (fromId === toId) return { nodes: [fromId], edges: [] };
  const prev = new Map();     // node -> { from, edge }
  const seen = new Set([fromId]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    for (const step of ADJ.get(cur) || []) {
      if (seen.has(step.to)) continue;
      seen.add(step.to);
      prev.set(step.to, { from: cur, edge: step.edge });
      if (step.to === toId) {
        const nodeIds = [toId];
        const edgePath = [];
        let walk = toId;
        while (walk !== fromId) {
          const p = prev.get(walk);
          edgePath.unshift(p.edge);
          walk = p.from;
          nodeIds.unshift(walk);
        }
        return { nodes: nodeIds, edges: edgePath };
      }
      queue.push(step.to);
    }
  }
  return { nodes: [], edges: [] }; // reachable set exhausted: not connected
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // The graph is static public-record data; cache it hard at the edge.
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  const q = req.query || {};

  // ---- tail -> owning org node (for the aircraft dossier's "reveal" button) ----
  if (q.tail != null) {
    let t = String(q.tail).trim().toUpperCase();
    if (t && !t.startsWith("N")) t = "N" + t;
    const id = TAIL_TO_OWNER[t] || null;
    return res.status(200).json({ tail: t, node: id ? (NODE_BY_ID.get(id) || null) : null, node_id: id });
  }

  // ---- node search by label / id ----
  if (q.q != null) {
    const needle = String(q.q).trim().toLowerCase();
    const hits = !needle ? [] : NODES.filter(
      (n) => n.id.toLowerCase().includes(needle) || String(n.label || "").toLowerCase().includes(needle)
    ).slice(0, 40).map((n) => ({ id: n.id, type: n.type, label: n.label }));
    return res.status(200).json({ query: needle, count: hits.length, nodes: hits });
  }

  // ---- how are these two connected? (BFS over real edges) ----
  if (q.from != null && q.to != null) {
    const path = shortestPath(String(q.from), String(q.to));
    if (!path) return res.status(404).json({ reason: "unknown from/to node id" });
    return res.status(200).json({
      from: String(q.from),
      to: String(q.to),
      connected: path.nodes.length > 0,
      hops: path.edges.length,
      nodes: path.nodes.map((id) => NODE_BY_ID.get(id)).filter(Boolean),
      edges: path.edges,
    });
  }

  // ---- one node + its incident edges + neighbors (walk a step) ----
  if (q.node != null) {
    const id = String(q.node);
    const node = NODE_BY_ID.get(id);
    if (!node) return res.status(404).json({ reason: "unknown node id", node_id: id });
    const edges = incidentEdges(id);
    const neighbors = neighborIds(id).map((nid) => NODE_BY_ID.get(nid)).filter(Boolean);
    return res.status(200).json({ node, edges, neighbors, degree: edges.length });
  }

  // ---- default: the whole graph (it is small; the UI walks it client-side) ----
  return res.status(200).json({
    meta: GRAPH.meta || {},
    nodes: NODES,
    edges: EDGES,
    tail_to_owner: TAIL_TO_OWNER,
  });
}
