// WorldSave_ResolveCellMaterialAtPixel @0x0087d0e0 on the CPU: "which material
// does the engine create at this world pixel".
//
// The GL terrain shader answers the same question per fragment (gl/shaders.js
// engResolveCell -> engTopo0 / engTopo2), but only inside a draw call and only
// as a color. The edge-decal pass needs the material *identity* of a whole
// neighbourhood at once, on the CPU, so it can find borders and stamp sprites
// across them — hence this port. Both sides read the same committed
// engine_data.js tables, so they cannot disagree about the model; they can only
// disagree about float rounding (measured at ~0.01% of pixels, see
// scripts/ref_resolver/cpu_predict_render.mjs).
//
// Chain per pixel:
//   ChunkGrid_ResolveChunkAtPosition @0x0087d9a0   (chunk_wobble.js)
//     -> biome-map cell, after the 42px biome-edge wobble
//   topology 2: the 1/10 coverage lattice resolve  (topo2_resolve.js)
//   topology 0: the procedural surface resolve     (topo0_resolve.js)
//   both end in BiomeMaterials_SelectComponentForCell (band_select.js)
import { BIOME_ENGINE, WANG_PARAMS_BY_ID } from './engine_data.js';
import { buildEngineLattice } from './lattice_builder.js';
import { resolveCellFull } from './chunk_wobble.js';
import { CoverGrid, DEFAULT_PARAMS, resolvePixel , setTopo2WorldOffX } from './topo2_resolve.js';
import { resolveTopo0Pixel, surfaceNoisePhase, topo0Config } from './topo0_resolve.js';
import { selectComponentForCell } from './band_select.js';

const BIOME_MAP_HEIGHT = 48;

/** Material id for a pixel the engine model cannot resolve (fallback chunk). */
export const MATERIAL_UNRESOLVED = -1;

const PARAMS_BY_ID = WANG_PARAMS_BY_ID.map(([scale, threshold, type]) => ({ scale, threshold, type }));
const ENGINE_BY_COLOR = new Map(BIOME_ENGINE.map(b => [b.color & 0xffffff, b]));

/**
 * Builds the per-pixel material query for one world (seed + PW + NG count as
 * baked into `layers`/`biomeData`). The 1/10 coverage lattice it needs is the
 * same plane gl/engine_resources.js uploads, so building both costs the lattice
 * twice unless the caller passes a prebuilt one.
 *
 * @param {Array<object>} layers          generateBiomeTiles output
 * @param {object} biomeData              {pixels, width}
 * @param {object} generatorConfig        GENERATOR_CONFIG
 * @param {number} mapWidth               biome map width in chunks
 * @param {number} worldSeed
 * @param {{lattice?: object}} [opts]
 */
export function createMaterialField(layers, biomeData, generatorConfig, mapWidth, worldSeed, opts = {}) {
    const lattice = opts.lattice || buildEngineLattice(layers, generatorConfig, mapWidth, BIOME_MAP_HEIGHT);
    const grid = new CoverGrid(lattice.GW, lattice.GH, lattice.cov, lattice.mat);
    const phase = surfaceNoisePhase(worldSeed);
    const bmap = {
        w: mapWidth,
        colorAt: (cx, cy) => (biomeData.pixels[cy * mapWidth + cx] ?? 0) & 0xffffff,
    };
    const hasEdgeNoise = (color) => ENGINE_BY_COLOR.get(color)?.noiseBiomeEdges !== false;
    const getParams = (i) => PARAMS_BY_ID[i] ?? DEFAULT_PARAMS;
    const cell = {};

    function chunkCovered(cx, cy) {
        const row = Math.min(BIOME_MAP_HEIGHT - 1, Math.max(0, cy));
        return lattice.chunkCovered[row * mapWidth + (((cx % mapWidth) + mapWidth) % mapWidth)];
    }

    const centerPx = mapWidth * 256;
    // The topo2 sampler's world offset is the grid's x shift (mapWidth*256),
    // not ng0's 17920 -- see K.worldOffX in topo2_resolve.js.
    setTopo2WorldOffX(centerPx);

    /** Material id at a world pixel; 0 = air, MATERIAL_UNRESOLVED = fallback. */
    function materialAt(x, y) {
        // Every chain takes the ABSOLUTE x, as in the engine: the chunk index
        // wraps on the map pitch inside resolveCellFull, the lake's linear
        // surface ramp keeps rising through the east parallel worlds, the
        // solid_wall coal/rock bands never repeat, and the topo2 lattice wraps
        // itself (CoverGrid, GW = stride/10). Same frame as gl/shaders.js main().
        resolveCellFull(bmap, x, y, hasEdgeNoise, cell);
        const biome = ENGINE_BY_COLOR.get(cell.color);
        if (!biome || !biome.supported) return MATERIAL_UNRESOLVED;
        if (biome.topo === 2) {
            if (!chunkCovered(cell.cx, cell.cy)) return MATERIAL_UNRESOLVED;
            const out = resolvePixel(grid, x, y, getParams);
            if (out.status === 1) return 0;
            if (out.status === 2) return out.mat;
            const mat = selectComponentForCell(biome, x, y, out.density);
            return mat < 0 ? 0 : mat;
        }
        // Near the surface the depth ratio comes from the PHYSICAL biome-map cell
        // and its left neighbour, not from the wobble-resolved cell the bands come
        // from: CellNoise_EvaluateCaveBoundary @0x0087e8d0 re-derives the cell from
        // the raw coordinates and ignores the BiomeChunk it was handed.
        const sx = x + mapWidth * 256;
        const pcx = (((sx >> 9) % mapWidth) + mapWidth) % mapWidth;
        const pcy = Math.min(BIOME_MAP_HEIGHT - 1, Math.max(0, (y + 7168) >> 9));
        const physBiome = ENGINE_BY_COLOR.get(bmap.colorAt(pcx, pcy));
        const leftColor = bmap.colorAt((((pcx - 1) % mapWidth) + mapWidth) % mapWidth, pcy);
        const leftBiome = ENGINE_BY_COLOR.get(leftColor);
        const subX = ((sx % 512) + 512) % 512;
        const mat = resolveTopo0Pixel(biome, topo0Config(biome), phase, x, y, {
            worldSeed, subX,
            physCfg: physBiome ? topo0Config(physBiome) : null,
            leftCfg: leftBiome ? topo0Config(leftBiome) : null,
        });
        return mat < 0 ? 0 : mat;
    }

    return { materialAt, lattice, phase };
}

/**
 * Resolves a world rect into a row-major Int16Array of material ids
 * (MATERIAL_UNRESOLVED for fallback chunks).
 */
export function resolveMaterialRect(field, x0, y0, width, height, out) {
    const ids = out || new Int16Array(width * height);
    for (let py = 0; py < height; py++) {
        const row = py * width;
        const y = y0 + py;
        for (let px = 0; px < width; px++) ids[row + px] = field.materialAt(x0 + px, y);
    }
    return ids;
}
