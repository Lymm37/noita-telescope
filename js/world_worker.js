// world_worker.js
import { injectPixelSceneData, injectPixelSceneSpawnData } from './pixel_scene_generation.js';
import { getSpecialPoIs, scanSpawnFunctions } from './poi_scanner.js';
import { addStaticPixelScenes } from './static_spawns.js';
import { injectTranslations } from './translations.js';
import { appSettings, updateSettings } from './settings.js';

let worldState = null;
let workerBiomeData = null;
let workerTileSpawns = null;

self.onmessage = async function(e) {
    const data = e.data;

    if (data.cmd === 'SYNC_METADATA') {
        injectPixelSceneData(data.pixelSceneCache);
		injectPixelSceneSpawnData(data.pixelSceneSpawnDataCache);
        injectTranslations(data.translationsCache);
		workerBiomeData = data.biomeData;
        workerTileSpawns = data.tileSpawns;
    }
	else if (data.cmd === 'SYNC_SETTINGS') {
		updateSettings(data.settings);
		return; 
	}
	else if (data.cmd === 'GENERATE_PW') {
		worldState = data;
		generatePWWorker();
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