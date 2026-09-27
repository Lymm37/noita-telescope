// GL backdrop renderer: the biome backdrop tile runs (drawNow's bg:backdrops
// step) in one full-screen WebGL2 pass instead of one clipped drawImage per
// visible tile. With the 640x64 / 64x640 strip art that is well over a
// thousand drawImage calls a frame at mid zoom, all on the main thread.
//
// Inputs are the buildBackdropRuns rows app.js already keeps for the main,
// heaven and hell rows, so the skip-cell logic lives in one place. They are
// flattened to a per-chunk slot texture (mapW x 3*mapH, R16UI, 0 = nothing),
// and every image a run references is shelf-packed into one RGBA atlas.
//
// The fragment shader reproduces drawBackdropRuns exactly: world copies are
// resolved from the draw-space position itself (copies repeat every mapW*512
// horizontally and every 24576 vertically, the same shifts drawNow's
// worldOffsets use), and tiles are aligned to the ABSOLUTE draw frame, i.e.
// texel = pmod(drawPos, imageSize), nearest-sampled like the 2D path.

import { shelfPack } from './atlas.js';

const VS = `#version 300 es
void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp isampler2D;

uniform usampler2D u_slotTex;   // (cx, variant*mapH + cy) -> image slot + 1
uniform isampler2D u_imgTab;    // (slot, 0) -> atlas x, y, w, h
uniform sampler2D u_atlas;
uniform ivec2 u_originInt;      // draw-space position of screen (0,0), split
uniform vec2 u_originFrac;
uniform float u_invZoom;
uniform float u_screenH;
uniform ivec2 u_pitch;          // world-copy stride in draw px (mapW*512, 24576)
uniform int u_mapH;             // chunk rows per copy
uniform ivec4 u_copyRange;      // relative copies in view: minX, maxX, minY, maxY
uniform int u_pwVertical;       // absolute vertical PW of relative copy 0

out vec4 outColor;

// GLSL ES leaves / and % undefined for negative operands.
int fdiv(int a, int m) { return a >= 0 ? a / m : -((m - 1 - a) / m); }
int pmod(int a, int m) { return a - m * fdiv(a, m); }

void main() {
    vec2 frag = vec2(gl_FragCoord.x, u_screenH - gl_FragCoord.y);
    ivec2 p = u_originInt + ivec2(floor(u_originFrac + frag * u_invZoom));
    int copyX = fdiv(p.x, u_pitch.x);
    int copyY = fdiv(p.y, u_pitch.y);
    if (copyX < u_copyRange.x || copyX > u_copyRange.y
        || copyY < u_copyRange.z || copyY > u_copyRange.w) discard;
    int cx = (p.x - copyX * u_pitch.x) / 512;
    int cy = (p.y - copyY * u_pitch.y) / 512;
    int pwY = copyY + u_pwVertical;
    int variant = pwY == 0 ? 0 : (pwY < 0 ? 1 : 2);
    uint slot = texelFetch(u_slotTex, ivec2(cx, variant * u_mapH + cy), 0).r;
    if (slot == 0u) discard;
    ivec4 r = texelFetch(u_imgTab, ivec2(int(slot) - 1, 0), 0);
    outColor = texelFetch(u_atlas, r.xy + ivec2(pmod(p.x, r.z), pmod(p.y, r.w)), 0);
}`;

const UNIFORMS = [
    'u_slotTex', 'u_imgTab', 'u_atlas', 'u_originInt', 'u_originFrac', 'u_invZoom',
    'u_screenH', 'u_pitch', 'u_mapH', 'u_copyRange', 'u_pwVertical',
];

function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(`GL backdrop shader compile failed: ${log}`);
    }
    return sh;
}

