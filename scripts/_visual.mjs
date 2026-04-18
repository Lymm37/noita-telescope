// PNG diff renderers for verify.mjs. Emits one image per verification
// section showing where telescope and noita disagree.
//
// All three renderers write directly via canvas.toBuffer('image/png') —
// no extra deps beyond node-canvas (already pulled in by _engine_shim.js).

import { writeFileSync } from 'node:fs';
import { createCanvas } from 'canvas';
import { BIOME_COLOR_TO_NAME } from '../js/generator_config.js';
import { canonicalBiome } from './_engine_shim.js';

const PALETTE = {
    agree: '#2ea04a',
    disagree: '#d94848',
    notLoaded: '#3a3a3a',
    unknown: '#ff00ff',
    background: '#181818',
    heatZero: '#262626',
};

function colorHex(c) {
    return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
}

function buildCanonicalBiomeToColor() {
    const out = {};
    for (const [colorStr, key] of Object.entries(BIOME_COLOR_TO_NAME)) {
        const canon = canonicalBiome(key);
        if (canon && !(canon in out)) out[canon] = Number(colorStr) & 0xffffff;
    }
    return out;
}

function rateToColor(rate) {
    if (rate <= 0) return PALETTE.heatZero;
    const clamped = Math.max(0, Math.min(1, rate));
    const g = Math.round(220 * (1 - clamped));
    const b = Math.round(220 * (1 - clamped));
    return `rgb(255,${g},${b})`;
}

function fillCell(ctx, cx, cy, scale, color) {
    ctx.fillStyle = color;
    ctx.fillRect(cx * scale, cy * scale, scale, scale);
}

function drawBiomePixels(ctx, biomeData, scale, opacity = 1) {
    const w = biomeData.width, h = biomeData.height;
    const src = createCanvas(w, h);
    const srcCtx = src.getContext('2d');
    const imgData = srcCtx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
        const c = biomeData.pixels[i] & 0xffffff;
        imgData.data[i * 4]     = (c >> 16) & 0xff;
        imgData.data[i * 4 + 1] = (c >> 8) & 0xff;
        imgData.data[i * 4 + 2] = c & 0xff;
        imgData.data[i * 4 + 3] = 255;
    }
    srcCtx.putImageData(imgData, 0, 0);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, w * scale, h * scale);
    ctx.restore();
}

function drawLegendSwatches(ctx, x, y, colors, swatch = 12) {
    for (let i = 0; i < colors.length; i++) {
        ctx.fillStyle = colors[i];
        ctx.fillRect(x + i * (swatch + 3), y, swatch, swatch);
    }
}

export function renderBiomesDiff(biomeData, noitaMap, telescopeGrid, outPath, { scale = 12 } = {}) {
    const w = biomeData.width, h = biomeData.height;
    const panelW = w * scale, panelH = h * scale;
    const gutter = 8;
    const legendH = 20;
    const totalW = panelW * 3 + gutter * 2;
    const totalH = panelH + legendH;

    const canvas = createCanvas(totalW, totalH);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = PALETTE.background;
    ctx.fillRect(0, 0, totalW, totalH);

    // Panel 1: telescope's biome_map.png scaled up.
    drawBiomePixels(ctx, biomeData, scale);

    // Panel 2: noita's per-chunk xmlName recolored via telescope's palette.
    const canonicalToColor = buildCanonicalBiomeToColor();
    ctx.save();
    ctx.translate(panelW + gutter, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, panelW, panelH);
    for (const n of noitaMap.values()) {
        if (n.name === '_EMPTY_' || n.name === '???') continue;
        if (n.cx < 0 || n.cx >= w || n.cy < 0 || n.cy >= h) continue;
        const canon = canonicalBiome(n.xmlName);
        const color = canon ? canonicalToColor[canon] : undefined;
        if (color !== undefined) {
            fillCell(ctx, n.cx, n.cy, scale, colorHex(color));
        } else {
            fillCell(ctx, n.cx, n.cy, scale, PALETTE.unknown);
            ctx.strokeStyle = '#1a1a1a';
            ctx.lineWidth = 2;
            ctx.strokeRect(n.cx * scale + 1, n.cy * scale + 1, scale - 2, scale - 2);
        }
    }
    ctx.restore();

    // Panel 3: diff.
    ctx.save();
    ctx.translate((panelW + gutter) * 2, 0);
    ctx.fillStyle = PALETTE.notLoaded;
    ctx.fillRect(0, 0, panelW, panelH);
    for (const [key, n] of noitaMap) {
        if (n.name === '_EMPTY_' || n.name === '???') continue;
        if (n.cx < 0 || n.cx >= w || n.cy < 0 || n.cy >= h) continue;
        const tel = telescopeGrid.get(key);
        if (!tel) continue;
        const telCanon = canonicalBiome(tel.biomeName);
        const noitaCanon = canonicalBiome(n.xmlName);
        if (!telCanon) fillCell(ctx, n.cx, n.cy, scale, PALETTE.unknown);
        else if (telCanon === noitaCanon) fillCell(ctx, n.cx, n.cy, scale, PALETTE.agree);
        else fillCell(ctx, n.cx, n.cy, scale, PALETTE.disagree);
    }
    ctx.restore();

    drawLegendSwatches(ctx, 4, panelH + 4, [
        PALETTE.agree, PALETTE.disagree, PALETTE.notLoaded, PALETTE.unknown,
    ]);

    writeFileSync(outPath, canvas.toBuffer('image/png'));
}

