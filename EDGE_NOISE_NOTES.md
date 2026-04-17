# Biome edge noise — model & verification

How Noita resolves which biome lives at a world coordinate, where
telescope models it, and how to compare the two against a running game.

Reference build: Noita dated 2025-01-25 (`noita_Jan_25_2025_15:55:41`),
data unpacked at `~/reverse/noita/<build>/data/data.wak.unpacked/`. All
"@ 0x…" annotations are addresses in `noita.exe` for that build — open
the binary in Ghidra/IDA and jump to the address to see the same
function regardless of whether you have my renaming/struct database.

## Engine model

### Chunk struct (per loaded biome chunk)

The biome chunk grid lives at `WorldManager + 0x48` (a.k.a.
`pBackgroundGrid`). For normal mode it's 70x48 chunks of 512x512 pixels;
the chunk pointers are stored at `BiomeGrid + 0x68` indexed by
`cy * width + cx`.

Per-chunk fields used by edge resolution:

| offset | type | meaning |
| --- | --- | --- |
| `+0x08` | `MsvcString` | biome name, e.g. `$biome_holymountain` |
| `+0xC4` | `u8`         | wobble eligible. `0` ⇒ never wobble at this chunk. Sourced from the biome XML's `noise_biome_edges` attribute (default `1`). |
| `+0xC5` | `u8`         | wavy edge. With `0` on either side of an edge, only the simplex part of the wobble is applied. |
| `+0xC6` | `u8`         | force-original. Non-zero short-circuits to original. |
| `+0x2A4` | `ptr`       | biome data pointer. Non-null gates pixel-scene placement. |

### `ChunkGrid_ResolveChunkAtPosition` (`0x0087d9a0`)

For world position `(wx, wy)` with `sx = wx + xShift`, `sy = wy + yShift`,
sub-chunk coords `subX = sx & 0x1FF`, `subY = sy & 0x1FF`, and
`original = chunks[chunk_y][chunk_x]`:

1. If `original.wobbleEligible == 0` or `original.forceOriginal != 0`,
   return `original`.
2. Walk relevant neighbor directions in this fixed order, stopping at the
   **first** with a different `Chunk*`:
   - left (`subX < 42`), top (`subY < 42`), right (`subX > 470`),
     bottom (`subY > 470`)
   - then NW/SW only if `subX < 42`; NE only if `subX > 470 && subY < 42`;
     SE only if `subX > 470 && subY > 470`
   - if none of the probed directions yield a different chunk, return
     `original`.
3. Re-fetch that specific neighbor. If `neighbor.wobbleEligible == 0`,
   return `original`.
4. Compute the wobble offset:
   - `s = simplex(sx * 0.05, sy * 0.05) * 70`
   - if `original.wavyEdge == 0` or `neighbor.wavyEdge == 0`:
     `dx = dy = s * 2.5` (simplex-only)
   - otherwise:
     `dx = cos(sx * 0.005) * 30 + s * 11`
     `dy = sin(sy * 0.005) * 30 + s * 11`
5. Look up `wobbled = chunks[(sy + dx) >> 9][(sx + dy) >> 9]`.
   **The X/Y are swapped in the lookup** — the X chunk index uses the Y
   wobble component and vice versa. (Verified in disassembly: in
   `BiomeGrid_GetChunkAt` (noita.exe @ 0x0087d870) call
   `(grid, (dVar10+dVar13)>>9, (dVar12+dVar9)>>9)`, `dVar10` is the
   sin/Y branch and `dVar12` is the cos/X branch.)
6. If `wobbled.wobbleEligible == 0`, return `original`. Otherwise return
   `wobbled`.

The simplex helper is the standard 2D Simplex noise from telescope's
`ComputeMagicValueFromDoubles`. The static permutation table
(`EDGE_NOISE`, 256 bytes) lives in `.rdata` and is initialized into
`EDGE_NOISE_2` / `EDGE_NOISE_M12` by `EdgeNoise_InitializeTables`
(noita.exe @ 0x008722b0).

### No-spawn buffer near chunk edges

Independent of the wobble: Noita's per-chunk procedural spawn loop in
`BiomeGen_GenerateProceduralContent` (`0x00868f70`) clamps each random
spawn position to `[5, chunk_width - 5]`. There's a corresponding
constraint on the cave-structure side: every `<CaveStructure>` element
in the biome XMLs sets `aabb_min_x="5" aabb_max_x="507"` (102
occurrences). Y-axis bounds vary per scene (some are ceiling-mounted
with `aabb_max_y="2"`, etc.).

Effect: items procedurally placed by the per-chunk loop never land in
the outer 5 pixels of a 512x512 chunk. This isn't relevant to wobble
or pixel-scene-placement gates (which operate on already-placed
positions) but matters if telescope ever predicts WHERE a spawn could
land within a chunk.

