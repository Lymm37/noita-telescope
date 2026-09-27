// GL pixel-scene pass: drawNow layer 5's scene images, drawn into the terrain
// renderer's canvas right after the terrain and before it is blitted, instead of
// one (or, with a FORCE AIR mask, two) Canvas2D drawImage per scene per frame.
//
// Scene bitmaps still come from the pixel-scene bitmap cache (built in the
// overlay worker); this pass copies each one it needs into an RGBA atlas page
// once and keeps it there. Pages are shelf-packed in arrival order and evicted
// whole, least recently drawn first, over a byte budget -- scenes of every
// size come and go, and a whole-page eviction never fragments.
//
// Per world copy the visible scenes become one instance buffer, grouped by
// page, rebuilt only when the view crosses a coarse cell, the mip level
// changes, a bitmap lands or a page is evicted. A pan inside a cell is a few
// uniforms and one instanced draw per page: no per-scene JS at all.
//
// FORCE AIR (#000042, textured level-0 entries only) is drawn first as an
// alpha erase of the terrain canvas, so the 2D layers under the terrain blit
// (the background stack) show through the hole. That replaces the Canvas2D
// path's destination-out mask plus the destination-over background refill.
// Unlike the 2D path, all masks of a copy erase before any scene paints, so a
// scene's air no longer erases an EARLIER overlapping scene's pixels.

import {
    getPixelSceneDrawable, PIXEL_SCENE_DATA, PIXEL_SCENE_MAX_MIP, pixelSceneBitmapVersion,
    pixelSceneCacheEpoch, pixelSceneCacheKeys, pixelScenesTexturedAt, warmPixelScene,
} from '../pixel_scene_generation.js';
import { renderHud } from '../render_hud.js';
import { pixelFilterGLSL } from './shaders.js';

const VS = `#version 300 es
layout(location = 0) in ivec4 a_rect;   // scene rect in list space: x, y, w, h (world px)
layout(location = 1) in ivec4 a_src;    // atlas x, y and bitmap w, h
layout(location = 2) in ivec2 a_mask;   // atlas x, y of the air mask (same size as the bitmap)
uniform ivec2 u_copyInt;                // list space -> screen-origin space, integer part
uniform vec2 u_copyFrac;
uniform float u_zoom;
uniform vec2 u_screen;
uniform bool u_air;
out vec2 v_local;
flat out ivec4 v_src;
flat out ivec2 v_size;
void main() {
    int c = gl_VertexID;
    vec2 corner = vec2((c == 1 || c == 2 || c == 4) ? 1.0 : 0.0, (c == 2 || c == 4 || c == 5) ? 1.0 : 0.0);
    // Integer add first: list-space positions carry the PW stride.
    vec2 world = vec2(a_rect.xy + u_copyInt) + u_copyFrac + corner * vec2(a_rect.zw);
    vec2 s = world * u_zoom;
    gl_Position = vec4(s.x / u_screen.x * 2.0 - 1.0, 1.0 - s.y / u_screen.y * 2.0, 0.0, 1.0);
    v_local = corner * vec2(a_rect.zw);
    v_src = u_air ? ivec4(a_mask, a_src.zw) : a_src;
    v_size = a_rect.zw;
}`;

const FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_atlas;
uniform bool u_air;
uniform float u_zoom;
in vec2 v_local;
flat in ivec4 v_src;
flat in ivec2 v_size;
out vec4 outColor;
// Texels are premultiplied (UNPACK_PREMULTIPLY_ALPHA_WEBGL), so they average directly.
vec4 sceneTexel(ivec2 q) { return texelFetch(u_atlas, v_src.xy + clamp(q, ivec2(0), v_src.zw - 1), 0); }
${pixelFilterGLSL('sceneFiltered', '', 'sceneTexel(q)')}
void main() {
    // The bitmap (any mip level) is stretched over the scene's full-resolution rect.
    vec2 scale = vec2(v_src.zw) / vec2(v_size);
    vec2 tc = v_local * scale;
    ivec2 t = clamp(ivec2(floor(tc)), ivec2(0), v_src.zw - 1);
    if (u_air) {
        // The air mask stays nearest and binary: it erases, it does not blend.
        if (texelFetch(u_atlas, v_src.xy + t, 0).a == 0.0) discard;
        outColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    vec4 c = sceneFiltered(t, tc - floor(tc), scale / u_zoom);
    // Coverage never drops below the nearest texel's: a one-pixel seam between a
    // scene and the terrain must not turn translucent (see halveWithoutHoles).
    vec4 n = sceneTexel(t);
    if (c.a < n.a) c = c.a > 0.0 ? c * (n.a / c.a) : n;
    if (c.a == 0.0) discard;
    outColor = c;
}`;

const UNIFORMS = ['u_copyInt', 'u_copyFrac', 'u_zoom', 'u_screen', 'u_air', 'u_atlas'];

const STRIDE_INTS = 12;             // rect(4) src(4) mask(2) pad(2)
const GRID_CELL = 2048;             // list-space bucket for the visibility query
const UPLOAD_BYTES_PER_FRAME = 16 * 1024 * 1024;   // at least one upload always goes through
const LIST_STATES_MAX = 32;
// Bitmaps landing re-run a copy's query at most this often. While a build burst
// streams in (Render Everything's warm-up: thousands of textured instances) a
// requery per landed bitmap per frame costs more than the whole old 2D path.
const VERSION_REQUERY_MS = 50;

function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(`GL scene shader compile failed: ${log}`);
    }
    return sh;
}

const cellKey = (cx, cy) => (cx + 0x100000) * 0x200000 + (cy + 0x100000);

export class GLSceneRenderer {
    constructor() {
        this.gl = null;
        this.program = null;
        this.uniforms = null;
        this.vao = null;
        this.failed = null;
        this.lost = false;
        this.resetResidency();
    }

    resetResidency() {
        this.pages = [];
        this.openPage = null;
        this.slots = new Map();       // `${cacheKey}#${level}` -> { page, x, y, w, h, mask }
        this.bytes = 0;
        this.residency = 0;           // bumped on eviction: list instances may point at dead pages
        this.lists = new Map();       // placement list -> per-copy state, LRU order
        this.epoch = pixelSceneCacheEpoch();
    }

    dropAll() {
        const gl = this.gl;
        if (gl && !this.lost) {
            for (const p of this.pages) gl.deleteTexture(p.tex);
            for (const s of this.lists.values()) if (s.buffer) gl.deleteBuffer(s.buffer);
        }
        this.resetResidency();
    }

    init(gl) {
        if (this.failed) return false;
        if (this.gl === gl && this.program) return true;
        this.gl = gl;
        try {
            const prog = gl.createProgram();
            const vs = compile(gl, gl.VERTEX_SHADER, VS), fs = compile(gl, gl.FRAGMENT_SHADER, FS);
            gl.attachShader(prog, vs);
            gl.attachShader(prog, fs);
            gl.linkProgram(prog);
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
                throw new Error(`GL scene program link failed: ${gl.getProgramInfoLog(prog)}`);
            }
            this.program = prog;
        } catch (err) {
            console.warn('[GL scenes]', err);
            this.failed = String(err);
            return false;
        }
        this.uniforms = Object.fromEntries(UNIFORMS.map(n => [n, gl.getUniformLocation(this.program, n)]));
        this.vao = gl.createVertexArray();
        this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        this.pageSize = Math.min(2048, this.maxTex);
        return true;
    }

    /** For the render HUD's bakes line. */
    stats() {
        return { pages: this.pages.length, bytes: this.bytes, slots: this.slots.size };
    }

    // --- atlas pages ------------------------------------------------------

    newPage(w, h) {
        const gl = this.gl;
        const bytes = w * h * 4;
        while (this.bytes + bytes > this.budget) {
            // Least recently drawn, never one this frame or the last touched.
            let victim = null;
            for (const p of this.pages) {
                if (p.frame >= this.frame - 1) continue;
                if (!victim || p.frame < victim.frame) victim = p;
            }
            if (!victim) return null;
            this.evictPage(victim);
        }
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
        const page = { tex, w, h, bytes, x: 0, y: 0, shelfH: 0, frame: this.frame, keys: [], dead: false };
        this.pages.push(page);
        this.bytes += bytes;
        return page;
    }

    evictPage(page) {
        this.gl.deleteTexture(page.tex);
        page.dead = true;
        for (const key of page.keys) this.slots.delete(key);
        this.pages.splice(this.pages.indexOf(page), 1);
        if (this.openPage === page) this.openPage = null;
        this.bytes -= page.bytes;
        this.residency++;
    }

    /** Space for a w x h image: shelf-packed into the open page, or a page of its own if oversize. */
    allocate(w, h) {
        const P = this.pageSize;
        if (w > P || h > P) {
            if (w > this.maxTex || h > this.maxTex) return null;
            const page = this.newPage(w, h);
            return page && { page, x: 0, y: 0 };
        }
        let page = this.openPage;
        if (page) {
            if (page.x + w > P) { page.y += page.shelfH; page.x = 0; page.shelfH = 0; }
            if (page.y + h > P) page = null;
        }
        if (!page) {
            page = this.newPage(P, P);
            if (!page) return null;
            this.openPage = page;
        }
        const at = { page, x: page.x, y: page.y };
        page.x += w;
        if (h > page.shelfH) page.shelfH = h;
        return at;
    }

    upload(bitmap, slotKey) {
        const gl = this.gl;
        const at = this.allocate(bitmap.width, bitmap.height);
        if (!at) return null;
        gl.bindTexture(gl.TEXTURE_2D, at.page.tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, at.x, at.y, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        at.page.keys.push(slotKey);
        this.uploadedBytes += bitmap.width * bitmap.height * 4;
        return at;
    }

    /** Resident slot for a drawable, uploading it (and its air mask) if needed. */
    slotFor(drawable, level, state) {
        const key = `${drawable.cacheKey}#${level}`;
        let slot = this.slots.get(key);
        if (slot) return slot;
        const bmp = drawable.bitmap;
        if (!bmp || !bmp.width || !bmp.height) return null;
        if (this.uploadedBytes > 0 && this.uploadedBytes + bmp.width * bmp.height * 4 > UPLOAD_BYTES_PER_FRAME) {
            state.incomplete = true;
            return null;
        }
        const img = this.upload(bmp, key);
        if (!img) return null;
        let mask = null;
        const m = drawable.airMask;
        if (m && m.width === bmp.width && m.height === bmp.height) {
            mask = this.upload(m, key);
            // No room for the mask: draw the scene without its air rather than not at all.
        }
        slot = { page: img.page, x: img.x, y: img.y, w: bmp.width, h: bmp.height, mask };
        this.slots.set(key, slot);
        return slot;
    }

    residentSlot(keys, level) {
        for (const k of keys) {
            const s = this.slots.get(`${k}#${level}`);
            if (s) return s;
        }
        return null;
    }

    // --- per placement list ----------------------------------------------

    listState(list, relOffX, relOffY) {
        let s = this.lists.get(list);
        if (s && (s.relOffX !== relOffX || s.relOffY !== relOffY)) {
            if (s.buffer) this.gl.deleteBuffer(s.buffer);
            this.lists.delete(list);
            s = null;
        }
        if (s) {
            this.lists.delete(list);   // re-insert: Map order is the LRU order
            this.lists.set(list, s);
            return s;
        }
        // Scenes bucketed by every grid cell their rect touches.
        const grid = new Map();
        for (let i = 0; i < list.length; i++) {
            const scene = list[i];
            const data = PIXEL_SCENE_DATA[scene.key];
            if (!data) continue;
            const x = scene.x + relOffX, y = scene.y + relOffY;
            const cx0 = Math.floor(x / GRID_CELL), cx1 = Math.floor((x + data.width - 1) / GRID_CELL);
            const cy0 = Math.floor(y / GRID_CELL), cy1 = Math.floor((y + data.height - 1) / GRID_CELL);
            for (let cy = cy0; cy <= cy1; cy++) {
                for (let cx = cx0; cx <= cx1; cx++) {
                    const k = cellKey(cx, cy);
                    let cell = grid.get(k);
                    if (!cell) grid.set(k, cell = []);
                    cell.push(i);
                }
            }
        }
        s = {
            relOffX, relOffY, grid, stamp: new Uint32Array(list.length), stampN: 0,
            buffer: null, colorGroups: [], airGroups: [],
            queryKey: null, version: -1, residency: -1, queriedAt: 0, incomplete: false, frame: this.frame,
        };
        this.lists.set(list, s);
        for (const [oldList, old] of this.lists) {
            if (this.lists.size <= LIST_STATES_MAX) break;
            if (old.frame >= this.frame - 1) continue;
            if (old.buffer) this.gl.deleteBuffer(old.buffer);
            this.lists.delete(oldList);
        }
        return s;
    }

    /**
     * Picks what every scene near the view draws from and rebuilds the copy's
     * instance buffer. `near` (the view plus a cell) gets real requests and
     * uploads; the rest of `warm` (half a screen further) is only warmed, the
     * same margin the 2D path warms.
     */
    query(list, s, level, near, warm) {
        const gl = this.gl;
        const stamp = ++s.stampN;
        s.incomplete = false;
        // Each scene's best slot key at this level, built once per list and level:
        // string building was most of a query.
        const keyId = `${level}|${pixelScenesTexturedAt(level)}`;
        if (s.keyId !== keyId) {
            s.keyId = keyId;
            s.primaryKeys = new Array(list.length);
        }
        const primaryKeys = s.primaryKeys;
        const hitI = [], hitSlot = [];
        const cx0 = Math.floor(warm.left / GRID_CELL), cx1 = Math.floor(warm.right / GRID_CELL);
        const cy0 = Math.floor(warm.top / GRID_CELL), cy1 = Math.floor(warm.bottom / GRID_CELL);
        for (let cy = cy0; cy <= cy1; cy++) {
            for (let cx = cx0; cx <= cx1; cx++) {
                const cell = s.grid.get(cellKey(cx, cy));
                if (!cell) continue;
                for (const i of cell) {
                    if (s.stamp[i] === stamp) continue;
                    s.stamp[i] = stamp;
                    const scene = list[i];
                    const data = PIXEL_SCENE_DATA[scene.key];
                    const x = scene.x + s.relOffX, y = scene.y + s.relOffY;
                    if (x + data.width < warm.left || x > warm.right || y + data.height < warm.top || y > warm.bottom) continue;
                    let pk = primaryKeys[i];
                    if (pk === undefined) pk = primaryKeys[i] = `${pixelSceneCacheKeys(scene, level)[0]}#${level}`;
                    let slot = this.slots.get(pk) || null;
                    if (!slot) {
                        const isNear = !(x + data.width < near.left || x > near.right || y + data.height < near.top || y > near.bottom);
                        if (isNear) {
                            const d = getPixelSceneDrawable(scene, level);
                            if (d) slot = this.slotFor(d, level, s);
                        } else {
                            warmPixelScene(scene, level);
                        }
                        // Nothing at this level yet: any level already resident, nearest first.
                        if (!slot) {
                            const keys = pixelSceneCacheKeys(scene, level);
                            for (let dl = 0; !slot && dl <= PIXEL_SCENE_MAX_MIP; dl++) {
                                slot = (dl > 0 && this.residentSlot(keys, level - dl))
                                    || this.residentSlot(keys.slice(dl === 0 ? 1 : 0), level + dl) || null;
                            }
                        }
                    }
                    if (!slot) continue;
                    hitI.push(i);
                    hitSlot.push(slot);
                }
            }
        }

        // Pages in use get a small id; instances are counting-sorted by page.
        const pageIds = new Map();
        const pages = [];
        const pageId = (p) => {
            let id = pageIds.get(p);
            if (id === undefined) { p.frame = this.frame; pageIds.set(p, id = pages.length); pages.push(p); }
            return id;
        };
        const colorCount = [], airCount = [];
        let airTotal = 0;
        const n = hitI.length;
        const colorPid = new Int32Array(n), airPid = new Int32Array(n).fill(-1);
        for (let k = 0; k < n; k++) {
            const slot = hitSlot[k];
            const c = colorPid[k] = pageId(slot.page);
            colorCount[c] = (colorCount[c] || 0) + 1;
            if (slot.mask && !slot.mask.page.dead) {
                const a = airPid[k] = pageId(slot.mask.page);
                airCount[a] = (airCount[a] || 0) + 1;
                airTotal++;
            }
        }
        const out = new Int32Array(Math.max(1, n + airTotal) * STRIDE_INTS);
        const groups = (counts, base) => {
            const gs = [], next = [];
            let at = base;
            for (let id = 0; id < pages.length; id++) {
                next[id] = at;
                if (counts[id]) { gs.push({ page: pages[id], first: at, count: counts[id] }); at += counts[id]; }
            }
            return { gs, next };
        };
        const air = groups(airCount, 0);
        const color = groups(colorCount, airTotal);
        const write = (at, i, slot) => {
            const scene = list[i];
            const data = PIXEL_SCENE_DATA[scene.key];
            const o = at * STRIDE_INTS;
            out[o] = scene.x + s.relOffX; out[o + 1] = scene.y + s.relOffY;
            out[o + 2] = data.width; out[o + 3] = data.height;
            out[o + 4] = slot.x; out[o + 5] = slot.y; out[o + 6] = slot.w; out[o + 7] = slot.h;
            if (slot.mask) { out[o + 8] = slot.mask.x; out[o + 9] = slot.mask.y; }
        };
        for (let k = 0; k < n; k++) {
            write(color.next[colorPid[k]]++, hitI[k], hitSlot[k]);
            if (airPid[k] >= 0) write(air.next[airPid[k]]++, hitI[k], hitSlot[k]);
        }
        s.airGroups = air.gs;
        s.colorGroups = color.gs;
        if (!s.buffer) s.buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, s.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, out, gl.DYNAMIC_DRAW);
    }

    drawGroups(s, groups, air) {
        const gl = this.gl;
        if (!groups.length) return;
        gl.uniform1i(this.uniforms.u_air, air ? 1 : 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, s.buffer);
        const B = STRIDE_INTS * 4;
        for (const g of groups) {
            if (g.page.dead) continue;
            g.page.frame = this.frame;
            gl.bindTexture(gl.TEXTURE_2D, g.page.tex);
            const off = g.first * B;
            gl.vertexAttribIPointer(0, 4, gl.INT, B, off);
            gl.vertexAttribIPointer(1, 4, gl.INT, B, off + 16);
            gl.vertexAttribIPointer(2, 2, gl.INT, B, off + 32);
            gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, g.count);
        }
    }

    /**
     * Draws the scenes of every world copy into the terrain canvas.
     * @param terrain the GLTerrainRenderer whose context and canvas are drawn into
     * @param view { width, height, originX, originY (draw space of screen 0,0), zoom,
     *               level, frame, budgetBytes, viewRect (draw space),
     *               worlds: [{ list, relOffX, relOffY, shiftX, shiftY }] }
     * @returns true when drawn (the 2D scene draw is then skipped). Afterwards
     *          `redrawInMs` is non-null when newly landed bitmaps were left for a
     *          later frame: redraw after that long.
     */
    draw(terrain, view) {
        if (terrain.contextLost || !terrain.gl) { this.lost = true; return false; }
        const gl = terrain.gl;
        if (this.lost || this.gl !== gl) {
            // Restored context: every name we held is gone.
            this.lost = true;
            this.dropAll();
            this.program = null;
            this.lost = false;
        }
        if (!this.init(gl)) return false;
        if (this.epoch !== pixelSceneCacheEpoch()) this.dropAll();
        this.frame = view.frame;
        this.budget = view.budgetBytes;
        this.uploadedBytes = 0;

        const { width, height, zoom, level, viewRect } = view;
        const vw = viewRect.right - viewRect.left, vh = viewRect.bottom - viewRect.top;
        // Power-of-two cells so a small zoom step does not move every boundary.
        const cell = 2 ** Math.ceil(Math.log2(Math.max(512, Math.max(vw, vh) / 8)));
        const version = pixelSceneBitmapVersion();
        const now = performance.now();
        this.redrawInMs = null;

        gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindVertexArray(this.vao);
        for (let i = 0; i < 3; i++) {
            gl.enableVertexAttribArray(i);
            gl.vertexAttribDivisor(i, 1);
        }

        const copies = [];
        for (const w of view.worlds) {
            const s = this.listState(w.list, w.relOffX, w.relOffY);
            s.frame = this.frame;
            // The view in this copy's list space.
            const l = viewRect.left - w.shiftX, r = viewRect.right - w.shiftX;
            const t = viewRect.top - w.shiftY, b = viewRect.bottom - w.shiftY;
            const qx0 = Math.floor(l / cell), qx1 = Math.floor(r / cell);
            const qy0 = Math.floor(t / cell), qy1 = Math.floor(b / cell);
            const queryKey = `${level},${cell},${qx0},${qx1},${qy0},${qy1}`;
            const stale = queryKey !== s.queryKey || s.residency !== this.residency || s.incomplete
                || (s.version !== version && now - s.queriedAt >= VERSION_REQUERY_MS);
            if (!stale && s.version !== version) {
                // Deferred: the caller must redraw, or the last bitmap of a burst
                // stays a stand-in until the next pan.
                const wait = VERSION_REQUERY_MS - (now - s.queriedAt);
                this.redrawInMs = this.redrawInMs == null ? wait : Math.min(this.redrawInMs, wait);
            }
            if (stale) {
                // Near covers every position the view can reach before the key changes.
                const near = { left: qx0 * cell - cell, right: (qx1 + 1) * cell + cell,
                    top: qy0 * cell - cell, bottom: (qy1 + 1) * cell + cell };
                const warm = { left: near.left - vw / 2, right: near.right + vw / 2,
                    top: near.top - vh / 2, bottom: near.bottom + vh / 2 };
                this.query(w.list, s, level, near, warm);
                s.queryKey = queryKey;
                s.version = version;
                s.queriedAt = now;
                // An eviction during this query leaves the copies before it pointing
                // at a dead page for one frame (skipped in drawGroups), then requeried.
                s.residency = this.residency;
                if (s.incomplete) this.redrawInMs = 0;   // upload cap hit: finish next frame
            }
            copies.push({ w, s });
        }
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

        const q = terrain.gpuTimerBegin();
        const u = this.uniforms;
        gl.viewport(0, 0, width, height);
        gl.useProgram(this.program);
        gl.uniform1i(u.u_atlas, 0);
        gl.uniform1f(u.u_zoom, zoom);
        gl.uniform2f(u.u_screen, width, height);
        gl.enable(gl.BLEND);
        const setCopy = ({ w }) => {
            const ox = w.shiftX - view.originX, oy = w.shiftY - view.originY;
            const ix = Math.floor(ox), iy = Math.floor(oy);
            gl.uniform2i(u.u_copyInt, ix, iy);
            gl.uniform2f(u.u_copyFrac, ox - ix, oy - iy);
        };
        // Air first: erase the terrain (premultiplied dst * (1 - 1)).
        gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
        for (const c of copies) {
            if (!c.s.airGroups.length) continue;
            setCopy(c);
            this.drawGroups(c.s, c.s.airGroups, true);
        }
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        for (const c of copies) {
            setCopy(c);
            this.drawGroups(c.s, c.s.colorGroups, false);
        }
        gl.disable(gl.BLEND);
        for (let i = 0; i < 3; i++) gl.vertexAttribDivisor(i, 0);
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        terrain.gpuTimerEnd(q, (ms) => renderHud.sample('scenesGL', 'gpu', ms));
        return true;
    }
}
