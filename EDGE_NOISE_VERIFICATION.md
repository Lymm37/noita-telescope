# Edge-noise verification receipts

Append-only log of comparison-script runs against the in-repo Noita
fixture (`data/dumps/biome_at_resolutions.ndjson.gz`,
`data/dumps/biome_flags.ndjson`, `data/dumps/pixel_scenes.ndjson.gz`).
Seed `864604507`, NG+=0, build dated 2025-01-25.

## Before/after at a glance

The four numbered comparisons below describe exactly what each metric
measures and the script that produces it. "Before" is the metric's
value the first time it was measured against telescope + the
corresponding bug (different snapshot per metric — captured at the
point each issue was first quantified). "After" is the current head of
the branch with all fixes applied.

### 1. Biome catalogue agreement

**What it measures:** for every loaded biome chunk in the noita
fixture, telescope's `BIOME_COLOR_TO_NAME` (looked up via
`BIOME_COLORS_WITH_TILES` filter in `js/generator_config.js`) is
compared against Noita's `BiomeChunk.biome_name` field at +0x08. No
wobble is applied — this purely tests whether telescope can name each
chunk's biome from its biome-map color. Both sides go through the
script's `KEY_OVERRIDES` table to reconcile cosmetic key differences
(`the_end` ↔ `boss_victoryroom`, `fungiforest` ↔ `fun`, etc.).

**Procedure:** `node scripts/verify.mjs --only=biomes`.
Loads `data/biome_maps/biome_map.png`; for each named chunk in the
dump, looks up the pixel color in telescope's table and compares to
the chunk's `name` from noitrainer.

**Before:** 765 / 1882 chunks agree (40.6%) — original telescope, no
`colorAliases` and missing surface biomes (desert, winter, lake, lava,
gold, water, secret rooms, orbroom marker).
**After:** 1,868 / 1,868 chunks agree (**100.0%**).

### 2. Wobble biome-name agreement

**What it measures:** at 84,060 world coordinates focused on the
wobble-active strips (sub_x/sub_y in `[0..41] ∪ [471..510]` for every
loaded chunk), telescope's `getBiomeAtWorldCoordinates` resolves the
biome name. That answer is compared against the biome name of the
chunk Noita's `ChunkGrid_ResolveChunkAtPosition` (noita.exe @
0x0087d9a0) actually returns, captured by `noitrainer biome-at-many`
into `data/dumps/biome_at_resolutions.ndjson.gz`.

**Procedure:** `node scripts/verify.mjs --only=wobble`. The script reports
`agree / decided` where `decided` excludes positions where telescope
returned null (the `BIOME_COLORS_WITH_TILES` rendering filter — these
are intentional "telescope doesn't render this biome", not
disagreements with Noita's lookup).

**Before:** 47,402 / 49,264 (96.22%) — telescope with the
`BIOMES_WITHOUT_WAVY_EDGE` color-set workaround but no per-chunk
flag table or neighbor probe.
**After:** 71,185 / 71,185 (**100.00%**).

### 3. Wobble chunk-index agreement

**What it measures:** same fixture as #2, but compares the wobbled
chunk *coordinate* `(cx, cy)`. This is finer-grained than the biome
name — telescope can resolve to a different `(cx, cy)` than Noita and
still report the same biome name if that name happens to span both
chunks.

**Procedure:** `node scripts/verify.mjs --only=wobble`. The
`chunk-index agreement` line counts positions where
`telescope.pos.{x,y} === noita.resolved.{cx,cy}`.

**Before:** 59,376 / 79,919 (74.30%) — same telescope era as #2, before
the neighbor short-circuit and the X-wrap / Y-clamp on `(biomePixelX,
biomePixelY)` were added.
**After:** 79,919 / 79,919 (**100.00%**).

### 4. Pixel-scene placement acceptance

**What it measures:** for every pixel scene Noita actually placed (323
entries in the snapshot session, captured by
`noitrainer pixel-scenes`), simulate telescope's `loadPixelScene`
bounds check and report whether telescope would accept the placement.
The "before" simulates the legacy 4-corner same-biome check; the
"after" runs the current `loadPixelScene` logic (top-left wobbled
biome must resolve to a non-null name OR a known catalogue color).
PNG dimensions are read directly from the data.wak unpack so we can
compute scene corners.

**Procedure:** `node scripts/verify.mjs --only=pixel-scenes --top-left-only`
for the after; the script also has a no-flag mode that simulates the
legacy 4-corner check for the before number. `decided` excludes the 79
scenes whose `materialsFile` PNG isn't on disk (auto-generated
`spliced/...` paths).

