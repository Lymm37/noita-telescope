// world_worker.js
import { injectPixelSceneData, injectPixelSceneSpawnData } from './pixel_scene_generation.js';
import { getSpecialPoIs, scanSpawnFunctions } from './poi_scanner.js';
import { addStaticPixelScenes } from './static_spawns.js';
import { injectTranslations } from './translations.js';
import { appSettings, updateSettings } from './settings.js';
import { injectUnlocksData } from './unlocks.js';
import { getPayloadSize } from './utils.js';

let worldState = null;
let workerBiomeData = null;
let workerTileSpawns = null;

self.onmessage = async function(e) {
    const data = e.data;

    if (data.cmd === 'SYNC_METADATA') {
        injectPixelSceneData(data.pixelSceneCache);
		injectPixelSceneSpawnData(data.pixelSceneSpawnDataCache);
        injectTranslations(data.translationsCache);
		injectUnlocksData(data.unlockedSpellsCache);
		workerBiomeData = data.biomeData;
        workerTileSpawns = data.tileSpawns;
    }
	else if (data.cmd === 'SYNC_SETTINGS') {
		updateSettings(data.settings);
		injectUnlocksData(data.unlockedSpellsCache);
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

	// Unsurprisingly, the pixel scenes take up way too much space to be sending them back and forth like this. It's like 68 MB per world
	/*
	console.log(`--- PW ${pw >= 0 ? '+' : ''}${pw}, ${pwVertical} Generated ---`);
    console.log(`PoIs Payload Size: ${getPayloadSize(generatedSpawns)}`);
    console.log(`Pixel Scenes Payload Size: ${getPayloadSize(finalPixelScenes)}`);
    console.log(`----------------------------------`);
	*/
	// Stripped out the images and let the overlay worker process them separately, this reduces the payload size to around 0.5 MB

	self.postMessage({
		type: 'PW_GENERATED',
		pw: pw,
		pwVertical: pwVertical,
		pois: generatedSpawns,
		pixelScenes: finalPixelScenes
	});
}