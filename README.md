# TT SlideViewer

[中文文档](README.zh-CN.md)

A fast, offline Windows desktop viewer for **MIRAX (3DHISTECH Pannoramic) digital pathology slides** stored as raw `.dat` tile data. Built with **Tauri v2 + React**, it parses `Index.dat` directly, streams 303×253 JPEG tiles by coordinate, and renders a 9-level pyramid on a hand-rolled Canvas 2D engine — with µm-accurate measurement, persistent annotations and PNG export.

| Slide library | Deep zoom (L1, 0.55 µm/px) | Dark theme |
|---|---|---|
| ![Slide library](docs/screenshots/01-slide-library.png) | ![Deep zoom](docs/screenshots/03-deep-zoom-nuclei.png) | ![Dark theme](docs/screenshots/10-dark-theme.png) |

| Measurement | Annotations | Dual-pane compare |
|---|---|---|
| ![Measurement](docs/screenshots/04-measure.png) | ![Annotations](docs/screenshots/07-annotations-done.png) | ![Dual pane](docs/screenshots/09-dual-pane.png) |

> **Installer size: 1.5 MB.** No backend process, no local HTTP server, no sidecar — closing the window is a full exit.

## Why another viewer?

The source slides come with a **broken `.mrxs` file** (its bytes are actually a renamed preview JPEG, starting `FF D8` instead of `MRXS`). OpenSlide/QuPath readers fail on it. This app ignores `.mrxs` entirely and reads the raw tile store instead. [OpenSeadragon] was also ruled out: it assumes a uniform square-tile grid, while MIRAX tiles are 303×253 and levels 0–4 are sparse — a custom Canvas engine keeps full control.

## Features

- **Slide library** — thumbnail per case, instant search, filter by site (palate/gingiva) and tooth (G1–G8)
- **Viewer** — wheel/double-click zoom anchored at the cursor, drag pan, automatic level switching with coarse-first fallback (no blank flashes)
- **Minimap** — bottom-right overview with a live viewport rectangle, click to jump
- **Measurement** — multi-point polyline with live µm/mm readout (`mpp × 2^level × px`), plus an adaptive scale bar
- **Annotations** — rectangle / arrow / freehand / text, persisted across restarts, undo and clear
- **PNG export** — current view or marquee region at the current level's native resolution
- **Dual-pane compare** — side-by-side cases with synced zoom/pan
- **Themes** — light / dark / follow system
- **Frameless window** — custom title bar, 8-direction resize hot zones, single instance, remembered geometry

## Getting started

### Install

Grab `TT SlideViewer_<ver>_x64-setup.exe` from [Releases] (NSIS, per-user, no UAC prompt) or build it yourself:

```bash
npm install
npm run tauri build
# → src-tauri/target/release/bundle/nsis/TT SlideViewer_<ver>_x64-setup.exe
```

Requirements to build: Node.js ≥ 18, Rust stable (MSVC), Windows 10/11. The installer bootstraps WebView2 automatically on machines that lack it (requires internet once).

### Prepare data

The app mounts a **data root** folder — read-only, never modified:

```
DATA_ROOT/                     ← select this folder in the app
├─ Case 01 G1 Palate/          ← one folder per slide, any name
│  ├─ Index.dat                ★ required — tile index table
│  ├─ Slidedat.ini             scan parameters (µm/px)
│  └─ Data0000.dat … Data0021.dat   raw JPEG tile streams
├─ Case 02 G2 Palate/
└─ …
```

Rules of thumb:

- The app scans the **direct children** of the selected folder; a child counts as a slide iff it contains `Index.dat`.
- **ZIP archives are not mounted directly** — extract to a real folder first, then select the parent folder.
- `.mrxs` files are ignored (they are broken in this dataset and never read by the app).
- Slide folders must not be nested inside each other.
- The app **never writes to the data root** — settings, annotations and exports live in the app data directory and user-chosen paths.

Three ways to point the app at your data root (first match wins):

1. In-app: “Change folder” button or Settings dialog
2. `TT_SLIDE_DATA_ROOT` environment variable
3. Auto-detect: a `DATA/` folder next to the executable (up to 4 levels up) or in the working directory

The choice is persisted in `%APPDATA%\com.tt.slideviewer\settings.json` together with cache budget, default zoom and theme.

### Validate your data

```bash
cd src-tauri
cargo run --release --example validate -- <DATA_ROOT>
```

Parses every slide, checks the level pyramid and JPEG SOI/EOI markers, prints a per-slide table.

## Data format notes

Hard-won facts about this MIRAX flavor (validated against 16 slides / ~249k tiles), implemented in `src-tauri/src/index.rs`:

- `Index.dat`: 325-byte header, then 16-byte little-endian records — four `u32` fields in **two rotated layouts** (`[key, offset, length, fileno]` vs `[length, fileno, key, offset]`), decided per data file by counting which position holds a plausible `fileno`.
- The stored `length` is unreliable; lengths are recomputed from neighbouring offsets and trimmed at the EOI marker.
- **Level inference**: no fixed fileno→level table (it differs between slides). Instead the 2-adic valuation histogram of keys decides — level-k keys are multiples of 2^k, ~half of them not of 2^(k+1).
- **Coordinates**: `t = key >> level; x = t % 296; y = t / 296` — 296 is a fixed constant (`IMAGENUMBER_X`), **not** the per-level column count. Tile (x, y) at level k covers layer-0 pixels `[x·303·2^k, y·253·2^k]`.
- Levels 0–4 are **sparse** (only tissue tiles are stored); 5–8 are full rectangles. Tiles must be placed by (x, y), never by file order.
- µm/px comes from `Slidedat.ini` → `[LAYER_0_LEVEL_0_SECTION]` → `MICROMETER_PER_PIXEL_X`; level k resolution = value × 2^k.
- Level 0 is ~4.3 gigapixels (~12.8 GB uncompressed RGB) — compositing the whole slide is forbidden by design; tiles are streamed per viewport.

## Architecture

One process, no sidecar:

```
┌───────────────────────────────────────────────┐
│  Tauri window (the only process)              │
│  WebView (React)           Rust core          │
│  ┌───────────────┐  invoke  ┌────────────────┐ │
│  │ Canvas engine  │ ───────► │ index parse    │ │
│  │ UI / annots    │ ◄─────── │ tile seek+read │ │
│  └───────────────┘  binary  └───────┬────────┘ │
└─────────────────────────────────────┼──────────┘
                                      ▼
                               DATA_ROOT/*.dat
```

- Tiles travel over `tauri::ipc::Response` as **raw bytes** (no base64): `[u32 count]{[u32 x][u32 y][u32 len][jpeg bytes]}*`, little-endian, ≤600 tiles per batch.
- The frontend decodes tiles into `ImageBitmap`s and keeps an LRU cache (default 400 MB budget, `bmp.close()` on evict).
- Renderer: dual canvas (tiles + annotation overlay), rAF + dirty-flag, DPR-aware backing store, integer-snapped tile edges, coarse-ancestor fallback while zooming.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `+` / `=` · `-` / `_` | zoom in ×1.35 / out |
| `0` | fit slide to window |
| `F` | toggle fullscreen |
| `M` | measure mode |
| `T` | toggle light/dark theme |
| `Esc` | cancel current action |
| `Delete` / `Backspace` | undo last annotation |

## Privacy

This repository contains **no patient data**. All screenshots were taken against anonymized demo folders; no clinical information, identifiers or original slide names are committed.

## License

[MIT](LICENSE)

[OpenSeadragon]: https://openseadragon.github.io/
[Releases]: https://github.com/TTDiang2/tt-slideviewer/releases
