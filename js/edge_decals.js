// Noita's EdgeGraphics decal pass, as a CPU overlay.
//
// When the engine paints a chunk it walks every fresh cell and, for the material's
// <EdgeGraphics> entry, may stamp a sprite from data/materials_gfx/edge_files
// across it — the mottled band along every rock/air border. The stamp goes
// straight into the cells' colors, which is why the game's material grid never
// shows it and telescope's terrain, drawn from material identity, had none of it.
//
//   GridWorld_GenerateOrLoadChunkContent @0x0073b040  (the per-cell scan + gate)
//   BiomeGen_StampEdgeDecalAtCell        @0x00721870  (type dispatch)
//   BiomeGen_StampEdgeSpritePattern      @0x0091fd50  (the blitter)
//   BiomeGen_StampEdgeSprite_PaintTexel  @0x0095c250  (the per-pixel paint rule)
//   BiomeGen_ComputeEdgeSurfaceNormal    @0x00920100  (the 16-ray normal)
// See reverse/noita docs/worldgen/cell_color_dressing.md.
//
// PLACEMENT IS NOT REPRODUCIBLE, AND CANNOT BE. Both engine stampers roll a
// single free-running stream — a thread-local Lehmer LCG at generation, the
// shared g_damageRng at runtime — so which cells get dressed depends on chunk
// generation order, thread scheduling and how many rolls other systems consumed
// before. Two loads of the same seed already differ from each other. What IS
// reproducible is the distribution, so this pass rolls a POSITION-SEEDED stream
// instead: a 32-bit integer hash of (world x, world y, world seed, entry, draw).
// Same seed and same rect always give the same decals, and density, band depth
// and palette match the game in aggregate — the best fidelity available in
// principle. Everything else below follows the binary.
//
// Two things worth knowing before reading the code, because they are what makes
// the band look right:
//
//   * do_only_horizontal_stripe / do_only_vertical_stripe (most of the temple and
//     steel sprites) do NOT blit the sprite. They blit a single 1px column (or
//     row) through it, indexed by the cell's WORLD coordinate — the band emerges
//     from neighbouring cells each drawing their own slice of one world-aligned
//     pattern. That is why the blitter is called PaintSpritePattern.
//   * overwrite="0" (every shipped entry) is enforced per destination cell: the
//     blitter marks each cell it paints by perturbing the low byte of its second
//     color slot, and refuses cells already marked. The first decal to reach a
//     cell wins, so a run of edge cells does not paint over each other.
import {
    EDGE_ATLAS_HEIGHT, EDGE_ATLAS_WIDTH, EDGE_ENTRIES_BY_MATERIAL, EDGE_IMAGES,
    MATERIAL_TYPE_BY_NAME,
} from './engine_resolve/edge_data.js';
import { BIOME_ENGINE, MATERIAL_NAMES_BY_ID } from './engine_resolve/engine_data.js';
import { resolveCellFull } from './engine_resolve/chunk_wobble.js';
import { SKIP_SEAM_EDGE_BIOMES } from './pixel_scene_edge_flags.js';

export const EDGE_TYPE_COLOR_EDGE_PIXELS = 0;
export const EDGE_TYPE_EVERYWHERE = 1;
export const EDGE_TYPE_CARDINAL_DIRECTIONS = 2;
export const EDGE_TYPE_NORMAL_BASED = 3;

const IMG_FLAG_RANDOM_ROTATION = 1;
const IMG_FLAG_HORIZONTAL_STRIPE = 2;
const IMG_FLAG_VERTICAL_STRIPE = 4;

const CHUNK = 512;
/** Cells this close to a chunk edge are skipped by the generation pass and
 *  dressed later, by the seam pass, once the neighbour chunks exist. */
const SEAM = 8;
/** Padding a caller must resolve around the rect it wants: the widest sprite
 *  reaches 20px, and a seam-band stamp can originate 8px outside. */
export const EDGE_DECAL_HALO = 32;

// ---------------------------------------------------------------------------
// material id -> entries / type class, resolved once from the generated tables
// ---------------------------------------------------------------------------
const ENTRIES_BY_ID = MATERIAL_NAMES_BY_ID.map(
    name => (name && EDGE_ENTRIES_BY_MATERIAL[name]) || null);
const TYPE_BY_ID = Int8Array.from(MATERIAL_NAMES_BY_ID.map(
    name => (name && MATERIAL_TYPE_BY_NAME[name]) ?? 0));

/** How far (Chebyshev) any stamp can paint from the cell that rolled it
 *  (blitEdgeSprite): a stripe image paints one column (horizontal stripe) or
 *  row (vertical) along its short side, any other image up to half its longer
 *  side (it may be transposed); plus the stripes' 1px nudge. A caller that
 *  crops the result (opts.inset) only needs cells within this of the kept rect
 *  scanned. */