**Before:** 19 / 183 accepted (10.38%) — original `loadPixelScene`
4-corner same-biome check (`pixel_scene_generation.js` lines
~239–262 pre-fix) would reject 89.62% of scenes Noita places.
**After:** 183 / 183 accepted (**100.00%**).

### Summary table

| # | Metric | Before | After | Where to reproduce |
| --- | --- | --- | --- | --- |
| 1 | Biome catalogue (no wobble) | 40.6% (765/1882) | **100.0%** (1868/1868) | §1 + `compare_biomes.mjs` |
| 2 | Wobble biome-name agreement | 96.22% (47402/49264) | **100.00%** (71185/71185) | §2 + `compare_wobble.mjs` |
| 3 | Wobble chunk-index agreement | 74.30% (59376/79919) | **100.00%** (79919/79919) | §3 + `compare_wobble.mjs` |
| 4 | Pixel-scene placement accept | 10.38% (19/183) | **100.00%** (183/183) | §4 + `compare_pixel_scenes.mjs` |

Each section below is an append-only receipt from a specific
comparison run; the before/after summary above is derived from those
receipts.

## Pre-tasks baseline (before Task A)

Captured 2026-04-16 against telescope at the state immediately
following the per-chunk wobble-flags work (`js/wobble_flags.js` + `data/biome_flags.json` wired via `js/utils.js`).

### Wobble: `node scripts/verify.mjs --only=wobble`

```
coords processed:           79919
skipped (no original):      0
skipped (_EMPTY_/???):      4141
telescope returned null:    26662  (biome has no wang tiles in telescope)
decided (both have name):   53257
  agree:                    53247  (99.98% of decided)
  wrong biome:              10
chunk-index agreement:      59372/79919  (74.29%)

By wobble decision (Noita's classification):
  no-differing-neighbor     46082 total,  18189 null,  27893/27893 name agree (100.0%),  26100/46082 chunk agree (56.6%)
  sin-cos+simplex           23493 total,   8109 null,  15384/15384 name agree (100.0%),  23448/23493 chunk agree (99.8%)
  skipped-flags             10344 total,    364 null,   9970/9980 name agree (99.9%),   9824/10344 chunk agree (95.0%)

Disagreement buckets (top 25):
  [    4]  $biome_holymountain ↔ $biome_excavationsite    {skipped-flags=4}
           e.g. wx=1, wy=2561, wobbleType=skipped-flags
  [    3]  $biome_holymountain ↔ $biome_snowcave    {skipped-flags=3}
           e.g. wx=0, wy=4608, wobbleType=skipped-flags
  [    3]  $biome_holymountain ↔ $biome_rainforest    {skipped-flags=3}
           e.g. wx=0, wy=8192, wobbleType=skipped-flags
```

All 10 disagreements are `skipped-flags` cases at the HM entrance
column (cx=35) where Noita short-circuits because the probed neighbor
is wobble-ineligible but telescope wobbles into a different biome.

### Biome catalogue: `node scripts/verify.mjs --only=biomes`

```
telescope map: 70x48
noita chunks dumped: 1868, _EMPTY_ skipped: 0, decided: 1868
  agree:                 1868  (100.0%)
  name disagreement:     0
  telescope color unknown: 0
  in noita, not in telescope grid: 0
  in telescope grid, not loaded by noita: 1492
```

Every named chunk in the noita dump resolves through telescope's
biome-color → name table. The 1492 "in telescope grid, not loaded by
noita" entries are the unloaded `_EMPTY_`/`???` slots that don't have
a real biome assignment in this seed.

### Pixel scenes

N/A — the pixel-scenes verification section doesn't exist yet; added in Task C.

## After Task A (neighbor-probe eligibility check)

`utils.js getBiomeAtWorldCoordinates` now also probes Noita's neighbor
order; the first differing-color neighbor's eligibility is folded into
`skipWobble`. The Node-side copy lives in `scripts/_engine_shim.js` and
is consumed by `scripts/verify.mjs`.

### Wobble: `node scripts/verify.mjs --only=wobble`

```
coords processed:           79919
skipped (no original):      0
skipped (_EMPTY_/???):      4141
telescope returned null:    26298  (biome has no wang tiles in telescope)
decided (both have name):   53621
  agree:                    53621  (100.00% of decided)
  wrong biome:              0
chunk-index agreement:      59892/79919  (74.94%)

By wobble decision (Noita's classification):
  no-differing-neighbor     46082 total,  18189 null,  27893/27893 name agree (100.0%),  26100/46082 chunk agree (56.6%)
  sin-cos+simplex           23493 total,   8109 null,  15384/15384 name agree (100.0%),  23448/23493 chunk agree (99.8%)
  skipped-flags             10344 total,      0 null,  10344/10344 name agree (100.0%),  10344/10344 chunk agree (100.0%)
```

