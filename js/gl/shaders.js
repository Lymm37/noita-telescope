// GL terrain renderer — GLSL ES 3.00 sources (PERF_PLAN.md Step 2.2/2.3).
//
// One full-screen pass. Per fragment:
//   screen -> world px  ->  biome-map chunk (exact integer math)
//          -> edge-noise wobble, evaluated per fragment, never baked
//          -> chunk indirection -> region metadata
//          -> region atlas sampled with the engine's whole-image mod-wrap
//          -> palette LUT -> color (grays resolve per chunk through u_fgTex)
//
// The biome-resolution chain is a port of:
//   js/image_processing.js  getTileOverlayBiome / getUnwobbledTileOverlayBiome
//   js/utils.js             getBiomeAtWorldCoordinates (edge-noise branch)
//   js/edge_noise.js        GetBiomeOffset / GetTrueChunkPosIdAt /
//                           GetWobbledBiome / ComputeMagicValueFromDoubles
// carried over from spikes/webgl-tiles/shaders.js, where it was diff-verified
// against the CPU bake, with the spike's hardcoded 70 / 17920 / 35840 / 7168 /
// 47 promoted to uniforms and its per-layer `isWrapped` guard dropped (see
// scripts/gl_scoping_report.md §4: in a viewport-space renderer the fragment's
// own world Y is authoritative, so the guard's premise no longer holds).
//
// All chunk arithmetic is exact integers; only the wobble noise and the sin/cos
// displacement run in float32 (the JS reference is float64 — the spike measured
// ~0.0025% biome flips from that, confined to seam pixels).
//
// Per-cell material texture (u_matDetail, PERF_PLAN.md 2.4) resolves a fill
// chunk's or a palette index's material through material_atlas.js and samples
// materials_gfx at the fragment's absolute world coords, reproducing the color
// the engine bakes per cell. The gray/white class stays flat: it is a per-biome
// density resolve, not a single material.

import { VISUAL_TILE_OFFSET_X, VISUAL_TILE_OFFSET_Y } from '../constants.js';
import { EDGE_SIGNS } from '../edge_noise.js';
import { CHUNK_FLAG_EDGE_NOISE_EXCEPTION, CHUNK_FLAG_FG_DEFINED, CHUNK_FLAG_FILL, CHUNK_FLAG_HAS_TILES, CHUNK_FLAG_NOISE_INELIGIBLE } from './chunk_textures.js';
import { NO_REGION } from './indirection.js';
import { PALETTE_ALPHA_CHUNK_FG, PALETTE_ALPHA_SKIP } from './palette.js';

const SIGNS_GLSL = `const int SIGNS[48] = int[48](${EDGE_SIGNS.join(', ')});`;

// One triangle covering the viewport; no attributes, no buffers, no VAO state.
export const TERRAIN_VS = `#version 300 es
void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const TERRAIN_FS = `#version 300 es
precision highp float;
precision highp int;

uniform highp usampler2D u_chunkTex;    // mapW x 48 RGBA8UI: rgb = biome-map color, a = flags
uniform highp usampler2D u_fgTex;       // mapW x 48 RGBA8UI: rgb = TILE_FOREGROUND_COLORS, a = 255 if defined
uniform highp usampler2D u_noiseTex;    // 512x3 R8UI: row 0 EDGE_NOISE doubled, rows 1/2 the
                                        // classic + custom noise permutation tables (engine mode)
uniform highp usampler2D u_indirTex;    // mapW x 48 RG16UI: r = region slot, g = chunk flags
uniform highp isampler2D u_regionTex;   // 2 x N RGBA32I region metadata
uniform highp usampler2D u_atlasTex;    // R8UI palette-index atlas of every layer buffer
uniform sampler2D u_paletteTex;         // 256x1 RGBA8: rgb = color, a = paint mode
uniform highp usampler2D u_matAtlasTex; // RGBA8UI packed materials_gfx textures
uniform highp usampler2D u_matMetaTex;  // 512 x 2 RGBA16UI: row 0 material rect (x, y, w, h) by
                                        // atlas entry; row 1 (atlasEntry, r, g, b) by MATERIAL ID
uniform highp usampler2D u_palMatTex;   // 256x2 R8UI: palette index -> material entry / compositing alpha
uniform highp usampler2D u_fgMatTex;    // mapW x 48 R8UI: fill chunk -> material entry
uniform bool u_matDetail;               // off: every material paints its flat color

// --- engine-faithful resolve mode (u_engineTerrain) -------------------------
uniform highp sampler2D u_covTex;       // GW x GH R32F: the global 1/10 coverage lattice
uniform highp usampler2D u_latMatTex;   // GW x GH R16UI: material lattice (stored id + 1)
uniform highp usampler2D u_engChunkTex; // mapW x 48 R16UI: biome slot | mode<<8 | edgeNoise<<10
uniform highp sampler2D u_engTableTex;  // 512 x (nBiomes+1) RGBA32F: per-biome band table
                                        // (cols 0..47) + topology-0 params (cols 48..53);
                                        // last row = wang sampler params by material id
uniform highp sampler2D u_sinHashTex;   // R32F: rows 0..511 exact frac(sin(n)*43758.5)
                                        // for integer n in [-262144, 262143]; rows 512+
                                        // the seed's 512x256 BitmapCaves modifier grids,
                                        // two per row band (engine_resources.js)
uniform bool u_engineTerrain;
uniform float u_surfacePhase;           // per-seed surface-noise X phase (BiomeGrid+0x48)

// Camera: world coords of screen pixel (0,0) split into an exact integer part
// and a fraction, so world positions stay exact out to the parallel-world
// extremes where float32 alone would lose whole pixels.
uniform ivec2 u_originInt;
uniform vec2 u_originFrac;
uniform float u_invZoom;
uniform vec2 u_screenSize;
uniform ivec2 u_vpOrigin;               // viewport origin in the framebuffer (tile pass)
uniform bool u_materialIdOut;           // write material ids instead of colors (tile pass)

uniform int u_mapWidth;     // getWorldSize(): 70 normal NG0, 64 NG+/nightmare
uniform int u_worldWidth;   // u_mapWidth * 512
uniform int u_centerPx;     // 512 * getWorldCenter()
uniform int u_baseY;        // 14 * 512
uniform int u_maxRow;       // 47
uniform int u_worldSizeX;   // parallel-world X stride: 70*512, or 64*512-8
uniform bool u_edgeNoise;

const int CHUNK = 512;
const int TILE = 10;
// constants.js VISUAL_TILE_OFFSET_*: every layer anchor satisfies
// worldX = -u_centerPx + VIS_X + 10*rasterTile (verified for all 70x48 chunk
// bases x {normal,nightmare} x {NG0,NG+}), which is what rasterChunk inverts.
const int VIS_X = ${VISUAL_TILE_OFFSET_X};
const int VIS_Y = ${VISUAL_TILE_OFFSET_Y};
const int BAND = 42;        // BIOME_EDGE_NOISE_EXTENT
// GetTrueChunkPosIdAt hardcodes 70 even in NG+ (edge_noise.js:124 "Actually
// this makes no difference anyway"). Deliberately NOT u_mapWidth.
const int TRUE_CHUNK_MODULUS = 70;

const float SQRT312 = 0.36602540378443864676; // (sqrt(3)-1)/2
const float SQRT336 = 0.21132486540518711775; // (3-sqrt(3))/6
${SIGNS_GLSL}

out vec4 outColor;

// GLSL ES leaves % and / UNDEFINED for a negative operand — ANGLE (Chrome)
// lowers them to C truncation, but Mesa's native GL (Firefox on Linux) compiles
// them as UNSIGNED ops, so (-1) % 70 came back 45 and the whole west parallel
// world (negative world x everywhere) sampled garbage chunks. Only non-negative
// operands ever reach % and / here. b must be positive.
int pmod(int a, int b) { return a >= 0 ? a % b : b - 1 - ((-1 - a) % b); }
// Floor division. JS '>>' on a negative int floors; GLSL ES leaves '>>' of a
// negative value implementation-defined, so every shift is spelled out.
int fdiv(int a, int b) { return a >= 0 ? a / b : -1 - ((-1 - a) / b); }
int parity(int x, int y) { return pmod(x, 2) * 2 + pmod(y, 2); }