const STAMP_REACH = 1 + EDGE_IMAGES.reduce((r, img) => {
    const iw = img[2], ih = img[3], flags = img[6];
    if (flags & IMG_FLAG_HORIZONTAL_STRIPE) return Math.max(r, ih >> 1);
    if (flags & IMG_FLAG_VERTICAL_STRIPE) return Math.max(r, iw >> 1);
    return Math.max(r, iw >> 1, ih >> 1);
}, 0);

// ---------------------------------------------------------------------------
// the seam-band gate: <Topology skip_edge_textures>, per chunk
// ---------------------------------------------------------------------------
// The biome flag (BiomeChunk+0xc7) turns off the SEAM pass and nothing else —
// not the generation-time interior pass, and not any pixel scene. The engine
// decides it once per chunk, from the biome resolved at the chunk paint rect's
// centre (ChunkGrid_ResolveChunkAtPosition, i.e. the same 42px-wobbled lookup
// the material field runs), so a chunk is gated as a whole even where the
// biome boundary cuts through it.
const NOISE_EDGES_BY_COLOR = new Map(
    BIOME_ENGINE.map(b => [b.color & 0xffffff, b.noiseBiomeEdges !== false]));
const seamHasEdgeNoise = (color) => NOISE_EDGES_BY_COLOR.get(color) !== false;

/**
 * Builds `(chunkOriginX, chunkOriginY) => boolean`, "is this chunk's seam band
 * suppressed", memoised per chunk. Returns null when no biome map was supplied,
 * which leaves the seam pass ungated (the pre-gate behaviour).
 *
 * @param {{pixels: ArrayLike<number>}} biomeData  the biome map, as
 *        js/engine_resolve/material_field.js reads it
 * @param {number} mapWidth  biome map width in chunks
 */
function makeSeamGate(biomeData, mapWidth) {
    if (!biomeData || !biomeData.pixels || !mapWidth) return null;
    const bmap = {
        w: mapWidth,
        colorAt: (cx, cy) => (biomeData.pixels[cy * mapWidth + cx] ?? 0) & 0xffffff,
    };
    const cache = new Map();
    const cell = {};
    return (chunkOriginX, chunkOriginY) => {
        const key = `${chunkOriginX},${chunkOriginY}`;
        let skip = cache.get(key);
        if (skip === undefined) {
            resolveCellFull(bmap, chunkOriginX + CHUNK / 2, chunkOriginY + CHUNK / 2,
                seamHasEdgeNoise, cell);
            skip = SKIP_SEAM_EDGE_BIOMES.has(cell.color);
            cache.set(key, skip);
        }
        return skip;
    };
}

// ---------------------------------------------------------------------------
// the sprite atlas (data/edge_atlas.bin, raw RGBA rows)
// ---------------------------------------------------------------------------
let _atlas = null;
let _loadPromise = null;

/** Installs already-fetched atlas bytes (node / worker callers). */
export function setEdgeDecalAtlas(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (data.length !== EDGE_ATLAS_WIDTH * EDGE_ATLAS_HEIGHT * 4) {
        throw new Error(`edge atlas size mismatch: ${data.length} bytes for ` +
            `${EDGE_ATLAS_WIDTH}x${EDGE_ATLAS_HEIGHT}`);
    }
    _atlas = data;
    return _atlas;
}

/** Kicks off (or returns) the one-time fetch of the sprite atlas. */
export function initEdgeDecalAtlas() {
    return _loadPromise ??= (async () => {
        const resp = await fetch(new URL('../data/edge_atlas.bin', import.meta.url));
        if (!resp.ok) throw new Error('edge atlas fetch failed');
        return setEdgeDecalAtlas(new Uint8Array(await resp.arrayBuffer()));
    })();
}

export function edgeDecalAtlasReady() {
    return _atlas !== null;
}

