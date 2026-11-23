// End-to-end test of the deployed attribute handler with a mock req/res. Verifies
// the known-real example and every documented response path, on the REAL cache.
import handler from "../site/api/attribute.js";

function run(query) {
  return new Promise((resolve) => {
    const res = {
      _status: 200, _headers: {}, _json: null,
      setHeader(k, v) { this._headers[k] = v; },
      status(c) { this._status = c; return this; },
      json(o) { this._json = o; resolve({ status: this._status, headers: this._headers, body: o }); },
    };
    handler({ query }, res);
  });
}

let fail = 0;
function check(name, cond, detail) {
  console.log(`${cond ? "ok  " : "FAIL"}  ${name}${cond ? "" : "  -> " + JSON.stringify(detail)}`);
  if (!cond) fail++;
}

// 1. Known-real example by hex (map has the hex). The whole point of the project.
const byHex = await run({ hex: "A3097C" });
check("N295QS by hex resolves", byHex.body.resolved === true, byHex.body);
check("  owner EXAMWORKS", byHex.body.owner === "EXAMWORKS LLC", byHex.body.owner);
check("  parent Ontic Engineering", /ONTIC ENGINEERING/.test(byHex.body.parent?.name || ""), byHex.body.parent);
check("  lobbying via King & Spalding $160k", byHex.body.lobbying?.total === 160000 && /KING & SPALDING/.test((byHex.body.lobbying?.firm_names || []).join(",")), byHex.body.lobbying);
check("  has federal award", (byHex.body.awards || []).length >= 1, byHex.body.awards);
check("  hit is edge-cached", /s-maxage=3600/.test(byHex.headers["Cache-Control"] || ""), byHex.headers);

// 2. Same aircraft by tail.
const byTail = await run({ tail: "N295QS" });
check("N295QS by tail resolves to same owner", byTail.body.owner === "EXAMWORKS LLC", byTail.body);

// 2b. tail without leading N still works.
const noN = await run({ tail: "295QS" });
check("tail without leading N resolves", noN.body.owner === "EXAMWORKS LLC", noN.body);

// 3. Airline with parent + awards + lobbying (United by hex).
import { tailToHex } from "../site/api/_faaHex.js";
const ual = await run({ hex: tailToHex("N852UA") });
check("United aircraft resolves", ual.body.owner === "UNITED AIRLINES INC", ual.body);
check("  United parent = Holdings", /United Airlines Holdings/i.test(ual.body.parent?.name || ""), ual.body.parent);

// 4. Trustee title-holder: resolves owner, but NO guessed parent/lobbying.
const trustee = await run({ tail: "N833SK" });
check("trustee aircraft resolves owner", /BANK OF UTAH TRUSTEE/.test(trustee.body.owner || ""), trustee.body);
check("  trustee flag true", trustee.body.trustee === true, trustee.body);
check("  trustee has NO fabricated parent", trustee.body.parent === null, trustee.body.parent);
check("  trustee has NO fabricated lobbying", trustee.body.lobbying === null, trustee.body.lobbying);

// 5. US tail not in cache -> resolved:false, honest reason, no-store.
const missUS = await run({ tail: "N999ZZ" });
check("uncached US tail -> resolved:false", missUS.body.resolved === false && /not in current attribution cache/.test(missUS.body.reason), missUS.body);
check("  miss is no-store", (missUS.headers["Cache-Control"] || "") === "no-store", missUS.headers);

// 6. Foreign / non-0xA hex -> resolved:false, FAA does not cover it.
const foreign = await run({ hex: "3C6444" }); // Lufthansa-range German hex (0x3C)
check("foreign hex -> resolved:false FAA uncovered", foreign.body.resolved === false && /non-US registration/.test(foreign.body.reason), foreign.body);

// 7. No input -> 400.
const none = await run({});
check("no input -> 400", none.status === 400, none);

console.log(fail ? `\n${fail} FAILURES` : "\nALL PASS");
process.exit(fail ? 1 : 0);