int noiseAt(int i) { return int(texelFetch(u_noiseTex, ivec2(i, 0), 0).r); }
uvec4 chunkAt(ivec2 p) { return texelFetch(u_chunkTex, ivec2(pmod(p.x, u_mapWidth), clamp(p.y, 0, u_maxRow)), 0); }
bool exceptionAt(ivec2 p) { return (chunkAt(p).a & ${CHUNK_FLAG_EDGE_NOISE_EXCEPTION}u) != 0u; }

// TILE_FOREGROUND_COLORS for a chunk: the gray/white class resolves to it, and
// so does a fill biome's constant material (chunk_textures.js FILL_LAYER_COLORS).
// Premultiplied: fg.a carries the fill material's XML compositing alpha
// (water 0xA0 in the lake...), 255 for the gray/white class. The canvas blit
// then src-over-composites the cell over the background layer exactly like
// the game's cell grid over its background sprites.
vec4 chunkForeground(ivec2 p) {
    uvec4 fg = texelFetch(u_fgTex, ivec2(pmod(p.x, u_mapWidth), clamp(p.y, 0, u_maxRow)), 0);
    float a = float(fg.a) / 255.0;
    return vec4(vec3(fg.rgb) / 255.0 * a, a);
}

// Engine cell color: sample the material texture at absolute world coords,
// negative-safe modulo (CellFactory_GetCellColor). a==0 texels create no
// cell in the engine, so they paint nothing; partial texel alpha IS the baked
// cell's compositing alpha (the baked color is the texel, alpha included).
// Output premultiplied for the canvas blit.
bool materialTexel(int entry, ivec2 w, out vec4 color) {
    uvec4 m = texelFetch(u_matMetaTex, ivec2(entry - 1, 0), 0); // x,y,w,h
    ivec2 t = ivec2(pmod(w.x, int(m.z)), pmod(w.y, int(m.w)));
    uvec4 c = texelFetch(u_matAtlasTex, ivec2(int(m.x) + t.x, int(m.y) + t.y), 0);
    if (c.a == 0u) { color = vec4(0.0); return false; }
    float a = float(c.a) / 255.0;
    color = vec4(vec3(c.rgb) / 255.0 * a, a);
    return true;
}

// Material entry of a chunk's fill material, on chunkForeground's texel grid.
uint fillMaterialAt(ivec2 p) {
    return texelFetch(u_fgMatTex, ivec2(pmod(p.x, u_mapWidth), clamp(p.y, 0, u_maxRow)), 0).r;
}

// getUnwobbledTileOverlayBiome's cell math (image_processing.js:111-116), with
// the vertical bands folded in: above the map the engine repeats row 0 (heaven)
// and below it row 47 (hell) -- the chunk-row lookup clamps, it never wraps --
// so the row here CLAMPS. The CPU bake gets the same answer by swapping in
// heavenPixels/hellPixels, whose 48 rows are all copies of row 0 / row 47.
ivec2 unwob(int wx, int wy) {
    return ivec2(pmod(fdiv(wx + u_centerPx, CHUNK), u_mapWidth),
                 clamp(fdiv(wy + u_baseY, CHUNK), 0, u_maxRow));
}

// ComputeMagicValueFromDoubles (simplex-style gradient noise), float32.
// Lattice coords are SIGNED (CVTTSD2SI + floor fixup, then & 0xff on the
// two's-complement int): negative inputs occur for every raw-world-coordinate
// caller west/above the origin, so no unsigned shortcuts here.
float magicNoise(float x, float y) {
    float d7 = (x + y) * SQRT312;
    float d6 = d7 + x;
    int u2 = int(d6);                 // truncate toward zero...
    if (d6 < float(u2)) u2 -= 1;      // ...then floor fixup
    d7 = d7 + y;
    int u1 = int(d7);
    if (d7 < float(u1)) u1 -= 1;
    float dd = float(u1 + u2) * SQRT336;
    float d10 = x - (float(u2) - dd);
    float d9  = y - (float(u1) - dd);
    int i1 = u1 & 0xff;
    int i2 = u2 & 0xff;
    int s1 = (d9 < d10) ? 1 : 0;
    int s2 = (d10 <= d9) ? 1 : 0;
    float e7  = (d10 - float(s1)) + SQRT336;
    float e3  = (d9 - float(s2)) + SQRT336;
    float e11 = (d10 - 1.0) + SQRT336 * 2.0;
    float e4  = (d9 - 1.0) + SQRT336 * 2.0;
    float dm = 0.0;
    float d5 = (0.5 - d10 * d10) - d9 * d9;
    if (d5 >= 0.0) {
        int m12 = noiseAt(noiseAt(i1) + i2) % 12;
        dm = (float(SIGNS[m12 * 4 + 1]) * d9 + float(SIGNS[m12 * 4]) * d10) * d5 * d5 * d5 * d5;
    }
    float dmid = 0.0;
    float d5b = (0.5 - e7 * e7) - e3 * e3;
    if (d5b >= 0.0) {
        int m12 = noiseAt(noiseAt(s2 + i1) + i2 + s1) % 12;
        dmid = (float(SIGNS[m12 * 4 + 1]) * e3 + float(SIGNS[m12 * 4]) * e7) * d5b * d5b * d5b * d5b;
    }
    float d8 = 0.0;
    float d3 = (0.5 - e11 * e11) - e4 * e4;
    if (d3 >= 0.0) {
        int m12 = noiseAt(noiseAt(i1 + 1) + i2 + 1) % 12;
        d8 = (float(SIGNS[m12 * 4 + 1]) * e4 + float(SIGNS[m12 * 4]) * e11) * d3 * d3 * d3 * d3;
    }
    return (dmid + dm + d8) * 70.0;   // literal 70 in the engine, not the world size
}

// GetWobbledBiome (sincos branch, highDetail = true). Takes shifted coords.
int wobbledParity(int sx, int sy) {
    float nv = magicNoise(float(sx) * 0.05, float(sy) * 0.05);
    float sv = sin(float(sy) * 0.005);
    float cv = cos(float(sx) * 0.005);
    float x2 = cv * 30.0 + nv * 11.0;
    float y2 = sv * 30.0 + nv * 11.0;
    return parity(fdiv(int(floor(y2 + float(sx))), CHUNK),
                  fdiv(int(floor(x2 + float(sy))), CHUNK));
}

// GetTrueChunkPosIdAt
int trueChunkParity(int wx, int wy) {
    int sx = wx + u_centerPx;
    int sy = wy + u_baseY;
    int scx = sx & 511;
    int scy = sy & 511;
    if (scx < BAND || scy < BAND || scx > CHUNK - BAND || scy > CHUNK - BAND) return wobbledParity(sx, sy);
    return parity(pmod(fdiv(sx, CHUNK), TRUE_CHUNK_MODULUS), clamp(fdiv(sy, CHUNK), 0, u_maxRow));
}

// GetOriginalChunkPosIdAt
int origChunkParity(int wx, int wy) {
    return parity(pmod(fdiv(wx + u_centerPx, CHUNK), u_mapWidth), fdiv(wy + u_baseY, CHUNK));
}

// GetBiomeOffset
ivec2 biomeOffset(int wx, int wy) {
    int o = origChunkParity(wx, wy);
    int t = trueChunkParity(wx, wy);
    int dY = pmod(t - o, 2);
    int dX = pmod(fdiv(t, 2) - fdiv(o, 2), 2);
    int mx = pmod(wx, CHUNK);
    int my = pmod(wy, CHUNK);
    int sX = mx < BAND ? -1 : (mx > CHUNK - BAND ? 1 : 0);
    int sY = my < BAND ? -1 : (my > CHUNK - BAND ? 1 : 0);
    return ivec2(dX * sX, dY * sY);
}