// ---------------------------------------------------------------------------
// position-seeded stream
// ---------------------------------------------------------------------------
// A 32-bit integer hash (the murmur3 finalizer over a mixed key). Nothing in the
// engine looks like this — its stream is sequential — so it is chosen for
// decorrelation across all five inputs, not for fidelity.
function hash32(x, y, seed, entry, draw) {
    let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^
        Math.imul(seed, 0x9e3779b1) ^ Math.imul(entry * 8 + draw, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
}
const rand01 = (h) => h / 4294967296;

// ---------------------------------------------------------------------------
const TWO_PI = Math.PI * 2;
const DEG = 180 / Math.PI;
const pmod = (v, m) => ((v % m) + m) % m;

/**
 * First image whose [min_angle, max_angle) contains `angle` (degrees), scanning
 * from a random start. The engine authors wrap-around as two images (315..360
 * plus 0..45) rather than letting a range cross zero, so no wrap handling here.
 * Returns -1 when nothing matches — the engine then stamps nothing.
 */
function pickAngleImage(images, angle, start) {
    for (let k = 0; k < images.length; k++) {
        const idx = images[(start + k) % images.length];
        const img = EDGE_IMAGES[idx];
        if (angle >= img[4] && angle < img[5]) return idx;
    }
    return -1;
}

// The 16 ray end offsets, computed once.
const RAY_OX = new Float64Array(16), RAY_OY = new Float64Array(16);
for (let i = 0; i < 16; i++) {
    const a = i * (Math.PI / 8);
    RAY_OX[i] = -5 * Math.sin(a);
    RAY_OY[i] = 5 * Math.cos(a);
}

/**
 * BiomeGen_ComputeEdgeSurfaceNormal @0x00920100 — 16 rays of length 5 from the
 * cell, each stopping at the first cell that does not match. The hits' directions
 * are summed NEGATED, so the result points into the material bulk, not out of it.
 * Returns the angle in degrees [0, 360), or -1 when no ray found an edge (the
 * engine stamps nothing then).
 */
function surfaceNormalAngle(mat, width, height, cx, cy, id, typeId, sameType) {
    let sumX = 0, sumY = 0, hits = 0;
    for (let i = 0; i < 16; i++) {
        const ox = RAY_OX[i], oy = RAY_OY[i];
        const dx = ox / 5, dy = oy / 5;
        let lastI = -1;
        for (let t = 1; t * t < 25; t++) {
            const px = Math.floor(cx + dx * t), py = Math.floor(cy + dy * t);
            if (px < 0 || py < 0 || px >= width || py >= height) break;
            const j = py * width + px;
            if (j === lastI) continue;
            lastI = j;
            const m = mat[j];
            const matches = m === id || (sameType && m > 0 && TYPE_BY_ID[m] === typeId);
            if (matches) continue;
            hits++;
            sumX -= ox;
            sumY -= oy;
            break;
        }
    }
    if (!hits) return -1;
    const len = Math.sqrt(sumX * sumX + sumY * sumY);
    if (len === 0) return 0;
    return pmod(Math.atan2(sumY / len, sumX / len), TWO_PI) * DEG;
}

/**
 * The CARDINAL_DIRECTIONS angle: which full row or column of the 3x3 mask is
 * present, in the binary's priority order. Degrees [0, 360), pointing into the
 * material like the normal above.
 */
function cardinalAngle(m, count) {
    if (count > 7) return 0;
    if (m[0] && m[3] && m[6]) return 180;                 // left column full
    if (m[0] && m[1] && m[2]) return 270;                 // top row full (-pi/2)
    if (m[6] && m[7] && m[8]) return 90;                  // bottom row full
    return 0;                                             // right column, or none
}

/**
 * Stamps the decals a world rect's terrain carries.
 *
 * @param {Int16Array} mat  material ids, row-major over the WHOLE padded rect
 *                          (0 = air, -1 = unresolved; see material_field.js)
 * @param {number} width    padded rect width
 * @param {number} height   padded rect height
 * @param {number} originX  world x of column 0
 * @param {number} originY  world y of row 0
 * @param {number} worldSeed
 * @param {{chunkShiftX?: number, chunkShiftY?: number, scenes?: Array<object>,
 *          biomeData?: object, mapWidth?: number, inset?: number}} [opts]
 *        chunkShiftX/Y: world coordinate of a chunk boundary, mod 512 (the biome
 *        grid's x_shift / y_shift). scenes: pixel-scene material grids
 *        (pixelSceneMaterialGrid) overlapping the rect, in paint order — each
 *        runs the engine's scene-time decal pass after the terrain passes.
 *        biomeData + mapWidth: the biome map, which gates the seam pass per
 *        chunk (SKIP_SEAM_EDGE_BIOMES); omit them to leave the seam ungated.
 *        inset: the caller keeps only the rect inset this far on every side
 *        (the halo it crops off); cells whose stamps cannot reach it are not
 *        scanned, and the output outside it is then incomplete.
 * @returns {Uint8ClampedArray} RGBA over the padded rect; composite it over the
 *          terrain with plain source-over, after cropping the halo off.
 */
export function stampEdgeDecals(mat, width, height, originX, originY, worldSeed, opts = {}) {
    const out = new Uint8ClampedArray(width * height * 4);
    if (!_atlas) return out;
    // Marks every cell a decal has already painted. overwrite="0" makes the
    // blitter refuse those, so the first stamp to reach a cell wins.
    const painted = new Uint8Array(width * height);
    const shiftX = opts.chunkShiftX || 0;
    const shiftY = opts.chunkShiftY || 0;
    const mask = new Uint8Array(9);
    // The scan window [x0, x1) x [y0, y1): every cell with a full 3x3, less
    // those too far from the kept rect for any stamp of theirs to reach it.
    const scanMargin = Math.max(1, (opts.inset || 0) - STAMP_REACH);
    const win = {
        x0: scanMargin, x1: Math.max(scanMargin, width - scanMargin),
        y0: scanMargin, y1: Math.max(scanMargin, height - scanMargin),
    };

    // Chunk-local coordinates and seam-band membership, per column and row.
    const localXs = new Int32Array(width), localYs = new Int32Array(height);
    const seamXs = new Uint8Array(width), seamYs = new Uint8Array(height);
    for (let x = 0; x < width; x++) {
        const lx = pmod(originX + x + shiftX, CHUNK);
        localXs[x] = lx;
        seamXs[x] = (lx < SEAM || lx >= CHUNK - SEAM) ? 1 : 0;
    }
    for (let y = 0; y < height; y++) {
        const ly = pmod(originY + y + shiftY, CHUNK);
        localYs[y] = ly;
        seamYs[y] = (ly < SEAM || ly >= CHUNK - SEAM) ? 1 : 0;
    }

    // The cells that can stamp at all, found once in a tight pass: solid, of a
    // material with edge entries, and not interior -- the outer gate: a cell
    // with 8 or 9 same-material cells in its 3x3 (itself included, so 7 or 8
    // matching neighbours) never stamps, whatever the entry says. Most of a
    // tile is air or interior, so the two passes below walk these lists (in
    // scan order, split by pass) instead of the whole rect.
    const genCells = new Int32Array((win.x1 - win.x0) * (win.y1 - win.y0));
    const seamCells = new Int32Array(genCells.length);
    let nGen = 0, nSeam = 0;
    for (let y = win.y0; y < win.y1; y++) {
        const row = y * width;
        const seamY = seamYs[y];
        for (let x = win.x0; x < win.x1; x++) {
            const i = row + x;
            const id = mat[i];
            if (id <= 0 || !ENTRIES_BY_ID[id]) continue;
            let same = 0;
            if (mat[i - 1] === id) same++;
            if (mat[i + 1] === id) same++;
            if (mat[i - width] === id) same++;
            if (mat[i + width] === id) same++;
            if (mat[i - width - 1] === id) same++;
            if (mat[i - width + 1] === id) same++;
            if (mat[i + width - 1] === id) same++;
            if (mat[i + width + 1] === id) same++;
            if (same >= 7) continue;
            if ((seamY | seamXs[x]) === 1) seamCells[nSeam++] = i;
            else genCells[nGen++] = i;
        }
    }

    // The generation pass skips the chunk's outer 8px and clips every stamp to
    // its own chunk; the seam pass dresses that band later, once the neighbour
    // chunks exist, and can therefore stamp across the boundary. Only the seam
    // pass answers to the biome's <Topology skip_edge_textures>.
    const seamGate = makeSeamGate(opts.biomeData, opts.mapWidth);
    for (let pass = 0; pass < 2; pass++) {
        const cells = pass === 0 ? genCells : seamCells;
        const n = pass === 0 ? nGen : nSeam;
        for (let c = 0; c < n; c++) {
            const i = cells[c];
            const y = (i / width) | 0;
            const x = i - y * width;
            const localX = localXs[x], localY = localYs[y];
            // The gate belongs to the chunk the cell lives in, whichever
            // side of the border the stamp then reaches.
            if (pass === 1 && seamGate &&
                seamGate(originX + x - localX, originY + y - localY)) continue;

            const id = mat[i];
            const entries = ENTRIES_BY_ID[id];

            // The 3x3 masks and their counts, centre included.
            const typeId = TYPE_BY_ID[id];
            let matCount = 0, typeCount = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const m = mat[i + dy * width + dx];
                    const k = (dy + 1) * 3 + (dx + 1);
                    // bit 0 = same material type, bit 1 = same material
                    if (m === id) { matCount++; typeCount++; mask[k] = 3; }
                    else if (m > 0 && TYPE_BY_ID[m] === typeId) { typeCount++; mask[k] = 1; }
                    else mask[k] = 0;
                }
            }

            const wx = originX + x, wy = originY + y;
            for (let e = 0; e < entries.length; e++) {
                const [type, percent, overwrite, reqSameMat, reqSameType, colorARGB, images] = entries[e];
                // The roll always happens, before any gate.
                if (rand01(hash32(wx, wy, worldSeed, e, 0)) > percent) continue;

                // The inner gate, types 0/1/2 only: the 4-neighbourhood of the
                // chosen mask must hold 2 or 3 — an interior cell has 4.
                if (type !== EDGE_TYPE_NORMAL_BASED && (reqSameMat || reqSameType)) {
                    const bit = reqSameMat ? 1 : 0;
                    const s = ((mask[1] >> bit) & 1) + ((mask[3] >> bit) & 1) +
                        ((mask[5] >> bit) & 1) + ((mask[7] >> bit) & 1);
                    if (s !== 2 && s !== 3) continue;
                }

                let image, angle = 0;
                if (type === EDGE_TYPE_EVERYWHERE) {
                    const r = rand01(hash32(wx, wy, worldSeed, e, 1));
                    image = images[Math.min(images.length - 1, (r * images.length) | 0)];
                } else if (type === EDGE_TYPE_CARDINAL_DIRECTIONS || type === EDGE_TYPE_NORMAL_BASED) {
                    if (type === EDGE_TYPE_NORMAL_BASED) {
                        angle = surfaceNormalAngle(mat, width, height, x, y, id, typeId, !!reqSameType);
                        if (angle < 0) continue;
                    } else if (reqSameMat) {
                        angle = cardinalAngle(bitMask(mask, 1), matCount);
                    } else {
                        angle = cardinalAngle(bitMask(mask, 0), typeCount);
                    }
                    const start = hash32(wx, wy, worldSeed, e, 1) % images.length;
                    image = pickAngleImage(images, angle, start);
                    if (image < 0) continue;
                } else if (type === EDGE_TYPE_COLOR_EDGE_PIXELS) {
                    const a = (colorARGB >>> 24) & 0xff;
                    if (!a || (!overwrite && painted[i])) continue;
                    const o = i * 4;
                    out[o] = (colorARGB >>> 16) & 0xff;
                    out[o + 1] = (colorARGB >>> 8) & 0xff;
                    out[o + 2] = colorARGB & 0xff;
                    out[o + 3] = a;
                    painted[i] = 1;
                    continue;
                } else {
                    continue;
                }

                // Types 2 and 3 nudge the stamp by a pixel for the stripe
                // images, depending on which quadrant the angle is in.
                let sx = x, sy = y;
                const flags = EDGE_IMAGES[image][6];
                if (type !== EDGE_TYPE_EVERYWHERE &&
                    (flags & (IMG_FLAG_HORIZONTAL_STRIPE | IMG_FLAG_VERTICAL_STRIPE))) {
                    if (angle >= 135 && angle < 225) sx += 1;
                    else if (angle >= 225 && angle < 315) sy += 1;
                }

                let flip = 0;
                let transpose = false;
                if (flags & IMG_FLAG_RANDOM_ROTATION) {
                    if (rand01(hash32(wx, wy, worldSeed, e, 2)) > 0.5) flip |= 1;
                    if (rand01(hash32(wx, wy, worldSeed, e, 3)) > 0.5) flip |= 2;
                    transpose = rand01(hash32(wx, wy, worldSeed, e, 4)) > 0.5;
                }
                blitEdgeSprite(out, painted, mat, width, height, sx, sy, id, overwrite,
                    image, flip, transpose,
                    pass === 0 ? [localX + sx - x, localY + sy - y] : null,
                    originX + sx, originY + sy);
            }
        }
    }
    // The engine paints pixel scenes on the main thread, after chunk generation,
    // and each scene runs its own decal pass over its cells
    // (PixelScene_TryPaintEntry @0x00880fb0 -> BiomeMaterials_PaintEdgeMaterial
    // @0x00721da0). Writing a scene cell replaces the generated cell — and with
    // it any decal the terrain pass had baked there — so the overlay first
    // erases stamps under every pixel the scene paints or force-airs, then runs
    // the scene-local pass. `mat` is mutated into the post-scene composite,
    // which is what later scenes and their type-3 normals must see.
    //
    // The colors image does two separate things, and only one of them is the
    // per-scene gate in sceneStampsAnyEdge. The other is PER CELL and permanent:
    // the row painter gives a covered cell its color straight from the image
    // (Cell::SetColor, vf+0x1c) WITHOUT touching the cell's base color (vf+0x24),
    // and every stamper's overwrite="0" test is exactly `base == current`
    // (BiomeGen_StampEdgeSprite_PaintTexel @0x0095c250 step 5). A recoloured cell
    // therefore fails that test forever — no terrain stamp, no scene stamp, no
    // later scene's stamp can land on it — which is why the dragon egg
    // (data/biome_impl/dragoncave.png, wholly covered by dragoncave_visual.png)
    // stays clean while the same scene's uncovered rock_hard walls are dressed.
    // Live BAKEDUMP of the dragoncave chunk (2048,7168 512x512, seed 786433191):
    // all 29,787 covered rock_static cells are byte-exact the visual image, and
    // 5,802 of the 47,620 uncovered rock_hard cells carry a decal.
    // The overlay below models that by entering covered cells as pre-painted.
    if (opts.scenes) {
        if (opts.stats) {
            let a = 0; for (let i = 3; i < out.length; i += 4) if (out[i]) a++;
            opts.stats.terrainStamped = a;
        }
        for (const scene of opts.scenes) {
            stampSceneDecals(out, painted, mat, width, height, originX, originY, worldSeed, scene, win);
        }
        if (opts.stats) {
            let a = 0; for (let i = 3; i < out.length; i += 4) if (out[i]) a++;
            opts.stats.afterScenes = a;
            let cells = 0; for (const s of opts.scenes) for (const v of s.grid) if (v !== SCENE_UNTOUCHED) cells++;
            opts.stats.sceneCells = cells;
        }
    }
    return out;
}

