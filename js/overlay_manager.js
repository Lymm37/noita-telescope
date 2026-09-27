// world_manager.js
import { app } from './app.js';
import { EDGE_DECAL_TILE, putEdgeDecalTile } from './edge_decal_layer.js';
import { EDGE_DECAL_HALO } from './edge_decals.js';
import { PIXEL_SCENE_DATA, putPixelSceneBitmaps, setPixelSceneBitmapRequester } from './pixel_scene_generation.js';
import { appSettings, updateSettingsFromUI } from './settings.js';
import { CHUNK_SIZE } from './constants.js';
import { getWorldCenter, getWorldStride } from './utils.js';
import { renderTrace } from './render_hud.js';

export const overlayWorker = new Worker(new URL('./overlay_worker.js', import.meta.url), { type: 'module' });
// A worker whose script fails to load/parse (stale cache, syntax error) dies
// without ever answering, and everything it serves — overlays, pixel scenes,
// edge decals — silently stops. Make that failure loud.
overlayWorker.addEventListener('error', (e) =>
	console.error('overlay worker failed:', e.message ?? '(no message)', e.filename ?? '', e.lineno ?? ''));
overlayWorker.addEventListener('messageerror', () =>
	console.error('overlay worker: message deserialization failed'));

// Keep track of pending generation requests so we don't spam the worker
const pendingOverlayRequests = new Set();

overlayWorker.onmessage = async (e) => {
	const msg = e.data;

	if (msg.type === 'JOB_START') {
		renderTrace.stage(msg.traceId, 'running');
	}
	else if (msg.type === 'JOB_DONE') {
		renderTrace.end(msg.traceId, { workerMs: msg.ms });
	}
	else if (msg.type === 'STATUS') {
		app.setLoading(true, msg.msg);
	}
	else if (msg.type === 'PIXEL_SCENES_GENERATED') {
		const pixelSceneKeys = msg.pixelSceneKeys;
		const variantKeys = msg.variantKeys;
		const pixelSceneImages = msg.pixelSceneImages;
		for (let i = 0; i < pixelSceneKeys.length; i++) {
			const key = pixelSceneKeys[i];
			const variantKey = variantKeys[i];
			const imgElement = pixelSceneImages[i];
			if (!PIXEL_SCENE_DATA[key].variants) {
				PIXEL_SCENE_DATA[key].variants = {};
			}
			PIXEL_SCENE_DATA[key].variants[variantKey] = imgElement;
		}
		app.draw();
	}
	else if (msg.type === 'SCENE_BITMAPS') {
		if (putPixelSceneBitmaps(msg)) app.draw();
	}
	else if (msg.type === 'EDGE_DECAL_TILE') {
		// Kept for harness inspection; bounded so a long session cannot grow it.
		if (msg.debug) {
			const d = (app._decalDebug ??= []);
			d.push({ tx: msg.tx, ty: msg.ty, ...msg.debug });
			if (d.length > 64) d.shift();
		}
		// Always route the reply through putEdgeDecalTile: a null bitmap (the
		// worker's tile layers weren't synced yet) must still clear the tile's
		// pending flag, or the tile is never re-requested and decals stay
		// missing for the rest of the session.
		if (putEdgeDecalTile(msg.worldKey, msg.tx, msg.ty, msg.bitmap)) app.draw();
	}
	else if (msg.type === 'OVERLAY_GENERATED') {
		const pwKey = `${msg.pw},${msg.pwVertical}`;
		if (app.seed !== msg.seed || app.ngPlusCount !== msg.ngPlusCount || app.gameMode !== msg.gameMode || appSettings.biomeOverlayMode !== msg.biomeOverlayMode) {
			// Race condition due to user quickly changing seed/ng values while worker is still processing - just ignore the result since it's outdated
			console.warn(`Outdated overlay generation discarded for PW ${msg.pw},${msg.pwVertical}`);
			pendingOverlayRequests.delete(pwKey);
			app.tileOverlaysByPW[pwKey] = null;
			// Surprisingly this still didn't fix it
			return;
		}
		// Cache the overlay data sent back from the worker
		app.tileOverlaysByPW[pwKey] = msg.overlays;

		// Just in case, fill the main world overlay to get the NG speedup
		if (!app.isNGP && !app.tileOverlaysByPW[`0,${msg.pwVertical}`]) {
			app.tileOverlaysByPW[`0,${msg.pwVertical}`] = msg.overlays;
		}

		// Clear it from the pending list
		pendingOverlayRequests.delete(pwKey);

		// Draw (otherwise we can see blank regions)
		app.draw();
	}
};

