# aerograph/web - the live public map

The viral public map. A dark, cinematic [maplibre-gl](https://maplibre.org) map
that loads the **real** decode + fusion [`/core`](../core) wasm and runs it over a
**labeled live simulation** of a city sensor mesh.

Everything the map shows (model, trust verdict, live position, launch point,
registration, the camera ground-target, the spoof-flood call, and the puppeteer
pin) is produced by `grid.run_grid()` -> the real `remoteid` /
`remoteid-sentinel` / `misb` crates compiled to WebAssembly. The only simulated
part is the city radio traffic feeding the virtual $6 nodes, and the page labels
it `LIVE SIMULATION OF THE GRID`.

## What's on the map

- **Drone markers** colored by trust verdict (authenticated / plausible /
  suspicious / spoofed); the single genuine track the sentinel held through the
  flood gets a pulsing gold ring.
- **Click any drone** for the full dossier: model, live position + altitude,
  live pilot pin, launch pin, registration (country + reg), the camera
  ground-target with its footprint cone, the trust verdict with its evidence,
  and the flight trail. The map also draws the lines from every sensor that
  heard it (the fusion input).
- **The spoof flood collapsing**: when the puppeteer floods hundreds of fake IDs,
  the field verdict flips to `flooded` and the triangulation solver drops a
  pulsing **puppeteer pin** on the one physical radio behind them.
- **"Who is being watched"** layer: the camera aimpoint and footprint cone for
  any drone carrying a MISB feed.
- **Live counters** (drones, pilots, fakes neutralized, sensors) and a **live
  grid ticker**.

## Serve it

It is a static site. It must be served over **http** (ES modules + wasm do not
load from `file://`):

```sh
cd aerograph/web
python -m http.server 8731
# open http://127.0.0.1:8731
```

Any static host works (`npx serve`, nginx, GitHub Pages, Vercel). If the wasm
core cannot load, the page falls back to replaying `core/sample_state.json`, a
real fused snapshot, so the layout still renders.

## Deploy / embed

- **GitHub Pages**: publish this `web/` folder (or copy it to `/docs`).
- **tensorust.com**: deploy as its own path and embed in an `<iframe>`, or copy
  these files under a route. `core/` must sit next to `index.html` so
  `aerograph_core_bg.wasm` resolves.

## Files

```
index.html   the page shell (brand, counters, ticker, dossier, legend)
style.css    dark cinematic theme
app.js       loads the wasm core, loops run_grid() at ~2 Hz, renders the grid
core/        copied from ../core/dist (aerograph_core.js, _bg.wasm, sample_state.json)
```

To refresh the core after a rebuild, re-copy `../core/dist/*` into `core/`.