/** pixelSceneMaterialGrid's "the world cell under this pixel stays" value. */
const SCENE_UNTOUCHED = -2;

/**
 * The engine's OTHER scene gate, and the one that decides most scenes.
 *
 * PixelScene_TryPaintEntry runs the edge pass only when PixelScenePaintState
 * +0x1e8 is positive, and the row painter (PixelScene_PaintRowsLambdaBody
 * @0x00880860) increments that counter once per created cell that is BOTH
 * outside the colors_filename image's opaque area AND of a material the
 * EdgeGraphics registry knows. A cell the colors image covers takes its color
 * from that image instead (Cell::SetColor) and never counts.
 *
 * The counter is per SCENE, so the decision is all-or-nothing: a scene whose
 * `_visual.png` covers every edge-capable cell it paints runs no edge pass at
 * all, and one uncovered cell turns the whole pass on for every qualifying cell
 * — covered ones included. That, not `skip_edge_textures`, is why the game
 * leaves general/essenceroom undressed: its LoadPixelScene omits argument 7 (so
 * the flag really is false), but essenceroom_visual.png is opaque over 27,348 of
 * the 27,349 material pixels, and the one it misses is the 0xff31d0b4 spawn
 * marker, which creates no cell.
 *
 * The mask counts a pixel as covered at alpha >= 128 where the engine counts any
 * non-zero alpha; every shipped colors image is opaque where it paints, so the
 * two have not been observed to differ.
 *
 * Memoised on the grid, which the callers cache per scene placement.
 */
