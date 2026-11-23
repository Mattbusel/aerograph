// Aerograph DOSSIER UX. Turns a clicked aircraft into a real-world dossier:
// who is really behind that dot. Pure client-side, self-contained. It injects
// its own styles and panel markup, then exposes one hook the map calls:
//
//   window.showDossier(tail, hex, flight, meta?)
//
//   tail   FAA N-number string, or null/"" if not resolved client-side
//   hex    ADS-B 24-bit hex (PREFERRED for the lookup; the map already has it)
//   flight callsign / flight id for the header
//   meta   optional { cls, type, alt, gs } for a richer header + trust chip
//
// It fetches /api/attribute?hex=... (falling back to ?tail=...) and renders the
// returned public-record dossier. REAL data only: every field shown comes from
// the attribute response; nothing is invented here. Missing parent / lobbying
// render as honest empty states, never a guess.
//
// Markup ids (for the deploy agent to confirm integration):
//   #dossier         the slide-in panel container
//   #dossier-close   the close button
//   #dossier-head    header region (callsign / tail / type + trust chip)
//   #dossier-body    async-filled dossier body
//
// Visuals are matched to the dark map (same tokens as index.html).

(function () {
  "use strict";
  if (window.__aerographDossier) return;
  window.__aerographDossier = true;

  // Trust classes, honest one-line meanings, and colors. Mirrors api/live.js
  // classify() and the trust map legend. unverified is NEVER "spoofed".
  var TRUST = {
    emergency:  { c: "#ff3b4e", label: "EMERGENCY", meaning: "distress squawk or emergency flag" },
    unverified: { c: "#c04cff", label: "UNVERIFIED", meaning: "low/zero position integrity (the shape a spoof takes)" },
    mlat:       { c: "#ffcf4a", label: "MLAT", meaning: "mesh-triangulated, no onboard GPS" },
    tisb:       { c: "#6b8299", label: "TIS-B", meaning: "rebroadcast position, not from the aircraft" },
    ok:         { c: "#28e0ff", label: "ADS-B", meaning: "self-reported GPS, integrity present" }
  };

  var STYLE = '' +
    '#dossier{position:absolute;top:0;right:0;bottom:0;z-index:30;width:380px;max-width:92vw;' +
      'background:rgba(6,9,16,0.94);border-left:1px solid #1a2334;backdrop-filter:blur(10px);' +
      'color:#e8eef7;font-family:"Inter",system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
      'transform:translateX(100%);transition:transform .22s ease;overflow-y:auto;overscroll-behavior:contain;' +
      'box-shadow:-18px 0 44px rgba(0,0,0,.45);}' +
    '#dossier.open{transform:translateX(0);}' +
    '#dossier .dz-x{position:absolute;top:12px;right:12px;width:28px;height:28px;border:1px solid #1a2334;' +
      'background:rgba(20,26,40,.7);color:#8a97ad;border-radius:7px;cursor:pointer;font-size:15px;line-height:1;' +
      'display:flex;align-items:center;justify-content:center;}' +
    '#dossier .dz-x:hover{color:#e8eef7;border-color:#2a3550;}' +
    '#dossier-head{padding:18px 18px 14px;border-bottom:1px solid #141c2b;}' +
    '#dossier .dz-call{font-size:19px;font-weight:700;letter-spacing:.01em;padding-right:34px;}' +
    '#dossier .dz-sub{color:#8a97ad;font-size:12px;margin-top:4px;}' +
    '#dossier .dz-chip{display:inline-flex;align-items:center;gap:6px;margin-top:11px;font-size:10.5px;' +
      'letter-spacing:.07em;text-transform:uppercase;padding:4px 9px;border-radius:999px;font-weight:600;}' +
    '#dossier .dz-chip .d{width:7px;height:7px;border-radius:50%;}' +
    '#dossier .dz-chipmean{color:#8a97ad;font-size:11px;margin-top:7px;line-height:1.5;}' +
    '#dossier-body{padding:4px 18px 26px;}' +
    '#dossier .dz-sec{padding:15px 0;border-bottom:1px solid #121a28;}' +
    '#dossier .dz-sec:last-child{border-bottom:none;}' +
    '#dossier .dz-k{font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:#6f7d93;margin-bottom:6px;}' +
    '#dossier .dz-v{font-size:14.5px;line-height:1.5;font-weight:600;}' +
    '#dossier .dz-v.lead{font-size:16px;}' +
    '#dossier .dz-src{color:#6f7d93;font-size:10.5px;margin-top:5px;line-height:1.5;}' +
    '#dossier .dz-money{font-size:14.5px;line-height:1.55;font-weight:600;}' +
    '#dossier .dz-money .amt{color:#ffcf4a;}' +
    '#dossier .dz-list{list-style:none;margin:6px 0 0;padding:0;}' +
    '#dossier .dz-list li{font-size:13px;line-height:1.5;padding:3px 0;color:#cdd7e6;}' +
    '#dossier .dz-list li .oid{color:#6f7d93;font-size:11px;}' +
    '#dossier .dz-wait{color:#8a97ad;font-size:13px;padding:16px 0;display:flex;align-items:center;gap:9px;}' +
    '#dossier .dz-wait .spin{width:13px;height:13px;border:2px solid #243049;border-top-color:#28e0ff;' +
      'border-radius:50%;animation:dzspin .8s linear infinite;}' +
    '@keyframes dzspin{to{transform:rotate(360deg);}}' +
    '#dossier .dz-empty{color:#8a97ad;font-size:13px;line-height:1.6;padding:14px 0;}' +
    '#dossier .dz-foot{margin-top:4px;padding:16px 0 0;color:#7c8aa0;font-size:11.5px;line-height:1.6;}' +
    '#dossier .dz-foot b{color:#aab6c8;font-weight:600;}' +
    '#dossier .dz-err{color:#ff6b84;font-size:12.5px;padding:14px 0;line-height:1.5;}' +
    '@media (max-width:520px){#dossier{width:100vw;max-width:100vw;border-left:none;}}';

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m];
    });
  }

  var panel, head, body, reqToken = 0;

  function ensureDom() {
    if (panel) return;
    var st = document.createElement("style");
    st.id = "dossier-style";
    st.textContent = STYLE;
    document.head.appendChild(st);

    panel = document.createElement("aside");
    panel.id = "dossier";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Aircraft ownership dossier");
    panel.innerHTML =
      '<button id="dossier-close" class="dz-x" aria-label="Close dossier">&times;</button>' +
      '<div id="dossier-head"></div>' +
      '<div id="dossier-body"></div>';
    document.body.appendChild(panel);
    head = panel.querySelector("#dossier-head");
    body = panel.querySelector("#dossier-body");
    panel.querySelector("#dossier-close").addEventListener("click", hideDossier);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") hideDossier();
    });
  }

  function hideDossier() {
    reqToken++; // cancel any in-flight render
    if (panel) panel.classList.remove("open");
  }
  window.hideDossier = hideDossier;

  function renderHead(tail, hex, flight, meta) {
    meta = meta || {};
    var t = TRUST[meta.cls] || null;
    var title = (flight && flight.trim()) || tail || hex || "unknown aircraft";
    var subBits = [];
    if (tail) subBits.push("tail " + esc(tail));
    if (hex) subBits.push("hex " + esc(String(hex).toUpperCase()));
    if (meta.type) subBits.push(esc(meta.type));
    var chip = "";
    if (t) {
      chip =
        '<span class="dz-chip" style="background:' + t.c + '1f;color:' + t.c + ';">' +
          '<span class="d" style="background:' + t.c + ';"></span>' + t.label +
        '</span>' +
        '<div class="dz-chipmean">' + esc(t.meaning) + '</div>';
    }
    head.innerHTML =
      '<div class="dz-call">' + esc(title) + '</div>' +
      '<div class="dz-sub">' + subBits.join(" &nbsp; ") + '</div>' +
      chip;
  }

  function fmtMoney(n) {
    var v = Number(n);
    if (!isFinite(v)) return String(n);
    return "$" + v.toLocaleString("en-US");
  }

  function renderResolved(d) {
    var html = "";

    // Registered owner (always present on a resolved hit).
    html += '<div class="dz-sec">' +
      '<div class="dz-k">Registered owner</div>' +
      '<div class="dz-v lead">' + esc(d.owner || "unknown") + '</div>' +
      (d.model || d.category
        ? '<div class="dz-src">' + esc([d.model, d.category].filter(Boolean).join(" · ")) + '</div>'
        : "") +
      (d.trustee ? '<div class="dz-src">trustee of record: ' + esc(d.trustee) + '</div>' : "") +
      '<div class="dz-src">FAA aircraft registry</div>' +
      '</div>';

    // Parent / control group (SEC subsidiary list). null => omit, never guess.
    if (d.parent && d.parent.name) {
      html += '<div class="dz-sec">' +
        '<div class="dz-k">Part of (control group)</div>' +
        '<div class="dz-v">' + esc(d.parent.name) + '</div>' +
        '<div class="dz-src">subsidiary of, per SEC subsidiary list' +
          (d.parent.oid ? ' · ' + esc(d.parent.oid) : "") + '</div>' +
        '</div>';
    }

    // Federal money (USAspending). FY2025+ award ids.
    if (Array.isArray(d.awards) && d.awards.length) {
      var items = d.awards.map(function (a) {
        var name = esc(a.name || a.oid || "award");
        var oid = a.oid ? ' <span class="oid">' + esc(a.oid) + '</span>' : "";
        return "<li>" + name + oid + "</li>";
      }).join("");
      html += '<div class="dz-sec">' +
        '<div class="dz-k">Federal money</div>' +
        '<ul class="dz-list">' + items + '</ul>' +
        '<div class="dz-src">Federal awards FY2025+ (USAspending)</div>' +
        '</div>';
    }

    // Lobbying (Senate LDA). null => omit.
    if (d.lobbying && (d.lobbying.total != null || (d.lobbying.firm_names && d.lobbying.firm_names.length))) {
      var lb = d.lobbying;
      var line = "";
      if (lb.total != null) line += '<span class="amt">' + esc(fmtMoney(lb.total)) + '</span>';
      if (lb.periods) line += ' reported ' + esc(lb.periods);
      var tail2 = [];
      if (lb.issues) tail2.push("issue " + esc(lb.issues));
      var firms = lb.firm_names && lb.firm_names.length ? lb.firm_names : lb.firms;
      if (firms && firms.length) tail2.push("via " + esc([].concat(firms).join(", ")));
      html += '<div class="dz-sec">' +
        '<div class="dz-k">Lobbying</div>' +
        '<div class="dz-money">' + line + '</div>' +
        (tail2.length ? '<div class="dz-src">' + tail2.join(" · ") + '</div>' : "") +
        '<div class="dz-src">reported to the Senate (LDA)</div>' +
        '</div>';
    }

    // Reveal the hidden network (the "past-possible" connection graph). Only shown
    // when this owner actually resolves to a node in the real ontology graph; the
    // click opens the walkable graph focused on that entity. Never a dead button.
    var hasGraph = false;
    try { hasGraph = !!(window.aerographGraph && window.aerographGraph.nodeIdForDossier(d)); } catch (e) {}
    if (hasGraph) {
      html += '<button class="dz-reveal" id="dz-reveal-btn" type="button">' +
        '<span class="rv-i" aria-hidden="true">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff6ea9" stroke-width="1.8">' +
          '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="7" r="2"/><circle cx="12" cy="18" r="2"/>' +
          '<path d="M6.6 7.1 10.6 16M17.4 8.3 13.4 16.5M7 6.5 17 7"/></svg></span>' +
        '<span class="rv-t"><b>Reveal the hidden network</b>' +
          '<span>shared lenders, lobbyists, siblings, federal money &mdash; every edge sourced</span></span>' +
        '</button>';
    }

    // Footer: the framing + sources + resolved date. Calm, sourced, no theatrics.
    var when = d.resolved_at ? new Date(d.resolved_at) : null;
    var whenStr = when && !isNaN(when) ? when.toISOString().slice(0, 10) : "";
    html += '<div class="dz-foot">' +
      '<b>This is who is really behind that dot.</b> Ownership and control from public records' +
      (whenStr ? ", resolved " + esc(whenStr) : "") + ". Not a claim about this flight." +
      (d.sources ? '<br>Sources: ' + esc([].concat(d.sources).join(", ")) : "") +
      (d.note ? '<br>' + esc(d.note) : "") +
      '</div>';

    body.innerHTML = html;

    var rb = body.querySelector("#dz-reveal-btn");
    if (rb) rb.addEventListener("click", function () {
      if (typeof window.showNetworkForDossier === "function") window.showNetworkForDossier(d);
    });
  }

  function renderUnresolved(d) {
    var reason = d && d.reason;
    var msg;
    if (reason && /non-us|registration/i.test(reason)) {
      msg = "No public ownership record resolved: foreign registration. The FAA registry only covers US (N-number) aircraft.";
    } else {
      msg = "No public ownership record resolved yet: this aircraft is not in the current attribution set.";
    }
    body.innerHTML =
      '<div class="dz-sec">' +
        '<div class="dz-empty">' + esc(msg) + '</div>' +
        '<div class="dz-src">The attribution set grows as the national sweep is re-walked through the ontology. Nothing is invented to fill the gap.</div>' +
      '</div>';
  }

  // Write a compact one-line result into the map popup's .dossier-slot, so the
  // popup resolves too (the full record lives in the slide-in panel). Honest:
  // owner + parent on a hit, an honest empty line on a miss. Never a guess.
  function fillSlot(slot, d) {
    if (!slot) return;
    if (d && d.resolved) {
      var line = esc(d.owner || "owner on record");
      if (d.parent && d.parent.name) line += ' &middot; part of ' + esc(d.parent.name);
      slot.innerHTML = line + '<br><span style="color:#6f7d93">full dossier open at right &rarr;</span>';
    } else {
      var r = d && d.reason;
      slot.innerHTML = (r && /non-us|registration/i.test(r))
        ? 'No FAA ownership record (foreign registration).'
        : 'No public ownership record resolved yet.';
    }
  }

  // The hook the map calls on click. Accepts BOTH the object form the trust map
  // sends ({hex, tail, flight, type, cls, slot, ...}) and the positional form
  // (tail, hex, flight, meta). Normalizes, then renders the real dossier.
  window.showDossier = function (a, hex, flight, meta) {
    var slot = null, tail;
    if (a && typeof a === "object") {
      tail = a.tail || null;
      hex = a.hex || null;
      flight = (a.flight || "").trim();
      meta = { cls: a.cls, type: a.type, alt: a.alt, gs: a.gs };
      slot = a.slot || null;
    } else {
      tail = a;
    }

    ensureDom();
    var mine = ++reqToken;
    renderHead(tail, hex, flight, meta);
    body.innerHTML = '<div class="dz-wait"><span class="spin"></span>Resolving owner from public records…</div>';
    panel.classList.add("open");
    panel.scrollTop = 0;

    var qs = hex ? "hex=" + encodeURIComponent(hex)
                 : (tail ? "tail=" + encodeURIComponent(tail) : "");
    if (!qs) { renderUnresolved({ reason: "no identifier" }); fillSlot(slot, null); return; }

    fetch("/api/attribute?" + qs, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("attribute " + r.status);
        return r.json();
      })
      .then(function (d) {
        if (mine !== reqToken) return; // a newer click or a close superseded us
        if (d && d.resolved) renderResolved(d);
        else renderUnresolved(d);
        fillSlot(slot, d);
      })
      .catch(function (e) {
        if (mine !== reqToken) return;
        body.innerHTML = '<div class="dz-err">Could not reach the attribution service (' +
          esc(e.message) + '). The aircraft is real and live; ownership lookup is temporarily unavailable.</div>';
        if (slot) slot.textContent = "Ownership lookup temporarily unavailable.";
      });
  };
})();
