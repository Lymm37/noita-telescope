// world_manager.js
import { app } from './app.js';
import { recolorPixelScenes } from './overlay_manager.js';
import { PIXEL_SCENE_DATA, PIXEL_SCENE_SPAWN_DATA } from './pixel_scene_generation.js';
import { continueSearchSequence } from './search_manager.js';
import { appSettings, updateSettingsFromUI } from './settings.js';
import { TRANSLATIONS } from './translations.js';
import { unlockedSpells } from './unlocks.js';

export const worldWorker = new Worker(new URL('./world_worker.js', import.meta.url), { type: 'module' });

// Keep track of pending generation requests so we don't spam the worker
const pendingGenerateRequests = new Set(); 

worldWorker.onmessage = async (e) => {
    const msg = e.data;

    if (msg.type === 'STATUS') {
        app.setLoading(true, msg.msg);
    }
    else if (msg.type === 'PW_GENERATED') {
        const pwKey = `${msg.pw},${msg.pwVertical}`;
        if (app.seed !== msg.seed || app.ngPlusCount !== msg.ngPlusCount) {
            // Race condition due to user quickly changing seed/ng values while worker is still processing - just ignore the result since it's outdated
            console.warn(`Race condition in generation - discarding result for seed ${msg.seed}+${msg.ngPlusCount} for PW ${msg.pw},${msg.pwVertical}`);
            pendingGenerateRequests.delete(pwKey);
            app.poisByPW[pwKey] = null;
            app.pixelScenesByPW[pwKey] = null;
            // Surprisingly this still didn't fix it
            return;
        }
        
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

		// TODO: After refactoring pixel scene data to separate images and spawn data, do this
		// Send a message to the overlay worker to recolor the pixel scenes in this world
		//recolorPixelScenes(msg.pixelScenes);

        // Tell the search manager that new data is ready to be filtered
        continueSearchSequence(msg.pw, msg.pwVertical);

		// Recolor pixel scenes from this PW
		recolorPixelScenes(msg.pixelScenes);
    }
};

export function syncWorldWorkerData() {
    worldWorker.postMessage({
        cmd: 'SYNC_METADATA',
        pixelSceneCache: PIXEL_SCENE_DATA,
		pixelSceneSpawnDataCache: PIXEL_SCENE_SPAWN_DATA,
        translationsCache: TRANSLATIONS,
		unlockedSpellsCache: unlockedSpells,
		biomeData: app.biomeData,
		tileSpawns: app.tileSpawns
    });
	pendingGenerateRequests.clear();
}

export function syncSettingsToWorldWorker() {
	updateSettingsFromUI();
	worldWorker.postMessage({
		cmd: 'SYNC_SETTINGS',
		settings: appSettings,
		unlockedSpellsCache: unlockedSpells
	});
	//console.log(appSettings);
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