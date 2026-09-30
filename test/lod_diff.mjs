#!/usr/bin/env node
/* global process, Buffer */
// Level-of-detail consistency: how different does the map look zoomed out
// compared with the zoomed-in map averaged down to the same size?
//
// For every region it renders the view at 1:1 (the reference: full detail,
// edge decals, textured scenes), area-averages that down to each test zoom,
// and compares it against what telescope actually draws at that zoom -- once
// with the normal LOD gates and once with Render Everything. Three numbers per
// region and zoom:
//
//   total   normal render      vs downsampled 1:1   what the user sees
//   lod     normal render      vs Render Everything  what the LOD cuts alone cost
//   filter  Render Everything  vs downsampled 1:1   what the scaler itself costs
//                                                   (NEAREST sampling aliases)
//
// Differences are OKLab distance x100 (~2 is a just-noticeable difference)
// after a 3x3 blur of both images, so sub-pixel phase does not count as error.
//
// Not part of `node --test`; needs Chrome and a few minutes. Run it like the
// GL regression:
//
//   systemd-run --user --quiet --collect --pipe --wait --slice=claude-limit.slice \
//     -p MemoryMax=10G --working-directory=/home/vitaminmoo/repos/noita-telescope \
//     /usr/bin/node test/lod_diff.mjs [--random=8] [--regions=named|random|all]
//       [--only=name,...] [--zooms=0.5,0.25] [--no-everything] [--out=DIR]
//       [--baseline] [--margin=0.5]
//
// Without --baseline it compares against test/fixtures/lod/baseline.json (when
// present) and exits 1 if any region/zoom got worse by more than --margin.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import UPNG from 'upng-js';
import { startServer, drive } from './helpers/drive.mjs';

const argv = process.argv.slice(2);
const flagVal = (n, d) => {
	const a = argv.find(s => s.startsWith(`--${n}=`));
	return a ? a.slice(n.length + 3) : d;
};
const has = (n) => argv.includes(`--${n}`);

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const BASELINE_PATH = `${REPO}/test/fixtures/lod/baseline.json`;
const OUT = flagVal('out', `${REPO}/data/verify_out/lod`);
const WRITE_BASELINE = has('baseline');
const MARGIN = Number(flagVal('margin', '0.5'));
const EVERYTHING = !has('no-everything');
const SEED = Number(flagVal('seed', '786433191'));
const REGION_W = 2048, REGION_H = 1280;
// Each zoom must make REGION_W * z and REGION_H * z whole numbers, so the
// zoomed-out canvas covers exactly the reference's world rect.
const ZOOMS = flagVal('zooms', '0.75,0.5,0.4375,0.375,0.25,0.125,0.0625').split(',').map(Number);
for (const z of ZOOMS) {
	if (!Number.isInteger(REGION_W * z) || !Number.isInteger(REGION_H * z)) {
		throw new Error(`zoom ${z} does not divide the ${REGION_W}x${REGION_H} region into whole pixels`);
	}
}
// Hotspots: connected areas above this difference, biggest first.
const HOT_DE = 10;
const HOT_PER_CASE = 4;

// Hand-picked spots (world coords, region centered on them). Add more here as
// they are found; the name is what the baseline keys on.
const NAMED = [
	{ name: 'mountain_top_736_-597', x: 736, y: -597 },
	{ name: 'lavalake_3355_1085', x: 3355, y: 1085 },
	{ name: 'mountain_lake_2834_376', x: 2834, y: 376 },
	{ name: 'lake_statue_-13465_437', x: -13465, y: 437 },
];

// The map as a user sees it, minus things that are not terrain or move on
// their own.
const LAYERS = {
	'debug-layer-biome-background': true,
	'debug-layer-custom-art': false,
	'debug-layer-atmosphere': false,
	'debug-layer-tile-overlays': true,
	'debug-layer-pixel-scenes': true,
	'debug-layer-secrets': false,
	'debug-layer-misc': false,
	'debug-layer-pois': false,
};

