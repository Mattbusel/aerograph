# Embedding Aerograph on tensorust.com

Live map (GitHub Pages, public, verified 200): **https://mattbusel.github.io/aerograph/**

## Option A — drop-in `/grid` page (recommended)

Copy `grid.html` to the root of the tensorust.com site source and deploy. With Vercel
`cleanUrls` it serves at **https://tensorust.com/grid**. It is a full-bleed iframe of the
live map with a thin Tensorust header, share/OG tags, and the honesty footer.

```sh
cp tensorust-embed/grid.html <tensorust.com-site-root>/grid.html
# then deploy that site (the tensorust.com project)
```

## Option B — iframe snippet to paste into an existing page/section

```html
<div style="position:relative;width:100%;aspect-ratio:16/10;min-height:520px;border:1px solid #1a2334;border-radius:12px;overflow:hidden;background:#05070d">
  <iframe
    src="https://mattbusel.github.io/aerograph/"
    title="Aerograph — live drone grid"
    loading="lazy"
    style="position:absolute;inset:0;width:100%;height:100%;border:0"
    referrerpolicy="no-referrer-when-downgrade"></iframe>
</div>
<p style="font:12px/1.5 system-ui;color:#8a97ad;margin:8px 2px">
  Live simulation of the grid. Decode, trust scoring and spoofer triangulation are the real
  <a href="https://github.com/Mattbusel/aerograph" style="color:#ffcf4a">Aerograph</a> crates run in
  your browser; only the city traffic is simulated.
</p>
```

Both point at the Pages URL, so the embed stays current whenever the map is rebuilt and pushed.