export function renderWobbleHeatmap(biomeData, nameStats, chunkStats, outPath, { scale = 14 } = {}) {
    const w = biomeData.width, h = biomeData.height;
    const panelW = w * scale, panelH = h * scale;
    const gutter = 8;
    const legendH = 20;
    const totalW = panelW * 2 + gutter;
    const totalH = panelH + legendH;

    const canvas = createCanvas(totalW, totalH);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = PALETTE.background;
    ctx.fillRect(0, 0, totalW, totalH);

    const drawHeat = (stats, offsetX) => {
        ctx.save();
        ctx.translate(offsetX, 0);
        drawBiomePixels(ctx, biomeData, scale, 0.30);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = y * w + x;
                const total = stats.agree[idx] + stats.disagree[idx];
                if (total === 0) continue;
                const rate = stats.disagree[idx] / total;
                if (rate === 0) continue;
                ctx.globalAlpha = 0.85;
                ctx.fillStyle = rateToColor(rate);
                ctx.fillRect(x * scale, y * scale, scale, scale);
                ctx.globalAlpha = 1.0;
            }
        }
        ctx.restore();
    };

    drawHeat(nameStats, 0);
    drawHeat(chunkStats, panelW + gutter);

    drawLegendSwatches(ctx, 4, panelH + 4, [
        rateToColor(0.0001), rateToColor(0.25), rateToColor(0.5), rateToColor(0.75), rateToColor(1.0),
    ]);

    writeFileSync(outPath, canvas.toBuffer('image/png'));
}

export function renderPixelScenes(biomeData, sceneResults, outPath, { scale = 10 } = {}) {
    const w = biomeData.width, h = biomeData.height;
    const canvasW = w * scale;
    const legendH = 20;
    const canvasH = h * scale + legendH;

    const canvas = createCanvas(canvasW, canvasH);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = PALETTE.background;
    ctx.fillRect(0, 0, canvasW, canvasH);

    drawBiomePixels(ctx, biomeData, scale);

    // Normal-mode world dimensions (verify.mjs always runs against normal).
    const xShift = 35 * 512;
    const yShift = 14 * 512;
    const worldSize = 70 * 512;
    const worldHeight = 24576;

    for (const s of sceneResults) {
        const mx = ((s.x + xShift) % worldSize + worldSize) % worldSize;
        const my = ((s.y + yShift) % worldHeight + worldHeight) % worldHeight;
        const dx0 = (mx / 512) * scale;
        const dy0 = (my / 512) * scale;
        const dw = Math.max(2, (s.w / 512) * scale);
        const dh = Math.max(2, (s.h / 512) * scale);
        ctx.strokeStyle = s.ok ? PALETTE.agree : PALETTE.disagree;
        ctx.lineWidth = 2;
        ctx.strokeRect(dx0 + 0.5, dy0 + 0.5, dw, dh);
        ctx.fillStyle = s.ok ? PALETTE.agree : PALETTE.disagree;
        for (const [px, py] of [[dx0, dy0], [dx0 + dw, dy0], [dx0, dy0 + dh], [dx0 + dw, dy0 + dh]]) {
            ctx.beginPath();
            ctx.arc(px, py, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawLegendSwatches(ctx, 4, h * scale + 4, [PALETTE.agree, PALETTE.disagree]);

    writeFileSync(outPath, canvas.toBuffer('image/png'));
}
