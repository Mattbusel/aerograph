# Aerograph

**A live, open map of every drone in the sky and what it is actually doing.**

Not dots like a flight tracker. A dossier per drone: model, live pilot
position, where it launched, who registered it, the exact ground point its
camera is staring at, a spoof/trust verdict, and its history. When one radio
floods the airspace with hundreds of fakes, the mesh triangulates the puppeteer
and drops a pin on the operator.

> Tagline: *Every drone, decoded. Not dots, dossiers.*

## Live map

**[Open the live map -> mattbusel.github.io/aerograph](https://mattbusel.github.io/aerograph/)**

The map runs the real decode and fusion in your browser (compiled to WebAssembly)
over a labelled live simulation of a city sensor mesh. Click any drone for its
full dossier. Watch a spoof flood of hundreds of fake broadcasts collapse to a
single pin on the operator radio. The crates doing the work are the same ones a
real sensor runs; only the city traffic is simulated, and the map says so.

## Join the grid with a $6 board

The network grows itself because the sensor is cheap and open. One ESP32 board
(about $6) running [`remoteid-esp32`](https://github.com/Mattbusel/remoteid-esp32)
listens for Remote ID broadcasts, decodes them, and POSTs `DetectionReport` JSON
to an aggregator. Point enough boards at one aggregator across a city and the
fusion triangulates spoofers for real, no simulation.

```sh
# 1. flash a $6 ESP32 with the node firmware (remoteid-esp32)
# 2. run an aggregator anywhere:
cargo run -p aerograph-aggregator --release -- --bind 0.0.0.0:8787
# 3. point your board (or the PC shim) at it:
cargo run -p aerograph-node -- sim --post http://YOUR_AGGREGATOR:8787
```

Every added node sharpens triangulation and widens coverage. That is the whole
idea: a public, open map of the sky that anyone can plug into.

The grid is a mesh of $6 open-source sensor nodes (`remoteid-esp32`). Nodes POST
decoded Remote ID sightings to an aggregator; the aggregator fuses them into one
live entity per drone and triangulates spoof floods to the operating radio.

Everything the map shows is computed by real crates from a decoded frame:

| Capability | Crate |
|---|---|
| decode, trust verdict, DJI DroneID, takeoff, operator registration | [`remoteid`](https://crates.io/crates/remoteid) |
| flood detection, pick the one real track | [`remoteid-sentinel`](https://crates.io/crates/remoteid-sentinel) |
| camera aimpoint (what it is filming) | [`misb`](https://crates.io/crates/misb) |
| Cursor-on-Target output to TAK | [`uas-cot`](https://crates.io/crates/uas-cot) |
| realistic Remote ID test streams | [`remoteid-scenario`](https://crates.io/crates/remoteid-scenario) |
| the $6 node firmware | [`remoteid-esp32`](https://github.com/Mattbusel/remoteid-esp32) |

## Honesty

The decode and fusion are the real crate code. No faked results.

For the public demo there is no real hardware, so the **input** is a realistic
simulated city mesh (several virtual $6 nodes generating Remote ID traffic,
including a spoof flood) and it is **labelled as a live simulation of the grid**.
The real node and aggregator in this repo work with real sensors; the simulated
input is shaped exactly like what hardware produces, and the same fusion runs
over both. Nothing is shown that a crate does not actually compute.

## Layout

This repository is a monorepo built by four parallel tracks.

```
/node         Rust binary: the firmware-side decode + PC shim. Turns decoded
              Remote ID into DetectionReport JSON over serial/HTTP.   (backend)
/aggregator   Rust (axum) service: ingest, dedupe, fuse, triangulate,
              serve /state, /ws, /cot.                                (backend)
/fusion       aerograph-fusion: the shared decode + fusion + triangulation
              library. The aggregator and the wasm core both use it so the
              server and the browser run byte-identical fusion.       (backend)
/core         cdylib -> wasm (wasm-bindgen): the real fusion for the browser.
/web          Static dark cinematic maplibre-gl map that loads /core.
```

The three backend crates (`/fusion`, `/node`, `/aggregator`) are one Cargo
workspace. `/core` is built separately and depends on `aerograph-fusion` by
path; it is excluded from the backend workspace so this side builds on its own.

## The wire contract: `DetectionReport`

One node emits one `DetectionReport` per decoded frame-burst. Every field maps
to something a real crate computes. `decoded` and `misb` are display echoes; the
aggregator re-decodes `raw_hex` with `remoteid` before trusting them.

```jsonc
{
  "schema": "aerograph.report.v1",
  "node":   { "id": "node-0007", "lat": 40.7411, "lon": -73.9897, "clock_ms": 1732300000123 },
  "sighting": {
    "ts_ms": 1732300000120,
    "transport": "bluetooth4",
    "transmitter": "ble:aa:bb:cc:dd:ee:ff",   // dedupe key across nodes
    "rssi_dbm": -72,                           // required for triangulation
    "counter": 41,
    "raw_hex": "12202d20...",                  // the bytes; source of truth
    "decoded": { "uas_id": "...", "drone_lat": 40.742, "drone_lon": -73.99, "model": "..." },
    "misb":    { "frame_center_lat": 40.7401, "frame_center_lon": -73.989, "corners": [[..],[..],[..],[..]] }
  }
}
```

## Aggregator API

`aerograph-aggregator` (Rust + axum). All logic is real crate calls.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/ingest` | a `DetectionReport` or an array of them. Re-decodes `raw_hex` before trusting the echo. |
| `GET` | `/state` | full current `GridState` snapshot (JSON). The page's cold start. |
| `GET` | `/ws` | WebSocket: pushes the full `GridState` at ~2 Hz. |
| `GET` | `/nodes` | known nodes + last-seen, for the node layer. |
| `GET` | `/cot` | `uas-cot` Cursor-on-Target XML of the fused entities, for TAK. |
| `GET` | `/healthz` | liveness. |

### Fusion pipeline (per snapshot, all real functions)

1. **Dedupe** across nodes by `sighting.transmitter` (a `remoteid::Transmitter`).
   One drone heard by N nodes becomes one entity with a per-node RSSI list.
2. **Decode / track**: every windowed sighting is re-decoded and fed through the
   `remoteid-sentinel` field analyzer (`Observation::new(..).with_rssi(..)
   .with_receiver(..)`), giving each track a `remoteid` trust `Verdict`
   (authenticated / plausible / suspicious / spoofed) and its reasons.
3. **Attribution**: model (`BasicId` UA type / DJI product name), registration
   (country code + clean reg from the operator ID), takeoff point and live pilot
   position (`System`, kept apart by `OperatorLocationType`).
4. **Intent / what is being watched**: if a MISB feed is present, the aimpoint is
   `misb` `Packet::frame_center` and the footprint is `Packet::corners`; camera
   dwell is how long the aimpoint stays within a radius.
5. **Trust / flood**: `remoteid-sentinel` `FieldAssessment` grades the whole
   field into a `FloodVerdict`, with a per-track `real_score` and the single
   `most_likely_real` track surfaced first.
6. **Spoofer triangulation**: a flagged flood source is heard by every node at a
   strength set by its distance. Each RSSI inverts to a range through the
   log-distance path-loss model, and a least-squares intersection of those ranges
   drops a pin on the puppeteer radio (needs 3+ nodes). This is the collapse of
   hundreds of fakes to one real point on the operator.

`GridState` (served by `/state` and `/ws`):

```jsonc
{
  "ts_ms": ...,
  "nodes": [{ "id", "lat", "lon", "last_seen_ms" }],
  "entities": [DroneEntity, ...],
  "flood": { "level": "clear|elevated|flooded", "confidence": 0.0-1.0 },
  "triangulation": [{ "transmitter", "lat", "lon", "confidence", "node_ids": [...] }],
  "ticker": [{ "ts_ms", "text" }]
}
```

`DroneEntity = { transmitter, uas_id, model, registration{country,reg}, verdict,
reasons[], real_score, drone{lat,lon,alt_m}, pilot{lat,lon}, takeoff{lat,lon},
watching{lat,lon,dwell_s,footprint}, trail[[lat,lon]...], heard_by[node_id...] }`

## Run it

Build and test the backend workspace:

```sh
cargo test                                  # unit + integration tests
cargo clippy --workspace --all-targets -- -D warnings
```

The end-to-end test (`fusion/tests/grid.rs`) runs the real fusion over a
simulated five-node Manhattan mesh with a 60-ID spoof flood and asserts the
aggregator fuses the genuine drone, flags the flood, and localizes the puppeteer
to within 60 m of its true position.

### Self-contained live demo

Boot the aggregator with its own labelled simulated city mesh feeding it:

```sh
cargo run -p aerograph-aggregator --release -- --demo --bind 127.0.0.1:8787
curl http://127.0.0.1:8787/state     # flooded, entities, one puppeteer pin
curl http://127.0.0.1:8787/cot       # the same grid as Cursor-on-Target XML
```

This is the data the public map runs on. The map must label it as a simulation.

### A real (or replayed) node feeding the aggregator

```sh
# Simulated mesh -> aggregator over HTTP:
cargo run -p aerograph-node -- sim --post http://127.0.0.1:8787

# Real sensor path: pipe node records (serial) through the real remoteid decode.
# Record format:  <node_id> <lat> <lon> <rssi_dbm> <transport> <counter> <raw_hex>
echo "node-0007 40.7411 -73.9897 -72 bluetooth4 41 12202d20...ffff0000" \
  | cargo run -p aerograph-node -- decode --post http://127.0.0.1:8787
```

## A note on crate versions

`remoteid-sentinel 0.2.0`, `remoteid-scenario 0.1.0` and `uas-cot 0.7.0` all
depend on `remoteid ^0.3`, so the decoded types (`Observation`, `Transmitter`,
`Assessment`) only unify when the direct dependency is pinned to the same line.
The backend therefore pins `remoteid 0.3.3`, the proven `remoteid-web`
combination. When those crates publish against `remoteid 0.4`, bump the pin.

## License

MIT. No warranty. Receive-only: this is analysis of broadcasts a sensor already
heard. No radio, no transmit path, no targeting output.