// Chunk that OWNS the region-buffer content at a world coordinate.
//
// Region buffers are masked chunk by chunk on the engine's *tile raster* grid
// (image_processing.js chunkRasterStart = trunc(51.2 * chunk), applyMasking's
// 51/51/51/51/52 column runs), not on the 512-px chunk grid. Because every
// layer anchor satisfies  worldX = -u_centerPx + VISUAL_TILE_OFFSET + 10*raster,
// chunk c's unmasked content begins 2*(c mod 5) px *before* c's true 512-px
// boundary. Picking the region on the 512-px grid therefore samples chunk c-1's
// region inside that 0..8 px sliver, where applyMasking already zeroed the
// buffer -> a dead-straight transparent seam at every region border (visible as
// gaps along the rainforest / rainforest_open borders). The CPU bake has no such
// seam: it picks the layer with chunkAtRasterTile and only the *colors* with
// getTileOverlayBiome, so the region lookup below uses this grid while the whole
// biome/wobble chain stays on the true grid.
int rasterChunk(int world, int base, int visualOffset) {
    int t = fdiv(world + base - visualOffset, TILE);
    // chunkAtRasterTile (image_processing.js:178-180).
    return t >= 0 ? ((t + 1) * TILE + CHUNK - 1) / CHUNK - 1 : fdiv(t * TILE, CHUNK);
}

// getBiomeAtWorldCoordinates with useEdgeNoise = true
void biomeAt(int wx, int wy, out ivec2 fpos, out ivec2 opos) {
    ivec2 o = unwob(wx, wy);
    int sbx = pmod(wx, CHUNK);
    int sby = pmod(wy, CHUNK);
    bool nearX = sbx < BAND || sbx > CHUNK - BAND;
    bool nearY = sby < BAND || sby > CHUNK - BAND;
    ivec2 off = ivec2(0);
    if (nearX || nearY) off = biomeOffset(wx, wy);
    int bX = pmod(o.x + off.x, u_mapWidth);
    int bY = clamp(o.y + off.y, 0, u_maxRow);
    uvec4 oc = chunkAt(o);
    uvec4 nc = chunkAt(ivec2(bX, bY));
    bool skip = (oc.a & ${CHUNK_FLAG_NOISE_INELIGIBLE}u) != 0u || (nc.a & ${CHUNK_FLAG_NOISE_INELIGIBLE}u) != 0u;
    if (!skip) {
        // Probe neighbors in engine order; only the FIRST differing one counts.
        ivec2 probes[8];
        int pc = 0;
        if (sbx < BAND)  { probes[pc] = ivec2(o.x - 1, o.y); pc++; }
        if (sby < BAND)  { probes[pc] = ivec2(o.x, o.y - 1); pc++; }
        if (sbx > CHUNK - BAND) { probes[pc] = ivec2(o.x + 1, o.y); pc++; }
        if (sby > CHUNK - BAND) { probes[pc] = ivec2(o.x, o.y + 1); pc++; }
        if (sbx < BAND) {
            if (sby < BAND)  { probes[pc] = ivec2(o.x - 1, o.y - 1); pc++; }
            if (sby > CHUNK - BAND) { probes[pc] = ivec2(o.x - 1, o.y + 1); pc++; }
        }
        if (sbx > CHUNK - BAND) {
            if (sby < BAND)  { probes[pc] = ivec2(o.x + 1, o.y - 1); pc++; }
            if (sby > CHUNK - BAND) { probes[pc] = ivec2(o.x + 1, o.y + 1); pc++; }
        }
        bool found = false;
        for (int p = 0; p < 8; p++) {
            if (p >= pc) break;
            uvec4 pcC = chunkAt(probes[p]);
            if (all(equal(pcC.rgb, oc.rgb))) continue;
            found = true;
            if ((pcC.a & ${CHUNK_FLAG_NOISE_INELIGIBLE}u) != 0u) skip = true;
            break;
        }
        if (pc > 0 && !found) skip = true;
    }
    if (skip) { bX = o.x; bY = o.y; }
    fpos = ivec2(bX, bY);
    opos = o;
}

// getTileOverlayBiome. u_edgeNoise is per layer on the CPU; here the layer is
// whatever region covers the resolved chunk, so an exception biome under the
// fragment is the same condition (image_processing.js:331).
void overlayBiome(int wx, int wy, out ivec2 pos, out bool ignored) {
    ignored = false;
    pos = unwob(wx, wy);
    if (!u_edgeNoise) return;
    int scx = pmod(wx, CHUNK);
    int scy = pmod(wy, CHUNK);
    if (scx >= BAND && scx <= CHUNK - BAND && scy >= BAND && scy <= CHUNK - BAND) return;
    if (exceptionAt(pos)) return;   // layer's own biome ignores edge noise

    bool adjEx = false;
    if (scx < BAND && exceptionAt(unwob(wx - scx - 1, wy))) adjEx = true;
    else if (scy < BAND && exceptionAt(unwob(wx, wy - scy - 1))) adjEx = true;
    else if (scx > CHUNK - BAND && exceptionAt(unwob(wx + CHUNK - scx, wy))) adjEx = true;
    else if (scy > CHUNK - BAND && exceptionAt(unwob(wx, wy + CHUNK - scy))) adjEx = true;
    if (adjEx) { ignored = true; return; }

    ivec2 fpos;
    ivec2 opos;
    biomeAt(wx, wy, fpos, opos);
    if (!exceptionAt(fpos) && !exceptionAt(opos)) { pos = fpos; return; }
    ignored = true;
}

// ============================================================================
// Engine-faithful per-pixel resolve (WorldSave_ResolveCellMaterialAtPixel
// @0x0087d0e0), ported from the bit-exact CPU model in scripts/ref_resolver/
// (spec: reverse/noita docs/worldgen/topology2_resolve.md). GLSL is float32
// like the engine's SSE scalar math, but drivers may fuse/reorder ops, so the
// port follows the binary's operation ORDER and accepts ulp-level divergence
// (knife-edge threshold flips on boundary contours; measured by the harness).
// ============================================================================

int permC(int i) { return int(texelFetch(u_noiseTex, ivec2(i, 1), 0).r); } // classic (simplex)
int permP(int i) { return int(texelFetch(u_noiseTex, ivec2(i, 2), 0).r); } // custom (perlin/value)

float covAt(int x, int y) {
    ivec2 s = textureSize(u_covTex, 0);
    return texelFetch(u_covTex, ivec2(pmod(x, s.x), pmod(y, s.y)), 0).r;
}
int latMatAt(int x, int y) {
    ivec2 s = textureSize(u_latMatTex, 0);
    return int(texelFetch(u_latMatTex, ivec2(pmod(x, s.x), pmod(y, s.y)), 0).r);
}
uint engInfoAt(int cx, int cy) {
    return texelFetch(u_engChunkTex, ivec2(pmod(cx, u_mapWidth), clamp(cy, 0, u_maxRow)), 0).r;
}
vec4 engTable(int col, int row) { return texelFetch(u_engTableTex, ivec2(col, row), 0); }

// ProceduralNoise_Simplex2D @0x00872d40 — classic-table float32 simplex.
// Lattice floor is trunc + DEC-unless-(v>0): 0.0 -> -1, -2.0 -> -3.
const float CS_F2 = 0.36602538824081420898;
const float CS_G2 = 0.21132487058639526367;
const float CS_G2x2 = 0.42264974117279052734;
int skewFloor(float v) { int i = int(v); if (!(v > 0.0)) i -= 1; return i; }
float csCorner(float cx, float cy, int g) {
    float tt = (0.5 - cx * cx) - cy * cy;
    if (tt < 0.0) return 0.0;
    float t2 = tt * tt;
    float u = (g & 7) < 4 ? cx : cy;
    float v = (g & 7) < 4 ? cy : cx;
    if ((g & 1) != 0) u = -u;
    v = v * (((g & 2) != 0) ? -2.0 : 2.0);
    return (u + v) * (t2 * t2);
}
float carveSimplex(float x, float y) {
    float s = (x + y) * CS_F2;
    int i = skewFloor(x + s);
    int j = skewFloor(s + y);
    float t = float(i + j) * CS_G2;
    float x0 = x - (float(i) - t);
    float y0 = y - (float(j) - t);
    int i1 = x0 > y0 ? 1 : 0;
    int j1 = 1 - i1;
    float x1 = (x0 - float(i1)) + CS_G2;
    float y1 = (y0 - float(j1)) + CS_G2;
    float x2 = (x0 - 1.0) + CS_G2x2;
    float y2 = (y0 - 1.0) + CS_G2x2;
    int ii = i & 0xff, jj = j & 0xff;
    float n0 = csCorner(x0, y0, permC(permC(jj) + ii));
    float n1 = csCorner(x1, y1, permC(permC(jj + j1) + ii + i1));
    float n2 = csCorner(x2, y2, permC(permC(jj + 1) + ii + 1));
    return ((n1 + n0) + n2) * 40.0;
}

