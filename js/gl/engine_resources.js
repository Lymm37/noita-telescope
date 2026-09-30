// GL engine-faithful terrain resolve — CPU-side resource build.
//
// Packs the committed engine tables (js/engine_resolve/engine_data.js) and the
// lattice built from telescope's own layers (lattice_builder.js) into the
// texture-shaped arrays the engine branch of the terrain shader samples.
//
// Layouts (all consumed with texelFetch, NEAREST, no filtering):
//   engChunk  R16UI  mapW x 48       bits 0-7 biome slot, 8-9 mode
//                                    (0 topo0, 1 topo2, 2 fallback),
//                                    bit 10 noise_biome_edges,
//                                    bit 11 the generator paints nothing here
//                                    (BIOME_ENGINE.paintsNothing — a
//                                    BIOME_WANG_TILE biome with an empty
//                                    wang_template_file)
//   engTable  RGBA32F 512 x (n+1)    buildEngineTable — per-biome band table
//                                    (cols 0..47: header texel + 5 texels/band),
//                                    topology-0 params (cols 48..53), and the
//                                    wang sampler params by material id (last row)
//       band flagBits: 1 limY, 2 addPerlin, 4 rare, 8 rare.perlin,
//                      16 rare.polka, 32 rare.boxed
//   matColor  row 1 of u_matMetaTex  atlasEntry, r, g, b (engine ABGR display
//                                    color) by material id (buildMatColorTable)
import {
    BIOME_ENGINE, MATERIAL_FLAT_ALPHA_BY_ID, MATERIAL_FLAT_RGB_BY_ID, MATERIAL_NAMES_BY_ID, WANG_PARAMS_BY_ID,
} from '../engine_resolve/engine_data.js';
import { CAVES_SETUP, getModifierGrid, bitmapNoiseNodeOffset } from '../engine_resolve/bitmap_caves.js';
import { buildEngineLattice } from '../engine_resolve/lattice_builder.js';
import { FILL_LAYER_COLORS } from '../generator_config.js';
import { BIOME_MAP_HEIGHT } from './indirection.js';
import { atlasEntryMeanAlpha, atlasEntryMeanRGB } from './material_atlas.js';

export const ENGINE_MODE_TOPO0 = 0;
export const ENGINE_MODE_TOPO2 = 1;
export const ENGINE_MODE_FALLBACK = 2;

const SLOT_BY_COLOR = new Map(BIOME_ENGINE.map((b, i) => [b.color, i]));

// Per-seed surface-noise X phase (BiomeGrid+0x48): MINSTD halves the seed once
// if >= 2147483646, then ctor + 2 draws; the third state maps to
// [-100000, 100000) with FLOAT32 unit-scale rounding (live-verified 34084.625
// for seed 786433191 — plain double or whole-result rounding are both wrong).
function minstdNext(s) {
    const v = BigInt(Math.floor(s));
    let r = 16807n * v - 2147483647n * (v / 127773n);
    if (r <= 0n) r += 2147483647n;
    return Number(r);
}
export function surfaceNoisePhase(worldSeed) {
    let s = worldSeed;
    if (s >= 2147483646.0) s = s * 0.5;
    s = minstdNext(s);
    s = minstdNext(s);
    s = minstdNext(s);
    return Math.fround(Math.fround(s * 2 ** -31) * 200000.0) - 100000.0;
}

