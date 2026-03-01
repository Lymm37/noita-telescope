import { tileToWorldCoordinates, getBiomeAtWorldCoordinates, getWorldCenter, getWorldSize } from "./utils.js";
import { GENERATOR_CONFIG } from "./generator_config.js";
import { BIOME_SPAWN_FUNCTION_MAP } from "./spawn_function_config.js";
import { getSpawnFunctionIndex, spawnSwitch } from "./spawn_functions.js";
import { isDuplicateObject } from "./utils.js";
import { generateHolyMountainShops } from "./temple_generation.js";
import { 
	generateHourglassShop, 
	generateEyeRoom, 
	generateMeditationCube, 
	generateSnowyRoom, 
	generatePortal, 
	generateTriangleBossDrops, 
	generateAlchemistBossDrops, 
	generatePyramidBossDrops 
} from './misc_generation.js';

// Prevent infinite loops with nested pixel scenes (which hopefully shouldn't happen...)
const MAX_SCAN_CYCLES = 10;

export function prescanPixelScene(canvas, sourceBiome) {
    const clearSpawnPixels = document.getElementById('clear-spawn-pixels').checked;
    const detectedSpawns = [];
    if (!canvas) return detectedSpawns;

    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data; // The RGBA buffer
    const sWidth = canvas.width;
    const sHeight = canvas.height;

    for (let y = 0; y < sHeight; y++) {
        for (let x = 0; x < sWidth; x++) {
            const idx = (y * sWidth + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const a = data[idx + 3];

            // Skip transparent or standard background pixels
            if (a === 0) continue;
            const colorInt = (r << 16) | (g << 8) | b;
            if (colorInt === 0x000000 || colorInt === 0xffffff) continue;

            const index = getSpawnFunctionIndex(sourceBiome, colorInt);
            if (index !== null) {
                // Pixel scenes are drawn at 1:1 scale in world units
                // Note the positions are relative
                detectedSpawns.push({
                    sourceBiome,
                    x: x,
                    y: y,
                    spawnFunctionIndex: index
                });
            }
            if (clearSpawnPixels && index !== null) {
                data[idx] = 0;
                data[idx + 1] = 0;
                data[idx + 2] = 0;
                data[idx + 3] = 0;
            }
        }
    }
    ctx.putImageData(imgData, 0, 0);
    //console.log(`Prescanned pixel scene for biome ${sourceBiome}, detected spawn points: `, detectedSpawns);
    return detectedSpawns;
}

function getPixelSceneSpawnFunctionIndices(biomeData, biomeName, pixelScene, worldSeed, ngPlusCount, skipCosmeticScenes = true, perks={}) {
    let detectedSpawns = [];
    let newPixelScenes = [];
    let generatedSpawns = [];

    if (!pixelScene.imgElement) return { detectedSpawns, newPixelScenes, generatedSpawns };
    const spawnFunctions = BIOME_SPAWN_FUNCTION_MAP[biomeName] || [];
    if (spawnFunctions.length === 0) return { detectedSpawns, newPixelScenes, generatedSpawns };
    
    //console.log(`Scanning pixel scene ${pixelScene.name} for biome ${biomeName}`);

    // Pixel scenes were already prescanned for spawn function pixels, so we can skip straight to generating spawn indices
    // However they need to be modified to take into account the position of the pixel scene in the world
    // Also handle shop here by detecting spell spawns and grouping them together based on proximity
    let spellList = [];
    let potionList = [];
    
    for (const spawnPoint of pixelScene.spawnPoints) {
        const spawnX = pixelScene.x + spawnPoint.x;
        const spawnY = pixelScene.y + spawnPoint.y;
        const index = spawnPoint.spawnFunctionIndex;

        if (index === null || (index >= 0 && !spawnFunctions[index])) continue; // Shouldn't happen but just in case
        // Check for nested pixel scenes
        //console.log(`Processing spawn point with index ${index} at (${spawnX}, ${spawnY}) in pixel scene ${pixelScene.name} for biome ${biomeName}`);
        //console.log(`Spawn function details: `, spawnFunctions[index]);
        // Since this pixel scene is considered entirely inside one biome, it should be safe to add the spawns from it inside the same biome, saving a scan cycle
        // However, it doesn't seem like this actually improves the speed at all, and it might affect accuracy
        
        if (index >= 0 && spawnFunctions[index].isPixelScene) {
            // Nested pixel scene handling (this is literally only needed for the vault, why did Nolla do this)
            const nestedSpawnData = spawnSwitch(biomeData, biomeName, index, worldSeed, ngPlusCount, spawnX, spawnY, skipCosmeticScenes, perks);
            if (nestedSpawnData && nestedSpawnData.type === 'pixel_scene') {
                //console.log(`Generated nested pixel scene at (${spawnX}, ${spawnY}) for biome ${biomeName}: ${nestedSpawnData.name}`);
                // Adjust nested pixel scene position (why? no idea, but it fixes the misaligned pipe nested pixel scenes in the vault)
                //nestedSpawnData.x -= 6;
                newPixelScenes.push(nestedSpawnData);
                //console.log(`Added nested pixel scene ${nestedSpawnData.name} to layer ${biomeName} PW ${pwIndex} at (${nestedSpawnData.x}, ${nestedSpawnData.y})`);
                // Appending to the same list we're iterating over? Is this okay?
            }
        }
        else {
            
            // TODO: Add bar..? Actually maybe it's fine, it just makes a handful of potions close together but not as many as the lab
            if (pixelScene.name.includes("laboratory")) {
                const spawnData = spawnSwitch(biomeData, biomeName, index, worldSeed, ngPlusCount, spawnX, spawnY, skipCosmeticScenes, perks);
                //console.log(`Lab spawn data at (${spawnX}, ${spawnY}) in pixel scene ${pixelScene.name} for biome ${biomeName}: `, spawnData);
                if (spawnData && spawnData.item === 'potion') {
                    potionList.push(spawnData);
                }
            }
            else if (pixelScene.name.includes("shop")) {
                const spawnData = spawnSwitch(biomeData, biomeName, index, worldSeed, ngPlusCount, spawnX, spawnY, skipCosmeticScenes, perks);
                if (spawnData && spawnData.item === 'spell') {
                    spellList.push(spawnData);
                }
            }
            else {
                // For non-shop pixel scenes, we can directly add the spawns without worrying about grouping
                detectedSpawns.push({
                    sourceBiome: biomeName,
                    x: spawnX,
                    y: spawnY,
                    spawnFunctionIndex: index
                });
            }
        }
    }

    // If we detected spells in a shop pixel scene, add the shop PoI directly
    if (spellList.length > 0) {
        const worldX = pixelScene.x + pixelScene.width / 2;
        const worldY = pixelScene.y + pixelScene.height / 2;
        const shopData = {type: 'shop', items: spellList, x: worldX, y: worldY, biome: biomeName};
        generatedSpawns.push(shopData);
    }

    if (potionList.length > 0) {
        // Dedupe
        let dedupedItems = [];
        for (let item of potionList) {
            let found = false;
            for (let deduped of dedupedItems) {
                if (isDuplicateObject(deduped, item)) {
                    if (deduped.amount && item.amount) deduped.amount += item.amount;
                    deduped.count = (deduped.count || 1) + 1;
                    found = true;
                    break;
                }
            }
            if (!found) {
                dedupedItems.push(item);
            }
        }

        const worldX = pixelScene.x + pixelScene.width / 2;
        const worldY = pixelScene.y + pixelScene.height / 2;
        // TODO: Add bar
        const labData = {type: 'laboratory', items: dedupedItems, x: worldX, y: worldY, biome: biomeName};
        generatedSpawns.push(labData);
    }

    return { detectedSpawns, newPixelScenes, generatedSpawns };
}

// Surprisingly this depends on NG0 vs NG+ but not on seed
export function prescanSpawnFunctions(tileLayers, isNGP) {
    const clearSpawnPixels = document.getElementById('clear-spawn-pixels').checked;
    const t0 = performance.now();
    let detectedSpawns = [];
    for (const layer of tileLayers) {
        const sourceBiome = layer.biomeName;
        const width = layer.width;
        const height = layer.mapH;
        const sourceSpawnFunctions = BIOME_SPAWN_FUNCTION_MAP[sourceBiome] || [];

        if (!layer.canvas || typeof layer.canvas.getContext !== 'function') {
            console.log("Skipping layer:", layer);
            continue;
        }

        const canvas = layer.canvas;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;

        if (sourceSpawnFunctions.length === 0) continue;

        // Accidentally used the height before the offset by 4...? Eh it's fine
        for (let y = 4; y < height + 4; y++) {
            for (let x = 0; x < width; x++) {
                const srcIdx = (y * width + x) * 3;
                const r = layer.buffer[srcIdx];
                const g = layer.buffer[srcIdx + 1];
                const b = layer.buffer[srcIdx + 2];
                const colorInt = (r << 16) | (g << 8) | b;

                if (colorInt === 0x000000 || colorInt === 0xffffff) continue;

                const index = getSpawnFunctionIndex(sourceBiome, colorInt);

                if (index !== null) {
                    const coords = tileToWorldCoordinates(layer.minX, layer.minY, x, y - 4, 0, 0, isNGP);

                    detectedSpawns.push({
                        sourceBiome,
                        x: coords.x, // Note: PW0
                        y: coords.y,
                        spawnFunctionIndex: index
                    });
                }
                // Not sure why this magenta one wasn't cleared
                if (clearSpawnPixels && (index !== null || colorInt === 0xff00ff)) {
                        // Correct stride
                        const targetIdx = ((y - 4) * width + x) * 4;
                        data[targetIdx] = 0;
                        data[targetIdx + 1] = 0;
                        data[targetIdx + 2] = 0;
                        data[targetIdx + 3] = 0;
                    }
            }
        }
        if (clearSpawnPixels) {
            ctx.putImageData(imgData, 0, 0);
        }
    }
    
    const t1 = performance.now();
    console.log(`[Generator] Spawn function prescan completed in ${(t1 - t0).toFixed(2)} ms with ${detectedSpawns.length} detected spawn points.`);
    
    return detectedSpawns;
}

export function scanSpawnFunctions(biomeData, tileSpawns, worldSeed, ngPlusCount, pwIndex, pwIndexVertical, skipCosmeticScenes = true, perks={}) {
    const t0 = performance.now();
    let detectedSpawns = tileSpawns.map(spawn => ({...spawn, 
        x: spawn.x + pwIndex*getWorldSize(ngPlusCount > 0) * 512 - (ngPlusCount > 0 ? 8 * pwIndex : 0),
        y: spawn.y + pwIndexVertical*24570
    }));
    let generatedSpawns = [];

    let finalPixelScenes = [];
    let newPixelScenes = [];
    const shopsPerChunk = {};
    let scanCycles = 0;
    do {
        // Loop until we don't have any new pixel scenes or detected spawns
        // Process new pixel scenes

        let numberOfNewPixelScenes = newPixelScenes.length;
        for (let i = 0; i < numberOfNewPixelScenes; i++) {
            const pixelScene = newPixelScenes[i];
            finalPixelScenes.push(pixelScene);
            const target = getBiomeAtWorldCoordinates(biomeData, pixelScene.x, pixelScene.y, ngPlusCount > 0);
            const targetBiome = target ? target.biome : null;
            //const targetChunkPos = target ? target.pos : null;

            const pixelSceneResults = getPixelSceneSpawnFunctionIndices(biomeData, targetBiome, pixelScene, worldSeed, ngPlusCount, skipCosmeticScenes, perks);
            detectedSpawns.push(...pixelSceneResults.detectedSpawns);
            newPixelScenes.push(...pixelSceneResults.newPixelScenes); // This could be a problem
            numberOfNewPixelScenes += pixelSceneResults.newPixelScenes.length; // This is a hack to allow processing newly added pixel scenes in the same cycle
            // TODO: Might cause infinite loop if overlap can cause infinitely nested pixel scenes, but surely that can't happen...? Right?
            generatedSpawns.push(...pixelSceneResults.generatedSpawns);
        }

        // Clear processed pixel scenes
        newPixelScenes = [];

        detectedSpawns.forEach(spawn => {
            const target = getBiomeAtWorldCoordinates(biomeData, spawn.x, spawn.y, ngPlusCount > 0);
            const targetBiome = target ? target.biome : null;
            const targetChunkPos = target ? target.pos : null;
            if (targetBiome) {
                // TODO: Setting the biome in here might be redundant now
                const spawnData = spawnSwitch(biomeData, targetBiome, spawn.spawnFunctionIndex, worldSeed, ngPlusCount, spawn.x, spawn.y, skipCosmeticScenes, perks);
                if (spawnData) {
                    spawnData.biome = targetBiome;
                    if (spawn.sourceBiome != targetBiome) {
                        spawnData.originalBiome = spawn.sourceBiome;
                        spawnData.originalX = spawn.x;
                        spawnData.originalY = spawn.y;
                    }

                    if (spawnData.type === 'pixel_scene') {
                        if (scanCycles <= MAX_SCAN_CYCLES-1) {
                            newPixelScenes.push(spawnData);
                            // rescan next cycle to get spawns from the nested pixel scene
                        }
                        else {
                            // Add placeholder
                            generatedSpawns.push(spawnData);
                        }
                    }
                    // On second thought, knowing the exact position of the shop item does seem useful if it's not a shop pixel scene
                    /*
                    else if (spawnData.item && spawnData.item === 'spell') {
                        //console.log(`Secret shop spell spawn detected at (${spawn.x}, ${spawn.y}) in biome ${targetBiome} from spawn function index ${spawn.spawnFunctionIndex}: `, spawnData);
                        // Special consideration for secret shop spells because we want to group them together into shops based on proximity
                        const chunkKey = `${targetBiome}/${targetChunkPos.x}/${targetChunkPos.y}`;
                        if (!shopsPerChunk[chunkKey]) {
                            shopsPerChunk[chunkKey] = [];
                        }
                        shopsPerChunk[chunkKey].push(spawnData);
                    }
                    */
                    else {
                        generatedSpawns.push(spawnData);
                    }
                }
            }
        });

        // Clear processed spawns
        detectedSpawns = [];
        scanCycles++;
    } while (newPixelScenes.length > 0 && scanCycles <= MAX_SCAN_CYCLES);

    // Add secret shops
    for (const chunkKey in shopsPerChunk) {
        const spells = shopsPerChunk[chunkKey];
        const [biomeName, chunkX, chunkY] = chunkKey.split('/').map((v, i) => i === 0 ? v : Number(v));
        const worldX = chunkX * 512 + 256 - getWorldCenter(ngPlusCount > 0) * 512 + getWorldSize(ngPlusCount > 0) * 512 * pwIndex;
        const worldY = chunkY * 512 + 256 - 14 * 512 + 24570 * pwIndexVertical;
        const shopData = {type: 'shop', items: spells, x: worldX, y: worldY, biome: biomeName, originalBiome: biomeName};
        generatedSpawns.push(shopData);
    }

    // Add final pixel scenes to render
    //tileLayers[0].pixelScenesByPW[pwIndex] = (tileLayers[0].pixelScenesByPW[pwIndex] || []).concat(finalPixelScenes);

    const t1 = performance.now();
    console.log(`[Generator] Spawn function scanning completed in ${(t1 - t0).toFixed(2)} ms with ${generatedSpawns.length} generated spawns and ${finalPixelScenes.length} pixel scenes from ${scanCycles} scan cycles.`);

    return {
        generatedSpawns,
        finalPixelScenes
    };
}

export function getSpecialPoIs(biomeData, worldSeed, ngPlusCount, pwIndex, perks={}) {
    const biomeMap = biomeData.pixels;
    //const t0 = performance.now();
    // Extra generation things
    let pois = [];
    // Concat multiple times might be slow? But this is only a few things anyway, usually like 1 ms

    // Add HM PoIs to main layer
    if (GENERATOR_CONFIG['temple_altar'].enabled) {
        let hmPoIs = generateHolyMountainShops(worldSeed, ngPlusCount, pwIndex, perks);
        pois = pois.concat(hmPoIs);
    }
    // Add Eye Room PoIs
    //console.log("Generating Eye Room for PW", pwIndex);
    // Check whether it exists first, for NGP
    if (GENERATOR_CONFIG['snowcastle_hourglass_chamber'].enabled) {
        let roomExists = true;
        if (ngPlusCount > 0) {
            // Check colors of biome map
            const color = GENERATOR_CONFIG['snowcastle_hourglass_chamber'].color & 0xFFFFFF;
            roomExists = biomeMap.some(p => (p & 0xFFFFFF) === color);
        }
        if (roomExists) {
            let eyeRoom = generateEyeRoom(worldSeed, ngPlusCount, pwIndex);
            pois = pois.concat([eyeRoom]);
        }
    }

    
    if (pwIndex === 0 && ngPlusCount === 0) {
        if (GENERATOR_CONFIG['snowcastle_cavern'].enabled) {
            // Generate hourglass shop
            // TODO: Also check existence? Depends on the side though (side param is available)
            let hourglassShop = generateHourglassShop(worldSeed);
            pois = pois.concat([hourglassShop]);
        }

        let portal = generatePortal(worldSeed);
        if (portal) {
            pois = pois.concat([portal]);
        }
    }

    if (GENERATOR_CONFIG['excavationsite_cube_chamber'].enabled) {
        let roomExists = true;
        if (ngPlusCount > 0) {
            // Check colors of biome map
            const color = GENERATOR_CONFIG['excavationsite_cube_chamber'].color & 0xFFFFFF;
            roomExists = biomeMap.some(p => (p & 0xFFFFFF) === color);
        }
        if (roomExists) {
            let meditationCubeWand = generateMeditationCube(worldSeed, ngPlusCount, pwIndex, perks);
            if (meditationCubeWand) {
                pois = pois.concat([meditationCubeWand]);
            }
        }
    }

    if (ngPlusCount === 0) {
        if (GENERATOR_CONFIG['snowcave_secret_chamber'].enabled) {
            let snowyRoomWands = generateSnowyRoom(worldSeed, pwIndex, perks);
            if (snowyRoomWands) {
                pois = pois.concat(snowyRoomWands);
            }
        }

        if (GENERATOR_CONFIG['wizardcave_entrance'].enabled) {
            let triangleBossDrops = generateTriangleBossDrops(worldSeed, pwIndex);
            if (triangleBossDrops) {
                pois = pois.concat([triangleBossDrops]);
            }
        }

        if (GENERATOR_CONFIG['secret_lab'].enabled) {
            let alchemistBossDrops = generateAlchemistBossDrops(worldSeed, pwIndex);
            if (alchemistBossDrops) {
                pois = pois.concat([alchemistBossDrops]);
            }
        }

        if (GENERATOR_CONFIG['pyramid_top'].enabled) {
            let pyramidBossDrops = generatePyramidBossDrops(worldSeed, pwIndex);
            if (pyramidBossDrops) {
                pois = pois.concat([pyramidBossDrops]);
            }
        }
    }

    //const t1 = performance.now();
    //console.log(`[Generator] Special PoI generation completed in ${(t1 - t0).toFixed(2)} ms with ${pois.length} PoIs generated.`);
    // This takes like 2 ms, it's not worth printing

    return pois;
}