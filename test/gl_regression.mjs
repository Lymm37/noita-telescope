#!/usr/bin/env node
/* global process, Buffer */
// Tier 2 of the pixel regression harness: render every fixture rect 1:1 through
// the real GL terrain pipeline in a headless browser and compare the pixels
// against the game's own dump.
//
// Not part of `node --test test/*.test.mjs` — it needs Chrome, ~40s of world
// generation, and a server. Run it on demand:
//
//   systemd-run --user --quiet --collect --pipe --wait --slice=claude-limit.slice \
//     -p MemoryMax=10G --working-directory=/home/vitaminmoo/repos/noita-telescope \
//     /usr/bin/node test/gl_regression.mjs [names...] [--rebaseline] [--margin=0.5] [--png DIR]
//
// (plain `node` makes headless Chrome SIGTRAP in this environment.)
//
// It starts its own dev server on a random free port, so it does not care
// whether the shared one on :8767 is busy, and kills only what it spawned.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import UPNG from 'upng-js';
import { startServer, drive, sleep } from './helpers/drive.mjs';
import {
	FIXTURE_DIR, fixtureNames, loadFixture, expectedAirMask, agreement, rgbAgreement, verdict,
} from './helpers/fixtures.mjs';
import { isRenderAir } from './helpers/netpbm.mjs';

const argv = process.argv.slice(2);
const flagVal = (n, d) => {
	const a = argv.find(s => s.startsWith(`--${n}=`));
	return a ? a.slice(n.length + 3) : d;
};
const REBASELINE = argv.includes('--rebaseline');
const MARGIN = Number(flagVal('margin', '0.5'));
const PNG_DIR = flagVal('png', null);
const only = argv.filter(a => !a.startsWith('-'));
const names = only.length ? only : fixtureNames();
if (!names.length) { console.error('no fixtures'); process.exit(1); }

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const gitHead = () => {
	try { return execFileSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); }
	catch { return 'unknown'; }
};

// Terrain-only baseline: the fixtures are ground truth for the world's cells,
// not for background art, atmosphere or debug overlays. A fixture can flip any
// of these through its own tier2.render.layers.
const BASE_LAYERS = {
	'debug-layer-biome-background': false,
	'debug-layer-custom-art': false,
	'debug-layer-atmosphere': false,
	'debug-layer-tile-overlays': true,
	'debug-layer-pixel-scenes': true,
	'debug-layer-secrets': false,
	'debug-layer-misc': false,
	// PoI markers became a real render layer (4859a24); before that they drew
	// unconditionally and the cyan meditation-cube disc leaked into fixtures.
	'debug-layer-pois': false,
};

/**
 * Which pixels of a fixture rect a stamped scene's colors file paints, as a
 * 0/1 byte per pixel (or null when no scene art reaches the rect).
 *
 * The rgb metric compares telescope's pixels against the game's MAPDUMP, which
 * re-renders the material grid through materials_gfx -- it carries NO scene art
 * at all. Where a scene's `<name>_visual.png` overrides the cell colours, the
 * two images are answering different questions, and no amount of fixing the
 * renderer can make them agree. That is a property of the ground truth, not a
 * defect, so those pixels come out of the metric entirely rather than dragging
 * a fixture's honest ceiling down (cube_chamber_scene measured 0%: its whole
 * rect is cube_chamber_visual.png).
 *
 * The mask is the same bit-packed artMask the loader builds and the hover
 * readout's "Art:" line tests (js/pixel_scene_generation.js), read straight off
 * the placed scenes in the live page, so it cannot drift from what was drawn.
 * It is intersected with the scene's OPAQUE pixels, because that is the gate
 * the art itself runs under (overlayVisualArt: "no cell here, art places none
 * either") -- art hanging over a scene's air paints nothing, and the terrain
 * showing through there is still worth comparing.
 */
