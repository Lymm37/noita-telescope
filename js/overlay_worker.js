// overlay_worker.js
import {
	bitmapFromPixels, buildTexturedScenePixels, ensureScenePixels, eraseFlatScenePixels, halveWithoutHoles, initPixelSceneTextures, injectPixelSceneData,
	overlayVisualArt, PIXEL_SCENE_DATA, pixelSceneMaterialGrid, recolorPixelScene, recolorPixelSceneForBiome,
} from './pixel_scene_generation.js';
import * as bandSelect from './engine_resolve/band_select.js';
import { createTileOverlaysCheap, createTileOverlays, createTileOverlaysExpanded } from './image_processing.js';
import { appSettings, updateSettings } from './settings.js';
import { CHUNK_SIZE } from './constants.js';
import { decodeMaterialIdTile, EDGE_DECAL_TILE } from './edge_decal_layer.js';
import { EDGE_DECAL_HALO, initEdgeDecalAtlas, stampEdgeDecals } from './edge_decals.js';
import { createMaterialField, resolveMaterialRect } from './engine_resolve/material_field.js';
import { GENERATOR_CONFIG } from './generator_config.js';
import { getWorldSize } from './utils.js';

let workerBiomeData = null;
let workerTileLayers = null;
let workerRecolorBuffers = null;

self.onmessage = async function(e) {
	const data = e.data;

	if (data.cmd === 'SYNC_METADATA') {
		injectPixelSceneData(data.pixelSceneCache);
		workerBiomeData = data.biomeData;
		workerTileLayers = data.tileLayers;
		workerRecolorBuffers = data.recolorBuffers;
	}
	else if (data.cmd === 'SYNC_SETTINGS') {
		updateSettings(data.settings);
		// Unlocks not needed here, hopefully
		return; 
	}
	// Render HUD tracing (render_hud.js): a request carrying a traceId gets a
	// JOB_START when it leaves the FIFO and a JOB_DONE with this thread's time
	// for it. The reply itself is posted by the job as usual. Jobs that await
	// overlap, so elapsed time is shared out among the jobs running at the time
	// (jobBusyStep) -- otherwise ten jobs awaiting one atlas load would each
	// claim the whole wait and the worker would read as 1000% busy.
	const traceId = data.traceId;
	if (traceId) self.postMessage({ type: 'JOB_START', traceId });
	const job = { ms: 0 };
	jobBusyStep();
	runningJobs.add(job);
	if (data.cmd === 'GENERATE_PIXEL_SCENES') {
		await generatePixelSceneImagesWorker(data.pixelSceneKeys, data.variantKeys);
	}
	else if (data.cmd === 'GENERATE_OVERLAY') {
		generateOverlayWorker(data.seed, data.ngPlusCount, data.pw, data.pwVertical, data.gameMode);
	}
	else if (data.cmd === 'GENERATE_EDGE_DECAL_TILE') {
		await generateEdgeDecalTileWorker(data);
	}
	else if (data.cmd === 'BUILD_SCENE_BITMAPS') {
		await buildSceneBitmapsWorker(data);
	}
	jobBusyStep();
	runningJobs.delete(job);
	if (traceId) self.postMessage({ type: 'JOB_DONE', traceId, ms: job.ms });
};

const runningJobs = new Set();
let jobBusyAt = 0;
function jobBusyStep() {
	const t = performance.now();
	if (runningJobs.size) {
		const share = (t - jobBusyAt) / runningJobs.size;
		for (const j of runningJobs) j.ms += share;
	}
	jobBusyAt = t;
}

// ---------------------------------------------------------------------------
// Scene bitmaps (pixel_scene_generation.js "Bitmaps are BUILT IN THE OVERLAY
// WORKER"): one request = one drawable scene, as an ImageBitmap per mip level
// plus the FORCE-AIR mask for textured instances, all transferred back.
// ---------------------------------------------------------------------------
// Recolored variants, so neighbouring instances of one scene do not each
// re-run the substitution chain. Bounded; the base images stay in PIXEL_SCENE_DATA.
const variantPixelCache = new Map();
const VARIANT_PIXEL_CACHE_MAX = 64;

