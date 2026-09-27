// GL terrain renderer — WebGL2 driver (PERF_PLAN.md Step 2.3/2.5).
//
// Owns an offscreen WebGL2 canvas sized to the main canvas and renders the
// terrain layer (drawNow layer 4, "tile overlays") in one full-screen pass, from
// the resources buildTerrainResources() derives from `layer.buffer`. app.js then
// blits it with a single ctx.drawImage() at the layer-4 position, so layer
// ordering is unchanged and the CPU bake path stays untouched.
//
// Coordinate model (derivation in the Step 2.5 notes):
//   canvasX = worldX + 512*getWorldCenter - pw*512*mapWidth
//   canvasY = worldY + 14*512            - pwVertical*48*512
// i.e. drawNow's world space is generation world space plus a constant offset,
// for *every* parallel world in view: the per-PW `pwOffset` / `pwOffsetVertical`
// hacks in the CPU draw exactly cancel the difference between the PW stride
// (70*512, or 64*512-8) and the biome-map pitch. Horizontal PWs therefore need
// nothing but that offset — the shader undoes the PW stride before sampling a
// region, so the content repeats exactly as the CPU bakes it.
//
// Vertical PWs render in the same pass: heaven and hell are the row-0 / row-47
// biomes generated at the pixel's raw world y, and the shader's row lookups all
// clamp to [0, 47] (the engine's own chunk-row lookup does the same), so the
// band content falls out of the ordinary resolve. The CPU overlay path used to
// own the bands via rendersWorld(), but it cannot draw the engine-resolved
// terrain (clouds, hell fill) at all -- the bands looked empty (speckles only).

import { CHUNK_SIZE, WORLD_CHUNK_CENTER_Y } from '../constants.js';
import { getWorldCenter, getWorldSize } from '../utils.js';
import { renderHud } from '../render_hud.js';
import { buildChunkTextures, buildNoiseTable512 } from './chunk_textures.js';
import {
    buildEngineResources, buildEngineTable, buildMatColorTable, buildSinHashAndGrids, surfaceNoisePhase,
} from './engine_resources.js';
import { BIOME_MAP_HEIGHT } from './indirection.js';
import {
    buildFillMaterialTable, buildPaletteMaterialTable, getMaterialAtlas, initMaterialAtlas,
} from './material_atlas.js';
import { buildPaletteLUT } from './palette.js';
import { TERRAIN_FS, TERRAIN_VS } from './shaders.js';
import {
    createChunkTexture, createCoverageLatticeTexture, createEngineChunkTexture,
    createFillMaterialTexture, createFloatTableTexture, createForegroundTexture,
    createIndirectionTexture, createMaterialAtlasTexture, createMaterialLatticeTexture,
    createMaterialMetaTexture, createNoiseTexture, createPaletteMaterialTexture,
    createPaletteTexture, createR32FTexture, createRegionAtlasTexture, createRegionMetaTexture,
    deleteTerrainTextures, maxTextureSize, updatePaletteTexture,
} from './textures.js';
import { buildTerrainResources } from './terrain_resources.js';

const UNIFORM_NAMES = [
    'u_chunkTex', 'u_fgTex', 'u_noiseTex', 'u_indirTex', 'u_regionTex', 'u_atlasTex', 'u_paletteTex',
    'u_originInt', 'u_originFrac', 'u_invZoom', 'u_screenSize',
    'u_mapWidth', 'u_worldWidth', 'u_centerPx', 'u_baseY', 'u_maxRow', 'u_worldSizeX', 'u_edgeNoise',
    'u_matAtlasTex', 'u_matMetaTex', 'u_palMatTex', 'u_fgMatTex', 'u_matDetail',
    'u_covTex', 'u_latMatTex', 'u_engChunkTex', 'u_engTableTex', 'u_sinHashTex', 'u_engineTerrain', 'u_surfacePhase',
    'u_vpOrigin', 'u_materialIdOut',
];

/** Padded decal tiles per row of the material-id batch framebuffer. */
const ID_BATCH_COLS = 12;

function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(`GL terrain shader compile failed: ${log}`);
    }
    return sh;
}

function link(gl, vsSrc, fsSrc) {
    const prog = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(prog);
        gl.deleteProgram(prog);
        throw new Error(`GL terrain program link failed: ${log}`);
    }
    return prog;
}