async function artMaskFor(d, f) {
	const { x, y, w, h } = f.world;
	const covered = await d.evalIn(`(async () => {
		const m = await import('/js/app.js');
		const g = await import('/js/pixel_scene_generation.js');
		const scenes = m.app.pixelScenesByPW?.[\`\${m.app.pw},\${m.app.pwVertical}\`] ?? [];
		const hits = [];
		for (const s of scenes) {
			if (s.type !== 'pixel_scene') continue;
			const data = g.PIXEL_SCENE_DATA[s.key];
			if (!data || !data.artMask) continue;
			const x0 = Math.max(${x}, s.x), x1 = Math.min(${x + w}, s.x + s.width);
			const y0 = Math.max(${y}, s.y), y1 = Math.min(${y + h}, s.y + s.height);
			if (x0 >= x1 || y0 >= y1) continue;
			// The instance as drawn, so the opacity test is the drawn one.
			const bmp = g.getPixelSceneCanvas(s, 0);
			if (!bmp) continue;
			const c = new OffscreenCanvas(s.width, s.height);
			const ctx = c.getContext('2d', { willReadFrequently: true });
			ctx.drawImage(bmp, 0, 0);
			const px = ctx.getImageData(0, 0, s.width, s.height).data;
			for (let wy = y0; wy < y1; wy++) {
				for (let wx = x0; wx < x1; wx++) {
					const p = (wy - s.y) * data.width + (wx - s.x);
					if (!(data.artMask[p >> 3] & (0x80 >> (p & 7)))) continue;
					if (px[p * 4 + 3] !== 255) continue;
					hits.push((wy - ${y}) * ${w} + (wx - ${x}));
				}
			}
		}
		return hits;
	})()`);
	if (!covered.length) return null;
	const mask = new Uint8Array(w * h);
	for (const i of covered) mask[i] = 1;
	return mask;
}

const fixtures = names.map(loadFixture);
const seeds = new Set(fixtures.map(f => `${f.seed}|${f.ngPlus ?? 0}`));
if (seeds.size !== 1) throw new Error(`fixtures span several worlds (${[...seeds]}); run them per seed`);
const [seed, ng] = [...seeds][0].split('|').map(Number);