// ProceduralNoise_Perlin2D @0x00872a20 / ValueNoisePerlinPerm2D @0x00872be0:
// custom permutation table, TRUE lattice floor, fade 6t^5-15t^4+10t^3.
const vec2 GRAD8[8] = vec2[8](vec2(-1.,0.), vec2(1.,0.), vec2(0.,-1.), vec2(0.,1.),
                              vec2(-1.,-1.), vec2(-1.,1.), vec2(1.,-1.), vec2(1.,1.));
float fade5(float t) {
    float a = t * 6.0; a = a - 15.0; a = a * t; a = a + 10.0; a = a * t; a = a * t; a = a * t;
    return a;
}
float perlin2(float x, float y) {
    int ix = int(floor(x)), iy = int(floor(y));
    float fx = x - float(ix), fy = y - float(iy);
    int X = ix & 0xff, Xp = (ix + 1) & 0xff;
    int Y = iy & 0xff, Yp = (iy + 1) & 0xff;
    int pX = permP(X), pX1 = permP(Xp);
    int g00 = permP(pX + Y) & 7, g01 = permP(pX + Yp) & 7;
    int g10 = permP(pX1 + Y) & 7, g11 = permP(pX1 + Yp) & 7;
    float fx1 = fx - 1.0, fy1 = fy - 1.0;
    float n00 = GRAD8[g00].y * fy + fx * GRAD8[g00].x;
    float n10 = GRAD8[g10].y * fy + fx1 * GRAD8[g10].x;
    float n01 = GRAD8[g01].y * fy1 + GRAD8[g01].x * fx;
    float n11 = GRAD8[g11].y * fy1 + GRAD8[g11].x * fx1;
    float fdY = fade5(fy);
    float A = (n01 - n00) * fdY + n00;
    float B = (n11 - n10) * fdY + n10;
    return (B - A) * fade5(fx) + A;
}
float valueNoise2(float x, float y) {
    int ix = int(floor(x)), iy = int(floor(y));
    float fx = x - float(ix), fy = y - float(iy);
    int X = ix & 0xff, Xp = (ix + 1) & 0xff;
    int Y = iy & 0xff, Yp = (iy + 1) & 0xff;
    int pX = permP(X), pX1 = permP(Xp);
    float v00 = float(permP(pX + Y)) / 255.0;
    float v01 = float(permP(pX + Yp)) / 255.0;
    float v10 = float(permP(pX1 + Y)) / 255.0;
    float v11 = float(permP(pX1 + Yp)) / 255.0;
    float fdY = fade5(fy);
    float A = (v01 - v00) * fdY + v00;
    float B = (v11 - v10) * fdY + v10;
    float r = (B - A) * fade5(fx) + A;
    return (r - 0.5) * 2.0;
}

// BiomeNodeLookupCoord @0x0087ce50: world -> 1/10 lattice coord, noise-warped
// by the material's wang_noise_percent. u_centerPx/u_baseY are the engine's
// world offsets (mapW*256, 14*512).
const float ENG_WARP_CX = 0.13715155947046348;
const float ENG_WARP_CY = 0.13717455323209457;
const float ENG_F2 = 0.11111110448837280273;
vec2 engLookupCoord(float scale, ivec2 w) {
    float X = float(w.x + u_centerPx);
    float Y = float(w.y + u_baseY);
    float gx = (X + 0.5) * 0.1;
    float gy = (Y + 0.5) * 0.1;
    if (!(scale > 0.0)) return vec2(gx, gy);
    float fgx = floor(gx), fgy = floor(gy);
    float A = carveSimplex(X * ENG_WARP_CX, Y * ENG_WARP_CY) * 0.45 + 0.1;
    float Yf = Y * ENG_F2, Xf = X * ENG_F2;
    // Y warp: Perlin2D with the arguments SWAPPED; the exact accumulation order
    // of the CPU reference (frac + warp, then + floor).
    float pv = perlin2(Yf, Xf);
    float fyM = 1.0 - A; fyM = fyM * 0.33; fyM = fyM + 0.111; fyM = fyM * scale;
    float outY = pv * fyM; outY = outY + (gy - fgy); outY = fgy + outY;
    float vn = valueNoise2(Xf, Yf);
    float ax = A * scale;
    float outX = vn * ax; outX = outX + (gx - fgx); outX = outX + fgx;
    return vec2(outX, outY);
}

float sstep2(float t) { float sq = t * t; float lin = t * 2.0; return (3.0 - lin) * sq; }

// WangGrid_LookupMaterialIndex @0x008712d0 — smoothstep-aware nearest cell.
int engWangLookup(vec2 c) {
    int x0 = int(floor(c.x)), y0 = int(floor(c.y));
    float fx = c.x - float(x0), fy = c.y - float(y0);
    if (!(0.5 > sstep2(fy))) y0 += 1;
    if (!(0.5 > sstep2(fx))) x0 += 1;
    return latMatAt(x0, y0) - 1;
}

// FloatGrid2D_SampleBilinearSmooth @0x00870e60 (wang_noise_type 0).
float engBilinear(vec2 c) {
    int x0 = int(floor(c.x)), y0 = int(floor(c.y));
    float fx = c.x - float(x0);
    float fy = c.y - float(y0);
    float sFx = sstep2(fx);
    float cTL = covAt(x0, y0 + 1);
    float cBL = covAt(x0, y0);
    float cBR = covAt(x0 + 1, y0);
    float bottom = (cBR - cBL) * sFx + cBL;
    float cTR = covAt(x0 + 1, y0 + 1);
    float top = (cTR - cTL) * sFx + cTL;
    return (top - bottom) * sstep2(fy) + bottom;
}

// FloatGrid2D_SampleCoverageEdge @0x00871160 (wang_noise_type 1) — binary.
float engCoverageEdge(vec2 c) {
    float xp = c.x + 0.5, yp = c.y + 0.5;
    int x0 = int(floor(xp)), y0 = int(floor(yp));
    if (covAt(x0, y0) > 0.5) return 1.0;
    float fx = xp - float(x0), fy = yp - float(y0);
    float omfx = 1.0 - fx;
    int nx, ny;
    if (fx >= fy) { if (omfx <= fy) { nx = x0 + 1; ny = y0; } else { nx = x0; ny = y0 - 1; } }
    else { if (omfx <= fy) { nx = x0; ny = y0 + 1; } else { nx = x0 - 1; ny = y0; } }
    if (covAt(nx, ny) >= 0.5) return 1.0;
    int sx1 = x0 + (fx >= 0.5 ? 1 : -1);
    int sy1 = y0 + (fy >= 0.5 ? 1 : -1);
    if (covAt(sx1, sy1) < 0.5) return 0.0;
    if (covAt(sx1, y0) >= 0.5) return 1.0;
    return covAt(x0, sy1) >= 0.5 ? 1.0 : 0.0;
}

// FloatGrid2D_SampleMaterialEdge @0x00870f80 (wang_noise_type 2) — binary,
// same-material 45-degree corner fills (the temple-brick look).
float engMaterialEdge(vec2 c) {
    float xp = c.x + 0.5, yp = c.y + 0.5;
    int x0 = int(floor(xp)), y0 = int(floor(yp));
    if (covAt(x0, y0) > 0.5) return 1.0;
    float fx = xp - float(x0), fy = yp - float(y0);
    int dx = fx >= fy ? 1 : -1;
    int dy = fx >= fy ? -1 : 1;
    int m0 = latMatAt(x0, y0);
    if (covAt(x0 + dx, y0) >= 0.5 && covAt(x0, y0 + dy) >= 0.5 &&
        latMatAt(x0 + dx, y0) == m0 && latMatAt(x0, y0 + dy) == m0) return 1.0;
    int d = (1.0 - fx) >= fy ? -1 : 1;
    if (covAt(x0 + d, y0) >= 0.5 && covAt(x0, y0 + d) >= 0.5 &&
        latMatAt(x0 + d, y0) == m0 && latMatAt(x0, y0 + d) == m0) return 1.0;
    return 0.0;
}