function sceneStampsAnyEdge(scene) {
    if (scene.edgeEligible !== undefined) return scene.edgeEligible;
    const { grid, artMask, width: sw, height: sh } = scene;
    let any = false;
    for (let p = 0; p < sw * sh; p++) {
        const id = grid[p];
        // <= 0 is a pixel that creates no cell: untouched world, or forced air.
        if (id <= 0) continue;
        if (artMask && (artMask[p >> 3] & (0x80 >> (p & 7)))) continue;
        if (ENTRIES_BY_ID[id]) { any = true; break; }
    }
    scene.edgeEligible = any;
    return any;
}

/**
 * The scene painter's own decal pass, per the binary:
 *   - runs AFTER the scene's cells are written (so first the overlay: scene
 *     pixels replace `mat`, and any terrain-pass stamp under them is cleared);
 *   - scans the scene rect INSET 1px on all sides — not the chunk pass's 8px;
 *   - its neighbour context is the SCENE-LOCAL grid: scene cells plus the
 *     pre-existing world cells at transparent scene pixels. A cell outside the
 *     scene rect is NO CELL to the masks, whatever the world holds there;
 *   - pre-existing world cells inside the rect are stamp targets too;
 *   - type-3 normals and the blit's destination check read the LIVE world
 *     (the composite `mat`), exactly like the runtime stamper;
 *   - is skipped entirely when the scene sets `skip_edge_textures`, and equally
 *     when its colors image covers every edge-capable cell it paints
 *     (sceneStampsAnyEdge above) — the erase still happens either way, so such a
 *     scene reads as undressed rather than as terrain.
 * Rolls are salted so they decorrelate from the terrain pass at the same
 * coordinates — the engine's two passes consume independent RNG streams.
 */