export function syncOverlayWorkerData() {
	// The worker recolors from the base images and never draws the visual-art
	// overlays (those apply at main-thread bitmap build), so don't clone the
	// ~80MB of decoded art into it.
	const pixelSceneCache = Object.fromEntries(Object.entries(PIXEL_SCENE_DATA)
		.map(([k, v]) => [k, v.visualArt ? { ...v, visualArt: null } : v]));
	artSentToWorker.clear();   // the worker's copy of the art goes with the old metadata
	overlayWorker.postMessage({
		cmd: 'SYNC_METADATA',
		pixelSceneCache,
		biomeData: app.biomeData,
		tileLayers: app.tileLayers,
		// Do not transfer these buffers: the main renderer continues to use them.
		// Structured cloning gives the worker independent RGB lookup data.
		recolorBuffers: {
			normal: app.recolorOffscreenBuffer,
			heaven: app.recolorOffscreenHeavenBuffer,
			hell: app.recolorOffscreenHellBuffer
		}
	});
	pendingOverlayRequests.clear();
}

export function syncSettingsToOverlayWorker() {
	updateSettingsFromUI();
	overlayWorker.postMessage({
		cmd: 'SYNC_SETTINGS',
		settings: appSettings
	});
	//console.log(appSettings);
}

export function recolorPixelScenes(pixelSceneList) {
	const pixelSceneKeys = [];
	const variantKeys = [];
	const combinedKeys = []; // To track which key+variant combos we've already requested
	// Only include new scenes that need to be recolored
	for (const scene of pixelSceneList) {
		const pixelSceneData = PIXEL_SCENE_DATA[scene.key];
		if (!pixelSceneData) continue;
		if (!pixelSceneData.variants) {
			pixelSceneData.variants = {};
		}
		const combinedKey = `${scene.key}/${scene.variantKey}`;
		if (!pixelSceneData.variants[scene.variantKey] && !combinedKeys.includes(combinedKey)) {
			pixelSceneKeys.push(scene.key);
			variantKeys.push(scene.variantKey);
			combinedKeys.push(combinedKey);
		}
	}
	if (pixelSceneKeys.length > 0) {
		console.log(`Requesting recolors for ${pixelSceneKeys.length} pixel scenes`);
		const payload = {
			cmd: 'GENERATE_PIXEL_SCENES',
			pixelSceneKeys,
			variantKeys,
			traceId: renderTrace.begin('recolor', `${pixelSceneKeys.length} scene variants`, 'pixelScenes'),
		};
		overlayWorker.postMessage(payload);
	}
}

// Scene bitmaps are built in the worker (pixel_scene_generation.js). The visual
// art a scene may carry is deliberately left out of SYNC_METADATA (~90 MB of
// decoded PNGs); it rides along with the first bitmap request per scene key
// after each sync, and the worker keeps it from then on.
const artSentToWorker = new Set();
setPixelSceneBitmapRequester((request, sceneData) => {
	if (sceneData.visualArt && !artSentToWorker.has(request.key)) {
		artSentToWorker.add(request.key);
		request.visualArt = sceneData.visualArt;
	}
	request.traceId = renderTrace.begin('scene', `${request.key}${request.textured ? ' (tex)' : ''}`, 'pixelScenes');
	overlayWorker.postMessage(request);
});

export function getOrGenerateOverlay(pw, pwVertical) {
	const pwKey = `${pw},${pwVertical}`;

	// Speedup for NG where we can reuse the same overlay
	if (!app.isNGP && app.gameMode !== 'nightmare' && app.tileOverlaysByPW[`0,${pwVertical}`]) {
		app.tileOverlaysByPW[pwKey] = app.tileOverlaysByPW[`0,${pwVertical}`];
		return;
	}

	if (app.tileOverlaysByPW[pwKey]) {
		return; // Overlay is already generated and cached
	}

	if (pendingOverlayRequests.has(pwKey)) {
		return; // Overlay is already being generated
	}

	pendingOverlayRequests.add(pwKey);

	const payload = {
		cmd: 'GENERATE_OVERLAY',
		seed: app.seed,
		ngPlusCount: app.ngPlusCount,
		pw,
		pwVertical,
		gameMode: app.gameMode,
		traceId: renderTrace.begin('overlay', `PW ${pwKey}`, 'tileOverlays'),
	};

	overlayWorker.postMessage(payload);
}

/**
 * Asks for a batch of world-space edge-decal tiles (edge_decal_layer.js).
 * The per-pixel material ids -- 24 ms a tile on the CPU -- come from the GL
 * terrain renderer's material-id pass (one batched draw + async readback for
 * the whole request); the stamp itself runs in the overlay worker, which gets
 * the id grid handed to it. Without the GL pass (no WebGL2, context lost) the
 * worker resolves the ids itself, as before.
 *
 * Returns the tiles it accepted; a tile whose world has no scene placement list
 * yet is left out so the layer asks for it again later.
 */