// BiomeMaterials_ComputeMaterialNoiseDensity @0x0087d010 (ore-vein matNoise).
float engMatNoiseDensity(ivec2 w, float cov) {
    float n1 = valueNoise2(float(w.x) * 0.035, float(w.y) * 0.07);
    float warp = n1 * 15.5;
    float t = (cov - 0.5) * 0.5;
    float sy = (float(w.y) + warp) * 0.048927501;
    float sx = (float(w.x) + warp) * 0.048927501;
    float n2 = carveSimplex(sx, sy);
    float m = t * t; m = m * 5.35; m = m * 0.95;
    float r = n2 * m + cov;
    return 0.5 > r ? 0.5 : r;
}

// BiomeMaterials_RarePolkaTest @0x00872140 + PolkaCellHash @0x0086fd40/0x0086fe30.
const float PK_INV71 = 0.014084507152438164;
const float PK_SCALAR = 0.0010132591396197677;
const float PK_V0 = 0.0010514580644667149;
const float PK_V1 = 0.0015553091652691364;
const float PK_V2 = 0.0012450951617211103;
int engFfloor(float v) { int i = int(v); if (v < float(i)) i -= 1; return i; }
float engFfrac(float v) { return v - float(engFfloor(v)); }
float polkaBase(int cx, int cy) {
    int ix = engFfloor(float(cx) * PK_INV71);
    int iy = engFfloor(float(cy) * PK_INV71);
    float a = (float(cx) - float(ix) * 71.0) + 26.0;
    float b = (float(cy) - float(iy) * 71.0) + 161.0;
    return (b * b) * (a * a);
}
float rarePolka(float x, float y, float plo, float phi, bool boxed, float prob) {
    int cy = engFfloor(y), cx = engFfloor(x);
    float base = polkaBase(cx, cy);
    if (prob <= engFfrac(base * PK_SCALAR)) return 0.0;
    float fx = x - float(cx), fy = y - float(cy);
    float h0 = engFfrac(base * PK_V0);
    float h1 = engFfrac(base * PK_V1);
    float h2 = engFfrac(base * PK_V2);
    float radius = (phi - plo) * h2 + plo;
    if (!(0.0 < radius)) return 0.0;
    float s = 2.0 / radius;
    float sm1 = s - 1.0, sm2 = s - 2.0;
    float dy = sm2 * h1 + (fy * s - sm1);
    float dx = sm2 * h0 + (fx * s - sm1);
    dy = dy * dy; dx = dx * dx;
    float dd;
    if (boxed) { dd = dy * dy + dx * dx; if (1.0 < dd) return 0.0; }
    else { dd = dy + dx; if (1.0 <= dd) dd = 1.0; }
    float u = 1.0 - dd;
    return (u * u) * u;
}

// BiomeMaterials_SelectComponentForCell @0x0086d2a0 — first passing band wins;
// bands are pre-sorted in the engine's runtime order (stable by material_index).
int engBandSelect(int slot, ivec2 w, float density) {
    vec4 hdr = engTable(0, slot);
    if (!(hdr.x <= density && density <= hdr.y)) return 0;
    int nBands = int(hdr.z);
    float fx = float(w.x), fy = float(w.y);
    for (int b = 0; b < 8; b++) {
        if (b >= nBands) break;
        int o = 1 + b * 5;
        vec4 t0 = engTable(o, slot);
        vec4 t1 = engTable(o + 1, slot);
        int flags = int(t1.y);
        if ((flags & 1) != 0 && !(t0.z <= fy && fy <= t0.w)) continue;
        float n = density;
        if ((flags & 2) != 0) n = magicNoise(fx * t1.z, fy * t1.w) + density;
        if (!(t0.x <= n && n < t0.y)) continue;
        if ((flags & 4) == 0) return int(t1.x);
        vec4 t2 = engTable(o + 2, slot);
        vec4 t3 = engTable(o + 3, slot);
        vec4 t4 = engTable(o + 4, slot);
        float rx = fx * t2.x + t2.z;
        float ry = fy * t2.y + t2.w;
        if ((flags & 8) != 0) {
            float p = magicNoise(rx, ry);
            if (!(t3.w < p && p <= t4.x)) continue;
        }
        if ((flags & 16) == 0) return int(t1.x);
        float k = rarePolka(rx, ry, t3.x, t3.y, (flags & 32) != 0, t3.z);
        if (t3.w < k && k <= t4.x) return int(t1.x);
    }
    return 0;
}

// Topology-2 resolve (the mines/crypt coverage-lattice chain).
int engTopo2(int slot, ivec2 w) {
    vec2 c0 = engLookupCoord(0.0, w);
    int idx0 = engWangLookup(c0);
    float scale = 1.0, thr = 0.5;
    int stype = 0;
    if (idx0 >= 1 && idx0 < 512) {
        int wangRow = textureSize(u_engTableTex, 0).y - 1;
        vec4 p = engTable(idx0, wangRow);
        scale = p.x; thr = p.y; stype = int(p.z);
    }
    vec2 c = engLookupCoord(scale, w);
    float cov = stype == 1 ? engCoverageEdge(c) : stype == 2 ? engMaterialEdge(c) : engBilinear(c);
    if (cov < thr) return 0;
    int idx2 = engWangLookup(c);
    if (idx2 >= 1) return idx2;
    return engBandSelect(slot, w, engMatNoiseDensity(w, cov));
}