function stampSceneDecals(out, painted, mat, width, height, originX, originY, worldSeed, scene, win) {
    const { grid, width: sw, height: sh } = scene;
    const baseX = scene.x - originX, baseY = scene.y - originY;
    if (baseX + sw <= 0 || baseY + sh <= 0 || baseX >= width || baseY >= height) return;

    // The overlay: everything the scene paints (or erases) replaces the world.
    // A cell the colors image covers comes out of the row painter already
    // recoloured, which permanently marks it "stamped" — see the note above
    // stampEdgeDecals' scene block — so it enters this pass pre-painted and no
    // decal can ever land on it.
    const artMask = scene.artMask;
    const ox0 = Math.max(0, -baseX), ox1 = Math.min(sw, width - baseX);
    const oy0 = Math.max(0, -baseY), oy1 = Math.min(sh, height - baseY);
    for (let ly = oy0; ly < oy1; ly++) {
        const srow = ly * sw, trow = (baseY + ly) * width + baseX;
        for (let lx = ox0; lx < ox1; lx++) {
            const p = srow + lx;
            const v = grid[p];
            if (v === SCENE_UNTOUCHED) continue;
            const i = trow + lx;
            mat[i] = v;
            painted[i] = (v > 0 && artMask !== null && artMask !== undefined &&
                (artMask[p >> 3] & (0x80 >> (p & 7))) !== 0) ? 1 : 0;
            const o = i * 4;
            out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
        }
    }

    // A scene whose pass is off stops here: its cells replaced the terrain (and
    // every stamp the terrain pass had baked under them), but the painter runs
    // no decal pass of its own.
    if (scene.skipEdges || !sceneStampsAnyEdge(scene)) return;

    // The scene-local neighbour rule: outside the scene rect there is no cell.
    // The scan below is inset 1px into the rect, so every 3x3 neighbour lies
    // inside it, where `mat` already holds the composite (scene cell, or the
    // world cell a transparent pixel kept) -- the rule never has to answer
    // "no cell", and the masks read `mat` directly.

    const sceneSeed = (worldSeed ^ 0x53434e45) | 0;   // 'SCNE'
    const mask = new Uint8Array(9);
    const sy0 = Math.max(1, win.y0 - baseY), sy1 = Math.min(sh - 1, win.y1 - baseY);
    const sx0 = Math.max(1, win.x0 - baseX), sx1 = Math.min(sw - 1, win.x1 - baseX);
    for (let ly = sy0; ly < sy1; ly++) {
        const ty = baseY + ly;
        for (let lx = sx0; lx < sx1; lx++) {
            const tx = baseX + lx;
            const i = ty * width + tx;
            const id = mat[i];
            if (id <= 0) continue;
            const entries = ENTRIES_BY_ID[id];
            if (!entries) continue;
            // Interior cells (matCount >= 8 below) are most of a scene; reject
            // them before building the masks.
            let same = 0;
            if (mat[i - 1] === id) same++;
            if (mat[i + 1] === id) same++;
            if (mat[i - width] === id) same++;
            if (mat[i + width] === id) same++;
            if (mat[i - width - 1] === id) same++;
            if (mat[i - width + 1] === id) same++;
            if (mat[i + width - 1] === id) same++;
            if (mat[i + width + 1] === id) same++;
            if (same >= 7) continue;

            const typeId = TYPE_BY_ID[id];
            let matCount = 0, typeCount = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const m = mat[i + dy * width + dx];
                    const k = (dy + 1) * 3 + (dx + 1);
                    if (m === id) { matCount++; typeCount++; mask[k] = 3; }
                    else if (m > 0 && TYPE_BY_ID[m] === typeId) { typeCount++; mask[k] = 1; }
                    else mask[k] = 0;
                }
            }
            if (matCount >= 8) continue;

            const wx = originX + tx, wy = originY + ty;
            for (let e = 0; e < entries.length; e++) {
                const [type, percent, overwrite, reqSameMat, reqSameType, colorARGB, images] = entries[e];
                if (rand01(hash32(wx, wy, sceneSeed, e, 0)) > percent) continue;

                if (type !== EDGE_TYPE_NORMAL_BASED && (reqSameMat || reqSameType)) {
                    const bit = reqSameMat ? 1 : 0;
                    const s = ((mask[1] >> bit) & 1) + ((mask[3] >> bit) & 1) +
                        ((mask[5] >> bit) & 1) + ((mask[7] >> bit) & 1);
                    if (s !== 2 && s !== 3) continue;
                }

                let image, angle = 0;
                if (type === EDGE_TYPE_EVERYWHERE) {
                    const r = rand01(hash32(wx, wy, sceneSeed, e, 1));
                    image = images[Math.min(images.length - 1, (r * images.length) | 0)];
                } else if (type === EDGE_TYPE_CARDINAL_DIRECTIONS || type === EDGE_TYPE_NORMAL_BASED) {
                    if (type === EDGE_TYPE_NORMAL_BASED) {
                        angle = surfaceNormalAngle(mat, width, height, tx, ty, id, typeId, !!reqSameType);
                        if (angle < 0) continue;
                    } else if (reqSameMat) {
                        angle = cardinalAngle(bitMask(mask, 1), matCount);
                    } else {
                        angle = cardinalAngle(bitMask(mask, 0), typeCount);
                    }
                    const start = hash32(wx, wy, sceneSeed, e, 1) % images.length;
                    image = pickAngleImage(images, angle, start);
                    if (image < 0) continue;
                } else if (type === EDGE_TYPE_COLOR_EDGE_PIXELS) {
                    const a = (colorARGB >>> 24) & 0xff;
                    if (!a || (!overwrite && painted[i])) continue;
                    const o = i * 4;
                    out[o] = (colorARGB >>> 16) & 0xff;
                    out[o + 1] = (colorARGB >>> 8) & 0xff;
                    out[o + 2] = colorARGB & 0xff;
                    out[o + 3] = a;
                    painted[i] = 1;
                    continue;
                } else {
                    continue;
                }

                let cx = tx, cy = ty;
                const flags = EDGE_IMAGES[image][6];
                if (type !== EDGE_TYPE_EVERYWHERE &&
                    (flags & (IMG_FLAG_HORIZONTAL_STRIPE | IMG_FLAG_VERTICAL_STRIPE))) {
                    if (angle >= 135 && angle < 225) cx += 1;
                    else if (angle >= 225 && angle < 315) cy += 1;
                }

                let flip = 0;
                let transpose = false;
                if (flags & IMG_FLAG_RANDOM_ROTATION) {
                    if (rand01(hash32(wx, wy, sceneSeed, e, 2)) > 0.5) flip |= 1;
                    if (rand01(hash32(wx, wy, sceneSeed, e, 3)) > 0.5) flip |= 2;
                    transpose = rand01(hash32(wx, wy, sceneSeed, e, 4)) > 0.5;
                }
                // The runtime stamper never clips to a chunk (it paints any
                // resident cell), so no chunkLocal here.
                blitEdgeSprite(out, painted, mat, width, height, cx, cy, id, overwrite,
                    image, flip, transpose, null, originX + cx, originY + cy);
            }
        }
    }
}