function mulberry32(a) {
	return () => {
		a |= 0; a = a + 0x6D2B79F5 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}

function randomRegions(n, worldSize, worldCenter) {
	const rnd = mulberry32(1);
	const x0 = -worldCenter * 512 + REGION_W / 2, x1 = (worldSize - worldCenter) * 512 - REGION_W / 2;
	const y0 = -14 * 512 + REGION_H / 2, y1 = 34 * 512 - REGION_H / 2;
	const out = [];
	for (let i = 0; i < n; i++) {
		const x = Math.round(x0 + rnd() * (x1 - x0)), y = Math.round(y0 + rnd() * (y1 - y0));
		out.push({ name: `rand${i}_${x}_${y}`, x, y });
	}
	return out;
}

// ---- image math ----------------------------------------------------------

function decodePng(dataUrl) {
	const img = UPNG.decode(Buffer.from(dataUrl.split(',')[1], 'base64'));
	return { w: img.width, h: img.height, px: new Uint8Array(UPNG.toRGBA8(img)[0]) };
}

function encodePng(img) {
	return Buffer.from(UPNG.encode([img.px.buffer.slice(img.px.byteOffset, img.px.byteOffset + img.px.byteLength)], img.w, img.h, 0));
}

// Area-weighted box resample to w x h, in sRGB like the browser's and the mip
// chain's own averaging. Alpha is composited over black first (the canvas
// behind the map is black).
function areaResample(src, w, h) {
	const sx = src.w / w, sy = src.h / h;
	const out = new Uint8Array(w * h * 4);
	for (let oy = 0; oy < h; oy++) {
		const fy0 = oy * sy, fy1 = fy0 + sy;
		for (let ox = 0; ox < w; ox++) {
			const fx0 = ox * sx, fx1 = fx0 + sx;
			let r = 0, g = 0, b = 0, wsum = 0;
			for (let y = Math.floor(fy0); y < Math.ceil(fy1); y++) {
				const wy = Math.min(fy1, y + 1) - Math.max(fy0, y);
				for (let x = Math.floor(fx0); x < Math.ceil(fx1); x++) {
					const wgt = wy * (Math.min(fx1, x + 1) - Math.max(fx0, x));
					const i = (y * src.w + x) * 4, a = src.px[i + 3] / 255;
					r += src.px[i] * a * wgt; g += src.px[i + 1] * a * wgt; b += src.px[i + 2] * a * wgt;
					wsum += wgt;
				}
			}
			const o = (oy * w + ox) * 4;
			out[o] = Math.round(r / wsum); out[o + 1] = Math.round(g / wsum); out[o + 2] = Math.round(b / wsum); out[o + 3] = 255;
		}
	}
	return { w, h, px: out };
}

const lin = new Float64Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; lin[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }

// Per-pixel OKLab after a 3x3 box blur (in sRGB, clamped at the edges).
function oklabBlurred(img) {
	const { w, h, px } = img;
	const lab = new Float64Array(w * h * 3);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let r = 0, g = 0, b = 0, n = 0;
			for (let dy = -1; dy <= 1; dy++) {
				const yy = Math.min(h - 1, Math.max(0, y + dy));
				for (let dx = -1; dx <= 1; dx++) {
					const xx = Math.min(w - 1, Math.max(0, x + dx));
					const i = (yy * w + xx) * 4, a = px[i + 3] / 255;
					r += px[i] * a; g += px[i + 1] * a; b += px[i + 2] * a; n++;
				}
			}
			const R = lin[Math.round(r / n)], G = lin[Math.round(g / n)], B = lin[Math.round(b / n)];
			const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
			const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
			const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
			const o = (y * w + x) * 3;
			lab[o] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
			lab[o + 1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
			lab[o + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
		}
	}
	return lab;
}

function deltaE(labA, labB, n) {
	const d = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const o = i * 3;
		d[i] = 100 * Math.hypot(labA[o] - labB[o], labA[o + 1] - labB[o + 1], labA[o + 2] - labB[o + 2]);
	}
	return d;
}

function stats(d) {
	const sorted = Float32Array.from(d).sort();
	const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
	let sum = 0, over2 = 0, over5 = 0, over10 = 0;
	for (const v of d) { sum += v; if (v > 2) over2++; if (v > 5) over5++; if (v > 10) over10++; }
	const n = d.length, r = (v) => Math.round(v * 100) / 100;
	return {
		mean: r(sum / n), p95: r(q(0.95)), p99: r(q(0.99)),
		pct2: r(100 * over2 / n), pct5: r(100 * over5 / n), pct10: r(100 * over10 / n),
	};
}