// Topology-0 pieces (CellNoise_EvaluateCaveAndMaterial @0x0087e110 chain).
// ProceduralNoise_Dispatch @0x00873c00, restricted to the two variants any
// shipped <Topology mInsideNoiseType> asks for: 5 (EdgeNoise_Simplex2D, the
// default when the attribute is absent) and 8 ("SimplexNoise1234",
// ProceduralNoise_Simplex2D — the same function carveSimplex already is).
float engBaseNoise(float x, float y, int variant) {
    return variant == 8 ? carveSimplex(x, y) : magicNoise(x, y);
}
float engFbm4(float x, float y, int variant) {
    const float M0 = 0.84147, M1 = 0.5403;
    float acc = engBaseNoise(x, y, variant) * 0.5;
    float u = ((M0 * x) + (M1 * y)) * 2.02;
    float v = ((M1 * x) + (-M0 * y)) * 2.02;
    acc = acc + engBaseNoise(u, v, variant) * 0.25;
    float u2 = ((M0 * u) + (M1 * v)) * 2.33;
    float v2 = ((M1 * u) + (-M0 * v)) * 2.33;
    acc = acc + engBaseNoise(u2, v2, variant) * 0.125;
    float u3 = ((M0 * u2) + (M1 * v2)) * 2.01;
    float v3 = ((M1 * u2) + (-M0 * v2)) * 2.01;
    acc = acc + engBaseNoise(u3, v3, variant) * 0.0625;
    return acc / 0.9375;
}
// Sin-hash value noise @0x00871850 (even/odd lattice parity picks smoothstep vs
// linear weights). The hash amplifies sin() error 43758x, so integer arguments
// (the only kind this noise produces) read exact CPU-computed values from
// u_sinHashTex; the GPU sin() fallback only runs beyond several parallel worlds.
float engSinHash(float v) {
    int n = int(v) + 262144;
    if (n >= 0 && n < 524288) {
        return texelFetch(u_sinHashTex, ivec2(n & 1023, n >> 10), 0).r;
    }
    float m = sin(v) * 43758.546875;
    return m - floor(m);
}
// Replayed BitmapCaves density-modifier grid (bitmap_caves.js), stacked below
// the sin-hash rows of u_sinHashTex: grid gi at x = (gi&1)*512, y = 512 + (gi>>1)*256,
// wrapped toroidally. FloatGrid2D_SampleBilinearSmooth @0x00870e60: smoothstep-
// faded bilinear over the wrapped corners.
float modGridCell(int gi, int x, int y) {
    int px = pmod(x, 512);
    int py = pmod(y, 256);
    return texelFetch(u_sinHashTex, ivec2(((gi & 1) << 9) + px, 512 + ((gi >> 1) << 8) + py), 0).r;
}
float modGridSample(int gi, float sx, float sy) {
    int x0 = int(floor(sx)), y0 = int(floor(sy));
    float fx = sx - float(x0), fy = sy - float(y0);
    float wx = (3.0 - 2.0 * fx) * fx * fx;
    float wy = (3.0 - 2.0 * fy) * fy * fy;
    float c00 = modGridCell(gi, x0, y0),     c10 = modGridCell(gi, x0 + 1, y0);
    float c01 = modGridCell(gi, x0, y0 + 1), c11 = modGridCell(gi, x0 + 1, y0 + 1);
    float top = c00 + wx * (c10 - c00);
    float bot = c01 + wx * (c11 - c01);
    return top + wy * (bot - top);
}
float engCarveVN(float x, float y) {
    int ix = int(floor(x)), iy = int(floor(y));
    float fx = x - float(ix), fy = y - float(iy);
    float fadeX = (3.0 - fx * 2.0) * (fx * fx);
    float u0 = (ix & 1) == 0 ? fadeX : fx;
    float u1 = ((ix + 1) & 1) == 0 ? fadeX : fx;
    float u = (u1 - u0) * fx + u0;
    float fadeY = (3.0 - fy * 2.0) * (fy * fy);
    float v0 = (iy & 1) == 0 ? fadeY : fy;
    float v1 = ((iy + 1) & 1) == 0 ? fadeY : fy;
    float v = (v1 - v0) * fy + v0;
    float n = float(iy) * 57.0 + float(ix);
    float h57 = engSinHash(n + 57.0), h58 = engSinHash(n + 58.0);
    float h0 = engSinHash(n), h1 = engSinHash(n + 1.0);
    float hTop = (h58 - h57) * u + h57;
    float hBot = (h1 - h0) * u + h0;
    return (hTop - hBot) * v + hBot;
}
// @0x00871630 — the same sin-hash value noise WITHOUT the parity twist: both
// axes always take the smoothstep weight. Only the noise_type 3 carve calls it.
float engCarveVNSmooth(float x, float y) {
    int ix = int(floor(x)), iy = int(floor(y));
    float fx = x - float(ix), fy = y - float(iy);
    float u = (3.0 - fx * 2.0) * (fx * fx);
    float v = (3.0 - fy * 2.0) * (fy * fy);
    float n = float(iy) * 57.0 + float(ix);
    float h57 = engSinHash(n + 57.0), h58 = engSinHash(n + 58.0);
    float h0 = engSinHash(n), h1 = engSinHash(n + 1.0);
    float hTop = (h58 - h57) * u + h57;
    float hBot = (h1 - h0) * u + h0;
    return (hTop - hBot) * v + hBot;
}
// The shared blend tail @0x0087e6f0.
float engCarveBlend(float s, float density) {
    float cave = s * density;
    float t = (density - 0.85) / 0.1;
    return (cave - density) * t + density;
}
// noise_type 0 (IQ2_SIMPLEX1234), the switch's default branch @0x0087e3e8.
float engCarveDensity(float wx, float wy, float density) {
    float vn = engCarveVN(wx * 0.025, wy * 0.025);
    float a = vn * 0.05 + 0.05;
    float sx = a * ((wx * 0.5) * 0.02);
    float sy = ((wy * 0.5) * 0.02) * a;
    return engCarveBlend(carveSimplex(sx, sy), density);
}
// noise_type 3 (SIN_CAPPED_SIMPLEX) @0x0087e48b: the simplex coordinate is
// cos(x/1024) / sin(y/1024) scaled by 1024*0.5*0.06 and the same 0.05..0.1
// value-noise amplitude, i.e. CAPPED to a bounded box — and the simplex is
// EdgeNoise_Simplex2D (magicNoise), not the type-0 branch's
// ProceduralNoise_Simplex2D.
float engCarveDensity3(float wx, float wy, float density) {
    float vn = engCarveVNSmooth(wx * 0.02, wy * 0.021);
    float a = vn * 0.05 + 0.05;
    float sx = cos(wx * 0.0009765625) * 1024.0 * 0.5 * 0.06 * a;
    float sy = sin(wy * 0.0009765625) * 1024.0 * 0.5 * 0.06 * a;
    return engCarveBlend(magicNoise(sx, sy), density);
}

const int ENG_TOPO0_COL = 48;   // topo0 params live after the 48 band columns
float engSurfaceTop(vec4 t0, vec4 t1, float wx, out float botY) {
    int edge = int(t0.x);
    float topB = t0.y, botB = t0.z;
    if (edge == 0) { botY = botB; return topB; }
    if (edge == 3) {
        float d = (wx - t1.z) * t1.w;
        botY = botB + d;
        return topB + d;
    }
    float sx = t0.w * (u_surfacePhase + wx);
    botY = magicNoise(sx, botB * t0.w) * t1.y + botB;
    return magicNoise(sx, topB * t0.w) * t1.x + topB;
}
// CellNoise_EvaluateCaveBoundary @0x0087e8d0: depth ratio in the biome's
// gradient band, blended with the LEFT neighbour cell's line near the surface.
// CellNoise_EvaluateCaveBoundary @0x0087e8d0. Which chunk's surface line is
// used depends on depth, and the two answers differ inside the wobble band:
// below y=380 it is the BiomeChunk the caller resolved (the WOBBLED cell),
// unblended; at/above 380 the function ignores that argument and re-derives the
// cell from the raw coordinates — the PHYSICAL map cell — then blends with THAT
// cell's left neighbour over the first 42px. So near the surface the bands come
// from the wobbled biome while the depth ratio comes from the physical one.
float engDepthRatio(int slot, int physSlot, int leftSlot, float wx, float wy, float subX) {
    int base = wy <= 380.0 ? physSlot : slot;
    vec4 t0 = engTable(ENG_TOPO0_COL + 0, base);
    vec4 t1 = engTable(ENG_TOPO0_COL + 1, base);
    float botY;
    float topY = engSurfaceTop(t0, t1, wx, botY);
    if (wy <= 380.0 && subX < 42.0) {
        vec4 l0 = engTable(ENG_TOPO0_COL + 0, leftSlot);
        vec4 l1 = engTable(ENG_TOPO0_COL + 1, leftSlot);
        float lBot;
        float lTop = engSurfaceTop(l0, l1, wx, lBot);
        float f = 1.0 - subX / 41.0;
        topY = (lTop - topY) * f + topY;
        botY = (lBot - botY) * f + botY;
    }
    if (wy <= topY) return 0.0;
    if (botY <= wy) return 1.0;
    if (botY == topY) return 1.0;
    return (wy - topY) / (botY - topY);
}
// CellNoise_EvaluateCaveAndMaterial @0x0087e110 (noise_type 0 and 3 carve
// regimes — the only two the shipped biomes use; unsupported variants never
// reach the shader — see buildEngineResources).
float engEvalCaveMat(int slot, int physSlot, int leftSlot, ivec2 w) {
    vec4 t2p = engTable(ENG_TOPO0_COL + 2, slot);
    vec4 t3p = engTable(ENG_TOPO0_COL + 3, slot);
    vec4 t4p = engTable(ENG_TOPO0_COL + 4, slot);
    vec4 t5p = engTable(ENG_TOPO0_COL + 5, slot);
    float wx = float(w.x) + 0.5, wy = float(w.y) + 0.5;
    int mk = int(t5p.x);
    float m = 1.0;
    bool blendMod = false;
    float modOff = 0.0;  // BiomeNode+0x94 sample offset of the blended node
    if (mk == 1) { m = t5p.y; if (m < 1.0) blendMod = true; }
    else if (mk == 2) { m = 0.0; blendMod = true; modOff = t5p.y; }  // lakes: 0x0 bitmap-noise node, seed-derived offset
    else if (mk == 3) {
        int gi = int(t5p.z);
        if (gi >= 0) {  // -1: <BitmapCaves> params not ported, keep m = 1.0
            // sample coords include the grid's node+0x94 offset (w*0.5/0.1 =
            // 2560 for the 512-wide grids), unlike the const/empty blend below
            float gx = (wx * 0.49162514 + 2560.0) * 0.1;
            float gy = (2560.0 * 6.86035959282328e-7 + wy * 0.49162514) * 0.1;
            m = modGridSample(gi, gx, gy);
            if (m < 1.0) m = m + magicNoise(gx, gy) * ((1.0 - m) * 0.495);
        }
    }
    if (blendMod) {
        float gx = (wx * 0.49162514 + modOff) * 0.1;
        float gy = (modOff * 6.86035959282328e-7 + wy * 0.49162514) * 0.1;
        float sN = magicNoise(gx, gy);
        m = m + (sN * (1.0 - m)) * 0.495;
    }
    if (!(m > 0.0)) return 0.0;
    float subX = float(pmod(w.x + u_centerPx, CHUNK));
    float r = engDepthRatio(slot, physSlot, leftSlot, wx, wy, subX);
    float density = r * m;
    if (density <= 0.0) return 0.0;
    float matWeight = 0.0, mn = 0.0;
    if (0.51 < density && t2p.y != 0.0) {
        matWeight = (density - 0.5) * 2.0;
        float msx = wx * 0.05243442 * t3p.x + 0.1 + t3p.z;
        float msy = wy * 0.05243442 * t3p.y + 0.1 + t3p.w;
        int ifl = int(t4p.x);
        int inoise = int(t4p.w);   // mInsideNoiseType, the dispatch variant
        mn = (ifl & 1) != 0 ? engFbm4(msx, msy, inoise)
                            : engBaseNoise(msx, msy, inoise);
        if ((ifl & 2) != 0) mn = mn * mn;
        if ((ifl & 4) != 0) mn = clamp(mn, t4p.y, t4p.z);
        if ((ifl & 8) != 0) mn = (t4p.z - t4p.y) * (mn * 0.5 + 0.5) + t4p.y;
    }
    float addValue = 0.0;
    if (density > 0.85) {
        addValue = t2p.z;
        density = int(t2p.w) == 3 ? engCarveDensity3(wx, wy, density)
                                  : engCarveDensity(wx, wy, density);
    }
    return ((t2p.y * matWeight) * mn + (t2p.x * density)) + addValue;
}
int engTopo0(int slot, int physSlot, int leftSlot, ivec2 w) {
    vec4 hdr = engTable(0, slot);
    if (hdr.z < 1.0) return 0;    // no MaterialComponents: this path paints nothing
    return engBandSelect(slot, w, engEvalCaveMat(slot, physSlot, leftSlot, w));
}