### Pixel-scene placement (`PixelScene_PlaceEntryIfValid` @ 0x0087d7e0)

When the engine renders a queued pixel scene at world `(x, y)`:

1. `PixelScene_AreOtherCornersLoaded` (noita.exe @ 0x0087d670) verifies
   the three non-top-left chunks the scene overlaps are *loaded* —
   does **not** verify same biome.
2. `ChunkGrid_ResolveChunkAtPosition` (noita.exe @ 0x0087d9a0) runs for
   the **top-left** corner.
3. The scene is placed iff `resolved.biomeDataPtr != 0`.

There is no all-corners-must-match-the-biome check.

## Source of truth: biome XMLs (`data.wak`)

The `+0xC4` byte is set from the per-biome XML's `noise_biome_edges`
attribute (`0` ⇒ ineligible, absent or `1` ⇒ eligible). The mapping from
biome-map RGB color to biome XML is in `biome/_biomes_all.xml`.

`scripts/generate.mjs biome-flags` walks both and emits
`data/biome_flags.json`: one entry per known biome color with
`{color, xmlName, wobbleIneligible?}` (`wobbleIneligible: true` when
the XML sets `noise_biome_edges="0"`; absent means the default/eligible
case).
Re-run after a Noita update with `--src=PATH --out=PATH`.

`js/wobble_flags.js` consumes that JSON and exposes
`colorWobbleVerdict(color) → 'ineligible' | 'eligible' | 'unknown'`.

## Telescope's model and known divergences

`utils.js getBiomeAtWorldCoordinates` reads the biome map at the original
chunk position and applies an edge offset from `edge_noise.js
GetBiomeOffset`. The wobble math itself matches Noita's binary; the
remaining divergences are upstream of the math:

1. **Wobble eligibility — proxy by color, not chunk.** Noita keys it
   on the per-chunk `+0xC4` byte (sourced from biome XML). Telescope
   keys it on biome-map color via `wobble_flags.js`. The proxy holds
   because each color maps to exactly one biome XML — including
   variant shades like the HM entrance column (cx=35) using
   `temple_altar_right_snowcastle.xml` with `noise_biome_edges="1"`
   while neighboring HM tiles use `temple_altar.xml` with `="0"`.

2. **Eager wobble — telescope wobbles for any sub-position, doesn't
   require a differing neighbor first.** `GetTrueChunkPosIdAt` always
   wobbles when `subX/subY` is in `[0..41] ∪ [471..510]`. Noita
   pre-checks that some neighbor in the wobble direction is a different
   chunk pointer and stops early if not. Telescope's eager wobble
   usually lands in a same-named neighbor (so biome name agrees), but
   the resolved chunk index differs about 25% of the time inside edge
   zones. Affects spawn placement, not biome name resolution.

3. **NG+ palette gaps.** `js/wobble_flags.js` is sourced from the
   static biome XML data (NG-tier-independent). If an NG+ palette swap
   ever introduces a color not in `_biomes_all.xml`, `colorWobbleVerdict`
   returns `'unknown'` and the wobble runs normally — regenerate
   `data/biome_flags.json` from the new unpack to fix.

## Verification harness

Two-way diff between telescope's JS biome resolution and Noita's actual
chunk pointer (read from a running game by the sibling `noitrainer` Go
tool — see `~/repos/noitrainer`).

Inputs (`data/dumps/`, see that dir's README):

- `biome_flags.ndjson` — per-chunk flags from `noitrainer biome-flags`.
- `biome_at_resolutions.ndjson.gz` — Noita's resolved chunk for 84,060
  edge-zone world coords from `noitrainer biome-at-many`.
- `pixel_scenes.ndjson.gz` — every scene Noita has actually placed in
  the snapshot session, from `noitrainer pixel-scenes`.

Scripts (default to the in-repo dumps; per-section input flags override):

- `scripts/generate.mjs biome-flags` — XML → JSON wobble flags table.
- `scripts/generate.mjs sample-coords` — generate a coord fixture from a
  flags dump (`--mode=centers|borders|edges|dense`).
- `scripts/verify.mjs` — runs all three agreement checks in one pass.
  `--only=biomes` tests telescope's biome-map color → name table against
  Noita's per-chunk name. `--only=wobble` runs
  `getBiomeAtWorldCoordinates` against Noita's resolution per coord and
  reports name + chunk-index agreement bucketed by wobble classification.
  `--only=pixel-scenes` diffs telescope's `loadPixelScene` placement gate
  against the noita pixel-scene fixture (`--top-left-only` for the
  relaxed check).
- `scripts/_engine_shim.js` — Node-compatible copy of `edge_noise.js` +
  `getBiomeAtWorldCoordinates`, with CDN-only imports inlined. Must track
  `js/edge_noise.js` and `js/utils.js` when either changes.

To regenerate everything against a different Noita session, follow
`data/dumps/README.md`.