const server = await startServer();
let d = null;
try {
	d = await drive({ port: server.port, seed, ng });
	await d.evalIn(`(async () => {
		const s = await import('/js/settings.js');
		s.appSettings.terrainRenderer = 'gl';
		s.appSettings.engineTerrain = true;
		s.appSettings.checkerboardUnpainted = false;
		const cb = document.getElementById('debug-unpainted-checkerboard');
		if (cb && cb.checked) { cb.checked = false; cb.dispatchEvent(new Event('change')); }
		return true;
	})()`);

	const rows = [];
	let failures = 0;
	if (PNG_DIR) mkdirSync(PNG_DIR, { recursive: true });

	for (const f of fixtures) {
		const layers = { ...BASE_LAYERS, ...(f.tier2?.render?.layers ?? {}) };
		const { x, y, w, h } = f.world;
		await d.evalIn(`(async () => {
			for (const [id, on] of ${JSON.stringify(Object.entries(layers))}) {
				const el = document.getElementById(id);
				if (el && el.checked !== on) { el.checked = on; el.dispatchEvent(new Event('change')); }
			}
			const m = await import('/js/app.js');
			const u = await import('/js/utils.js');
			// Scene texturing is a one-time async load that the first draw only
			// *starts*; until it lands scenes paint flat colours. Await it so a
			// fixture renders the same whether it runs alone or late in the suite
			// (pyramid_right_rgb measured 89.6 % solo vs 82.4 % in the full run).
			await (await import('/js/pixel_scene_generation.js')).initPixelSceneTextures();
			m.app.canvas.width = ${w}; m.app.canvas.height = ${h};
			m.app.cam.x = ${x + w / 2} + 512 * u.getWorldCenter(m.app.isNGP, m.app.gameMode);
			m.app.cam.y = ${y + h / 2} + 512 * 14;
			m.app.cam.z = 1;
			m.app.drawNow();
			return true;
		})()`);
		await sleep(2500);
		// Edge decal tiles (the surface decal band) load asynchronously and each
		// draw only requests a few; keep drawing until none are in flight so the
		// render does not depend on how many landed during the sleep.
		for (let i = 0; i < 40; i++) {
			const pending = await d.evalIn(`(async () => {
				const m = await import('/js/app.js');
				m.app.drawNow();
				await new Promise(r => setTimeout(r, 250));
				return m.app.edgeDecalsPending();
			})()`);
			if (!pending) break;
		}
		const dataUrl = await d.evalIn(`(async () => {
			const m = await import('/js/app.js');
			m.app.drawNow();
			await new Promise(r => setTimeout(r, 400));
			return m.app.canvas.toDataURL('image/png');
		})()`);
		const png = Buffer.from(dataUrl.split(',')[1], 'base64');
		if (PNG_DIR) writeFileSync(`${PNG_DIR}/${f.name}.png`, png);
		const img = UPNG.decode(png);
		if (img.width !== w || img.height !== h) throw new Error(`${f.name}: rendered ${img.width}x${img.height}, want ${w}x${h}`);
		const rgba = new Uint8Array(UPNG.toRGBA8(img)[0]);

		const wantAir = expectedAirMask(f);
		const art = f.rgb ? await artMaskFor(d, f) : null;
		const gotAir = new Array(w * h);
		for (let i = 0; i < w * h; i++) gotAir[i] = isRenderAir(rgba, i * 4) ? 'air' : 'solid';
		// The rgb metric skips the game's air (two conventions for "nothing") and
		// the scene art (a colour the dump cannot carry) -- see artMaskFor.
		const rgbSkip = art ? Uint8Array.from(wantAir, (a, i) => (a || art[i] ? 1 : 0)) : wantAir;
		const rgb = f.rgb ? rgbAgreement(f.rgb, rgba, w * h, rgbSkip) : null;
		let artSkipped = 0;
		if (art) for (let i = 0; i < w * h; i++) if (art[i] && !wantAir[i]) artSkipped++;
		if (rgb) rgb.artSkipped = artSkipped;
		const measured = {
			airMask: agreement(Array.from(wantAir, a => (a ? 'air' : 'solid')), gotAir),
			// An all-air rect has no terrain colors to compare; only its mask. Nor
			// has a rect whose terrain is all scene art -- that one gets a `skip`
			// check recording the ceiling, rather than a percentage of nothing.
			rgb: rgb && rgb.n > 0 ? rgb : null,
		};

		const checks = f.tier2?.checks ?? [];
		for (const metric of ['airMask', 'rgb']) {
			const m = measured[metric];
			if (!m) {
				if (metric === 'rgb' && rgb && artSkipped) {
					rows.push([f.name, metric, 'n/a', 'info',
						`no comparable pixels: all ${artSkipped} terrain px are scene art`]);
				}
				continue;
			}
			const c = checks.find(k => k.metric === metric);
			if (!c || c.threshold === null) {
				rows.push([f.name, metric, `${m.pct.toFixed(3)}%`, 'info', 'no baseline yet']);
				continue;
			}
			const v = verdict(c, m.pct);
			if (!v.pass) failures++;
			rows.push([f.name, metric, `${m.pct.toFixed(3)}%`, v.pass ? 'pass' : 'FAIL',
				v.why + (m.artSkipped ? `  (${m.artSkipped} art px excluded)` : '')
				+ (v.pass ? '' : `  ${m.top}`)]);
		}

		if (REBASELINE) {
			const meta = JSON.parse(readFileSync(`${FIXTURE_DIR}${f.name}.json`, 'utf8'));
			const had = (k) => (meta.tier2.checks ?? []).some(c => c.metric === k);
			meta.tier2.checks = ['airMask', 'rgb'].filter(k => measured[k] || had(k)).map((k) => {
				const prev = (meta.tier2.checks ?? []).find(c => c.metric === k) ?? { metric: k, mode: 'agreement' };
				const stamp = { measuredAt: new Date().toISOString().slice(0, 10), measuredCommit: gitHead() };
				// Nothing left to compare: say so in the fixture instead of
				// recording a percentage over zero pixels.
				if (!measured[k]) {
					return {
						...prev, mode: 'skip', threshold: null, measured: null,
						artExcluded: artSkipped || undefined, comparedPixels: 0, ...stamp,
						note: `every terrain pixel in this rect is scene cell-colour art, which a MAPDUMP does not carry; ${k} has nothing to compare`,
					};
				}
				const pct = measured[k].pct;
				return {
					...prev,
					mode: prev.mode === 'skip' ? 'agreement' : prev.mode,
					// How many terrain pixels the scene-art exclusion took out of the
					// comparison, so the recorded percentage says what it is a
					// percentage OF. `undefined` drops the key on the way through
					// JSON.stringify, which also clears a stale one from `prev`.
					artExcluded: measured[k].artSkipped || undefined,
					comparedPixels: measured[k].n,
					measured: +pct.toFixed(3),
					...stamp,
					threshold: prev.mode === 'exact' ? 100 : Math.max(0, +(pct - MARGIN).toFixed(2)),
				};
			});
			writeFileSync(`${FIXTURE_DIR}${f.name}.json`, JSON.stringify(meta, null, '\t') + '\n');
		}
	}

	const wid = [0, 1, 2, 3].map(i => Math.max(...rows.map(r => String(r[i]).length)));
	console.log('\nfixture'.padEnd(wid[0] + 1) + '  metric'.padEnd(wid[1] + 2) + '  agreement  verdict');
	for (const r of rows) {
		console.log(r.slice(0, 4).map((c, i) => String(c).padEnd(wid[i])).join('  ') + (r[4] ? `  ${r[4]}` : ''));
	}
	if (d.errors.length) console.log(`\npage errors: ${d.errors.length}\n  ${d.errors.slice(0, 3).join('\n  ')}`);
	console.log(`\n${rows.length} checks, ${failures} failing${REBASELINE ? ' (thresholds rewritten)' : ''}`);
	if (failures) process.exitCode = 1;
} finally {
	if (d) d.close();
	server.stop();
}