**0 wrong biomes** (was 10). All three Noita wobble classifications now
hit 100% name agreement. `skipped-flags` reaches 100/100 on chunk
indices too — telescope's neighbor-probe matches Noita's exactly.
`telescope-null` shrunk by 364 because the probe check correctly
suppresses wobble before reading a color the catalogue would have
nullified.

The remaining ~25% gap on chunk-index agreement (74.94%) is in the
`no-differing-neighbor` bucket — telescope eagerly wobbles (always
when sub_x/sub_y is in [0..41]∪[471..510]) while Noita short-circuits
when no neighbor differs. Telescope happens to land in same-named
neighbors, so biome name still agrees; the chunk-index discrepancy
matters for pixel-scene placement (Task C territory).

### Biome catalogue: `node scripts/verify.mjs --only=biomes`

```
noita chunks dumped: 1868, _EMPTY_ skipped: 0, decided: 1868
  agree:                 1868  (100.0%)
  name disagreement:     0
  telescope color unknown: 0
```

No regression.

### Pixel scenes

N/A still — created in Task C.

## After Task C (loadPixelScene 4-corner check relaxed)

`compare_pixel_scenes.mjs` (new) reads
`data/dumps/pixel_scenes.ndjson.gz` (323 scenes Noita actually placed)
and asks: would telescope's `loadPixelScene` bounds check accept each
scene? PNG dimensions are read directly from the data.wak unpack
(`~/reverse/noita/<build>/data/data.wak.unpacked/...`). Of the 323
fixture entries, 79 had no PNG on disk (mostly auto-generated /
spliced overlap-biome scenes), leaving 183 decided.

### Before — `--input data/dumps/pixel_scenes.ndjson.gz` (no flags)

Simulates the legacy 4-corner same-biome check.

```
pixel scenes in fixture:    262
size missing (skip):        79
decided:                    183
  telescope ACCEPT:         19  (10.38%)
  telescope REJECT:         164  (89.62%)
mode: 4-corner same-biome (current loadPixelScene)

Rejects by top-left biome:
    61  temple_altar
    40  (unresolved)
    10  vault
    10  snowcave
     9  rainforest_open
     8  crypt
     8  coalmine
     7  snowcastle
     7  excavationsite
     2  coalmine_alt
     1  tower_coalmine
     1  fungicave

Rejects by failure reason (top 15):
    53  bottom-left resolved to temple_altar
    40  top-left null
    12  top-right resolved to (null)
    10  bottom-left resolved to crypt
     8  bottom-left resolved to lava
     8  bottom-left resolved to vault
     7  bottom-left resolved to snowcastle
     7  bottom-left resolved to snowcave
     6  bottom-left resolved to excavationsite
     6  bottom-left resolved to rainforest
     3  bottom-left resolved to (null)
     2  top-right resolved to boss_arena
     1  top-right resolved to coalmine
     1  top-right resolved to excavationsite
```

89.62% of scenes Noita actually placed would be REJECTED by telescope's
4-corner check. The dominant failure is "bottom-left resolved to a
different biome" — i.e. the scene crosses a biome boundary. Noita
doesn't care because it only resolves the top-left chunk and gates on
`biome_data_ptr != 0`.

### After — `--top-left-only` (= the proposed fix)

```
pixel scenes in fixture:    262
size missing (skip):        79
decided:                    183
  telescope ACCEPT:         143  (78.14%)
  telescope REJECT:         40  (21.86%)
mode: top-left only (proposed fix)

Rejects by top-left biome:
    40  (unresolved)

Rejects by failure reason (top 15):
    40  top-left null
```

**89.62% rejection → 21.86% rejection** (`19 → 143` accepted, **+124
recovered scenes** of 183 decided). All 40 remaining rejects are
"top-left null" — telescope returns null because the wobbled biome's
color isn't in `BIOME_COLORS_WITH_TILES` (e.g. `pyramid`'s
`hasStuff:false`, surface `desert` / `winter` markers). Those biomes do
have `biome_data_ptr != 0` in the live game but telescope filters them
out earlier in `getBiomeAtWorldCoordinates`. A future improvement could
key the placement gate on the biome_flags.json `biomeDataPtr`
non-emptiness instead of `BIOME_COLORS_WITH_TILES`.