/** mapW x 48 R16UI chunk table + the lattice planes. */
export function buildEngineResources(layers, biomeData, generatorConfig, mapWidth) {
    const mapHeight = BIOME_MAP_HEIGHT;
    const lattice = buildEngineLattice(layers, generatorConfig, mapWidth, mapHeight);
    const chunk = new Uint16Array(mapWidth * mapHeight);
    for (let i = 0; i < chunk.length; i++) {
        const color = (biomeData.pixels[i] ?? 0) & 0xffffff;
        const slot = SLOT_BY_COLOR.get(color);
        const b = slot !== undefined ? BIOME_ENGINE[slot] : null;
        // A topology-0 biome with no <MaterialComponent> keeps the ctor's empty
        // BiomeMaterials (setMin=+FLT_MAX, setMax=-FLT_MAX — live-PEEKed on
        // temple_wall), so its pre-gate can never pass and the engine paints
        // nothing in its chunk. The holy mountain's brick is a pixel scene, not
        // the generator's output; telescope does not stamp that scene and stands
        // in for it with a constant fill instead (FILL_LAYER_MATERIALS,
        // temple_wall -> templebrick_static). Hand those chunks to the legacy
        // pipeline so the stand-in survives — answering "air" from the engine pass
        // left the whole Holy Mountain basin empty. Without a stand-in fill there
        // is nothing to defer to, so keep the engine's own "air" (which also keeps
        // the legacy wobble from dragging a neighbour's fill in, below).
        const enginePaintsNothing = !!b && (b.paintsNothing || (b.topo === 0 && b.bands.length === 0));
        const deferToFill = enginePaintsNothing && !b.paintsNothing && FILL_LAYER_COLORS.has(color);
        let mode = ENGINE_MODE_FALLBACK;
        if (b && b.supported && !deferToFill) {
            if (b.topo === 2) mode = lattice.chunkCovered[i] ? ENGINE_MODE_TOPO2 : ENGINE_MODE_FALLBACK;
            else mode = ENGINE_MODE_TOPO0;
        }
        // `paintsNothing`: a BIOME_WANG_TILE biome with an empty wang_template_file.
        // ProceduralTerrain_Init @0x0087a900 builds a wang region — and with it the
        // covergrid the topology-2 resolve samples — only for
        // `Biome+0x04 == 2 && wang_template_file.size() != 0`, so these biomes get
        // no covergrid, generate no terrain, and are entirely their biome lua's
        // stamped pixel scene (rock_room's room, watercave_layout_N, mountain/hall,
        // and roadblock's fully transparent data/biome_impl/roadblock.png).
        //
        // Flagging the chunk matters twice over: the engine pass must not paint its
        // (demoted, meaningless) topology-0 density, and the legacy fallback must not
        // re-resolve the biome with the CPU pipeline's own edge-noise rules — where
        // the two wobbles disagree that lands on a NEIGHBOUR's chunk and paints its
        // fill over the room's air. The same guard covers every other chunk the
        // engine has no terrain for, unless a stand-in fill is deferring to the
        // legacy pipeline on purpose (deferToFill above).
        chunk[i] = (slot ?? 0) | (mode << 8) | ((b && b.noiseBiomeEdges) ? 1 << 10 : 0)
            | ((enginePaintsNothing && !deferToFill) ? 1 << 11 : 0);
    }
    return { lattice, chunk, width: mapWidth, height: mapHeight };
}

const BIG = 1e30;

// One RGBA32F texture holds every per-biome parameter table plus the wang
// sampler params, to stay inside the 16-sampler WebGL2 minimum:
//   rows 0..nBiomes-1:  cols 0..47  band table (header texel + 5 texels/band)
//                       cols 48..53 topology-0 params
//   row  nBiomes:       cols 0..511 wang params by material id (scale, thr, type)
export const ENG_TOPO0_COL = 48;

