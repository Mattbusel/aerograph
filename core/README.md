# aerograph-core - the WASM fusion core

This crate compiles the **real** Aerograph decode + fusion to WebAssembly and
runs it in the browser, so the public map is honest with no server.

All the real work lives in the shared [`aerograph-fusion`](../fusion) crate,
which the server [`/aggregator`](../aggregator) uses too, so the browser and the
server run **byte-identical** fusion:

- **`remoteid` 0.3.x** decodes every frame and gives a per-transmitter trust
  verdict (authenticated / plausible / suspicious / spoofed).
- **`remoteid-sentinel` 0.2** fuses the whole field: is the airspace flooded,
  and which single track is the one genuine drone?
- **`misb` 0.5** reads the camera aimpoint (ST 0601 frame center + footprint).
- A **log-distance path-loss multilateration** solver triangulates a spoof
  flood back to the one physical radio emitting it and drops a pin on it.

This crate is a thin **wasm bridge**: it builds the labeled city-mesh simulation
(`aerograph_fusion::sim::GridSim`), feeds each tick's reports into the real
fusion (`aerograph_fusion::Grid`), and returns the fused `GridState` as JSON.

> The simulation is the INPUT. Every number the map shows is produced by one of
> the real crates from the bytes a node captured. Even the simulated camera feed
> is built as a real MISB ST 0601 packet and parsed back with the `misb` crate
> here, so no number on the map is invented. **The page must label the mesh as a
> live simulation of the grid.**

## JS API

`wasm-bindgen --target web` output lives in [`dist/`](./dist):

```
dist/aerograph_core.js          # ES module: default init() + Grid class
dist/aerograph_core_bg.wasm     # the fusion core
dist/aerograph_core.d.ts        # TypeScript types
dist/sample_state.json          # a real fused snapshot, for offline layout
```

Usage from the map:

```js
import init, { Grid } from "./aerograph_core.js";

await init();                      // load the wasm

const grid = new Grid(JSON.stringify({
  city:  { center_lat: 40.7411, center_lon: -73.9897 },  // map center
  nodes: [                                               // the $6 sensors
    { id: "node-0001", lat: 40.7447, lon: -73.9897 },
    { id: "node-0002", lat: 40.7436, lon: -73.9859 },
    { id: "node-0003", lat: 40.7411, lon: -73.9844 },
    { id: "node-0004", lat: 40.7386, lon: -73.9859 },
    { id: "node-0005", lat: 40.7375, lon: -73.9897 },
    { id: "node-0006", lat: 40.7386, lon: -73.9935 },
    { id: "node-0007", lat: 40.7411, lon: -73.9950 },
    { id: "node-0008", lat: 40.7436, lon: -73.9935 }
  ],
  drones: 5,                               // honest drones in the sky
  fakes_per_radio: 120,                    // fake IDs the puppeteer floods
  puppeteer: { lat: 40.7402, lon: -73.9881 } // the radio to be triangulated
}));

let step = 0;
setInterval(() => {
  const state = JSON.parse(grid.run_grid(step++));  // THE CORE CALL, ~2 Hz
  render(state);
}, 500);
```

### `new Grid(configJson: string)`

Builds the grid and the simulated mesh. Only `city` is required; the rest
default to a Manhattan mesh.

| field | default | meaning |
|-------|---------|---------|
| `city.center_lat` / `center_lon` | required | map center |
| `nodes[]` (`{id,lat,lon}`) | ring of 6 around center | fixed sensor positions (needed for triangulation) |
| `drones` | 5 | honest moving drones |
| `fakes_per_radio` | 120 | fake IDs the flooding radio injects |
| `puppeteer` (`{lat,lon}`) | ~250 m NE of center | the flooding radio's true position (what triangulation should recover) |
| `flood_at_step` | 0 | step the flood turns on |
| `hearing_floor_dbm` | -99 | below this a node does not hear a frame |

### `grid.run_grid(step: number) -> string`

Advances the sim one tick and returns the fused `GridState` as a JSON string.
Loop it at about 2 Hz, incrementing `step` (the argument is accepted for API
symmetry; the sim advances its own internal clock).

## GridState shape

```jsonc
{
  "ts_ms": 1732300006000,
  "nodes": [ { "id": "node-0001", "lat": .., "lon": .., "last_seen_ms": .. } ],
  "entities": [
    {
      "transmitter": "ble:aa:bb:cc:dd:ee:ff",   // dedupe key across nodes
      "uas_id": "1581FA01000",                   // decoded Basic ID
      "model": "HelicopterOrMultirotor",         // ASTM UA type / DJI model
      "registration": { "country": "USA", "reg": ".." },
      "verdict": "spoofed",                       // trust verdict
      "reasons": ["frozen_position", ".."],       // the evidence
      "real_score": 0.02,                         // 0 fake .. 1 the genuine drone
      "drone":   { "lat": .., "lon": .., "alt_m": 43.0 },
      "pilot":   { "lat": .., "lon": .. },         // live operator position
      "takeoff": { "lat": .., "lon": .. },         // launch point
      "watching": {                               // only if a MISB feed was heard
        "lat": .., "lon": .., "dwell_s": 3.0,
        "footprint": [[lat,lon],[lat,lon],[lat,lon],[lat,lon]]
      },
      "trail": [[lat,lon], ..],                   // where it has been
      "heard_by": ["node-0001", "node-0004"]       // the fusion input
    }
  ],
  "flood": { "level": "flooded", "confidence": 1.0 },   // sentinel verdict
  "triangulation": [                                    // puppeteer pins
    { "transmitter": "ble:..", "lat": .., "lon": ..,
      "confidence": 0.9, "node_ids": ["node-0001", ".."] }
  ],
  "ticker": [ { "ts_ms": .., "text": "puppeteer radio .. localized to .." } ]
}
```

A drone with the highest `real_score` is the one genuine aircraft the sentinel
held through the flood; `watching` and `triangulation` are present only when
there is something to show. The full shape is defined by
`aerograph_fusion::state::GridState`. `dist/sample_state.json` is a real fused
snapshot the `/web` agent can build against without the wasm.

## Rebuilding the wasm

```sh
# per-agent target dir, deleted after; 4 build jobs
export CARGO_TARGET_DIR="C:/Users/Matthew/.cargo/target-grid-core"
export CARGO_BUILD_JOBS=4
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir dist --out-name aerograph_core \
  "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/aerograph_core.wasm"
# optional: cargo run --release --example dump_state   # refresh sample_state.json
```

Native tests (`cargo test --release`) prove the bridge fuses, the flood is
detected and the puppeteer is triangulated, and that the camera aimpoint is a
number the `misb` crate actually produced.
