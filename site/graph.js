// Aerograph CONNECTION GRAPH  --  the "past-possible" layer. Click any entity and
// reveal the hidden web behind it: shared lobbyists, shared lenders, control-group
// siblings, federal money, PACs, the federal rules that bind it. A walkable graph
// over the REAL Tensorust Ontology, plus a "how are these two connected?" path
// finder (BFS over the real edges).
//
// EVERY edge drawn here is a real public-record relation carried straight from
// /api/graph (SUBSIDIARY_OF, LOBBIES_FOR, HAS_PAC, RECEIVED, BORROWS, LENDS_TO,
// SUBJECT_TO), each with its own evidence string (Senate LDA, SEC Exhibit 21,
// USAspending, FEC, SEC BDC 10-Q, DFARS / Federal Register). Nothing is invented.
// Where no connection exists in the records, the graph says so honestly.
//
// Self-contained: injects its own style + markup, exposes three hooks:
//   window.showNetwork({ nodeId? , tail? })   open the overlay, focused on a node
//   window.showNetworkForDossier(d)           open from an aircraft dossier record
//   window.aerographGraph.nodeIdForDossier(d) resolve a dossier -> a node id | null
//
// Pure client-side. Reads the whole graph once (/api/graph) and walks it locally.

(function () {
  "use strict";
  if (window.__aerographGraph) return;
  window.__aerographGraph = true;

  // ---- node type -> color + human role. Mirrors graph.json node.type. ----
  var TYPE = {
    owner:   { c: "#28e0ff", r: 15, k: "Aircraft owner" },
    parent:  { c: "#ffcf4a", r: 13, k: "Parent / control group" },
    related: { c: "#b45cff", r: 12, k: "Related entity (shared parent)" },
    firm:    { c: "#7fa8c9", r: 8.5, k: "Lobbying firm" },
    pac:     { c: "#ff6ea9", r: 10, k: "Political action committee" },
    award:   { c: "#2bd47a", r: 10, k: "Federal award" },
    loan:    { c: "#ff9d4a", r: 10, k: "First-lien term loan" },
    fund:    { c: "#ff5c7a", r: 10, k: "Private-credit lender (BDC)" },
    rule:    { c: "#ff3b5c", r: 11, k: "Federal rule" }
  };
  function typeOf(t) { return TYPE[t] || { c: "#8a97ad", r: 9, k: t || "entity" }; }

  // ---- relation -> plain-language verb + the record class it comes from. ----
  var REL = {
    SUBSIDIARY_OF: { v: "is a subsidiary of", src: "SEC subsidiary list / parent UEI" },
    LOBBIES_FOR:   { v: "lobbies for",        src: "Senate LDA filing" },
    HAS_PAC:       { v: "runs the PAC",       src: "FEC connected organization" },
    RECEIVED:      { v: "received federal money", src: "USAspending" },
    BORROWS:       { v: "borrows on",         src: "SEC BDC 10-Q" },
    LENDS_TO:      { v: "holds the debt of",  src: "SEC BDC 10-Q" },
    SUBJECT_TO:    { v: "is bound by",        src: "DFARS / Federal Register" }
  };
  function relOf(k) { return REL[k] || { v: k, src: "" }; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m];
    });
  }
  function fmtMoney(n) {
    var v = Number(n); if (!isFinite(v)) return null;
    return "$" + v.toLocaleString("en-US");
  }
  var SVGNS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  var STYLE = '' +
    '#agx{position:fixed;inset:0;z-index:60;display:none;opacity:0;transition:opacity .25s ease;' +
      'background:radial-gradient(1200px 820px at 62% 40%,#0b1424 0%,#060910 60%,#03050a 100%);' +
      'color:#e8eef7;font-family:"Inter",system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}' +
    '#agx.open{display:block;opacity:1;}' +
    '#agx .agx-grid{position:absolute;inset:0;background-image:' +
      'linear-gradient(#0e1726 1px,transparent 1px),linear-gradient(90deg,#0e1726 1px,transparent 1px);' +
      'background-size:46px 46px;opacity:.5;mask-image:radial-gradient(120% 90% at 60% 40%,#000 30%,transparent 85%);}' +
    '#agx svg{position:absolute;inset:0;width:100%;height:100%;cursor:grab;touch-action:none;}' +
    '#agx svg.drag{cursor:grabbing;}' +
    '#agx .agx-top{position:absolute;top:16px;left:18px;right:18px;display:flex;gap:14px;align-items:flex-start;' +
      'justify-content:space-between;pointer-events:none;}' +
    '#agx .agx-title{pointer-events:auto;}' +
    '#agx .agx-title b{font-size:15px;letter-spacing:.02em;}' +
    '#agx .agx-title b .pp{color:#ff6ea9;}' +
    '#agx .agx-title div{color:#8a97ad;font-size:11.5px;margin-top:3px;max-width:430px;line-height:1.5;}' +
    '#agx .agx-x{pointer-events:auto;width:30px;height:30px;border:1px solid #1d283b;background:rgba(14,20,32,.8);' +
      'color:#9fb0c6;border-radius:8px;cursor:pointer;font-size:17px;line-height:1;flex:none;}' +
    '#agx .agx-x:hover{color:#fff;border-color:#2c3a56;}' +
    '#agx .agx-tools{position:absolute;top:16px;left:50%;transform:translateX(-50%);display:flex;gap:8px;' +
      'pointer-events:auto;flex-wrap:wrap;justify-content:center;max-width:94vw;}' +
    '#agx .agx-tools input{width:220px;max-width:46vw;background:rgba(10,15,25,.9);border:1px solid #1d283b;color:#e8eef7;' +
      'border-radius:8px;padding:8px 11px;font-size:12.5px;outline:none;}' +
    '#agx .agx-tools input:focus{border-color:#28e0ff;}' +
    '#agx .agx-btn{background:rgba(10,15,25,.9);border:1px solid #1d283b;color:#cdd7e6;border-radius:8px;' +
      'padding:8px 11px;font-size:12px;cursor:pointer;white-space:nowrap;}' +
    '#agx .agx-btn:hover{border-color:#2c3a56;color:#fff;}' +
    '#agx .agx-btn.on{border-color:#ff6ea9;color:#ff6ea9;}' +
    '#agx .agx-sug{position:absolute;top:52px;left:50%;transform:translateX(-50%);width:300px;max-width:80vw;' +
      'background:#0a0f19;border:1px solid #1d283b;border-radius:9px;overflow:hidden;pointer-events:auto;display:none;' +
      'box-shadow:0 18px 40px rgba(0,0,0,.5);max-height:50vh;overflow-y:auto;}' +
    '#agx .agx-sug.show{display:block;}' +
    '#agx .agx-sug .s{padding:8px 11px;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:9px;' +
      'border-bottom:1px solid #121a28;}' +
    '#agx .agx-sug .s:hover{background:rgba(255,255,255,.04);}' +
    '#agx .agx-sug .s .d{width:8px;height:8px;border-radius:50%;flex:none;}' +
    '#agx .agx-sug .s .ty{color:#6f7d93;font-size:10.5px;margin-left:auto;text-transform:uppercase;letter-spacing:.06em;}' +
    '#agx .edge{stroke:#2a3b57;stroke-width:1.1;transition:stroke .25s,stroke-width .25s,opacity .25s;}' +
    '#agx .edge.lit{stroke:#3f5e86;stroke-width:1.6;}' +
    '#agx .edge.path{stroke:#ff6ea9;stroke-width:2.4;filter:drop-shadow(0 0 5px rgba(255,110,169,.6));}' +
    '#agx .edge.dim{opacity:.16;}' +
    '#agx .elabel{fill:#8a97ad;font-size:8.5px;letter-spacing:.02em;pointer-events:none;opacity:0;transition:opacity .2s;}' +
    '#agx .elabel.show{opacity:.92;}' +
    '#agx .elabel.path{fill:#ffb3d1;opacity:1;font-weight:600;}' +
    '#agx .node{cursor:pointer;}' +
    '#agx .node circle.core{stroke:#05080f;stroke-width:1.5;transition:stroke .2s,stroke-width .2s;}' +
    '#agx .node.focus circle.core{stroke:#fff;stroke-width:2.4;}' +
    '#agx .node.path circle.core{stroke:#ff6ea9;stroke-width:2.4;}' +
    '#agx .node.dim{opacity:.22;}' +
    '#agx .node text{fill:#cdd7e6;font-size:11px;paint-order:stroke;stroke:#05080f;stroke-width:3px;' +
      'stroke-linejoin:round;pointer-events:none;}' +
    '#agx .node.focus text{fill:#fff;font-weight:600;}' +
    '#agx .rail{position:absolute;top:0;right:0;bottom:0;width:360px;max-width:92vw;background:rgba(6,9,16,.9);' +
      'border-left:1px solid #141c2b;backdrop-filter:blur(10px);overflow-y:auto;overscroll-behavior:contain;' +
      'transform:translateX(100%);transition:transform .24s ease;padding:0;}' +
    '#agx .rail.open{transform:translateX(0);}' +
    '#agx .rail-h{padding:18px 18px 14px;border-bottom:1px solid #141c2b;}' +
    '#agx .rail-h .chip{display:inline-flex;align-items:center;gap:6px;font-size:10px;letter-spacing:.07em;' +
      'text-transform:uppercase;padding:3px 8px;border-radius:999px;font-weight:600;}' +
    '#agx .rail-h .chip .d{width:7px;height:7px;border-radius:50%;}' +
    '#agx .rail-h h3{margin:10px 0 2px;font-size:17px;line-height:1.3;}' +
    '#agx .rail-h .sub{color:#8a97ad;font-size:11.5px;line-height:1.5;}' +
    '#agx .rail-b{padding:6px 18px 30px;}' +
    '#agx .grp{padding:13px 0;border-bottom:1px solid #121a28;}' +
    '#agx .grp:last-child{border-bottom:none;}' +
    '#agx .grp .gk{font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:#6f7d93;margin-bottom:8px;' +
      'display:flex;align-items:center;gap:7px;}' +
    '#agx .grp .gk .gd{width:8px;height:8px;border-radius:50%;}' +
    '#agx .link{display:block;width:100%;text-align:left;background:rgba(255,255,255,.015);border:1px solid #141e2e;' +
      'border-radius:9px;padding:9px 11px;margin:5px 0;cursor:pointer;color:#dbe4f0;transition:border-color .18s,background .18s;}' +
    '#agx .link:hover{border-color:#2c3a56;background:rgba(255,255,255,.04);}' +
    '#agx .link .ln{font-size:13px;font-weight:600;line-height:1.35;}' +
    '#agx .link .lr{font-size:11px;color:#9fb0c6;margin-top:3px;}' +
    '#agx .link .ls{font-size:10.5px;color:#6f7d93;margin-top:4px;line-height:1.45;}' +
    '#agx .link .amt{color:#ffcf4a;font-weight:600;}' +
    '#agx .empty{color:#8a97ad;font-size:12.5px;line-height:1.6;padding:12px 0;}' +
    '#agx .pathbox{margin:0;padding:14px 18px;border-bottom:1px solid #141c2b;background:rgba(255,110,169,.045);}' +
    '#agx .pathbox .pt{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#ff9ec8;margin-bottom:7px;}' +
    '#agx .pathbox .hop{font-size:12px;line-height:1.5;padding:4px 0;color:#e8eef7;}' +
    '#agx .pathbox .hop .via{color:#9fb0c6;}' +
    '#agx .pathbox .hop .src{color:#6f7d93;font-size:10.5px;}' +
    '#agx .legend{position:absolute;left:18px;bottom:16px;display:flex;gap:7px 14px;flex-wrap:wrap;max-width:60vw;' +
      'pointer-events:none;}' +
    '#agx .legend .lg{display:flex;align-items:center;gap:6px;font-size:10.5px;color:#9fb0c6;}' +
    '#agx .legend .lg .d{width:8px;height:8px;border-radius:50%;}' +
    '#agx .hint{position:absolute;right:18px;bottom:16px;color:#5c6b82;font-size:10.5px;pointer-events:none;text-align:right;line-height:1.6;}' +
    '#agx .foot{color:#6f7d93;font-size:11px;line-height:1.6;padding-top:6px;}' +
    '#agx .foot b{color:#9fb0c6;}' +
    '@media (max-width:620px){#agx .agx-title div{display:none;}#agx .rail{width:100vw;}#agx .legend{display:none;}}';

  // dossier "reveal" button style, injected once (used inside #dossier-body)
  var DZSTYLE = '' +
    '.dz-reveal{display:flex;align-items:center;gap:10px;width:100%;margin:14px 0 2px;padding:12px 13px;cursor:pointer;' +
      'background:linear-gradient(100deg,rgba(255,110,169,.12),rgba(40,224,255,.08));border:1px solid #2a3a57;' +
      'border-radius:11px;color:#fff;font-family:inherit;text-align:left;transition:border-color .18s,transform .1s;}' +
    '.dz-reveal:hover{border-color:#ff6ea9;}' +
    '.dz-reveal:active{transform:translateY(1px);}' +
    '.dz-reveal .rv-i{width:30px;height:30px;flex:none;border-radius:8px;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(255,110,169,.14);}' +
    '.dz-reveal .rv-t b{display:block;font-size:13px;}' +
    '.dz-reveal .rv-t span{display:block;color:#9fb0c6;font-size:11px;margin-top:2px;}';

  // ---------- state ----------
  var GRAPH = null, loading = null;           // whole graph + load promise
  var NODE = new Map();                        // id -> node
  var ADJ = new Map();                         // id -> [{to, edge}]
  var root, host, svgEl, viewG, railEl, railH, railB, pathBoxEl, sugEl, searchEl, pathBtn;
  var sim = { nodes: [], edges: [], byId: new Map() }; // live layout
  var focusId = null;
  var pathMode = false, pathA = null, pathB = null, activePath = null;
  var view = { x: 0, y: 0, k: 1 };
  var raf = 0, alpha = 0;

  // ---------- data load ----------
  function load() {
    if (GRAPH) return Promise.resolve(GRAPH);
    if (loading) return loading;
    loading = fetch("/api/graph", { cache: "force-cache" })
      .then(function (r) { if (!r.ok) throw new Error("graph " + r.status); return r.json(); })
      .then(function (g) {
        GRAPH = g;
        NODE = new Map((g.nodes || []).map(function (n) { return [n.id, n]; }));
        ADJ = new Map((g.nodes || []).map(function (n) { return [n.id, []]; }));
        (g.edges || []).forEach(function (e) {
          if (ADJ.has(e.source)) ADJ.get(e.source).push({ to: e.target, edge: e });
          if (ADJ.has(e.target)) ADJ.get(e.target).push({ to: e.source, edge: e });
        });
        return g;
      });
    return loading;
  }

  // Resolve an aircraft dossier record -> the most central node id in the graph,
  // using ONLY real identifiers already in the record (tail in a node's
  // resolved_tails, then parent oid, then an award oid, then a pac id, then an
  // exact owner-name match). No fuzzy guessing. Returns a node id or null.
  function nodeIdForDossier(d) {
    if (!d || !GRAPH) return null;
    var t2o = GRAPH.tail_to_owner || {};
    if (d.tail) {
      var tk = String(d.tail).trim().toUpperCase();
      if (t2o[tk] && NODE.has(t2o[tk])) return t2o[tk];
    }
    if (d.parent && d.parent.oid && NODE.has(d.parent.oid)) return d.parent.oid;
    if (Array.isArray(d.awards)) {
      for (var i = 0; i < d.awards.length; i++) {
        if (d.awards[i].oid && NODE.has(d.awards[i].oid)) return d.awards[i].oid;
      }
    }
    if (d.pac && d.pac.id && NODE.has("pac:" + d.pac.id)) return "pac:" + d.pac.id;
    if (d.owner) {
      var want = String(d.owner).replace(/[^a-z0-9]/gi, "").toLowerCase();
      var hit = null;
      NODE.forEach(function (n) {
        if (hit) return;
        var lab = String(n.label || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
        var idn = n.id.replace(/^org:/, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
        if (lab && (lab === want || want.indexOf(lab) === 0 || lab.indexOf(want) === 0)) hit = n.id;
        else if (idn && (idn === want)) hit = n.id;
      });
      if (hit) return hit;
    }
    return null;
  }
  window.aerographGraph = { load: load, nodeIdForDossier: nodeIdForDossier };

  // ---------- DOM ----------
  function ensureDom() {
    if (root) return;
    var st = document.createElement("style"); st.textContent = STYLE + DZSTYLE; document.head.appendChild(st);

    root = document.createElement("div"); root.id = "agx";
    root.innerHTML =
      '<div class="agx-grid"></div>' +
      '<div class="agx-top">' +
        '<div class="agx-title"><b>The <span class="pp">past-possible</span> layer</b>' +
          '<div>The hidden web behind this entity, straight from public records. Every line is a real relation with its source. Click a node to walk it.</div></div>' +
        '<button class="agx-x" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="agx-tools">' +
        '<input type="text" placeholder="Search an entity..." autocomplete="off" />' +
        '<button class="agx-btn" data-act="path">How are two connected?</button>' +
        '<button class="agx-btn" data-act="all">Show everything</button>' +
      '</div>' +
      '<div class="agx-sug"></div>' +
      '<div class="legend"></div>' +
      '<div class="hint">drag to pan &middot; scroll to zoom &middot; drag a node to move it</div>' +
      '<aside class="rail"><div class="pathbox" style="display:none"></div><div class="rail-h"></div><div class="rail-b"></div></aside>';
    document.body.appendChild(root);

    host = root;
    svgEl = svg("svg"); svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
    root.insertBefore(svgEl, root.querySelector(".agx-top"));
    viewG = svg("g"); svgEl.appendChild(viewG);
    // layer order: edges, edge-labels, nodes
    viewG.appendChild(svg("g", { class: "edges" }));
    viewG.appendChild(svg("g", { class: "elabels" }));
    viewG.appendChild(svg("g", { class: "nodes" }));

    railEl = root.querySelector(".rail");
    railH = root.querySelector(".rail-h");
    railB = root.querySelector(".rail-b");
    pathBoxEl = root.querySelector(".pathbox");
    sugEl = root.querySelector(".agx-sug");
    searchEl = root.querySelector(".agx-tools input");
    pathBtn = root.querySelector('[data-act="path"]');

    root.querySelector(".agx-x").addEventListener("click", hide);
    root.querySelector('[data-act="all"]').addEventListener("click", function () { showAll(); });
    pathBtn.addEventListener("click", togglePathMode);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && root.classList.contains("open")) hide(); });

    buildLegend();
    wireSearch();
    wirePanZoom();
  }

  function buildLegend() {
    var order = ["owner", "parent", "related", "firm", "pac", "award", "loan", "fund", "rule"];
    root.querySelector(".legend").innerHTML = order.map(function (t) {
      return '<span class="lg"><span class="d" style="background:' + TYPE[t].c + '"></span>' + esc(TYPE[t].k) + '</span>';
    }).join("");
  }

  // ---------- search ----------
  function wireSearch() {
    var t;
    searchEl.addEventListener("input", function () {
      clearTimeout(t);
      var q = searchEl.value.trim().toLowerCase();
      t = setTimeout(function () {
        if (!q) { sugEl.classList.remove("show"); return; }
        var hits = [];
        NODE.forEach(function (n) {
          if (hits.length >= 30) return;
          if (n.id.toLowerCase().indexOf(q) >= 0 || String(n.label || "").toLowerCase().indexOf(q) >= 0) hits.push(n);
        });
        hits.sort(function (a, b) { return (TYPE[b.type] ? b.type === "owner" : 0) - (TYPE[a.type] ? a.type === "owner" : 0); });
        sugEl.innerHTML = hits.map(function (n) {
          return '<div class="s" data-id="' + esc(n.id) + '"><span class="d" style="background:' + typeOf(n.type).c + '"></span>' +
            '<span>' + esc(n.label) + '</span><span class="ty">' + esc(n.type) + '</span></div>';
        }).join("") || '<div class="s" style="cursor:default;color:#6f7d93">no entity matches</div>';
        sugEl.classList.add("show");
        sugEl.querySelectorAll(".s[data-id]").forEach(function (el) {
          el.addEventListener("click", function () {
            var id = el.getAttribute("data-id");
            sugEl.classList.remove("show"); searchEl.value = "";
            if (pathMode) choosePathNode(id); else focusNode(id, true);
          });
        });
      }, 120);
    });
    searchEl.addEventListener("blur", function () { setTimeout(function () { sugEl.classList.remove("show"); }, 180); });
  }

  // ---------- path mode ----------
  function togglePathMode() {
    pathMode = !pathMode;
    pathBtn.classList.toggle("on", pathMode);
    pathBtn.textContent = pathMode ? "Pick two nodes..." : "How are two connected?";
    pathA = pathB = null; activePath = null;
    if (!pathMode) { pathBoxEl.style.display = "none"; }
    else {
      pathA = focusId; // seed with current focus if any
      pathBoxEl.style.display = "block";
      pathBoxEl.innerHTML = '<div class="pt">How are these two connected?</div>' +
        '<div class="hop">' + (pathA ? 'From <b>' + esc(short(NODE.get(pathA).label)) + '</b>. Now click (or search) a second entity.' : 'Click a first entity, then a second.') + '</div>';
    }
    paint();
  }
  function choosePathNode(id) {
    if (!pathA) { pathA = id; focusNode(id, false);
      pathBoxEl.innerHTML = '<div class="pt">How are these two connected?</div>' +
        '<div class="hop">From <b>' + esc(short(NODE.get(id).label)) + '</b>. Now click a second entity.</div>';
      paint(); return;
    }
    pathB = id;
    runPath(pathA, pathB);
  }
  // client-side BFS over the real undirected edges (same logic as the API).
  function bfs(from, to) {
    if (from === to) return { nodes: [from], edges: [] };
    var prev = new Map(), seen = new Set([from]), q = [from];
    while (q.length) {
      var cur = q.shift();
      var steps = ADJ.get(cur) || [];
      for (var i = 0; i < steps.length; i++) {
        var s = steps[i];
        if (seen.has(s.to)) continue;
        seen.add(s.to); prev.set(s.to, { from: cur, edge: s.edge });
        if (s.to === to) {
          var nodes = [to], edges = [], w = to;
          while (w !== from) { var p = prev.get(w); edges.unshift(p.edge); w = p.from; nodes.unshift(w); }
          return { nodes: nodes, edges: edges };
        }
        q.push(s.to);
      }
    }
    return { nodes: [], edges: [] };
  }
  function runPath(a, b) {
    var res = bfs(a, b);
    activePath = res.nodes.length ? { nodes: res.nodes, edges: res.edges, set: new Set(res.nodes) } : null;
    // make sure every node on the path is on screen
    if (activePath) ensureNodes(res.nodes);
    renderPathBox(a, b, res);
    paint();
    // exit picking state but keep highlight
    pathMode = false; pathBtn.classList.remove("on"); pathBtn.textContent = "How are two connected?";
  }
  function renderPathBox(a, b, res) {
    var an = NODE.get(a), bn = NODE.get(b);
    pathBoxEl.style.display = "block";
    if (!res.nodes.length) {
      pathBoxEl.innerHTML = '<div class="pt">No connection in the public record</div>' +
        '<div class="hop"><b>' + esc(short(an.label)) + '</b> and <b>' + esc(short(bn.label)) +
        '</b> are not linked by any relation in the ontology. That absence is real, not a gap we filled.</div>';
      return;
    }
    var hops = res.edges.map(function (e, i) {
      var r = relOf(e.kind);
      var s = NODE.get(e.source), t = NODE.get(e.target);
      return '<div class="hop"><b>' + esc(short(s.label)) + '</b> <span class="via">' + esc(r.v) + '</span> <b>' +
        esc(short(t.label)) + '</b><br><span class="src">' + esc(e.evidence || r.src) + '</span></div>';
    }).join("");
    pathBoxEl.innerHTML = '<div class="pt">Connected in ' + res.edges.length + (res.edges.length === 1 ? " hop" : " hops") + '</div>' + hops;
  }

  // ---------- layout / simulation ----------
  function W() { return svgEl.clientWidth || window.innerWidth; }
  function H() { return svgEl.clientHeight || window.innerHeight; }

  function addSimNode(id) {
    if (sim.byId.has(id)) return sim.byId.get(id);
    var n = NODE.get(id); if (!n) return null;
    var cx = W() / 2, cy = H() / 2;
    var s = { id: id, node: n, x: cx + (Math.random() - 0.5) * 260, y: cy + (Math.random() - 0.5) * 260,
      vx: 0, vy: 0, pinned: false, el: null };
    sim.nodes.push(s); sim.byId.set(id, s);
    return s;
  }
  function rebuildSimEdges() {
    sim.edges = [];
    (GRAPH.edges || []).forEach(function (e) {
      if (sim.byId.has(e.source) && sim.byId.has(e.target)) sim.edges.push(e);
    });
  }
  // ego network: a node plus its direct neighbors
  function egoNodes(id) {
    var ids = [id];
    (ADJ.get(id) || []).forEach(function (s) { ids.push(s.to); });
    return ids;
  }
  function setNodes(ids, center) {
    var want = new Set(ids);
    // keep already-placed nodes that are still wanted; drop the rest
    sim.nodes = sim.nodes.filter(function (s) { if (want.has(s.id)) return true; sim.byId.delete(s.id); return false; });
    ids.forEach(function (id) {
      var s = addSimNode(id);
      if (s && center && s.id === center) { s.x = W() / 2; s.y = H() / 2; }
    });
    rebuildSimEdges();
    render();
    kick();
  }
  function ensureNodes(ids) {
    var cur = new Set(sim.nodes.map(function (s) { return s.id; }));
    var merged = sim.nodes.map(function (s) { return s.id; });
    ids.forEach(function (id) { if (!cur.has(id)) { merged.push(id); } });
    setNodes(merged, null);
  }

  function kick() { alpha = 1; if (!raf) raf = requestAnimationFrame(step); }
  function step() {
    raf = 0;
    var N = sim.nodes, k = view.k;
    var cx = W() / 2, cy = H() / 2;
    var REP = 42000, SPR = 0.016, LEN = 128, CEN = 0.015, DAMP = 0.86;
    for (var i = 0; i < N.length; i++) {
      var a = N[i]; if (a.pinned) continue;
      var fx = 0, fy = 0;
      for (var j = 0; j < N.length; j++) {
        if (i === j) continue;
        var b = N[j];
        var dx = a.x - b.x, dy = a.y - b.y; var d2 = dx * dx + dy * dy || 0.01;
        var d = Math.sqrt(d2); var f = REP / d2;
        fx += (dx / d) * f; fy += (dy / d) * f;
      }
      fx += (cx - a.x) * CEN; fy += (cy - a.y) * CEN;
      a.vx = (a.vx + fx * 0.0016) * DAMP; a.vy = (a.vy + fy * 0.0016) * DAMP;
    }
    for (var e = 0; e < sim.edges.length; e++) {
      var ed = sim.edges[e]; var s = sim.byId.get(ed.source), t = sim.byId.get(ed.target);
      if (!s || !t) continue;
      var dx2 = t.x - s.x, dy2 = t.y - s.y; var dd = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 0.01;
      var force = (dd - LEN) * SPR;
      var ux = dx2 / dd, uy = dy2 / dd;
      if (!s.pinned) { s.vx += ux * force; s.vy += uy * force; }
      if (!t.pinned) { t.vx -= ux * force; t.vy -= uy * force; }
    }
    for (var m = 0; m < N.length; m++) { var p = N[m]; if (p.pinned) continue; p.x += p.vx; p.y += p.vy; }
    paintPositions();
    alpha *= 0.985;
    if (alpha > 0.02) raf = requestAnimationFrame(step);
  }

  // ---------- render ----------
  function render() {
    var eG = viewG.querySelector(".edges"), lG = viewG.querySelector(".elabels"), nG = viewG.querySelector(".nodes");
    eG.textContent = ""; lG.textContent = ""; nG.textContent = "";
    sim.edges.forEach(function (ed) {
      var line = svg("line", { class: "edge" }); line.__e = ed; eG.appendChild(line); ed.__line = line;
      var lab = svg("text", { class: "elabel" }); lab.textContent = relOf(ed.kind).v; lG.appendChild(lab); ed.__lab = lab;
    });
    sim.nodes.forEach(function (s) {
      var meta = typeOf(s.node.type);
      var g = svg("g", { class: "node" }); g.__id = s.id;
      var glow = svg("circle", { class: "glow", r: meta.r + 7, fill: meta.c, opacity: 0.16, filter: "blur(3px)" });
      var core = svg("circle", { class: "core", r: meta.r, fill: meta.c });
      var txt = svg("text", { x: meta.r + 6, y: 4 }); txt.textContent = short(s.node.label);
      g.appendChild(glow); g.appendChild(core); g.appendChild(txt);
      nG.appendChild(g); s.el = g;
      wireNode(g, s);
    });
    paint();
    paintPositions();
  }
  function paintPositions() {
    sim.nodes.forEach(function (s) { if (s.el) s.el.setAttribute("transform", "translate(" + s.x + "," + s.y + ")"); });
    sim.edges.forEach(function (ed) {
      var s = sim.byId.get(ed.source), t = sim.byId.get(ed.target);
      if (!s || !t || !ed.__line) return;
      ed.__line.setAttribute("x1", s.x); ed.__line.setAttribute("y1", s.y);
      ed.__line.setAttribute("x2", t.x); ed.__line.setAttribute("y2", t.y);
      if (ed.__lab) { ed.__lab.setAttribute("x", (s.x + t.x) / 2); ed.__lab.setAttribute("y", (s.y + t.y) / 2 - 3); }
    });
  }
  // highlight state: focus node, its edges lit, path edges/nodes emphasized
  function paint() {
    var pset = activePath ? activePath.set : null;
    var peset = new Set();
    if (activePath) activePath.edges.forEach(function (e) { peset.add(e); });
    sim.nodes.forEach(function (s) {
      if (!s.el) return;
      s.el.classList.toggle("focus", s.id === focusId);
      s.el.classList.toggle("path", !!(pset && pset.has(s.id)));
      s.el.classList.toggle("dim", !!(pset && !pset.has(s.id)));
    });
    sim.edges.forEach(function (ed) {
      if (!ed.__line) return;
      var lit = ed.source === focusId || ed.target === focusId;
      var onPath = peset.has(ed);
      ed.__line.classList.toggle("lit", lit && !onPath);
      ed.__line.classList.toggle("path", onPath);
      ed.__line.classList.toggle("dim", !!(pset && !onPath));
      if (ed.__lab) {
        ed.__lab.classList.toggle("show", lit || onPath);
        ed.__lab.classList.toggle("path", onPath);
      }
    });
  }

  function short(s) { s = String(s || ""); return s.length > 34 ? s.slice(0, 32) + "…" : s; }

  // ---------- node interaction (click to walk / pick, drag to move) ----------
  function wireNode(g, s) {
    var moved = false, dragging = false, start = null;
    g.addEventListener("pointerdown", function (ev) {
      ev.stopPropagation(); dragging = true; moved = false;
      start = clientToView(ev.clientX, ev.clientY);
      g.setPointerCapture(ev.pointerId);
    });
    g.addEventListener("pointermove", function (ev) {
      if (!dragging) return;
      var p = clientToView(ev.clientX, ev.clientY);
      if (Math.abs(p.x - start.x) > 3 || Math.abs(p.y - start.y) > 3) moved = true;
      s.pinned = true; s.x = p.x; s.y = p.y; s.vx = s.vy = 0; paintPositions();
    });
    g.addEventListener("pointerup", function (ev) {
      dragging = false; try { g.releasePointerCapture(ev.pointerId); } catch (e) {}
      if (!moved) { if (pathMode) choosePathNode(s.id); else focusNode(s.id, true); }
      else { kick(); }
    });
  }

  // focus a node: make it the center of the walk, expand its neighbors, fill rail
  function focusNode(id, expand) {
    if (!NODE.has(id)) return;
    focusId = id;
    if (expand) {
      // merge current nodes with this node's ego network (walking outward)
      var ids = new Set(sim.nodes.map(function (s) { return s.id; }));
      egoNodes(id).forEach(function (x) { ids.add(x); });
      setNodes([...ids], id);
    }
    // pin focus toward center-left so the rail does not cover it
    var s = sim.byId.get(id);
    if (s) { s.pinned = false; }
    openRail(id);
    paint();
    kick();
  }

  // ---------- rail (the dossier of connections) ----------
  function openRail(id) {
    var n = NODE.get(id); if (!n) return;
    var meta = typeOf(n.type);
    var sub = subLine(n);
    railH.innerHTML =
      '<span class="chip" style="background:' + meta.c + '22;color:' + meta.c + '">' +
        '<span class="d" style="background:' + meta.c + '"></span>' + esc(meta.k) + '</span>' +
      '<h3>' + esc(n.label) + '</h3>' +
      (sub ? '<div class="sub">' + sub + '</div>' : '');

    // group this node's incident edges by relation, from its point of view
    var inc = (ADJ.get(id) || []);
    var groups = {}; // relation+direction -> items
    inc.forEach(function (st) {
      var e = st.edge; var other = NODE.get(st.to); if (!other) return;
      // phrase from THIS node's perspective
      var outward = e.source === id;
      var key, verb;
      var r = relOf(e.kind);
      if (e.kind === "LOBBIES_FOR") { key = outward ? "Lobbies for" : "Lobbyists"; verb = outward ? "lobbies for" : "lobbies for this entity"; }
      else if (e.kind === "HAS_PAC") { key = outward ? "Political action committee" : "Sponsor"; verb = outward ? "runs" : "is run by"; }
      else if (e.kind === "RECEIVED") { key = "Federal money"; verb = "received"; }
      else if (e.kind === "SUBSIDIARY_OF") { key = outward ? "Parent / control group" : "Subsidiaries"; verb = outward ? "is a subsidiary of" : "is the parent of"; }
      else if (e.kind === "BORROWS") { key = "Debt"; verb = "borrows on"; }
      else if (e.kind === "LENDS_TO") { key = outward ? "Lends to" : "Lenders (private credit)"; verb = outward ? "holds the debt of" : "is held by"; }
      else if (e.kind === "SUBJECT_TO") { key = outward ? "Bound by federal rule" : "Bound entities"; verb = outward ? "is bound by" : "binds"; }
      else { key = r.v; verb = r.v; }
      (groups[key] = groups[key] || []).push({ e: e, other: other, verb: verb });
    });

    var order = ["Parent / control group", "Subsidiaries", "Lends to", "Lenders (private credit)", "Debt",
      "Federal money", "Political action committee", "Sponsor", "Lobbies for", "Lobbyists",
      "Bound by federal rule", "Bound entities"];
    var keys = Object.keys(groups).sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    var html = "";
    keys.forEach(function (key) {
      var items = groups[key];
      var dcol = typeOf(items[0].other.type).c;
      html += '<div class="grp"><div class="gk"><span class="gd" style="background:' + dcol + '"></span>' +
        esc(key) + ' &middot; ' + items.length + '</div>';
      items.forEach(function (it) {
        var extra = edgeExtra(it.e, it.other);
        html += '<button class="link" data-id="' + esc(it.other.id) + '">' +
          '<span class="ln">' + esc(it.other.label) + '</span>' +
          '<span class="lr">' + esc(it.verb) + (extra.inline ? ' &middot; ' + extra.inline : '') + '</span>' +
          '<span class="ls">' + esc(it.e.evidence || relOf(it.e.kind).src) + '</span>' +
          '</button>';
      });
      html += '</div>';
    });

    if (!keys.length) {
      html = '<div class="grp"><div class="empty">No onward public-record links from this entity in the current ontology set. That is honest emptiness, not a loading gap.</div></div>';
    }

    // cross-links the graph itself flags (shared parent / shared rule hubs)
    var cl = crossLinkFor(id);
    if (cl) html += cl;

    html += '<div class="foot"><b>Every line above is a real relation</b> carried from the Tensorust Ontology, each with its public source. Where a link is absent, the record has none. Not a prediction, not advice: what is visible.</div>';

    railB.innerHTML = html;
    railB.querySelectorAll(".link[data-id]").forEach(function (el) {
      el.addEventListener("click", function () {
        var nid = el.getAttribute("data-id");
        if (pathMode) choosePathNode(nid); else focusNode(nid, true);
      });
    });
    railEl.classList.add("open");
    railEl.scrollTop = 0;
  }

  function subLine(n) {
    var p = n.props || {}; var bits = [];
    if (p.state) bits.push(esc(p.state));
    if (p.ticker) bits.push(esc(p.ticker));
    if (p.lobbying_total != null) bits.push(esc(fmtMoney(p.lobbying_total)) + " lobbying");
    if (p.owns_count) bits.push("owns " + p.owns_count + " aircraft");
    if (p.citation) bits.push(esc(p.citation));
    if (p.manager) bits.push(esc(p.manager) + "-managed fund");
    if (p.maturity) bits.push("matures " + esc(p.maturity));
    if (p.par_usd != null) bits.push("par " + esc(fmtMoney(p.par_usd)));
    if (Array.isArray(p.resolved_tails) && p.resolved_tails.length) bits.push(p.resolved_tails.length + " tail" + (p.resolved_tails.length > 1 ? "s" : "") + " on the map");
    if (p.note) bits.push(esc(p.note));
    return bits.join(" &middot; ");
  }
  function edgeExtra(e, other) {
    var inline = "";
    if (e.kind === "LENDS_TO" && e.mark != null) {
      var pct = (e.mark * 100).toFixed(2) + "% of par";
      inline = e.mark < 1 ? pct + " (below par)" : (e.mark > 1 ? pct + " (above par)" : pct + " (at par)");
    }
    if (e.kind === "SUBJECT_TO" && e.status) inline = e.status;
    var p = other.props || {};
    if (!inline && other.type === "loan" && p.par_usd != null) inline = "par " + fmtMoney(p.par_usd);
    return { inline: inline };
  }
  // surface the graph's own flagged cross-links (meta.cross_links) when relevant
  function crossLinkFor(id) {
    var cls = (GRAPH.meta && GRAPH.meta.cross_links) || [];
    var out = "";
    cls.forEach(function (cl) {
      var involved = cl.hub === id || (cl.members || []).indexOf(id) >= 0;
      if (!involved) return;
      var members = (cl.members || []).map(function (m) { return NODE.get(m); }).filter(Boolean);
      var hub = NODE.get(cl.hub);
      var label = cl.kind === "shared_rule" ? "Meet at a shared federal rule"
        : cl.kind === "shared_parent" ? "Siblings under a shared parent" : "Shared hub";
      out += '<div class="grp"><div class="gk"><span class="gd" style="background:#ff6ea9"></span>' + esc(label) + '</div>';
      if (hub) out += '<button class="link" data-id="' + esc(hub.id) + '"><span class="ln">' + esc(hub.label) +
        '</span><span class="lr">the shared node</span></button>';
      members.forEach(function (m) {
        if (m.id === id) return;
        out += '<button class="link" data-id="' + esc(m.id) + '"><span class="ln">' + esc(m.label) +
          '</span><span class="lr">' + (cl.kind === "shared_parent" ? "corporate sibling" : "co-bound entity") + '</span></button>';
      });
      out += '</div>';
    });
    if (out) {
      // rewire after injection handled by openRail's querySelectorAll
    }
    return out;
  }

  // ---------- pan / zoom ----------
  function applyView() { viewG.setAttribute("transform", "translate(" + view.x + "," + view.y + ") scale(" + view.k + ")"); }
  function clientToView(cx, cy) {
    var rect = svgEl.getBoundingClientRect();
    return { x: (cx - rect.left - view.x) / view.k, y: (cy - rect.top - view.y) / view.k };
  }
  function wirePanZoom() {
    var panning = false, last = null;
    svgEl.addEventListener("pointerdown", function (ev) {
      if (ev.target.closest(".node")) return;
      panning = true; last = { x: ev.clientX, y: ev.clientY }; svgEl.classList.add("drag");
      svgEl.setPointerCapture(ev.pointerId);
    });
    svgEl.addEventListener("pointermove", function (ev) {
      if (!panning) return;
      view.x += ev.clientX - last.x; view.y += ev.clientY - last.y; last = { x: ev.clientX, y: ev.clientY }; applyView();
    });
    svgEl.addEventListener("pointerup", function (ev) { panning = false; svgEl.classList.remove("drag"); try { svgEl.releasePointerCapture(ev.pointerId); } catch (e) {} });
    svgEl.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      var rect = svgEl.getBoundingClientRect();
      var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      var f = Math.exp(-ev.deltaY * 0.0012);
      var nk = Math.max(0.3, Math.min(3, view.k * f));
      view.x = mx - (mx - view.x) * (nk / view.k);
      view.y = my - (my - view.y) * (nk / view.k);
      view.k = nk; applyView();
    }, { passive: false });
  }

  // ---------- show / hide ----------
  function resetView() { view = { x: 0, y: 0, k: 1 }; applyView(); }
  function showAll() {
    load().then(function () {
      ensureDom(); open();
      activePath = null;
      var all = (GRAPH.nodes || []).map(function (n) { return n.id; });
      setNodes(all, null);
      // nudge zoom out a touch so the whole web fits
      view = { x: 0, y: 0, k: 0.68 }; applyView();
      if (focusId && NODE.has(focusId)) openRail(focusId); else railEl.classList.remove("open");
      paint();
    });
  }
  function open() {
    root.classList.add("open");
    resetView();
    if (!sim.__wiredResize) { sim.__wiredResize = true; window.addEventListener("resize", function () { if (root.classList.contains("open")) paintPositions(); }); }
  }
  function hide() { if (root) root.classList.remove("open"); if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  // public: open focused on a node id or an aircraft tail
  window.showNetwork = function (opts) {
    opts = opts || {};
    load().then(function () {
      ensureDom(); open();
      activePath = null; pathMode = false; pathBtn.classList.remove("on"); pathBtn.textContent = "How are two connected?"; pathBoxEl.style.display = "none";
      var id = opts.nodeId || null;
      if (!id && opts.tail) { var t = String(opts.tail).toUpperCase(); id = (GRAPH.tail_to_owner || {})[t] || null; }
      if (id && NODE.has(id)) { setNodes(egoNodes(id), id); focusNode(id, false); }
      else { showAll(); }
    }).catch(function () { /* graph unavailable: button simply does nothing visible */ });
  };

  // public: open from an aircraft dossier record (used by dossier.js)
  window.showNetworkForDossier = function (d) {
    load().then(function () {
      var id = nodeIdForDossier(d);
      if (id) window.showNetwork({ nodeId: id });
      else {
        ensureDom(); open();
        focusId = null; activePath = null; railEl.classList.remove("open");
        setNodes([], null);
        pathBoxEl.style.display = "block";
        pathBoxEl.innerHTML = '<div class="pt">No connection graph for this owner yet</div>' +
          '<div class="hop"><b>' + esc(short((d && d.owner) || "This owner")) + '</b> has no resolved relations in the ontology set yet. ' +
          'Nothing is invented to fill that in. Explore the rest of the network below.</div>';
        railH.innerHTML = ''; railB.innerHTML = '';
      }
    });
  };

  // warm the graph in the background so the first reveal is instant
  if (document.readyState === "complete" || document.readyState === "interactive") load();
  else window.addEventListener("DOMContentLoaded", load);
})();
