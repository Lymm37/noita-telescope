// overlay_worker.js
import { injectPixelSceneData, PIXEL_SCENE_DATA, recolorPixelScene, recolorPixelSceneForBiome } from './pixel_scene_generation.js';
import { createTileOverlaysCheap, createTileOverlays, createTileOverlaysExpanded } from './image_processing.js';
import { appSettings, updateSettings } from './settings.js';

let workerBiomeData = null;
let workerTileLayers = null;

self.onmessage = async function(e) {
	const data = e.data;

	if (data.cmd === 'SYNC_METADATA') {
		injectPixelSceneData(data.pixelSceneCache);
		workerBiomeData = data.biomeData;
		workerTileLayers = data.tileLayers;
	}
	else if (data.cmd === 'SYNC_SETTINGS') {
		updateSettings(data.settings);
		// Unlocks not needed here, hopefully
		return; 
	}
	else if (data.cmd === 'GENERATE_PIXEL_SCENES') {
		generatePixelSceneImagesWorker(data.pixelSceneKeys, data.variantKeys);
	}
	else if (data.cmd === 'GENERATE_OVERLAY') {
		generateOverlayWorker(data.seed, data.ngPlusCount, data.pw, data.pwVertical);
	}
};

function generatePixelSceneImagesWorker(pixelSceneKeys, variantKeys) {
	let outputPixelSceneKeys = [];
	let outputVariantKeys = [];
	let canvases = [];

	for (let i = 0; i < pixelSceneKeys.length; i++) {
		const pixelSceneKey = pixelSceneKeys[i];
		const variantKey = variantKeys[i];
		const pixelSceneData = PIXEL_SCENE_DATA[pixelSceneKey];
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
			canvases.push(recoloredPixelScene);
		}
	}

	const bitmaps = [];
	if (canvases && canvases.length > 0) {
		bitmaps.push(...canvases.map(canvas => canvas.transferToImageBitmap()));
	}

	self.postMessage({
		type: 'PIXEL_SCENES_GENERATED',
		pixelSceneKeys: outputPixelSceneKeys,
		variantKeys: outputVariantKeys,
		pixelSceneImages: bitmaps
	}, bitmaps);
}

function generateOverlayWorker(seed, ngPlusCount, pw, pwVertical) {
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