function heatmap(d, w, h) {
	const px = new Uint8Array(w * h * 4);
	for (let i = 0; i < d.length; i++) {
		const t = Math.min(1, d[i] / 20);
		px[i * 4] = Math.round(255 * Math.min(1, t * 2));
		px[i * 4 + 1] = Math.round(255 * Math.max(0, t * 2 - 1));
		px[i * 4 + 2] = d[i] > 2 ? 40 : 0;
		px[i * 4 + 3] = 255;
	}
	return { w, h, px };
}

// 8-connected areas over HOT_DE, ranked by summed difference; each reported by
// its worst pixel.
function hotspots(d, w, h) {
	const seen = new Uint8Array(w * h);
	const comps = [];
	for (let start = 0; start < d.length; start++) {
		if (seen[start] || d[start] <= HOT_DE) continue;
		const stack = [start];
		seen[start] = 1;
		let sum = 0, size = 0, peak = start;
		while (stack.length) {
			const i = stack.pop();
			sum += d[i]; size++;
			if (d[i] > d[peak]) peak = i;
			const x = i % w, y = (i / w) | 0;
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const xx = x + dx, yy = y + dy;
					if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
					const j = yy * w + xx;
					if (!seen[j] && d[j] > HOT_DE) { seen[j] = 1; stack.push(j); }
				}
			}
		}
		comps.push({ sum, size, peak });
	}
	return comps.sort((a, b) => b.sum - a.sum).slice(0, HOT_PER_CASE);
}

const hex = (px, i) => '#' + [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]].map(v => v.toString(16).padStart(2, '0')).join('');

// ---- page side -----------------------------------------------------------

const PAGE_HELPERS = `(async () => {
	const m = await import('/js/app.js');
	const u = await import('/js/utils.js');
	const s = await import('/js/settings.js');
	const g = await import('/js/pixel_scene_generation.js');
	s.appSettings.terrainRenderer = 'gl';
	const cb = document.getElementById('debug-unpainted-checkerboard');
	if (cb && cb.checked) { cb.checked = false; cb.dispatchEvent(new Event('change')); }
	for (const [id, on] of ${JSON.stringify(Object.entries(LAYERS))}) {
		const el = document.getElementById(id);
		if (el && el.checked !== on) { el.checked = on; el.dispatchEvent(new Event('change')); }
	}
	await g.initPixelSceneTextures();
	const sleep = (ms) => new Promise(r => setTimeout(r, ms));
	// Cheap fingerprint of the canvas, to tell when late bitmaps stop landing.
	const fingerprint = () => {
		const c = m.app.canvas, w = c.width, h = c.height;
		const probe = new OffscreenCanvas(w, h);
		const ctx = probe.getContext('2d', { willReadFrequently: true });
		ctx.drawImage(c, 0, 0);
		const d = ctx.getImageData(0, 0, w, h).data;
		let hsh = 0;
		for (let i = 0; i < d.length; i += 28) hsh = (Math.imul(hsh, 31) + d[i] + (d[i + 1] << 8) + (d[i + 2] << 16)) | 0;
		return hsh;
	};
	window.__lod = {
		world() {
			return { size: u.getWorldSize(m.app.isNGP, m.app.gameMode), center: u.getWorldCenter(m.app.isNGP, m.app.gameMode) };
		},
		async render({ cx, cy, z, w, h, everything }) {
			const re = document.getElementById('debug-render-everything');
			if (re.checked !== everything) { re.checked = everything; re.dispatchEvent(new Event('change')); }
			m.app.canvas.width = w; m.app.canvas.height = h;
			m.app.cam.x = cx + 512 * u.getWorldCenter(m.app.isNGP, m.app.gameMode);
			m.app.cam.y = cy + 512 * 14;
			m.app.cam.z = z;
			const before = g.getPixelSceneCacheStats().buildTime;
			const t0 = performance.now();
			let last = null, stable = 0;
			for (let i = 0; i < 400; i++) {
				m.app.drawNow();
				await sleep(i < 4 ? 150 : 400);
				const busy = g.pendingPixelSceneBitmaps() > 0 || m.app.edgeDecalsPending();
				if (busy) { stable = 0; last = null; continue; }
				m.app.drawNow();
				const f = fingerprint();
				stable = f === last ? stable + 1 : 0;
				last = f;
				if (stable >= 2) break;
			}
			const settleMs = performance.now() - t0;
			const times = [];
			for (let i = 0; i < 5; i++) { const a = performance.now(); m.app.drawNow(); times.push(performance.now() - a); }
			times.sort((a, b) => a - b);
			// Worker scene-build time this render caused, per build kind.
			const after = g.getPixelSceneCacheStats().buildTime ?? {};
			const builds = {};
			for (const [k, t] of Object.entries(after)) {
				const n = t.n - (before?.[k]?.n ?? 0), ms = t.ms - (before?.[k]?.ms ?? 0);
				if (n) builds[k] = { n, ms: Math.round(ms) };
			}
			return { png: m.app.canvas.toDataURL('image/png'), settleMs, drawMs: times[2], builds };
		},
		info(absX, absY, canvasX, canvasY) {
			return m.app.pixelInfoLines(absX, absY, canvasX, canvasY)
				.map(l => l.replace(/<[^>]*>/g, '').replace(/\\s+/g, ' ').trim());
		},
	};
	return true;
})()`;

