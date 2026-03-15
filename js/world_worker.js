// world_worker.js
import { injectPixelSceneData } from './pixel_scene_generation.js';
import { getSpecialPoIs, scanSpawnFunctions } from './poi_scanner.js';
import { addStaticPixelScenes } from './static_spawns.js';
import { injectTranslations } from './translations.js';
import { createTileOverlaysCheap, createTileOverlays, createTileOverlaysExpanded } from './image_processing.js';
import { appSettings, updateSettings } from './settings.js';

let worldState = null;
let workerBiomeData = null;
let workerTileSpawns = null;
let workerTileLayers = null;

self.onmessage = async function(e) {
    const data = e.data;

    if (data.cmd === 'SYNC_METADATA') {
        injectPixelSceneData(data.pixelSceneCache);
        injectTranslations(data.translationsCache);
		workerBiomeData = data.biomeData;
        workerTileSpawns = data.tileSpawns;
		workerTileLayers = data.tileLayers;
    }
	else if (data.cmd === 'SYNC_SETTINGS') {
		updateSettings(data.settings);
		return; 
	}
	else if (data.cmd === 'GENERATE_PW') {
		worldState = data;
		generatePWWorker();
	}
    else if (data.cmd === 'GENERATE_OVERLAY') {
        worldState = data;
		generateOverlayWorker();
    }
};

function generatePWWorker() {
	if (!worldState) return;

	const { seed, ngPlusCount, pw, pwVertical, skipCosmeticScenes, perks } = worldState;
	
	//self.postMessage({ type: 'STATUS', msg: `Searching PW ${pw >= 0 ? '+' : ''}${pw}, ${pwVertical}...` });

	const scanResults = scanSpawnFunctions(workerBiomeData, workerTileSpawns, seed, ngPlusCount, pw, pwVertical, skipCosmeticScenes, perks);
	const specialPoIs = getSpecialPoIs(workerBiomeData, seed, ngPlusCount, pw, pwVertical, perks);
	const staticSpawnResults = addStaticPixelScenes(seed, ngPlusCount, pw, pwVertical, workerBiomeData, skipCosmeticScenes, perks);
	
	specialPoIs.push(...staticSpawnResults.pois);
	const finalPixelScenes = scanResults.finalPixelScenes.concat(staticSpawnResults.pixelScenes);
	const generatedSpawns = scanResults.generatedSpawns.concat(specialPoIs);

	self.postMessage({
		type: 'PW_GENERATED',
		pw: pw,
		pwVertical: pwVertical,
		pois: generatedSpawns,
		pixelScenes: finalPixelScenes
	});
}

function generateOverlayWorker() {
	if (!worldState) return;

	const { seed, ngPlusCount, pw, pwVertical } = worldState;

	const biomeOverlayMode = appSettings.biomeOverlayMode;
    let canvases;

	//if (biomeOverlayMode === 'cheap') {
		canvases = createTileOverlaysCheap(workerBiomeData, workerTileLayers, pw, pwVertical, ngPlusCount > 0);
	//}
	// TODO: Currently missing recolorOffscreen... For now just use cheap mode
	/*
	else if (biomeOverlayMode === 'normal') {
		canvases = createTileOverlays(workerBiomeData, workerTileLayers, pw, pwVertical, ngPlusCount > 0);
	}
	else if (biomeOverlayMode === 'expanded') {
		canvases = createTileOverlaysExpanded(workerBiomeData, workerTileLayers, pw, pwVertical, ngPlusCount > 0);
	}
	*/


    // Extract the rendered pixels from each canvas into a transferable ImageBitmap
	const bitmaps = [];
	if (canvases && canvases.length > 0) {
    	bitmaps.push(...canvases.map(canvas => canvas.transferToImageBitmap()));
	}

	self.postMessage({
		type: 'OVERLAY_GENERATED',
		pw: pw,
		pwVertical: pwVertical,
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