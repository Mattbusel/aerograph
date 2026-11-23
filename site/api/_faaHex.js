// Offline, reversible FAA ICAO 24-bit <-> N-number converter. REAL, deterministic,
// zero network. US civil aircraft are assigned ICAO addresses in the block
// 0xA00001 .. 0xADF7C7, and the FAA maps them to tail numbers (N-numbers) with a
// fixed positional scheme. This implements that scheme both ways so the live feed's
// ADS-B hex can be turned into the registered tail locally, for every US aircraft,
// with no lookup and no third party. Non-0xA (foreign) addresses are not US civil
// and return null: the FAA registry does not cover them, so we never guess.
//
// Algorithm reference: the public FAA N-number encoding (same scheme used by the
// open icao-nnumber_converter). Verified here by exhaustive round-trip over the
// entire 0xA00001..0xADF7C7 block (see scripts/test-faa-hex.mjs).

const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // 24 letters, no I, no O
const DIGITSET = "0123456789";
const ALLCHARS = CHARSET + DIGITSET; // 34 chars

const ICAO_LO = 0xa00001;
const ICAO_HI = 0xadf7c7;

const SUFFIX_SIZE = CHARSET.length * CHARSET.length + CHARSET.length + 1; // 601
const BUCKET4 = CHARSET.length + DIGITSET.length + 1; // 35
const BUCKET3 = BUCKET4 * 10 + SUFFIX_SIZE; // 951
const BUCKET2 = BUCKET3 * 10 + SUFFIX_SIZE; // 10111
const BUCKET1 = BUCKET2 * 10 + SUFFIX_SIZE; // 101711

// offset 0 -> "", 1..600 -> one or two trailing letters
function suffixForOffset(offset) {
  if (offset === 0) return "";
  const i = Math.floor((offset - 1) / (CHARSET.length + 1));
  const rem = (offset - 1) % (CHARSET.length + 1);
  if (rem === 0) return CHARSET[i];
  return CHARSET[i] + CHARSET[rem - 1];
}

// inverse of suffixForOffset; returns 0..600 or -1 if not a valid suffix
function offsetForSuffix(suffix) {
  if (!suffix) return 0;
  if (suffix.length > 2) return -1;
  const i0 = CHARSET.indexOf(suffix[0]);
  if (i0 < 0) return -1;
  if (suffix.length === 1) return i0 * (CHARSET.length + 1) + 1;
  const i1 = CHARSET.indexOf(suffix[1]);
  if (i1 < 0) return -1;
  return i0 * (CHARSET.length + 1) + i1 + 2;
}

// Normalize a hex like "a1b2c3", "0xA1B2C3", "A1B2C3" to an int, or null.
function hexToInt(hex) {
  if (hex == null) return null;
  let s = String(hex).trim().toLowerCase();
  if (s.startsWith("0x")) s = s.slice(2);
  if (!/^[0-9a-f]{1,6}$/.test(s)) return null;
  return parseInt(s, 16);
}

// ICAO hex -> N-number (e.g. "a1b2c3" -> "N...") or null for non-US / out of block.
export function hexToTail(hex) {
  const icaoRaw = hexToInt(hex);
  if (icaoRaw == null) return null;
  if (icaoRaw < ICAO_LO || icaoRaw > ICAO_HI) return null;
  let out = "N";
  let rem = icaoRaw - ICAO_LO;

  const d1 = Math.floor(rem / BUCKET1) + 1;
  rem = rem % BUCKET1;
  out += String(d1);
  if (rem < SUFFIX_SIZE) return out + suffixForOffset(rem);
  rem -= SUFFIX_SIZE;

  const d2 = Math.floor(rem / BUCKET2);
  rem = rem % BUCKET2;
  out += String(d2);
  if (rem < SUFFIX_SIZE) return out + suffixForOffset(rem);
  rem -= SUFFIX_SIZE;

  const d3 = Math.floor(rem / BUCKET3);
  rem = rem % BUCKET3;
  out += String(d3);
  if (rem < SUFFIX_SIZE) return out + suffixForOffset(rem);
  rem -= SUFFIX_SIZE;

  const d4 = Math.floor(rem / BUCKET4);
  rem = rem % BUCKET4;
  out += String(d4);
  if (rem === 0) return out;
  return out + ALLCHARS[rem - 1];
}

// N-number -> ICAO hex (uppercase, 6 chars) or null if not a valid US tail.
export function tailToHex(tail) {
  if (tail == null) return null;
  let s = String(tail).trim().toUpperCase();
  if (s.startsWith("N")) s = s.slice(1);
  if (!/^[1-9]/.test(s)) return null;
  let icao = ICAO_LO;
  let i = 0;

  // digit 1 (1-9)
  const d1 = s.charCodeAt(i) - 48;
  if (d1 < 1 || d1 > 9) return null;
  icao += (d1 - 1) * BUCKET1;
  i += 1;
  if (i === s.length) return intToHex(icao);

  // optional suffix after 1 digit
  let suf = offsetForSuffix(s.slice(i));
  if (suf > 0) return intToHex(icao + suf);
  icao += SUFFIX_SIZE;

  // digit 2
  const d2 = s.charCodeAt(i) - 48;
  if (d2 < 0 || d2 > 9) return null;
  icao += d2 * BUCKET2;
  i += 1;
  if (i === s.length) return intToHex(icao);

  suf = offsetForSuffix(s.slice(i));
  if (suf > 0) return intToHex(icao + suf);
  icao += SUFFIX_SIZE;

  // digit 3
  const d3 = s.charCodeAt(i) - 48;
  if (d3 < 0 || d3 > 9) return null;
  icao += d3 * BUCKET3;
  i += 1;
  if (i === s.length) return intToHex(icao);

  suf = offsetForSuffix(s.slice(i));
  if (suf > 0) return intToHex(icao + suf);
  icao += SUFFIX_SIZE;

  // digit 4
  const d4 = s.charCodeAt(i) - 48;
  if (d4 < 0 || d4 > 9) return null;
  icao += d4 * BUCKET4;
  i += 1;
  if (i === s.length) return intToHex(icao);

  // final single trailing char (letter or digit)
  const c = ALLCHARS.indexOf(s[i]);
  if (c < 0 || i + 1 !== s.length) return null;
  icao += c + 1;
  return intToHex(icao);
}

function intToHex(n) {
  if (n < ICAO_LO || n > ICAO_HI) return null;
  return n.toString(16).toUpperCase().padStart(6, "0");
}

export { ICAO_LO, ICAO_HI };
