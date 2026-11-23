// Exhaustive correctness check: every ICAO address in the US civil block must
// round-trip hex -> tail -> hex unchanged, and known anchors must match.
import { hexToTail, tailToHex, ICAO_LO, ICAO_HI } from "./faa-hex.mjs";

let fail = 0;
const anchors = [
  ["A00001", "N1"],
  ["A0070C", "N1000"],
  ["A3097C", "N295QS"], // the known-real example aircraft
  ["ADF7C7", "N99999"],
];
for (const [hex, tail] of anchors) {
  const got = hexToTail(hex);
  if (got !== tail) { console.log("ANCHOR FAIL", hex, "->", got, "expected", tail); fail++; }
  const back = tailToHex(tail);
  if (back !== hex) { console.log("ANCHOR REV FAIL", tail, "->", back, "expected", hex); fail++; }
}

// Full round-trip over the entire block.
let checked = 0;
for (let n = ICAO_LO; n <= ICAO_HI; n++) {
  const hex = n.toString(16).toUpperCase().padStart(6, "0");
  const tail = hexToTail(hex);
  if (!tail) { console.log("NULL tail for in-range", hex); if (++fail > 20) break; continue; }
  const back = tailToHex(tail);
  if (back !== hex) {
    console.log("ROUNDTRIP FAIL", hex, "->", tail, "->", back);
    if (++fail > 20) break;
  }
  checked++;
}
// Foreign / out of block must be null.
for (const h of ["3C6444", "400001", "000000", "C0FFEE", "zzz", ""]) {
  if (hexToTail(h) !== null) { console.log("EXPECTED NULL for", h, "got", hexToTail(h)); fail++; }
}
console.log(`checked ${checked} in-block addresses, ${fail} failures`);
process.exit(fail ? 1 : 0);