export function buildEngineTable(worldSeed = 0) {
    const W = 512, H = BIOME_ENGINE.length + 1;
    const t = new Float32Array(W * H * 4);
    const KIND = { none: 0, const: 1, empty: 2, grid: 3 };
    for (let s = 0; s < BIOME_ENGINE.length; s++) {
        const b = BIOME_ENGINE[s];
        const row = s * W * 4;
        t[row] = b.setMin; t[row + 1] = b.setMax; t[row + 2] = b.bands.length;
        b.bands.forEach((c, i) => {
            const o = row + (1 + i * 5) * 4;
            t[o] = c.min; t[o + 1] = c.max;
            t[o + 2] = c.limY ? c.limY[0] : -BIG; t[o + 3] = c.limY ? c.limY[1] : BIG;
            let flags = 0;
            if (c.limY) flags |= 1;
            if (c.addP) flags |= 2;
            if (c.rare) {
                flags |= 4;
                if (c.rare.perlin) flags |= 8;
                if (c.rare.polka) flags |= 16;
                if (c.rare.boxed) flags |= 32;
            }
            t[o + 4] = c.mat; t[o + 5] = flags;
            t[o + 6] = c.addP ? c.addP[0] : 0; t[o + 7] = c.addP ? c.addP[1] : 0;
            const r = c.rare;
            t[o + 8] = r ? r.sx : 0; t[o + 9] = r ? r.sy : 0;
            t[o + 10] = r ? r.ox : 0; t[o + 11] = r ? r.oy : 0;
            t[o + 12] = r ? r.plo : 0; t[o + 13] = r ? r.phi : 0;
            t[o + 14] = r ? r.prob : 0; t[o + 15] = r ? r.rmin : 0;
            t[o + 16] = r ? r.rmax : 0;
        });
        const c = b.t0;
        const o = row + ENG_TOPO0_COL * 4;
        t[o] = c.edge; t[o + 1] = c.startY; t[o + 2] = c.endY; t[o + 3] = c.freq;
        t[o + 4] = c.low; t[o + 5] = c.high; t[o + 6] = c.slopeStartX; t[o + 7] = c.slopeDelta;
        t[o + 8] = c.multGradient; t[o + 9] = c.multPerlin; t[o + 10] = c.insideAddValue; t[o + 11] = c.noiseType;
        t[o + 12] = c.insideScaleX; t[o + 13] = c.insideScaleY; t[o + 14] = c.insideOffX; t[o + 15] = c.insideOffY;
        t[o + 16] = (c.insideFBM ? 1 : 0) | (c.insideSquared ? 2 : 0) | (c.insideClamped ? 4 : 0) | (c.insideScaled ? 8 : 0);
        t[o + 17] = c.insideScaleMin; t[o + 18] = c.insideScaleMax;
        // mInsideNoiseType: which ProceduralNoise_Dispatch variant the material
        // noise runs (5 = the absent-attribute default, 8 = "SimplexNoise1234").
        t[o + 19] = c.insideNoiseType ?? 5;
        // kind 2 (empty: the lakes' 0x0 bitmap-noise node) carries the node's
        // seed-derived +0x94 simplex-blend offset in t5p.y instead of a value
        t[o + 20] = KIND[c.modKind] ?? 3;
        t[o + 21] = c.modKind === 'empty' ? bitmapNoiseNodeOffset(worldSeed) : c.modValue;
        // kind 3 (grid): which replayed BitmapCaves grid to sample, as a slot in
        // the buildSinHashAndGrids stack; -1 = params not ported, modifier 1.0
        t[o + 22] = c.gridKey ? MOD_GRID_KEYS.indexOf(c.gridKey) : -1;
    }
    const wrow = BIOME_ENGINE.length * W * 4;
    WANG_PARAMS_BY_ID.forEach(([scale, threshold, type], id) => {
        if (id < W) { t[wrow + id * 4] = scale; t[wrow + id * 4 + 1] = threshold; t[wrow + id * 4 + 2] = type; }
    });
    return { width: W, height: H, data: t };
}