export class GLTerrainRenderer {
    constructor() {
        this.canvas = null;
        this.gl = null;
        this.program = null;
        this.uniforms = null;
        this.textures = null;
        this.resources = null;
        this.contextLost = false;
        this.failed = null;      // error message; disables GL mode until the next build
        this.sourceKey = null;   // identity of the layers/biomeData the resources came from
        this.lutKey = null;
        this.stats = null;
        this.buildMs = 0;
        this.timerExt = undefined; // EXT_disjoint_timer_query_webgl2, looked up once
        this.gpuQueries = [];
        renderHud.addPoller(() => this.pollGpuTimers());
    }

    // --- GPU timing for the render HUD (render_hud.js). Only while the HUD is
    // on; one TIME_ELAPSED query may be open at a time, so callers never nest.
    gpuTimerBegin() {
        if (!renderHud.on || !this.gl || this.contextLost) return null;
        const gl = this.gl;
        if (this.timerExt === undefined) {
            this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
            renderHud.setGpuTimerState(this.timerExt ? 'yes' : 'unavailable');
        }
        if (!this.timerExt) return null;
        const q = gl.createQuery();
        gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, q);
        return q;
    }

    gpuTimerEnd(q, onMs) {
        if (!q) return;
        this.gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
        this.gpuQueries.push({ q, onMs });
        // Results that never land (driver quirk) must not pile up.
        if (this.gpuQueries.length > 64) this.gl.deleteQuery(this.gpuQueries.shift().q);
    }

    pollGpuTimers() {
        if (!this.gpuQueries.length) return;
        const gl = this.gl;
        if (!gl || this.contextLost) { this.gpuQueries = []; return; }
        // A disjoint event (clock change, context switch) voids every pending result.
        const disjoint = gl.getParameter(this.timerExt.GPU_DISJOINT_EXT);
        const keep = [];
        for (const e of this.gpuQueries) {
            if (!disjoint && !gl.getQueryParameter(e.q, gl.QUERY_RESULT_AVAILABLE)) { keep.push(e); continue; }
            if (!disjoint) e.onMs(gl.getQueryParameter(e.q, gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(e.q);
        }
        this.gpuQueries = keep;
    }

    /** True once a context exists and resources are uploaded. */
    get ready() {
        return !!(this.gl && !this.contextLost && !this.failed && this.textures && this.resources);
    }

    /** Worlds this renderer covers; the rest stay on the CPU overlay draw.
     *  Vertical bands included: the shader clamps every chunk-row lookup, so
     *  heaven/hell render in the same pass (see the header comment). */
    rendersWorld(pwY) {
        return true;
    }

    initContext() {
        if (this.gl || this.failed) return !!this.gl;
        if (typeof document === 'undefined') { this.failed = 'no DOM'; return false; }
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2', {
            alpha: true, antialias: false, depth: false, stencil: false,
            premultipliedAlpha: true, preserveDrawingBuffer: false,
            powerPreference: 'high-performance',
        });
        if (!gl) { this.failed = 'WebGL2 unavailable'; return false; }
        canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            this.contextLost = true;
            this.textures = null;
            this.program = null;
            console.warn('[GL terrain] context lost, falling back to the CPU bake');
        });
        canvas.addEventListener('webglcontextrestored', () => {
            this.contextLost = false;
            this.sourceKey = null; // force a rebuild + re-upload
            console.log('[GL terrain] context restored');
        });
        this.canvas = canvas;
        this.gl = gl;
        // Async; ensureResources' key picks the atlas up on the frame it lands.
        initMaterialAtlas().catch(err => console.warn('[GL terrain] material atlas unavailable:', err));
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        return true;
    }

    /**
     * Builds + uploads the terrain resources if the inputs changed. Cheap to call
     * every frame: it compares the layer/biome data identities.
     */
    ensureResources(layers, biomeData, opts = {}) {
        if (this.failed || this.contextLost) return false;
        if (!this.initContext()) return false;
        if (!layers || !layers.length || !biomeData) return false;

        const { isNGP = false, gameMode = 'normal' } = opts;
        // recolorMaterials is in the key because the per-chunk fg texture bakes
        // terrainFillColor, which follows the setting. Unlike the palette LUT
        // (one 1 KiB re-upload, updateLUT below) that texture is only written by
        // buildChunkTextures, so the toggle has to reach buildAndUpload or a fill
        // chunk would keep its old color while the CPU bake repainted it.
        const recolorMaterials = opts.lut?.recolorMaterials !== false;
        // engineTerrain is in the key because its lattice/table textures are only
        // built when the mode is on (they cost ~55 MB of GPU memory).
        const key = `${layers.length}|${isNGP}|${gameMode}|${recolorMaterials}|${!!getMaterialAtlas()}` +
            `|${!!opts.engineTerrain}|${opts.seed ?? 0}`;
        const same = this.textures && this.sourceKey === key &&
            this.sourceLayers === layers && this.sourceBiomeData === biomeData;
        if (!same) {
            try {
                this.buildAndUpload(layers, biomeData, {
                    isNGP, gameMode, lut: opts.lut,
                    engineTerrain: !!opts.engineTerrain, seed: opts.seed ?? 0,
                    GENERATOR_CONFIG: opts.generatorConfig,
                });
            } catch (err) {
                this.failed = String(err && err.message ? err.message : err);
                console.error('[GL terrain] resource build failed, staying on the CPU bake:', err);
                return false;
            }
            this.sourceKey = key;
            this.sourceLayers = layers;
            this.sourceBiomeData = biomeData;
            this.mapWidth = getWorldSize(isNGP, gameMode);
            this.centerPx = CHUNK_SIZE * getWorldCenter(isNGP, gameMode);
            this.worldSizeX = (isNGP || gameMode === 'nightmare') ? 64 * CHUNK_SIZE - 8 : 70 * CHUNK_SIZE;
        }
        this.updateLUT(opts.lut);
        return true;
    }

    buildAndUpload(layers, biomeData, opts) {
        const gl = this.gl;
        const t0 = performance.now();
        const mapWidth = getWorldSize(opts.isNGP, opts.gameMode);
        const resources = buildTerrainResources(layers, biomeData, {
            isNGP: opts.isNGP,
            gameMode: opts.gameMode,
            maxTextureSize: maxTextureSize(gl),
            lut: opts.lut,
        });
        const chunkTextures = buildChunkTextures(biomeData, mapWidth);
        // Null until the atlas fetch lands; the sourceKey then forces a rebuild.
        const matAtlas = getMaterialAtlas();

        // Engine resolve mode: the game's own 1/10 lattices + per-biome tables,
        // built from the same layers (lattice_builder.js, bit-exact vs COVDUMP).
        let engine = null;
        if (opts.engineTerrain) {
            const { GENERATOR_CONFIG } = opts;
            engine = buildEngineResources(layers, biomeData, GENERATOR_CONFIG ?? {}, mapWidth);
            this.surfacePhase = surfaceNoisePhase(opts.seed ?? 0);
        }
        // Kept for the unpainted-checkerboard mask: chunks the engine pass
        // resolves itself (mode != fallback, bits 8-9) ARE painted — including
        // the ones whose whole answer is air (sky, holy-mountain interiors).
        this.engineChunkModes = engine ? engine.chunk : null;
        this.engineChunkWidth = engine ? engine.width : 0;

        deleteTerrainTextures(gl, this.textures);
        this.textures = {
            atlas: createRegionAtlasTexture(gl, resources.atlas),
            indirection: createIndirectionTexture(gl, resources.indirection),
            regionMeta: createRegionMetaTexture(gl, resources.regions),
            palette: createPaletteTexture(gl, resources.paletteLUT),
            chunk: createChunkTexture(gl, chunkTextures),
            fg: createForegroundTexture(gl, chunkTextures),
            noise: createNoiseTexture(gl, buildNoiseTable512()),
            matAtlas: matAtlas && createMaterialAtlasTexture(gl, matAtlas),
            matMeta: matAtlas && createMaterialMetaTexture(gl, matAtlas, buildMatColorTable(matAtlas)),
            palMat: matAtlas && createPaletteMaterialTexture(gl,
                buildPaletteMaterialTable(matAtlas, resources.palette)),
            fgMat: matAtlas && createFillMaterialTexture(gl,
                buildFillMaterialTable(matAtlas, biomeData, mapWidth), mapWidth),
            cov: engine && createCoverageLatticeTexture(gl, engine.lattice),
            latMat: engine && createMaterialLatticeTexture(gl, engine.lattice),
            engChunk: engine && createEngineChunkTexture(gl, engine),
            engTable: engine && createFloatTableTexture(gl, buildEngineTable(opts.seed ?? 0)),
            // sin-hash rows + the seed's BitmapCaves modifier grids (one texture)
            sinHash: engine && createR32FTexture(gl, buildSinHashAndGrids(opts.seed ?? 0)),
        };
        this.resources = resources;

        if (!this.program) {
            this.program = link(gl, TERRAIN_VS, TERRAIN_FS);
            this.uniforms = {};
            for (const name of UNIFORM_NAMES) this.uniforms[name] = gl.getUniformLocation(this.program, name);
        }
        this.buildMs = performance.now() - t0;
        this.stats = resources.stats;
        console.log(`[GL terrain] resources built in ${this.buildMs.toFixed(1)} ms`, resources.stats);
    }

    /** Re-uploads the 1 KiB LUT when a color setting changed (no atlas rebuild). */
    updateLUT(lutOpts) {
        if (!this.textures || !this.resources) return;
        const key = JSON.stringify(lutOpts ?? {});
        if (key === this.lutKey) return;
        this.lutKey = key;
        const lut = buildPaletteLUT(this.resources.palette, lutOpts);
        this.resources.paletteLUT = lut;
        updatePaletteTexture(this.gl, this.textures.palette, lut);
    }

    /** Frees GPU resources; the next ensureResources() rebuilds them. */
    invalidate() {
        if (this.gl && this.textures) deleteTerrainTextures(this.gl, this.textures);
        if (this.gl && this.idFbo) {
            this.gl.deleteFramebuffer(this.idFbo);
            this.gl.deleteTexture(this.idTex);
            this.idFbo = this.idTex = null;
        }
        this.textures = null;
        this.resources = null;
        this.sourceKey = null;
        this.sourceLayers = null;
        this.sourceBiomeData = null;
        this.lutKey = null;
        this.failed = null;
    }

    /**
     * Renders the terrain for one frame.
     * @param {object} view { width, height, camX, camY, camZ, pw, pwVertical, edgeNoise,
     *                        materialTextures }
     * @returns {HTMLCanvasElement|null} the canvas to blit, or null when unavailable
     */
    render(view) {
        if (!this.ready) return null;
        const gl = this.gl;
        const { width, height, camX, camY, camZ } = view;
        if (width <= 0 || height <= 0) return null;
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }

        // World coords of screen pixel (0,0), split so the integer part stays exact.
        const originX = camX - (width / 2) / camZ - this.centerPx + view.pw * CHUNK_SIZE * this.mapWidth;
        const originY = camY - (height / 2) / camZ - WORLD_CHUNK_CENTER_Y * CHUNK_SIZE
            + view.pwVertical * BIOME_MAP_HEIGHT * CHUNK_SIZE;
        const intX = Math.floor(originX);
        const intY = Math.floor(originY);

        const u = this.uniforms;
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(this.program);

        // The four material textures are one all-or-nothing set: without them
        // u_matDetail is false and the shader never reaches their texelFetches.
        const matDetail = !!(view.materialTextures && this.textures.matAtlas && this.textures.matMeta
            && this.textures.palMat && this.textures.fgMat);
        // Engine resolve needs its own four textures plus the material atlas set
        // (engMaterialColor reads u_matMetaTex row 1 / u_matAtlasTex).
        const engineOn = !!(view.engineTerrain && this.engineReady);
        // Every sampler uniform gets its own unit even when its texture is
        // absent (the u_matDetail / u_engineTerrain flags gate all real use):
        // an unbound sampler defaults to unit 0, and a FLOAT sampler sharing
        // unit 0 with the integer u_chunkTex is a draw-time INVALID_OPERATION.
        // Placeholders match the sampler's type: chunk for integer samplers,
        // palette for float ones (bindTextures).
        this.bindTextures();

        gl.uniform2i(u.u_originInt, intX, intY);
        gl.uniform2f(u.u_originFrac, originX - intX, originY - intY);
        gl.uniform1f(u.u_invZoom, 1 / camZ);
        gl.uniform2f(u.u_screenSize, width, height);
        gl.uniform1i(u.u_mapWidth, this.mapWidth);
        gl.uniform1i(u.u_worldWidth, this.mapWidth * CHUNK_SIZE);
        gl.uniform1i(u.u_centerPx, this.centerPx);
        gl.uniform1i(u.u_baseY, WORLD_CHUNK_CENTER_Y * CHUNK_SIZE);
        gl.uniform1i(u.u_maxRow, BIOME_MAP_HEIGHT - 1);
        gl.uniform1i(u.u_worldSizeX, this.worldSizeX);
        gl.uniform1i(u.u_edgeNoise, view.edgeNoise ? 1 : 0);
        gl.uniform1i(u.u_matDetail, matDetail ? 1 : 0);
        gl.uniform1i(u.u_engineTerrain, engineOn ? 1 : 0);
        gl.uniform1f(u.u_surfacePhase, this.surfacePhase ?? 0);
        gl.uniform2i(u.u_vpOrigin, 0, 0);
        gl.uniform1i(u.u_materialIdOut, 0);

        const q = this.gpuTimerBegin();
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.gpuTimerEnd(q, (ms) => renderHud.sample('terrainGL', 'gpu', ms));
        return this.canvas;
    }

    /** Binds every sampler to its unit (shared by the screen and tile passes). */
    bindTextures() {
        const gl = this.gl, u = this.uniforms;
        const intPh = this.textures.chunk, floatPh = this.textures.palette;
        const units = [
            ['u_chunkTex', this.textures.chunk], ['u_fgTex', this.textures.fg], ['u_noiseTex', this.textures.noise],
            ['u_indirTex', this.textures.indirection], ['u_regionTex', this.textures.regionMeta],
            ['u_atlasTex', this.textures.atlas], ['u_paletteTex', this.textures.palette],
            ['u_matAtlasTex', this.textures.matAtlas || intPh], ['u_matMetaTex', this.textures.matMeta || intPh],
            ['u_palMatTex', this.textures.palMat || intPh], ['u_fgMatTex', this.textures.fgMat || intPh],
            ['u_covTex', this.textures.cov || floatPh], ['u_latMatTex', this.textures.latMat || intPh],
            ['u_engChunkTex', this.textures.engChunk || intPh], ['u_engTableTex', this.textures.engTable || floatPh],
            ['u_sinHashTex', this.textures.sinHash || floatPh],
        ];
        units.forEach(([name, tex], i) => {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.uniform1i(u[name], i);
        });
    }

    /** True when the engine-resolve textures are uploaded, i.e. the shader can
     *  answer material ids (the tile pass has no legacy fallback). */
    get engineReady() {
        return !!(this.ready && this.textures.cov && this.textures.latMat && this.textures.engChunk
            && this.textures.engTable && this.textures.sinHash && this.textures.matAtlas && this.textures.matMeta);
    }

    /**
     * Resolves the material id of every pixel of several world rects on the GPU
     * -- the edge-decal tiles' input, which the CPU port (material_field.js)
     * took ~24 ms per 320x320 tile to answer and which the shader already
     * computes per fragment for the screen. All rects are drawn into one
     * framebuffer (one viewport each), read back through a pixel-pack buffer
     * and a fence, so the draw thread never waits on the GPU: the promise
     * resolves from a timer once the fence signals.
     *
     * @param {Array<{x0:number,y0:number,w:number,h:number}>} rects  world rects, absolute coords
     * @returns {Promise<Uint8Array[]|null>} one raw RGBA readback per rect (rows
     *          bottom-up; edge_decal_layer.js decodeMaterialIdTile turns it into
     *          ids), or null when the pass is unavailable
     */
    resolveMaterialTiles(rects, onGpuMs = null) {
        if (!this.engineReady || !rects.length) return Promise.resolve(null);
        const gl = this.gl, u = this.uniforms;
        const tw = rects[0].w, th = rects[0].h;
        const cols = Math.min(ID_BATCH_COLS, rects.length);
        const rows = Math.ceil(rects.length / cols);
        const fbW = cols * tw, fbH = rows * th;
        if (fbW > maxTextureSize(gl) || fbH > maxTextureSize(gl)) return Promise.resolve(null);

        // Framebuffer + color target, reallocated only when the batch outgrows it.
        if (!this.idFbo) {
            this.idFbo = gl.createFramebuffer();
            this.idTex = gl.createTexture();
            this.idTexSize = [0, 0];
        }
        gl.bindTexture(gl.TEXTURE_2D, this.idTex);
        if (this.idTexSize[0] < fbW || this.idTexSize[1] < fbH) {
            const w = Math.max(this.idTexSize[0], fbW), h = Math.max(this.idTexSize[1], fbH);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            this.idTexSize = [w, h];
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.idFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.idTex, 0);

        gl.useProgram(this.program);
        this.bindTextures();
        gl.uniform2f(u.u_originFrac, 0, 0);
        gl.uniform1f(u.u_invZoom, 1);
        gl.uniform2f(u.u_screenSize, tw, th);
        gl.uniform1i(u.u_mapWidth, this.mapWidth);
        gl.uniform1i(u.u_worldWidth, this.mapWidth * CHUNK_SIZE);
        gl.uniform1i(u.u_centerPx, this.centerPx);
        gl.uniform1i(u.u_baseY, WORLD_CHUNK_CENTER_Y * CHUNK_SIZE);
        gl.uniform1i(u.u_maxRow, BIOME_MAP_HEIGHT - 1);
        gl.uniform1i(u.u_worldSizeX, this.worldSizeX);
        gl.uniform1i(u.u_edgeNoise, 1);
        gl.uniform1i(u.u_matDetail, 0);
        gl.uniform1i(u.u_engineTerrain, 1);
        gl.uniform1f(u.u_surfacePhase, this.surfacePhase ?? 0);
        gl.uniform1i(u.u_materialIdOut, 1);
        const q = this.gpuTimerBegin();
        for (let i = 0; i < rects.length; i++) {
            const vx = (i % cols) * tw, vy = Math.floor(i / cols) * th;
            gl.viewport(vx, vy, tw, th);
            gl.uniform2i(u.u_vpOrigin, vx, vy);
            gl.uniform2i(u.u_originInt, rects[i].x0, rects[i].y0);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        this.gpuTimerEnd(q, (ms) => {
            renderHud.sample('edgeDecals', 'gpu', ms);
            onGpuMs?.(ms);
        });
        gl.uniform1i(u.u_materialIdOut, 0);
        gl.uniform2i(u.u_vpOrigin, 0, 0);

        // Async readback: each tile packed contiguously into one buffer (a
        // readPixels per viewport, at its own offset), fence, poll. The bytes
        // come back RAW -- decoding 48 tiles' ids on this thread was a 20 ms
        // frame while panning at 1:1; the worker that stamps decodes instead.
        const tileBytes = tw * th * 4;
        const pbo = gl.createBuffer();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, tileBytes * rects.length, gl.STREAM_READ);
        for (let i = 0; i < rects.length; i++) {
            gl.readPixels((i % cols) * tw, Math.floor(i / cols) * th, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, i * tileBytes);
        }
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();

        return new Promise((resolve) => {
            const out = [];
            // Copying out of the buffer is a memcpy per tile; a few per timer
            // tick keeps a big batch from landing in one frame.
            const copyStep = () => {
                const c0 = performance.now();
                gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
                for (let n = 0; n < 8 && out.length < rects.length; n++) {
                    const bytes = new Uint8Array(tileBytes);
                    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, out.length * tileBytes, bytes);
                    out.push(bytes);
                }
                gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
                renderHud.sample('edgeDecals', 'main', performance.now() - c0);
                if (out.length < rects.length) { setTimeout(copyStep, 0); return; }
                gl.deleteBuffer(pbo);
                resolve(out);
            };
            const poll = () => {
                if (this.contextLost || !this.gl) { resolve(null); return; }
                const st = gl.clientWaitSync(sync, 0, 0);
                if (st === gl.TIMEOUT_EXPIRED) { setTimeout(poll, 3); return; }
                gl.deleteSync(sync);
                if (st === gl.WAIT_FAILED) { gl.deleteBuffer(pbo); resolve(null); return; }
                copyStep();
            };
            setTimeout(poll, 2);
        });
    }


}