/** The 3x3 mask as 0/1 for one of the two equivalence tests. */
const _bits = new Uint8Array(9);
function bitMask(mask, bit) {
    for (let k = 0; k < 9; k++) _bits[k] = (mask[k] >> bit) & 1;
    return _bits;
}

/**
 * BiomeGen_StampEdgeSpritePattern @0x0091fd50. Four mutually exclusive shapes:
 * a 1px column or row through the sprite indexed by the world coordinate (the
 * stripe flags), a transposed full blit, or a plain full blit — all centred on
 * the cell with a truncating half-size.
 *
 * `chunkLocal` is [localX, localY] on the generation pass, which clips the stamp
 * to the 512x512 chunk it belongs to; null on the seam pass, which does not clip.
 */
function blitEdgeSprite(out, painted, mat, width, height, cx, cy, id, overwrite,
    image, flip, transpose, chunkLocal, worldX, worldY) {
    const img = EDGE_IMAGES[image];
    const ax = img[0], ay = img[1], iw = img[2], ih = img[3], flags = img[6];
    const atlas = _atlas;
    // The rect a texel may land in: the padded tile, intersected with the
    // stamp's own chunk on the generation pass (chunkLocal = the cell's
    // chunk-local coordinates, so the chunk spans [c - local, c - local + CHUNK)).
    let minX = 0, minY = 0, maxX = width - 1, maxY = height - 1;
    if (chunkLocal) {
        minX = Math.max(minX, cx - chunkLocal[0]);
        maxX = Math.min(maxX, cx - chunkLocal[0] + CHUNK - 1);
        minY = Math.max(minY, cy - chunkLocal[1]);
        maxY = Math.min(maxY, cy - chunkLocal[1] + CHUNK - 1);
    }

    // The destination rect (ox, oy, w, h) and how a destination cell maps back
    // to a sprite texel: sx = fixSx (stripe) or dx - ox, sy likewise; transposed
    // swaps the two. Every destination cell is written at most once per blit,
    // so the scan order does not change the result.
    let ox, oy, w, h, fixSx = -1, fixSy = -1;
    if (flags & IMG_FLAG_HORIZONTAL_STRIPE) {
        ox = cx; oy = cy - Math.floor(ih * 0.5); w = 1; h = ih;
        fixSx = pmod(worldX, iw);
        transpose = false;
    } else if (flags & IMG_FLAG_VERTICAL_STRIPE) {
        ox = cx - Math.floor(iw * 0.5); oy = cy; w = iw; h = 1;
        fixSy = pmod(worldY, ih);
        transpose = false;
    } else if (transpose) {
        ox = cx - ((ih / 2) | 0); oy = cy - ((iw / 2) | 0); w = ih; h = iw;
    } else {
        ox = cx - ((iw / 2) | 0); oy = cy - ((ih / 2) | 0); w = iw; h = ih;
    }
    const x0 = Math.max(ox, minX), x1 = Math.min(ox + w - 1, maxX);
    const y0 = Math.max(oy, minY), y1 = Math.min(oy + h - 1, maxY);
    const flipX = (flip & 1) !== 0, flipY = (flip & 2) !== 0;
    for (let dy = y0; dy <= y1; dy++) {
        const row = dy * width;
        for (let dx = x0; dx <= x1; dx++) {
            const di = row + dx;
            if (mat[di] !== id) continue;
            if (!overwrite && painted[di]) continue;
            let sx, sy;
            if (transpose) { sx = dy - oy; sy = dx - ox; }
            else {
                sx = fixSx >= 0 ? fixSx : dx - ox;
                sy = fixSy >= 0 ? fixSy : dy - oy;
            }
            const fx = flipX ? iw - 1 - sx : sx;
            const fy = flipY ? ih - 1 - sy : sy;
            const so = ((ay + fy) * EDGE_ATLAS_WIDTH + ax + fx) * 4;
            // The engine skips only an all-zero texel word, alpha included.
            const a = atlas[so + 3];
            if (!a && !atlas[so] && !atlas[so + 1] && !atlas[so + 2]) continue;
            const o = di * 4;
            out[o] = atlas[so];
            out[o + 1] = atlas[so + 1];
            out[o + 2] = atlas[so + 2];
            out[o + 3] = a;
            painted[di] = 1;
        }
    }
}