export function requestEdgeDecalTiles(worldKey, tiles) {
	const accepted = [];
	const jobs = [];
	for (const t of tiles) {
		const scenes = edgeDecalTileScenes(t.tx, t.ty);
		if (!scenes) continue;
		accepted.push(t);
		jobs.push({ tx: t.tx, ty: t.ty, scenes });
	}
	if (!jobs.length) return accepted;
	const P = EDGE_DECAL_HALO, size = EDGE_DECAL_TILE + 2 * P;
	const base = {
		cmd: 'GENERATE_EDGE_DECAL_TILE', worldKey,
		seed: app.seed, ngPlusCount: app.ngPlusCount, gameMode: app.gameMode,
	};
	const post = (job, rgba) => {
		renderTrace.stage(job.traceId, 'queued');
		const msg = { ...base, tx: job.tx, ty: job.ty, scenes: job.scenes, matRGBA: rgba || null, size, traceId: job.traceId };
		overlayWorker.postMessage(msg, rgba ? [rgba.buffer] : []);
	};
	const terrain = app.glTerrain;
	const gpu = !!(terrain && terrain.engineReady);
	for (const job of jobs) job.traceId = renderTrace.begin('decal', `tile ${job.tx},${job.ty}`, 'edgeDecals', gpu ? 'gpu' : 'queued');
	if (!gpu) {
		for (const job of jobs) post(job, null);
		return accepted;
	}
	const rects = jobs.map(j => ({ x0: j.tx * EDGE_DECAL_TILE - P, y0: j.ty * EDGE_DECAL_TILE - P, w: size, h: size }));
	// The batch's GPU time, split evenly over its tiles for the HUD.
	const onGpuMs = (ms) => { for (const job of jobs) renderTrace.gpu(job.traceId, ms / jobs.length, jobs.length); };
	terrain.resolveMaterialTiles(rects, onGpuMs).then((grids) => {
		jobs.forEach((job, i) => post(job, grids ? grids[i] : null));
	});
	return accepted;
}

/** The pixel scenes overlapping one tile's padded rect, in paint order, or
 *  null when a world the tile touches has no placement list yet. */
function edgeDecalTileScenes(tx, ty) {
	// The pixel scenes overlapping the tile's padded rect, in paint order: the
	// engine dresses a scene's cells with its own decal pass at paint time, so
	// the worker needs to know what landed here. Tiles are world-space and
	// scene positions are absolute (scanSpawnFunctions / addStaticPixelScenes
	// already add the parallel-world stride) — but each list only HOLDS its own
	// world's scenes, so the main-world list answers nothing west of x=-17920
	// or east of 17920: handed to every PW, it stamped every parallel world as
	// if it had no scenes at all (terrain stamps left under scene cells, scene
	// borders undressed). Read the list of every world the tile touches instead.
	//
	// Which world a tile belongs to follows the chunk grid (mapWidth chunks per
	// world), the same wrap the terrain uses. In NG+ scenes sit on the 8px-short
	// stride (64*512-8), so a scene from world k can drift into world k+1's
	// chunk frame near a seam; every loaded world's list is scanned for
	// overlaps, so such a scene is still found as long as its world is loaded.
	//
	// No list yet for a world the tile needs (still generating) -> decline, so
	// the layer retries on a later draw instead of caching a tile with the
	// scene stamps missing.
	const scenes = [];
	const P = EDGE_DECAL_HALO;
	const left = tx * EDGE_DECAL_TILE - P, right = left + EDGE_DECAL_TILE + 2 * P;
	const top = ty * EDGE_DECAL_TILE - P, bottom = top + EDGE_DECAL_TILE + 2 * P;
	const centerPx = getWorldCenter(app.isNGP, app.gameMode) * CHUNK_SIZE;
	const worldPx = getWorldStride(app.isNGP, app.gameMode); // scenes sit on the PW stride
	const pwOf = (x) => Math.floor((x + centerPx) / worldPx);
	const byPW = app.pixelScenesByPW;
	if (!byPW) return null;
	for (let k = pwOf(left); k <= pwOf(right - 1); k++) {
		if (!byPW[`${k},0`]) return null;
	}
	for (const key in byPW) {
		if (!key.endsWith(',0')) continue;   // vertical worlds keep the CPU overlays
		for (const scene of byPW[key]) {
			const data = PIXEL_SCENE_DATA[scene.key];
			if (!data) continue;
			if (scene.x + data.width <= left || scene.x >= right ||
				scene.y + data.height <= top || scene.y >= bottom) continue;
			scenes.push({ key: scene.key, variantKey: scene.variantKey, x: scene.x, y: scene.y });
		}
	}
	return scenes;
}

export function isOverlayPending(pw, pwVertical) {
	const pwKey = `${pw},${pwVertical}`;
	return pendingOverlayRequests.has(pwKey);
}

export function invalidatePendingOverlays() {
	// Worker jobs cannot be cancelled, but clearing this set allows replacement
	// requests immediately. Their results are rejected by the overlay-mode check.
	pendingOverlayRequests.clear();
}