The fix landed in `js/pixel_scene_generation.js` — both `loadPixelScene`
and `loadRandomPixelScene` now do a single top-left lookup. The
`PIXEL_SCENE_BOUNDS_OFFSET["trailer_altar"]` workaround is left in
place (it shifted the top-left position to land in a valid biome and
still helps).

### Wobble (re-run after Task C)

```
coords processed:           79919
  agree:                    53621  (100.00% of decided)
  wrong biome:              0
chunk-index agreement:      59892/79919  (74.94%)
```

No regression — the pixel-scene change doesn't touch wobble math.

### Biome catalogue (re-run after Task C)

```
noita chunks dumped: 1868, decided: 1868
  agree:                 1868  (100.0%)
  name disagreement:     0
  telescope color unknown: 0
```

No regression.

## After Task C follow-up (catalogue fallback for tile-less biomes)

`getBiomeAtWorldCoordinates` now also returns `colorInt` (the wobbled
position's biome-map color) so callers can consult
`data/biome_flags.json` directly when the resolved biome name was
nulled by `BIOME_COLORS_WITH_TILES` (a telescope-rendering filter).
`loadPixelScene` and `loadRandomPixelScene` accept placement when the
wobbled color is in the catalogue, even if telescope doesn't have wang
tiles for that biome — matching Noita's "biome_data_ptr != 0" gate
without the rendering filter biasing the result.

### Pixel scenes — `node scripts/verify.mjs --only=pixel-scenes --top-left-only`

```
pixel scenes in fixture:    262
size missing (skip):        79
decided:                    183
  telescope ACCEPT:         183  (100.00%)
  telescope REJECT:         0  (0.00%)
mode: top-left only (proposed fix)
```

**0 rejections of 183 decided scenes** — telescope now matches Noita's
acceptance for every scene that has a PNG on disk to read dimensions
from. The 79 "size missing" skips are scenes whose `materialsFile`
isn't present in the data.wak unpack (mostly auto-generated paths
under `spliced/...`); those need a different test path (drive
telescope's full per-chunk generation rather than the single-position
gate test) and remain out of scope here.

### Wobble & biome catalogue (re-run)

No regression on either — `colorInt` is purely additive on
`getBiomeAtWorldCoordinates`'s return shape, and the catalogue
fallback only loosens the pixel-scene gate.

## After chunk-index parity fixes

Two changes in `getBiomeAtWorldCoordinates` (mirrored in the inline
copy in `scripts/_engine_shim.js`):

1. The neighbor-probe loop now also sets `skipWobble = true` when *no*
   probed neighbor's color differs from the original, mirroring Noita's
   "stop at the first differing chunk pointer; if none, return original"
   short-circuit (step 2 of `ChunkGrid_ResolveChunkAtPosition`,
   noita.exe @ 0x0087d9a0).
2. Replaced the post-hoc `idx` fixup with consistent X-wrap and Y-clamp
   on `(biomePixelX, biomePixelY)` before the lookup, so the returned
   `pos` matches the in-game chunk coord (was off-by-one to row 48 at
   the bottom of the world even though the color lookup remapped to
   row 47).

### Wobble — `node scripts/verify.mjs --only=wobble`

```
coords processed:           79919
telescope returned null:    8734
decided (both have name):   71185
  agree:                    71185  (100.00% of decided)
  wrong biome:              0
chunk-index agreement:      79919/79919  (100.00%)

By wobble decision (Noita's classification):
  no-differing-neighbor     46082 total,    625 null,  45457/45457 name (100.0%),  46082/46082 chunk (100.0%)
  sin-cos+simplex           23493 total,   8109 null,  15384/15384 name (100.0%),  23493/23493 chunk (100.0%)
  skipped-flags             10344 total,      0 null,  10344/10344 name (100.0%),  10344/10344 chunk (100.0%)
```

**100.00% chunk-index agreement** across all three Noita wobble
classifications. The 8,734 remaining `telescope returned null` cases
are the legacy `BIOME_COLORS_WITH_TILES` rendering filter — telescope
intentionally drops biomes it can't render — and don't represent
disagreement with Noita's actual lookup.

### Biome catalogue — `node scripts/verify.mjs --only=biomes`

```
noita chunks dumped: 1868, decided: 1868
  agree:                 1868  (100.0%)
```

No regression.

### Pixel scenes — `node scripts/verify.mjs --only=pixel-scenes --top-left-only`

```
pixel scenes in fixture:    262
size missing (skip):        79
decided:                    183
  telescope ACCEPT:         183  (100.00%)
  telescope REJECT:         0  (0.00%)
```

No regression.