// The variant's pixels after its material substitutions only (still wang
// colors), and the biome its `biome=` part recolors for.
function wangPixelsAndBiome(data, variantKey) {
	let pixels = data.imgElement;
	let biome = 'general';
	for (const part of variantKey.split('&')) {
		const eq = part.indexOf('=');
		if (eq < 0) continue;
		if (part.slice(0, eq) === 'biome') biome = part.slice(eq + 1);
		else pixels = recolorPixelScene(pixels, parseInt(part.slice(0, eq), 16), parseInt(part.slice(eq + 1), 16));
	}
	return [pixels, biome];
}

function variantPixels(key, variantKey) {
	const cacheKey = `${key}/${variantKey}`;
	let pixels = variantPixelCache.get(cacheKey);
	if (pixels) return pixels;
	const data = PIXEL_SCENE_DATA[key];
	if (!data || !ArrayBuffer.isView(data.imgElement)) return null;
	pixels = data.imgElement;
	for (const part of variantKey.split('&')) {
		const eq = part.indexOf('=');
		if (eq < 0) continue;
		if (part.slice(0, eq) === 'biome') pixels = recolorPixelSceneForBiome(data.name, pixels, part.slice(eq + 1));
		else pixels = recolorPixelScene(pixels, parseInt(part.slice(0, eq), 16), parseInt(part.slice(eq + 1), 16));
	}
	if (variantPixelCache.size >= VARIANT_PIXEL_CACHE_MAX) {
		variantPixelCache.delete(variantPixelCache.keys().next().value);
	}
	variantPixelCache.set(cacheKey, pixels);
	return pixels;
}

async function buildSceneBitmapsWorker(req) {
	const { epoch, cacheKey, key, variantKey, x, y, textured, erase, texturedAlphas, maxLevel } = req;
	// Every request must be answered: the main thread holds cacheKey as pending
	// until a reply lands, and a textured request that never answers occupies
	// one of its few in-flight slots for good.
	const fail = (reason, err) => {
		console.error(`[scene bitmaps] no bitmap for ${cacheKey}${textured ? ' (tex)' : ''}: ${reason}`, err ?? '');
		self.postMessage({ type: 'SCENE_BITMAPS', epoch, cacheKey, key, variantKey, textured, levels: null, failReason: reason });
	};
	try {
		const data = PIXEL_SCENE_DATA[key];
		if (!data) return fail(`no PIXEL_SCENE_DATA entry for "${key}" in the worker (${Object.keys(PIXEL_SCENE_DATA || {}).length} entries synced)`);
		// Neither the pixels nor the colors-file art are part of the metadata
		// sync; each scene is decoded here the first time it is drawn.
		await ensureScenePixels(data);
		let pixels = null, airMask = null;
		if (textured) {
			const modules = await initPixelSceneTextures();
			const built = buildTexturedScenePixels({ key, variantKey, x, y }, data, true);
			if (built) { pixels = built.pixels; airMask = built.airMask; }
			else console.warn(`[scene bitmaps] textured build of ${cacheKey} returned null (texture modules ${modules ? 'loaded' : 'FAILED'}, atlas ${modules?.atlas.getMaterialAtlas() ? 'ready' : 'missing'}); falling back to flat colors`);
		}
		if (!pixels) {
			pixels = variantPixels(key, variantKey);
			if (!pixels) {
				const img = data.imgElement;
				return fail(`variantPixels returned null (imgElement is ${img == null ? img : img.constructor?.name}, variantKey "${variantKey}")`);
			}
			if (erase) {
				const [wang, biome] = wangPixelsAndBiome(data, variantKey);
				({ pixels, airMask } = eraseFlatScenePixels(data.name, wang, pixels, biome, texturedAlphas ?? []));
			}
		}
		const width = data.width, height = data.height;
		if (data.visualArt) pixels = overlayVisualArt(pixels, width, height, data.visualArt);
		// The whole mip chain up front: each level is reduced from the one above
		// (halveWithoutHoles keeps the one-pixel seams), and building it here costs
		// a third more pixels than level 0 alone, against a readback + halving on the
		// draw thread the first time each zoom band asked for it.
		// The air mask gets the same chain: the GL pass needs it at the size of the
		// level it erases for. halveWithoutHoles keeps any erased pixel of a block.
		const levels = [bitmapFromPixels(width, height, pixels)];
		const airMasks = airMask ? [bitmapFromPixels(width, height, airMask)] : [];
		let img = { width, height, data: pixels };
		let mask = airMask && { width, height, data: airMask };
		const toBitmap = (im) => {
			const canvas = new OffscreenCanvas(im.width, im.height);
			canvas.getContext('2d').putImageData(im, 0, 0);
			return canvas.transferToImageBitmap();
		};
		for (let l = 1; l <= maxLevel; l++) {
			img = halveWithoutHoles(img);
			levels.push(toBitmap(img));
			if (mask) {
				mask = halveWithoutHoles(mask);
				airMasks.push(toBitmap(mask));
			}
		}
		self.postMessage({
			type: 'SCENE_BITMAPS', epoch, cacheKey, key, variantKey, textured, width, height,
			levels, airMasks,
		}, [...levels, ...airMasks]);
	} catch (err) {
		fail(`threw ${err?.message ?? err}`, err);
	}
}