// ChunkGrid_ResolveChunkAtPosition @0x0087d9a0 — the engine's own biome-cell
// wobble (no telescope exception lists here).
void engProbe(int px, int py, uvec3 oc, inout uvec3 nc, inout ivec2 npos, inout bool hit) {
    uvec3 c = chunkAt(ivec2(px, py)).rgb;
    if (any(notEqual(c, oc))) { nc = c; npos = ivec2(px, py); hit = true; }
}
// Absolute pixel throughout: the chunk index wraps on the map pitch
// (chunkAt/engInfoAt pmod u_mapWidth), not on the PW stride.
ivec2 engResolveCell(ivec2 w) {
    int sx = w.x + u_centerPx, sy = w.y + u_baseY;
    int cx = fdiv(sx, CHUNK), cy = fdiv(sy, CHUNK);
    if ((engInfoAt(cx, cy) & 1024u) == 0u) return ivec2(cx, cy);
    int subX = pmod(sx, CHUNK), subY = pmod(sy, CHUNK);
    if (subX >= 42 && subY >= 42 && subX <= 470 && subY <= 470) return ivec2(cx, cy);
    uvec3 oc = chunkAt(ivec2(cx, cy)).rgb;
    uvec3 nc = oc;
    ivec2 npos = ivec2(cx, cy);
    bool hit = false;
    if (subX < 42) engProbe(cx - 1, cy, oc, nc, npos, hit);
    if (!hit && subY < 42) engProbe(cx, cy - 1, oc, nc, npos, hit);
    if (!hit && subX > 470) engProbe(cx + 1, cy, oc, nc, npos, hit);
    if (!hit && subY > 470) engProbe(cx, cy + 1, oc, nc, npos, hit);
    if (!hit && subX < 42 && subY < 42) engProbe(cx - 1, cy - 1, oc, nc, npos, hit);
    if (!hit && subX < 42 && subY > 470) engProbe(cx - 1, cy + 1, oc, nc, npos, hit);
    if (!hit && subX > 470 && subY < 42) engProbe(cx + 1, cy - 1, oc, nc, npos, hit);
    if (!hit && subX > 470 && subY > 470) engProbe(cx + 1, cy + 1, oc, nc, npos, hit);
    if (!hit || (engInfoAt(npos.x, npos.y) & 1024u) == 0u) return ivec2(cx, cy);
    float s = magicNoise(float(sx) * 0.05, float(sy) * 0.05);
    float offCol = sin(float(sy) * 0.005) * 30.0 + s * 11.0;
    float offRow = cos(float(sx) * 0.005) * 30.0 + s * 11.0;
    int wCx = fdiv(int(offCol + float(sx)), CHUNK);
    int wCy = fdiv(int(offRow + float(sy)), CHUNK);
    if ((engInfoAt(wCx, wCy) & 1024u) == 0u) return ivec2(cx, cy);
    return ivec2(wCx, wCy);
}

// Material id -> color: materials_gfx texel at absolute world coords when the
// material has a texture (byte-exact vs the game), else the engine's flat
// display color. The XML color text is plain aRGB (water A0376259 -> #376259);
// ABGR is only the engine's in-memory byte order, already normalized in
// engine_data.js — no swap here.
// mc.x packs (alpha << 8) | atlasEntry (buildMatColorTable). An untextured
// material's alpha is its XML color's alpha byte -- the straight src-over
// alpha the game's cell grid composites with (sprite_cellgrid.frag) -- so
// water paints premultiplied 0xA0-translucent over the background layer.
void engMaterialColor(int mat, ivec2 w) {
    uvec4 mc = texelFetch(u_matMetaTex, ivec2(mat, 1), 0);
    uint entry = mc.x & 0xffu;
    // u_matDetail off (toggle, or auto below MATERIAL_DETAIL_MIN_ZOOM): flat
    // display color instead of per-cell texels, which only alias at sub-pixel.
    if (u_matDetail && entry > 0u) { materialTexel(int(entry), w, outColor); return; }
    float a = float(mc.x >> 8) / 255.0;
    outColor = vec4(vec3(mc.yzw) / 255.0 * a, a);
}