// The carve blend's sin-hash value noise (0x00871850) hashes INTEGER lattice
// coordinates: hash(n) = frac(float32(sin(n)) * 43758.546875). GPU sin() error
// is amplified 43758x by the hash, so the shader reads these exact CPU-computed
// values from a texture instead. n = iy*57 + ix + {0,1,57,58} stays within
// +/-262144 out to several parallel worlds; the shader falls back to GPU sin
// beyond that.
export const SIN_HASH_MIN = -262144;
export const SIN_HASH_W = 1024, SIN_HASH_H = 512;
export function buildSinHashTable() {
    const F = Math.fround;
    const n = SIN_HASH_W * SIN_HASH_H;
    const t = new Float32Array(n);
    const MAG = F(43758.546875);
    for (let i = 0; i < n; i++) {
        const m = F(F(Math.sin(SIN_HASH_MIN + i)) * MAG);
        t[i] = F(m - Math.floor(m));
    }
    return { width: SIN_HASH_W, height: SIN_HASH_H, data: t };
}

// The replayed BitmapCaves modifier grids ride in the SAME R32F texture as the
// sin-hash table (the shader is at the WebGL2 16-sampler minimum, so no new
// sampler): rows 0..511 sin-hash, then 512x256 grids packed two per 1024-wide
// row band. Grid slot i sits at x = (i&1)*512, y = 512 + (i>>1)*256; the biome
// table's t5p.z carries the slot. Every CAVES_SETUP grid is 512x256.
export const MOD_GRID_KEYS = Object.keys(CAVES_SETUP).sort();
export const MOD_GRID_W = 512, MOD_GRID_H = 256;
export function buildSinHashAndGrids(worldSeed) {
    const sh = buildSinHashTable();
    const bands = Math.ceil(MOD_GRID_KEYS.length / 2);
    const H = SIN_HASH_H + bands * MOD_GRID_H;
    const t = new Float32Array(SIN_HASH_W * H);
    t.set(sh.data, 0);
    MOD_GRID_KEYS.forEach((key, i) => {
        const g = getModifierGrid(worldSeed, key);
        if (g.W !== MOD_GRID_W || g.H !== MOD_GRID_H)
            throw new Error(`modifier grid ${key} is ${g.W}x${g.H}, expected 512x256`);
        const ox = (i & 1) * MOD_GRID_W, oy = SIN_HASH_H + (i >> 1) * MOD_GRID_H;
        for (let y = 0; y < MOD_GRID_H; y++) {
            t.set(g.data.subarray(y * MOD_GRID_W, (y + 1) * MOD_GRID_W),
                (oy + y) * SIN_HASH_W + ox);
        }
    });
    return { width: SIN_HASH_W, height: H, data: t };
}

export function buildMatColorTable(matAtlas) {
    const t = new Uint16Array(512 * 4);
    const meanByEntry = new Map();
    for (let id = 0; id < MATERIAL_NAMES_BY_ID.length; id++) {
        const name = MATERIAL_NAMES_BY_ID[id];
        const entry = (name && matAtlas) ? (matAtlas.entryByMaterial.get(name) ?? 0) : 0;
        let rgb = MATERIAL_FLAT_RGB_BY_ID[id] | 0;
        if (entry > 0) {
            let mean = meanByEntry.get(entry);
            if (mean === undefined) { mean = atlasEntryMeanRGB(matAtlas, entry); meanByEntry.set(entry, mean); }
            rgb = mean;
        }
        // x packs the material's flat alpha (the cell's src-over compositing
        // alpha, water 0xA0...) above the 8-bit atlas entry; the shader
        // unpacks with & 0xff / >> 8. With texel detail on, textured materials
        // take the texel's own alpha instead (the baked cell color IS the
        // texel, alpha included); flat, they take its mean (ice 84, not FF).
        const alpha = entry > 0 ? atlasEntryMeanAlpha(matAtlas, entry) : (MATERIAL_FLAT_ALPHA_BY_ID[id] ?? 255);
        t[id * 4] = entry | (alpha << 8);
        t[id * 4 + 1] = (rgb >> 16) & 0xff;
        t[id * 4 + 2] = (rgb >> 8) & 0xff;
        t[id * 4 + 3] = rgb & 0xff;
    }
    return { width: 512, height: 1, data: t };
}