// ---------------------------------------------------------------------------
// Edge decals
//
// One world-space RGBA tile per request. The per-pixel material field the stamp
// reads is a pure function of the world, so it is built once per seed and kept;
// the 1/10 coverage lattice inside it is the only expensive part (~0.2 s).
// ---------------------------------------------------------------------------
let decalField = null;
let decalFieldKey = null;
// A scene's material grid is a pure function of (scene, variant, position), and
// neighbouring tiles keep asking for the same scenes, so keep a bounded cache.
const sceneGridCache = new Map();
const SCENE_GRID_CACHE_MAX = 128;

function sceneGridFor(scene) {
	const key = `${scene.key}/${scene.variantKey || ''}@${scene.x},${scene.y}`;
	let grid = sceneGridCache.get(key);
	if (grid === undefined) {
		grid = pixelSceneMaterialGrid(scene, bandSelect);
		if (sceneGridCache.size >= SCENE_GRID_CACHE_MAX) {
			sceneGridCache.delete(sceneGridCache.keys().next().value);
		}
		sceneGridCache.set(key, grid);
	}
	return grid;
}

async function generateEdgeDecalTileWorker(msg) {
	const { worldKey, tx, ty, seed, ngPlusCount, gameMode, scenes } = msg;
	let bitmap = null;
	if (workerTileLayers && workerBiomeData) {
		await initEdgeDecalAtlas();
		if (decalFieldKey !== worldKey) {
			decalField = null;   // built below only if a tile needs the CPU resolve
			decalFieldKey = worldKey;
			sceneGridCache.clear();
		}
		const P = EDGE_DECAL_HALO;
		const size = EDGE_DECAL_TILE + 2 * P;
		const x0 = tx * EDGE_DECAL_TILE - P;
		const y0 = ty * EDGE_DECAL_TILE - P;
		// The id grid normally arrives from the GL material-id pass
		// (overlay_manager.js requestEdgeDecalTiles); the CPU port is the
		// fallback when the renderer cannot answer.
		const tResolve0 = performance.now();
		let mat;
		if (msg.matRGBA && msg.matRGBA.length === size * size * 4) {
			mat = decodeMaterialIdTile(msg.matRGBA, size, size);
		} else {
			if (!decalField) {
				const mapWidth = getWorldSize(ngPlusCount > 0, gameMode);
				decalField = createMaterialField(workerTileLayers, workerBiomeData,
					GENERATOR_CONFIG, mapWidth, seed);
			}
			mat = resolveMaterialRect(decalField, x0, y0, size, size);
		}
		const tResolve1 = performance.now();
		// Chunk boundaries sit where (world + grid shift) is a multiple of 512;
		// both shifts are whole chunks for every shipped map width, but the stamp
		// clips to its own chunk so pass it rather than assume.
		const mapWidth = getWorldSize(ngPlusCount > 0, gameMode);
		// A scene whose pixels are not decoded yet has no grid, and the grid
		// cache would keep that null, so decode first.
		await Promise.all((scenes || []).map(s => ensureScenePixels(PIXEL_SCENE_DATA[s.key], { art: false })
			.catch(err => console.error(`[edge decals] pixel scene ${s.key} failed to decode:`, err))));
		const sceneGrids = (scenes || []).map(sceneGridFor).filter(Boolean);
		const tGrid = performance.now();
		// The stamp's pixel statistics cost two extra passes over the tile;
		// only the harness reads them.
		const stats = msg.debugStats ? {} : null;
		const rgba = stampEdgeDecals(mat, size, size, x0, y0, seed, {
			chunkShiftX: (mapWidth * 256) % CHUNK_SIZE,
			chunkShiftY: (14 * CHUNK_SIZE) % CHUNK_SIZE,
			// The scenes overlapping this tile, in paint order: each one runs the
			// engine's scene-time decal pass on top of the terrain passes.
			scenes: sceneGrids,
			// The biome map gates the seam band per chunk: a biome whose
			// <Topology> sets skip_edge_textures dresses its interior only.
			biomeData: workerBiomeData,
			mapWidth,
			// Only the core survives the crop below.
			inset: P,
			stats,
		});
		const tStamp = performance.now();
		var decalDebug = {
			scenesSent: (scenes || []).length, gridsBuilt: sceneGrids.length, ...(stats || {}),
			// Where the tile's time goes, for the perf harness.
			resolveMs: tResolve1 - tResolve0, gridMs: tGrid - tResolve1, stampMs: tStamp - tGrid, bitmapMs: 0,
		};

		const T = EDGE_DECAL_TILE;
		const cropped = new Uint8ClampedArray(T * T * 4);
		for (let row = 0; row < T; row++) {
			const src = ((row + P) * size + P) * 4;
			cropped.set(rgba.subarray(src, src + T * 4), row * T * 4);
		}
		const canvas = new OffscreenCanvas(T, T);
		canvas.getContext('2d').putImageData(new ImageData(cropped, T, T), 0, 0);
		bitmap = canvas.transferToImageBitmap();
		decalDebug.bitmapMs = performance.now() - tStamp;
	}

	self.postMessage({
		type: 'EDGE_DECAL_TILE',
		worldKey, tx, ty, bitmap,
		debug: typeof decalDebug !== 'undefined' ? decalDebug : null,
	}, bitmap ? [bitmap] : []);
}