void main() {
    // Screen pixel center -> world. gl_FragCoord.y counts from the bottom.
    // u_vpOrigin is (0,0) for the screen pass; the material-id tile pass draws
    // several tiles into one framebuffer through offset viewports.
    vec2 pix = vec2(gl_FragCoord.x - float(u_vpOrigin.x), u_screenSize.y - (gl_FragCoord.y - float(u_vpOrigin.y)));
    vec2 off = u_originFrac + pix * u_invZoom;
    ivec2 w = u_originInt + ivec2(floor(off));

    outColor = vec4(0.0);

    // No vertical-band early-out: heaven (above row 0) and hell (below row 47)
    // are the row-0 / row-47 biomes generated at the pixel's RAW world y -- the
    // engine clamps only the chunk-row lookup and keeps feeding true coordinates
    // to the noise/topo/texture math, which is what every row lookup below does
    // (unwob, chunkAt, engInfoAt, rasterChunk all clamp; noise and material
    // texels sample w directly). Game-validated at the map top on seed
    // 786433191: dense the_sky clouds continue upward, snow columns stay air.
    int pwX = fdiv(w.x + u_centerPx, u_worldSizeX);
    // Two frames. The biome map wraps on its own pitch: the chunk-table cell,
    // the edge-wobble cell and sub_x all come from the ABSOLUTE pixel w
    // (ChunkGrid_ResolveChunkAtPosition @0x0087d9a0: (shifted_x >> 9) % width,
    // raw shifted_x into sub_x and the simplex/sin/cos), as does everything
    // evaluated from a coordinate -- topo0 surface line / carve / inside noise,
    // band-select noise and polka, topo2 warp, material texels (the lake's
    // surface ramp keeps rising through the east worlds; solid_wall's bands
    // never repeat). Only the wang region anchors fold, on the PW stride
    // u_worldSizeX: in NG+/nightmare that is 64*512-8 while the map pitch is
    // 64*512, so biome columns drift 8px per world against the content.
    ivec2 wFold = ivec2(w.x - pwX * u_worldSizeX, w.y);

    // Engine-faithful resolve: the game's own per-pixel chain for every chunk
    // whose biome the port supports; anything else falls through to the legacy
    // pipeline below (per chunk, so the two coexist seam-by-seam).
    if (u_engineTerrain) {
        ivec2 cell = engResolveCell(w);
        uint info = engInfoAt(cell.x, cell.y);
        uint mode = (info >> 8) & 3u;
        // Material-id output (edge-decal tiles, terrain_renderer.js
        // resolveMaterialTiles): the same resolve the color pass runs, but the
        // answer is the material id -- what engine_resolve/material_field.js
        // computes on the CPU, at 24 ms a tile. Encoded id+1 in R (low byte)
        // and G (high byte); 0 = unresolved (fallback chunk, the CPU's -1),
        // 1 = air. A "paints nothing" chunk is air, as in the color pass.
        if (u_materialIdOut) {
            int mat = -1;
            if ((info & 2048u) != 0u) {
                mat = 0;
            } else if (mode != 2u) {
                int slot = int(info & 0xffu);
                if (mode == 1u) {
                    mat = engTopo2(slot, w);
                } else {
                    int pcx = fdiv(w.x + u_centerPx, CHUNK);
                    int pcy = fdiv(w.y + u_baseY, CHUNK);
                    int physSlot = int(engInfoAt(pcx, pcy) & 0xffu);
                    int leftSlot = int(engInfoAt(pcx - 1, pcy) & 0xffu);
                    mat = engTopo0(slot, physSlot, leftSlot, w);
                }
                if (mat < 0) mat = 0;
            }
            int code = mat + 1;
            outColor = vec4(float(code & 0xff) / 255.0, float((code >> 8) & 0xff) / 255.0, 0.0, 1.0);
            return;
        }
        // The resolved cell's biome generates no terrain at all: a BIOME_WANG_TILE
        // biome with an empty wang_template_file, which ProceduralTerrain_Init
        // @0x0087a900 never gives a wang region (it needs
        // Biome+0x04 == 2 && wang_template_file.size() != 0), so it has no
        // covergrid to sample and its chunk is purely what its biome lua stamps.
        // Answer air rather than falling through: the legacy pipeline re-resolves
        // the biome with its own edge-noise rules, and where those disagree with
        // the engine's wobble it paints a NEIGHBOUR's fill material over the room's
        // air — e.g. rock_room chunk 28,20 on seed 786433191, where the game leaves
        // air and telescope drew solid rock_hard_border. Same for roadblock chunk
        // 33,11, whose scene (data/biome_impl/roadblock.png) is fully transparent:
        // the game MAPDUMPs 0/262144 filled where telescope drew a solid square.
        if ((info & 2048u) != 0u) return;
        if (mode != 2u) {
            int slot = int(info & 0xffu);
            int mat;
            if (mode == 1u) {
                mat = engTopo2(slot, w);
            } else {
                // The surface line near the top of the world comes from the
                // PHYSICAL biome-map cell, not the wobble-resolved one — see
                // engDepthRatio.
                int pcx = fdiv(w.x + u_centerPx, CHUNK);
                int pcy = fdiv(w.y + u_baseY, CHUNK);
                int physSlot = int(engInfoAt(pcx, pcy) & 0xffu);
                int leftSlot = int(engInfoAt(pcx - 1, pcy) & 0xffu);
                mat = engTopo0(slot, physSlot, leftSlot, w);
            }
            if (mat > 0) engMaterialColor(mat, w);
            return;
        }
    }

    ivec2 pos;
    bool ignored;
    overlayBiome(w.x, w.y, pos, ignored);

    uvec4 cc = chunkAt(pos);
    // Constant-material fill biome: every cell the engine paints there is the
    // biome's fill material, so the resolved chunk is the whole answer — no
    // region, no atlas, no palette. Checked before the ignored early-out
    // because "ignore edge noise" means "use the unwobbled chunk" (which is what
    // overlayBiome leaves in pos), not "paint nothing"; a fill chunk next to a
    // holy-mountain wall is still solid rock in game.
    if ((cc.a & ${CHUNK_FLAG_FILL}u) != 0u) {
        // Absolute world coords, never the PW-unwrapped sx: the engine bakes each
        // cell from its own world position, so the pattern runs on across worlds.
        if (u_matDetail) {
            uint entry = fillMaterialAt(pos);
            // A transparent texel leaves outColor at vec4(0) — air, as in game.
            if (entry > 0u) { materialTexel(int(entry), w, outColor); return; }
        }
        outColor = chunkForeground(pos);
        return;
    }
    if (ignored) return;
    if ((cc.a & ${CHUNK_FLAG_HAS_TILES}u) == 0u) return;

    // The engine's whole-image mod-wrap, in the parallel world's own frame:
    // Region anchors are PW-0 world coords: the stride-folded x.
    int sx = wFold.x;

    // Region ownership follows the buffers' own masking grid (rasterChunk), not
    // the 512-px chunk grid — and it is NOT shifted by the wobble. The CPU bake
    // never moves wang content across a chunk border: every layer draws its own
    // buffer at its own fixed world position (image_processing.js
    // createTileOverlaysExpanded, "Central area"), so the *only* layer that can
    // paint a world pixel is the one owning that pixel's raster chunk. Edge noise
    // enters through the colors alone — the gray/foreground class and the
    // suppression rules read the wobbled chunk (pos, above), which is exactly
    // what getTileOverlayBiome feeds the CPU bake.
    //
    // Shifting this lookup by the wobble (as the pre-fix shader did, both on the
    // true grid and on the raster grid) samples a *different region's* buffer
    // inside every 42-px chunk-border band. Where neighbouring chunks share one
    // region that is invisible; where biomes alternate chunk by chunk it is not.
    // Seed 786433191's underground jungle (rows 27-29, cols 30-36: rainforest /
    // rainforest_open / fungicave in a checkerboard) showed it plainly: on a
    // 19k-sample lattice over x[-2700..-1500] y[7300..7550], the shifted lookup
    // left 299 samples sampling *outside* the chosen region's extent (whole-image
    // mod-wrap garbage) and 322 more painting air where the CPU paints terrain;
    // unshifted, all 18963 samples agree with the CPU's layer and palette index.
    ivec2 rpos = ivec2(pmod(rasterChunk(sx, u_centerPx, VIS_X), u_mapWidth),
                       clamp(rasterChunk(w.y, u_baseY, VIS_Y), 0, u_maxRow));
    uint slot = texelFetch(u_indirTex, rpos, 0).r;
    if (slot == ${NO_REGION}u) return;

    ivec4 m0 = texelFetch(u_regionTex, ivec2(0, int(slot)), 0);  // atlasX, atlasY, width, mapH
    ivec4 m1 = texelFetch(u_regionTex, ivec2(1, int(slot)), 0);  // originX, originY, flags, biomeColor

    int lx = pmod(fdiv(sx - m1.x, TILE), m0.z);
    int ly = pmod(fdiv(w.y - m1.y, TILE), m0.w);
    uint idx = texelFetch(u_atlasTex, ivec2(m0.x + lx, m0.y + ly), 0).r;

    vec4 pal = texelFetch(u_paletteTex, ivec2(int(idx), 0), 0);
    int mode = int(pal.a * 255.0 + 0.5);
    if (mode == ${PALETTE_ALPHA_SKIP}) return;                 // air, or cleared spawn pixel
    if (mode == ${PALETTE_ALPHA_CHUNK_FG}) {                   // gray / white: per-chunk foreground
        if ((cc.a & ${CHUNK_FLAG_FG_DEFINED}u) == 0u) return;
        outColor = chunkForeground(pos);
        return;
    }
    if (u_matDetail) {
        uint entry = texelFetch(u_palMatTex, ivec2(int(idx), 0), 0).r;
        if (entry > 0u) { materialTexel(int(entry), w, outColor); return; }
    }
    // Direct-color cells composite with their material's XML alpha (row 1),
    // premultiplied, over the background layer -- water pools in wang caves.
    float a = float(texelFetch(u_palMatTex, ivec2(int(idx), 1), 0).r) / 255.0;
    outColor = vec4(pal.rgb * a, a);
}
`;