export class GLBackdropRenderer {
    constructor() {
        this.canvas = null;
        this.gl = null;
        this.program = null;
        this.uniforms = null;
        this.textures = null;
        this.sourceKey = null;   // [main, heaven, hell] runs the textures came from
        this.failed = null;
        this.contextLost = false;
        this.renderedKey = null; // view the canvas currently holds (refill reuse)
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
            this.sourceKey = null;
        });
        canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; });
        try {
            const prog = gl.createProgram();
            const vs = compile(gl, gl.VERTEX_SHADER, VS), fs = compile(gl, gl.FRAGMENT_SHADER, FS);
            gl.attachShader(prog, vs);
            gl.attachShader(prog, fs);
            gl.linkProgram(prog);
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
                throw new Error(`GL backdrop program link failed: ${gl.getProgramInfoLog(prog)}`);
            }
            this.program = prog;
        } catch (err) {
            console.warn('[GL backdrops]', err);
            this.failed = String(err);
            return false;
        }
        this.uniforms = Object.fromEntries(UNIFORMS.map(n => [n, gl.getUniformLocation(this.program, n)]));
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        this.canvas = canvas;
        this.gl = gl;
        return true;
    }

    /**
     * (Re)builds the slot texture and atlas when the run lists change. Cheap
     * per frame: identity compare. `bitmapFor(imageIndex)` returns the decoded
     * art; call only once every backdrop bitmap has loaded, or the missing ones
     * stay missing until the runs change.
     */
    ensure(variants, mapW, mapH, bitmapFor) {
        if (this.failed || this.contextLost) return false;
        if (!this.initContext()) return false;
        if (this.textures && this.sourceKey
            && variants.every((v, i) => v === this.sourceKey[i])) return true;
        const gl = this.gl;
        if (this.textures) for (const t of Object.values(this.textures)) gl.deleteTexture(t);
        this.textures = null;

        // Compact slots over the images any run actually uses.
        const slotOf = new Map();
        const images = [];
        const slots = new Uint16Array(mapW * mapH * 3);
        variants.forEach((rows, variant) => {
            if (!rows) return;
            for (const row of rows) {
                for (const run of row) {
                    let slot = slotOf.get(run.imageIndex);
                    if (slot === undefined) {
                        const bmp = bitmapFor(run.imageIndex);
                        slot = bmp ? images.push(bmp) : 0;
                        slotOf.set(run.imageIndex, slot);
                    }
                    if (!slot) continue;
                    const base = (variant * mapH + run.cy) * mapW + run.cx;
                    slots.fill(slot, base, base + run.len);
                }
            }
        });

        const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        let pack = null;
        for (const w of [2048, 4096, 8192, 16384]) {
            if (w > maxSize) break;
            pack = shelfPack(images.map(b => ({ w: b.width, h: b.height })), w);
            if (pack && pack.height <= maxSize) break;
            pack = null;
        }
        if (!pack) { this.failed = 'backdrop atlas does not fit'; return false; }

        const tex = (fn) => {
            const t = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            fn();
            return t;
        };
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        const slotTex = tex(() => gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, mapW, mapH * 3, 0,
            gl.RED_INTEGER, gl.UNSIGNED_SHORT, slots));
        const table = new Int32Array(Math.max(1, images.length) * 4);
        pack.rects.forEach((r, i) => table.set([r.x, r.y, r.w, r.h], i * 4));
        const imgTab = tex(() => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32I, Math.max(1, images.length), 1, 0,
            gl.RGBA_INTEGER, gl.INT, table));
        // Premultiplied texels into a premultipliedAlpha canvas, so the 2D
        // src-over blit composites the same as drawing the bitmaps directly.
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        const atlas = tex(() => {
            gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, pack.width, Math.max(1, pack.height));
            pack.rects.forEach((r, i) => gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y,
                gl.RGBA, gl.UNSIGNED_BYTE, images[i]));
        });
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

        this.textures = { slotTex, imgTab, atlas };
        this.sourceKey = variants.slice();
        this.mapW = mapW;
        this.mapH = mapH;
        this.renderedKey = null;
        return true;
    }

    /**
     * Renders every backdrop in view into a screen-sized canvas, already in
     * screen space. `copyRange` is [minX, maxX, minY, maxY] of the world copies
     * in view, relative to the current PW; `frame` is a per-drawNow serial.
     * Returns the canvas, or null.
     */
    render({ frame, width, height, camX, camY, camZ, pwVertical, copyRange }) {
        if (!this.textures || this.contextLost || width <= 0 || height <= 0) return null;
        // Only reused within one frame (the refill pass): without
        // preserveDrawingBuffer the buffer is not guaranteed past it.
        const key = `${frame},${width},${height},${camX},${camY},${camZ},${pwVertical},${copyRange}`;
        if (key === this.renderedKey) return this.canvas;
        const gl = this.gl, u = this.uniforms;
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        const originX = camX - (width / 2) / camZ, originY = camY - (height / 2) / camZ;
        const intX = Math.floor(originX), intY = Math.floor(originY);

        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(this.program);
        const bind = (unit, t, name) => {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.uniform1i(u[name], unit);
        };
        bind(0, this.textures.slotTex, 'u_slotTex');
        bind(1, this.textures.imgTab, 'u_imgTab');
        bind(2, this.textures.atlas, 'u_atlas');
        gl.uniform2i(u.u_originInt, intX, intY);
        gl.uniform2f(u.u_originFrac, originX - intX, originY - intY);
        gl.uniform1f(u.u_invZoom, 1 / camZ);
        gl.uniform1f(u.u_screenH, height);
        gl.uniform2i(u.u_pitch, this.mapW * 512, this.mapH * 512);
        gl.uniform1i(u.u_mapH, this.mapH);
        gl.uniform4i(u.u_copyRange, copyRange[0], copyRange[1], copyRange[2], copyRange[3]);
        gl.uniform1i(u.u_pwVertical, pwVertical);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.renderedKey = key;
        return this.canvas;
    }
}