async function generatePixelSceneImagesWorker(pixelSceneKeys, variantKeys) {
	let outputPixelSceneKeys = [];
	let outputVariantKeys = [];
	let arraybuffers = [];

	await Promise.all(pixelSceneKeys.map(k => ensureScenePixels(PIXEL_SCENE_DATA[k], { art: false })
		.catch(err => console.error(`pixel scene ${k} failed to decode:`, err))));
	for (let i = 0; i < pixelSceneKeys.length; i++) {
		const pixelSceneKey = pixelSceneKeys[i];
		const variantKey = variantKeys[i];
		const pixelSceneData = PIXEL_SCENE_DATA[pixelSceneKey];
		if (!ArrayBuffer.isView(pixelSceneData?.imgElement)) continue;
		// Split variant key to recolor in parts
		const variantParts = variantKey.split('&');
		let recoloredPixelScene = pixelSceneData.imgElement;
		let currentVariantKey = '';
		for (const part of variantParts) {
			const variantSides = part.split('=');
			if (variantSides[0] === 'biome') {
				// Biome recolor
				recoloredPixelScene = recolorPixelSceneForBiome(PIXEL_SCENE_DATA[pixelSceneKey].name, recoloredPixelScene, variantSides[1]);
			}
			else {
				// Material recolor
				recoloredPixelScene = recolorPixelScene(recoloredPixelScene, parseInt(variantSides[0], 16), parseInt(variantSides[1], 16));
			}
			currentVariantKey += (currentVariantKey !== '' ? '&' : '') + part;
			outputPixelSceneKeys.push(pixelSceneKey);
			outputVariantKeys.push(currentVariantKey);
			arraybuffers.push(recoloredPixelScene);
		}
	}

	self.postMessage({
		type: 'PIXEL_SCENES_GENERATED',
		pixelSceneKeys: outputPixelSceneKeys,
		variantKeys: outputVariantKeys,
		pixelSceneImages: arraybuffers
	});
}