// ---- main ----------------------------------------------------------------

const gitHead = () => {
	try { return execFileSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); }
	catch { return 'unknown'; }
};

mkdirSync(OUT, { recursive: true });
const server = await startServer();
let d = null;
const results = {};
const report = [];
try {
	d = await drive({ port: server.port, seed: SEED });
	await d.evalIn(PAGE_HELPERS);
	const world = await d.evalIn('window.__lod.world()');
	const which = flagVal('regions', 'all');
	let regions = [
		...(which !== 'random' ? NAMED : []),
		...(which !== 'named' ? randomRegions(Number(flagVal('random', '8')), world.size, world.center) : []),
	];
	const only = flagVal('only', null);
	if (only) regions = regions.filter(r => only.split(',').includes(r.name));

	for (const reg of regions) {
		const dir = `${OUT}/${reg.name}`;
		mkdirSync(dir, { recursive: true });
		const x0 = reg.x - REGION_W / 2, y0 = reg.y - REGION_H / 2;
		const call = (z, everything) => d.evalIn(`window.__lod.render(${JSON.stringify({
			cx: reg.x, cy: reg.y, z, w: REGION_W * z, h: REGION_H * z, everything })})`);
		const t0 = Date.now();
		const refShot = await call(1, false);
		const ref = decodePng(refShot.png);
		writeFileSync(`${dir}/ref_1x.png`, encodePng(ref));
		results[reg.name] = { x: reg.x, y: reg.y, zooms: {} };
		for (const z of ZOOMS) {
			const w = REGION_W * z, h = REGION_H * z, n = w * h;
			const down = areaResample(ref, w, h);
			const downLab = oklabBlurred(down);
			let evShot = null, ev = null, evLab = null;
			if (EVERYTHING) {
				evShot = await call(z, true);
				ev = decodePng(evShot.png);
				evLab = oklabBlurred(ev);
			}
			// Normal last, so the page is left showing it for the hotspot lookups.
			const normShot = await call(z, false);
			const norm = decodePng(normShot.png);
			const normLab = oklabBlurred(norm);
			const dTotal = deltaE(normLab, downLab, n);
			let dLod = null;
			const row = {
				total: stats(dTotal),
				lod: evLab ? stats(dLod = deltaE(normLab, evLab, n)) : null,
				filter: evLab ? stats(deltaE(evLab, downLab, n)) : null,
				drawMs: Math.round(normShot.drawMs * 10) / 10,
				settleMs: Math.round(normShot.settleMs),
				everythingDrawMs: evShot ? Math.round(evShot.drawMs * 10) / 10 : null,
				builds: normShot.builds,
			};
			const tag = `z${z}`;
			writeFileSync(`${dir}/${tag}_ref.png`, encodePng(down));
			writeFileSync(`${dir}/${tag}_normal.png`, encodePng(norm));
			if (ev) writeFileSync(`${dir}/${tag}_everything.png`, encodePng(ev));
			writeFileSync(`${dir}/${tag}_heat.png`, encodePng(heatmap(dTotal, w, h)));
			if (dLod) writeFileSync(`${dir}/${tag}_lodheat.png`, encodePng(heatmap(dLod, w, h)));
			row.hotspots = [];
			for (const hs of hotspots(dTotal, w, h)) {
				const px = hs.peak % w, py = (hs.peak / w) | 0;
				const absX = Math.floor(x0 + (px + 0.5) / z), absY = Math.floor(y0 + (py + 0.5) / z);
				const info = await d.evalIn(`window.__lod.info(${absX}, ${absY}, ${px}, ${py})`).catch(e => [`info failed: ${e.message.slice(0, 80)}`]);
				row.hotspots.push({
					absX, absY, areaPx: hs.size, peakDE: Math.round(dTotal[hs.peak] * 10) / 10,
					ref: hex(down.px, hs.peak), shown: hex(norm.px, hs.peak),
					everything: ev ? hex(ev.px, hs.peak) : null, info,
				});
			}
			results[reg.name].zooms[z] = row;
			const f = (s) => s ? `${String(s.mean).padStart(6)} ${String(s.pct5).padStart(6)}%` : '     -       -';
			const b = Object.entries(row.builds ?? {}).map(([k, t]) => `${k} ${t.n}x/${t.ms}ms`).join(' ');
			report.push(`${reg.name.padEnd(26)} z=${String(z).padEnd(7)} total ${f(row.total)}   lod ${f(row.lod)}   filter ${f(row.filter)}   builds ${b || '-'}`);
			console.log(report[report.length - 1]);
		}
		console.log(`  (${reg.name}: ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
	}
} finally {
	d?.close();
	server.stop();
}

// Per-zoom summary across regions: which zoom gates hurt most.
console.log('\nper zoom, mean over regions (total = shown vs downsampled 1:1; mean dE, % px dE>5):');
for (const z of ZOOMS) {
	const rows = Object.values(results).map(r => r.zooms[z]).filter(Boolean);
	if (!rows.length) continue;
	const avg = (k, s) => {
		const v = rows.map(r => r[k]?.[s]).filter(x => x != null);
		return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : '-';
	};
	const draw = (rows.reduce((a, r) => a + r.drawMs, 0) / rows.length).toFixed(1);
	console.log(`  z=${String(z).padEnd(7)} total ${avg('total', 'mean').padStart(6)} ${avg('total', 'pct5').padStart(6)}%`
		+ `   lod ${avg('lod', 'mean').padStart(6)} ${avg('lod', 'pct5').padStart(6)}%`
		+ `   filter ${avg('filter', 'mean').padStart(6)} ${avg('filter', 'pct5').padStart(6)}%   draw ${draw}ms`);
}

const summary = { git: gitHead(), date: new Date().toISOString().slice(0, 10), seed: SEED, region: [REGION_W, REGION_H], results };
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, '\t'));
console.log(`\nimages, heatmaps and hotspots: ${OUT}/`);

if (WRITE_BASELINE) {
	mkdirSync(`${REPO}/test/fixtures/lod`, { recursive: true });
	const slim = {};
	for (const [name, r] of Object.entries(results)) {
		slim[name] = {};
		for (const [z, row] of Object.entries(r.zooms)) slim[name][z] = { mean: row.total.mean, pct5: row.total.pct5 };
	}
	const prev = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : { cases: {} };
	writeFileSync(BASELINE_PATH, JSON.stringify({ git: summary.git, date: summary.date, cases: { ...prev.cases, ...slim } }, null, '\t') + '\n');
	console.log(`baseline written: ${BASELINE_PATH}`);
} else if (existsSync(BASELINE_PATH)) {
	const base = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).cases;
	let worse = 0, better = 0;
	for (const [name, r] of Object.entries(results)) {
		for (const [z, row] of Object.entries(r.zooms)) {
			const b = base[name]?.[z];
			if (!b) continue;
			const dm = row.total.mean - b.mean, dp = row.total.pct5 - b.pct5;
			if (dm > MARGIN || dp > MARGIN) {
				worse++;
				console.log(`WORSE  ${name} z=${z}: mean ${b.mean} -> ${row.total.mean}, >5 ${b.pct5}% -> ${row.total.pct5}%`);
			} else if (dm < -MARGIN || dp < -MARGIN) better++;
		}
	}
	console.log(`vs baseline: ${worse} worse, ${better} better (margin ${MARGIN})`);
	if (worse) process.exitCode = 1;
}
