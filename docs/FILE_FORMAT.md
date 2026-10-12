# The `.meandrismap` file format

A Meandris Maps document is a **ZIP container** with the extension
`.meandrismap`. It is self-contained: images are stored inside the file, so a
map can be moved to another computer without breaking.

| Entry               | Contents                                                         |
| ------------------- | ---------------------------------------------------------------- |
| `mimetype`          | The text `application/x-meandris-map` (stored uncompressed, first) |
| `map.json`          | The map: structure, text, styling, image placement (UTF-8 JSON)   |
| `assets/<id>.<ext>` | Embedded image files, stored as-is (PNG, JPEG, GIF, WebP, SVG)    |

Readers must ignore unknown entries. (Recovery snapshots add a
`recovery.json` entry; it never appears in files the user saves.)

## `map.json` (format version 1)

```json
{
  "format": "meandris-map",
  "version": 1,
  "generator": "Meandris Maps 0.1.0",
  "document": {
    "root": "n_8f3k2l1m0abc",
    "created": "2026-10-03T17:20:13.231Z",
    "modified": "2026-10-03T17:25:02.004Z"
  },
  "settings": { "layout": "both" },
  "nodes": [
    {
      "id": "n_8f3k2l1m0abc",
      "text": "Sports",
      "parent": null,
      "children": ["n_q1w2e3r4t5y6", "n_a1s2d3f4g5h6"]
    },
    {
      "id": "n_q1w2e3r4t5y6",
      "text": "Football",
      "parent": "n_8f3k2l1m0abc",
      "children": [],
      "color": "#3d7fd9",
      "side": "right",
      "boundary": { "fill": "#eef4ff" },
      "collapsed": true
    }
  ],
  "images": [
    { "id": "i_k3j4h5g6f7d8", "asset": "a_z9x8c7v6b5n4", "node": "n_q1w2e3r4t5y6",
      "x": -60, "y": -110, "width": 120, "height": 80 },
    { "id": "i_p0o9i8u7y6t5", "asset": "a_z9x8c7v6b5n4",
      "x": 340, "y": -200, "width": 240, "height": 160 }
  ],
  "assets": [
    { "id": "a_z9x8c7v6b5n4", "path": "assets/a_z9x8c7v6b5n4.png",
      "mime": "image/png", "width": 1200, "height": 800 }
  ]
}
```

### Fields

- **`format`**: always `"meandris-map"`.
- **`version`**: integer format version. Readers refuse files with a higher
  version than they understand and explain that the app needs updating.
- **`document.root`**: id of the central topic.
- **`settings.layout`**: `"both"` (branches on both sides) or `"right"`.
- **`nodes`**: every topic, in pre-order. Each has a stable `id` (never
  derived from the text), its `text` (may contain `\n`), `parent`, and the
  ordered `children` ids. `children` is authoritative for structure and order;
  `parent` is redundant and used only to repair damaged files.
  - `color`: explicit branch colour (`#rgb` or `#rrggbb`). Topics without one
    inherit their parent's colour.
  - `side`: `"left"` or `"right"`, only on direct children of the root.
  - `boundary`: present when a boundary is drawn around the topic and its
    visible descendants; optional `fill` / `stroke` tint colours (otherwise
    derived from the branch colour). Tints are drawn translucently so text
    stays readable.
  - `collapsed`: `true` when the topic's children are hidden.
- **`images`**: placed images, in drawing order (later is on top).
  - Free image (no `node`): `x`, `y` is the top-left corner in map
    coordinates (the central topic is centred on 0,0).
  - Attached image (`node` set): `x`, `y` is the top-left corner relative to
    the centre of that topic's label, so the image follows the topic.
  - `width`, `height`: display size in map units.
- **`assets`**: embedded image files. `width`/`height` are the pixel size of
  the stored image. Several images may share one asset.

## Robustness rules

- A file that is not a ZIP, has no `map.json`, or has a different `format`
  is rejected with a readable message; the app does not crash.
- Broken child references are dropped; topics that are not reachable from the
  root are re-attached under the central topic; the user is told.
- Missing image data keeps the image's place and shows a placeholder.
- Invalid colours are ignored.
- Saving writes a temporary file next to the target, flushes it to disk and
  renames it over the original, so a failed save never damages the existing
  file.