function generateOverlayWorker(seed, ngPlusCount, pw, pwVertical, gameMode) {
	const biomeOverlayMode = appSettings.biomeOverlayMode;
	const isNGP = ngPlusCount > 0;
	let canvases;

	if (biomeOverlayMode === 'normal' || biomeOverlayMode === 'expanded') {
		const recolorBuffer = pwVertical < 0
			? workerRecolorBuffers?.heaven
			: pwVertical > 0
				? workerRecolorBuffers?.hell
				: workerRecolorBuffers?.normal;

		// Metadata is synchronized before overlay requests. Fall back to the cheap
		// path only if a request races before its RGB recolor data arrives.
		if (recolorBuffer) {
			canvases = biomeOverlayMode === 'expanded'
				? createTileOverlaysExpanded(workerBiomeData, recolorBuffer, workerTileLayers, pw, pwVertical, isNGP, gameMode)
				: createTileOverlays(workerBiomeData, recolorBuffer, workerTileLayers, pw, pwVertical, isNGP, gameMode);
		}
	}

	if (!canvases) {
		canvases = createTileOverlaysCheap(workerBiomeData, workerTileLayers, pw, pwVertical, isNGP, gameMode);
	}


	// Extract the rendered pixels from each canvas into a transferable ImageBitmap
	const bitmaps = [];
	if (canvases && canvases.length > 0) {
		bitmaps.push(...canvases.map(canvas => canvas.transferToImageBitmap()));
	}

	self.postMessage({
		type: 'OVERLAY_GENERATED',
		seed: seed,
		ngPlusCount: ngPlusCount,
		pw: pw,
		pwVertical: pwVertical,
		gameMode: gameMode,
		biomeOverlayMode: biomeOverlayMode,
		overlays: bitmaps
	}, bitmaps);
}

// Reference for later
/*
const biomeOverlayMode = document.getElementById('debug-biome-overlay-mode').value;
if (biomeOverlayMode !== 'none') {
if (!this.tileOverlaysByPW[`${pwX},${pwY}`]) {
	// Major timesave in NG, we can reuse the same overlay...
	if (!this.isNGP) {
		if (this.tileOverlaysByPW[`0,${pwY}`]) {
			this.tileOverlaysByPW[`${pwX},${pwY}`] = this.tileOverlaysByPW[`0,${pwY}`];
		}
	}
	if (!this.tileOverlaysByPW[`${pwX},${pwY}`]) {
		// Generate it now (this seems like a bad idea since it will hang)
		// Use different recolor map for vertical PWs
		let recolorMapUsed = this.recolorOffscreenBuffer;
		if (pwY < 0) {
			recolorMapUsed = this.recolorOffscreenHeavenBuffer;
		}
		else if (pwY > 0) {
			recolorMapUsed = this.recolorOffscreenHellBuffer;
		}
		if (biomeOverlayMode === 'expanded') {
			this.tileOverlaysByPW[`${pwX},${pwY}`] = createTileOverlaysExpanded(this.biomeData, recolorMapUsed, this.tileLayers, pwX, pwY, this.isNGP);
		}
		else if (biomeOverlayMode === 'normal') {
			this.tileOverlaysByPW[`${pwX},${pwY}`] = createTileOverlays(this.biomeData, recolorMapUsed, this.tileLayers, pwX, pwY, this.isNGP);
		}
		else {
			this.tileOverlaysByPW[`${pwX},${pwY}`] = createTileOverlaysCheap(this.biomeData, this.tileLayers, pwX, pwY, this.isNGP);
		}
	}
}
*/
