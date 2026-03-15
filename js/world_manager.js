// world_manager.js
import { app } from './app.js';
import { PIXEL_SCENE_DATA } from './pixel_scene_generation.js';
import { TRANSLATIONS } from './translations.js';

export const worldWorker = new Worker(new URL('./world_worker.js', import.meta.url), { type: 'module' });

// Keep track of pending generation requests so we don't spam the worker
const pendingGenerateRequests = new Set(); 
const pendingOverlayRequests = new Set();

worldWorker.onmessage = async (e) => {
    const msg = e.data;

    if (msg.type === 'STATUS') {
        app.setLoading(true, msg.msg);
    }
    else if (msg.type === 'WORLD_GENERATED' || msg.type === 'PW_GENERATED') {
        const pwKey = `${msg.pw},${msg.pwVertical}`;
        
        // Cache the PW data sent back from the worker so the map can draw it
        app.poisByPW[pwKey] = msg.pois;
        app.pixelScenesByPW[pwKey] = msg.pixelScenes;

        // Clear it from the pending list
        pendingGenerateRequests.delete(pwKey);

		// Sync any newly generated pixel scene variants to the main thread cache so they can be used in the UI
        for (const scene of msg.pixelScenes) {
            // Ensure the variant dictionary exists
            if (!PIXEL_SCENE_DATA[scene.key].variants) {
                PIXEL_SCENE_DATA[scene.key].variants = {};
            }
            
            // If the main thread doesn't have this recolored variant yet, save it
            if (!PIXEL_SCENE_DATA[scene.key].variants[scene.variantKey]) {
                PIXEL_SCENE_DATA[scene.key].variants[scene.variantKey] = scene.imgElement;
            }
        }

        // Tell the search manager that new data is ready to be filtered
        //continueSearchSequence(msg.pw, msg.pwVertical);
    }
    else if (msg.type === 'OVERLAY_GENERATED') {
        const pwKey = `${msg.pw},${msg.pwVertical}`;

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

export function syncWorldWorkerData() {
    worldWorker.postMessage({
        cmd: 'SYNC_METADATA',
        pixelSceneCache: PIXEL_SCENE_DATA,
        translationsCache: TRANSLATIONS,
		biomeData: app.biomeData,
		tileSpawns: app.tileSpawns,
		tileLayers: app.tileLayers
    });
	pendingGenerateRequests.clear();
	pendingOverlayRequests.clear();
}

export function getOrGenerateWorld(pw, pwVertical) {
    const pwKey = `${pw},${pwVertical}`;

    // 1. If we already have it, skip
    if (app.poisByPW[pwKey]) {
        return;
    }

    // 2. If it is already in the queue being generated, do nothing and wait for the message
    if (pendingGenerateRequests.has(pwKey)) {
        return;
    }

    // 3. Otherwise, mark as pending and post the command
    pendingGenerateRequests.add(pwKey);

    worldWorker.postMessage({
        cmd: 'GENERATE_PW',
        seed: app.seed,
        ngPlusCount: app.ngPlusCount,
		pw,
        pwVertical,
        perks: app.perks,
        skipCosmeticScenes: app.skipCosmeticScenes
    });
}

export function getOrGenerateOverlay(pw, pwVertical) {
	const pwKey = `${pw},${pwVertical}`;

	// Speedup for NG where we can reuse the same overlay
	if (!app.isNGP && app.tileOverlaysByPW[`0,${pwVertical}`]) {
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
		pwVertical
	};

	worldWorker.postMessage(payload);
}