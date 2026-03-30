// world_manager.js
import { app } from './app.js';
import { PIXEL_SCENE_DATA } from './pixel_scene_generation.js';
import { appSettings, updateSettingsFromUI } from './settings.js';

export const overlayWorker = new Worker(new URL('./overlay_worker.js', import.meta.url), { type: 'module' });

// Keep track of pending generation requests so we don't spam the worker
const pendingOverlayRequests = new Set();

overlayWorker.onmessage = async (e) => {
	const msg = e.data;

	if (msg.type === 'STATUS') {
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
	else if (msg.type === 'OVERLAY_GENERATED') {
		const pwKey = `${msg.pw},${msg.pwVertical}`;
		if (app.seed !== msg.seed || app.ngPlusCount !== msg.ngPlusCount || app.gameMode !== msg.gameMode) {
			// Race condition due to user quickly changing seed/ng values while worker is still processing - just ignore the result since it's outdated
			console.warn(`Race condition in overlay generation - discarding result for seed ${msg.seed}+${msg.ngPlusCount} for PW ${msg.pw},${msg.pwVertical}`);
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
	overlayWorker.postMessage({
		cmd: 'SYNC_METADATA',
		pixelSceneCache: PIXEL_SCENE_DATA,
		biomeData: app.biomeData,
		tileLayers: app.tileLayers
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
			variantKeys
		};
		overlayWorker.postMessage(payload);
	}
}

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
		gameMode: app.gameMode
	};

	overlayWorker.postMessage(payload);
}

export function isOverlayPending(pw, pwVertical) {
	const pwKey = `${pw},${pwVertical}`;
	return pendingOverlayRequests.has(pwKey);
}