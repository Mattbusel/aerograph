// Single source of truth for the offline FAA ICAO <-> N-number converter lives in
// site/api/_faaHex.js so the deployed Vercel function and this build script share
// exactly one implementation. This file just re-exports it.
export * from "../site/api/_faaHex.js";
