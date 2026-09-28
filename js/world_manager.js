// world_manager.js
import { app } from './app.js';
import { recolorPixelScenes } from './overlay_manager.js';
import { PIXEL_SCENE_DATA, PIXEL_SCENE_SPAWN_DATA } from './pixel_scene_generation.js';
import { continueSearchSequence, syncPW } from './search_manager.js';
import { appSettings, updateSettingsFromUI } from './settings.js';
import { TRANSLATIONS } from './translations.js';
import { unlockedSpells } from './unlocks.js';

export const worldWorker = new Worker(new URL('./world_worker.js', import.meta.url), { type: 'module' });
// See overlay_manager.js: a dead worker is silent without this.
worldWorker.addEventListener('error', (e) =>
	console.error('world worker failed:', e.message ?? '(no message)', e.filename ?? '', e.lineno ?? ''));
worldWorker.addEventListener('messageerror', () =>
	console.error('world worker: message deserialization failed'));

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
        app.bgSpritesByPW[pwKey] = msg.bgSprites;

        // Clear it from the pending list
        pendingGenerateRequests.delete(pwKey);

        // Tell the search manager that new data is ready to be filtered
        continueSearchSequence(msg.pw, msg.pwVertical);

		// Recolor pixel scenes from this PW. The world worker returns placements only
		// (key + variantKey + rect); every recolored image comes from the overlay worker.
		recolorPixelScenes(msg.pixelScenes);
    }
};

// Pixel scene metadata without the pixels (PERF_PLAN Step 4).
//
// PIXEL_SCENE_DATA carries every scene's full RGBA image in `imgElement` plus its
// recolored `variants` - a few hundred MB once all scenes are loaded. Only the overlay
// worker recolors, so it is the only worker that needs those pixels; the generation
// side (world worker) and the filtering side (search worker) read spawn data plus a
// handful of scalar fields. Structured cloning the cache wholesale copied the images
// into those workers for nothing, so they get this projection instead.
//
// Keep this in sync with the fields worker-side code reads off PIXEL_SCENE_DATA
// (pixel_scene_generation.js loadPixelScene / loadRandomPixelScene).
export function buildPixelSceneMetadata(sceneData = PIXEL_SCENE_DATA) {
	const metadata = {};
	for (const key of Object.keys(sceneData)) {
		const scene = sceneData[key];
		metadata[key] = {
			key: scene.key,
			biome: scene.biome,
			name: scene.name,
			width: scene.width,
			height: scene.height,
			isCosmetic: scene.isCosmetic,
			// Which recolor classes the scene contains (classifyPixelSceneColors).
			// underlyingBiomeSuffix() reads both to decide whether a scene needs an
			// `@<chunk biome>` variant, and a worker that cannot see them answers "no
			// suffix" for every scene it generates. That is how a pseudo-biome scene
			// (general/, temple/, spliced/) came out of the worker as plain
			// `biome=spliced`: its density-class pixels have no color in either table,
			// so sceneBiomePaint fell back to magenta. The main thread generates the
			// current world and the workers generate all the others, so the same scene
			// resolved two ways, and the parallel-world copies -- which the pixel-scene
			// layer draws at the same world position, and which only come into view
			// when zoomed far out -- painted magenta over the correct main-world one.
			hasAir: scene.hasAir,
			hasBiomeFill: scene.hasBiomeFill,
			// Same shape as the main thread cache, minus the pixels: no recolored variant
			// ever exists on these workers.
			variants: {}
		};
	}
	return metadata;
}

export function syncWorldWorkerData() {
    worldWorker.postMessage({
        cmd: 'SYNC_METADATA',
        pixelSceneCache: buildPixelSceneMetadata(),
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

    // 1. If we already have it, skip, but sync to make sure it doesn't get stuck?
    if (app.poisByPW[pwKey]) {
        // Doesn't quite work, continues searching even when a match is found, though this isn't a problem if background search is enabled
        continueSearchSequence(pw, pwVertical);
        // Doesn't quite work, still gets stuck on the loading screen
        //syncPW(pw, pwVertical);
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
        skipCosmeticScenes: appSettings.skipCosmeticScenes,
        isDaily: app.isDaily, // Probably not necessary
        gameMode: app.gameMode
    });
}