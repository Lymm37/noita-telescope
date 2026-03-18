import {CHUNK_SIZE, TILE_SIZE, WORLD_CHUNK_CENTER_X, WORLD_CHUNK_CENTER_Y, WORLD_CHUNK_CENTER_X_NGP, TILE_OFFSET_X, TILE_OFFSET_Y, VISUAL_TILE_OFFSET_X, VISUAL_TILE_OFFSET_Y} from './constants.js';
import { BIOME_COLOR_TO_NAME, BIOME_COLORS_WITH_TILES, BIOMES_WITHOUT_WAVY_EDGE } from './generator_config.js';
import { GetBiomeOffset } from './edge_noise.js';
import { MATERIAL_COLOR_LOOKUP } from './potion_config.js';
import { PIXEL_SCENE_DATA } from './pixel_scene_generation.js';
import { appSettings } from './settings.js';

export const CONTAINER_TYPES = [
    'utility_box',
    'chest',
    'great_chest',
    'holy_mountain_shop',
    'pacifist_chest',
    'eye_room',
    'shop',
    'triangle_boss',
    'alchemist_boss',
    'pyramid_boss',
    'pit_boss',
    'dragon',
    'tiny',
    'laboratory',
    'vault_puzzle',
    'puzzle',
    'starting_loadout'
];

export const MATERIAL_CONTAINER_TYPES = [
    'potion',
    'pouch',
    'jar',
];

// This function is pretty messed up even though it's currently in a working state
export function tileToWorldCoordinates(chunkBaseX, chunkBaseY, tileX, tileY, pw = 0, pwVertical = 0, isNGP = false) {
    const world_chunk_center_x = isNGP ? WORLD_CHUNK_CENTER_X_NGP : WORLD_CHUNK_CENTER_X;
    const worldSize = isNGP ? 64 * 512 - 8 : 70 * 512;

    let smallChunkSize = Math.floor(CHUNK_SIZE / TILE_SIZE); // 51
    let div5offX = 5 * CHUNK_SIZE * Math.floor((chunkBaseX - world_chunk_center_x)/5);
    let mod5offX = (((chunkBaseX - world_chunk_center_x) % 5 + 5) % 5);
    let worldBaseX = div5offX + mod5offX * smallChunkSize * TILE_SIZE;
    // Not sure why it's still 10 off but it's consistent
    let worldX_alt = -TILE_SIZE + worldBaseX + tileX * TILE_SIZE + TILE_OFFSET_X;
    let div5offY = 5 * CHUNK_SIZE * Math.floor((chunkBaseY - WORLD_CHUNK_CENTER_Y)/5);
    let mod5offY = (((chunkBaseY - WORLD_CHUNK_CENTER_Y) % 5 + 5) % 5);
    let worldBaseY = div5offY + mod5offY * smallChunkSize * TILE_SIZE;
    if (mod5offY > 0) worldBaseY += TILE_SIZE;
    let worldY_alt = -TILE_SIZE + worldBaseY + tileY * TILE_SIZE + TILE_OFFSET_Y;

    // Dumb NG+
    if (isNGP) {
        if (mod5offX >= 3) worldX_alt += TILE_SIZE; // Seems to work?
    }

    // Checking tile offset Y = -13, removes the extra -10 part above
    worldY_alt += TILE_SIZE;

    // Debug: Trying to align tile offsets! Works without this
    // TODO: Remove this if I can't get it to work
    //worldX_alt += TILE_SIZE;
    //worldY_alt += TILE_SIZE;
    
    //let worldX = Math.floor((((chunkBaseX - world_chunk_center_x) * CHUNK_SIZE) - 9 * ((chunkBaseX < world_chunk_center_x) ? 1 : 0)) / 10) * 10 + 10 * tileX + TILE_OFFSET_X;
    //let worldY = Math.floor((((chunkBaseY - WORLD_CHUNK_CENTER_Y) * CHUNK_SIZE) - 9 * ((chunkBaseY < WORLD_CHUNK_CENTER_Y) ? 1 : 0)) / 10) * 10 + 10 * tileY + TILE_OFFSET_Y;
    
    //if (chunkBaseX >= world_chunk_center_x) worldX -= 10;

    //if (worldX != worldX_alt || worldY !== worldY_alt)
    //console.log(chunkBaseX, chunkBaseY, worldX, worldY, worldX_alt, worldY_alt);

    // Apply Parallel World Shift (already done)
    //worldX += (pw * PW_SHIFT);
    //worldX_alt += (pw * PW_SHIFT);

    if (isNGP) {
        worldX_alt -= 4;
    }

    worldX_alt += pw * worldSize;
    worldY_alt += pwVertical * 24570; // Note, 6 pixels off from 512 * 48. Again, vertical chunks aren't divisible by 5...
    // World-shattering change
    return { x: worldX_alt, y: worldY_alt };
}

export function roundRNGPos(num) {
    if (-1000000 < num && num < 1000000)
        return num;
    else if (-10000000 < num && num < 10000000)
        //return Math.round(num / 10.0) * 10;
        return roundHalfOfEven(num / 10.0) * 10;
    else if (-100000000 < num && num < 100000000)
        return roundHalfOfEven(num / 100.0) * 100;
    return num;
}

const WAND_KEYS = [
    'always_casts',
    'wand_type',
    'actions_per_round',
    'fire_rate_wait',
    'reload_time',
    'mana_max',
    'mana_charge_speed',
    'deck_capacity',
    'spread_degrees',
    'speed_multiplier',
    'shuffle_deck_when_empty',
    'sprite'
]

export function isDuplicateObject(currentObj, newObj) {
    if (currentObj.type !== newObj.type) return false;
    if (currentObj.type === 'wand') {
        if (currentObj.cards.length !== newObj.cards.length) return false;
        for (let i = 0; i < currentObj.cards.length; i++) {
            if (currentObj.cards[i] !== newObj.cards[i]) return false;
        }
        for (let key of WAND_KEYS) {
            if (Math.abs(currentObj[key] - newObj[key]) > 0.01) return false;
        }
        return true;
    }
    else {
        if (currentObj.item) {
            if (currentObj.item === 'spell' && newObj.item === 'spell') return currentObj.spell === newObj.spell;
            if (MATERIAL_CONTAINER_TYPES.includes(currentObj.item)) {
                return currentObj.material === newObj.material && currentObj.item === newObj.item;
            }
            else {
                return currentObj.item === newObj.item;
            }
        }
        return false; // Others?
    }
}

export function shuffleTable(arr, prng) {
    for (let i = arr.length - 1; i >= 1; i--) {
        let j = prng.Random(0, i);
        let temp = arr[i];
        arr[i] = arr[j];
        arr[j] = temp;
    }
}

export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export function getWorldSize(isNGP) {
    return isNGP ? 64 : 70;
}

export function getWorldCenter(isNGP) {
    return isNGP ? 32 : 35;
}

export function getPWLimit(isNGP) {
    return isNGP ? 512 : 468;
}

export function getBiomeAtWorldCoordinates(biomeData, worldX, worldY, isNGP = false) {
    let biomeMap = biomeData.pixels;
    // Don't need this anymore?
    if (worldY < -14*512) {
        biomeMap = biomeData.heavenPixels;
    }
    else if (worldY > 34*512) {
        biomeMap = biomeData.hellPixels;
    }
    const mapWidth = getWorldSize(isNGP);
    // Convert to positions mod world size
    const worldSize = mapWidth * 512;
    const worldCenter = worldSize / 2;
    // Not sure whether or not to use the tile offsets here
    const modX = ((worldX + worldCenter) % worldSize + worldSize) % worldSize;
    const modY = ((worldY + 14*512) % 24570 + 24570) % 24570; 
    
    // Account for biome edge noise
    let highDetail = true; // Seems to be required to avoid false negatives...
    const edgeOffset = GetBiomeOffset(worldX, worldY, isNGP, highDetail);

    // Test without edge noise
    //if (!document.getElementById('debug-enable-edge-noise').checked) {
    if (!appSettings.enableEdgeNoise) {
        edgeOffset.x = 0;
        edgeOffset.y = 0;
    }

    const originalX = Math.floor(modX / 512);
    const originalY = Math.floor(modY / 512);
    
    let biomePixelX = originalX + edgeOffset.x;
    let biomePixelY = originalY + edgeOffset.y;
    
    let idx = biomePixelY * mapWidth + biomePixelX;

    // Fix for heaven/hell? or at least map edge cases
    if (idx < 0) idx = biomePixelX % mapWidth;
    if (idx >= biomeMap.length) idx = mapWidth * 47 + biomePixelX % mapWidth;

    const colorInt = biomeMap[idx] & 0xffffff; 
    let biomeName = BIOME_COLOR_TO_NAME[colorInt];
    if (!BIOME_COLORS_WITH_TILES.has(colorInt)) biomeName = null; // Only return biomes with tiles, otherwise it's just noise that causes false positives
    
    // This is actually annoyingly expensive for such a minor fix.
    //if (document.getElementById('debug-fix-holy-mountain-edge-noise').checked) {
    if (appSettings.fixHolyMountainEdgeNoise) {
        const origIdx = originalY * mapWidth + originalX;
        const origColorInt = biomeMap[origIdx] & 0xffffff;
        const origBiomeName = BIOME_COLOR_TO_NAME[origColorInt];
        //if (origBiomeName === "temple_altar" || biomeName === "temple_altar") {
        // There are kind of a lot of biomes that need to be excluded for this
        if (BIOMES_WITHOUT_WAVY_EDGE.has(origColorInt) || BIOMES_WITHOUT_WAVY_EDGE.has(colorInt)) {
            // Don't apply edge noise for these biomes, it just causes false positives and they don't have the wavy edge anyway
            biomePixelX = originalX;
            biomePixelY = originalY;
            biomeName = origBiomeName;
        }
    }
    
    return {
        biome: biomeName || null,
        pos: {x: biomePixelX, y: biomePixelY},
        originalPos: {x: originalX, y: originalY},
        mightBeEdgeCase: edgeOffset.x !== 0 || edgeOffset.y !== 0
    };
}

export function getMaterialAtWorldCoordinates(tileLayers, pixelScenes, worldX, worldY, pwIndex, pwIndexVertical, isNGP = false) {
    // Adjust for PW
    const adjustedWorldX = getWorldCenter(isNGP) * 512 + worldX - pwIndex * getWorldSize(isNGP) * 512 + (isNGP ? -8 * pwIndex : 0) - VISUAL_TILE_OFFSET_X;
    const adjustedWorldY = 14 * 512 + worldY - pwIndexVertical * 24570 - VISUAL_TILE_OFFSET_Y;
    for (const layer of tileLayers) {
        // Check if the world coordinate falls within this layer's bounds
        // (Assuming layer.x/y are in world units)
        //console.log(`Checking layer with bounds (${layer.correctedX}, ${layer.correctedY}) to (${layer.correctedX + layer.w}, ${layer.correctedY + layer.h}) against world coordinates (${adjustedWorldX}, ${adjustedWorldY})`);
        if (adjustedWorldX >= layer.correctedX && adjustedWorldX < layer.correctedX + layer.w &&
            adjustedWorldY >= layer.correctedY && adjustedWorldY < layer.correctedY + layer.h) {
            
            // 2. Calculate local pixel coordinates (0 to width/mapH)
            const localX = Math.floor((adjustedWorldX - layer.correctedX) / 10);
            const localY = Math.floor((adjustedWorldY - layer.correctedY) / 10);

            // 3. Access the raw buffer (skipping the 4-pixel header)
            const buffer = layer.buffer;
            if (!buffer) return null;

            // Index: (y + offset) * width + x, then * 3 for RGB
            const idx = ((localY + 4) * layer.width + localX) * 3;
            
            if (idx + 2 >= buffer.length) return null;

            const r = buffer[idx];
            const g = buffer[idx + 1];
            const b = buffer[idx + 2];
            const hex = (r << 16) | (g << 8) | b;
            const hexStr = `${hex.toString(16).padStart(6, '0')}`;

            // 4. Return the material name from your existing table
            //console.log(`Material color at (${worldX}, ${worldY}) [local: (${localX}, ${localY})]: #${hexStr}`);
            if (MATERIAL_COLOR_LOOKUP[hexStr]) {
                return MATERIAL_COLOR_LOOKUP[hexStr];
            }
            //break; // No need to check other layers if we've found the correct one, hopefully
            // Actually nevermind, forgot about the single chunk fungal caverns inside the range of other biomes
            // If it didn't find a material it's probably in a pixel scene
        }
    }
    // Check pixel scenes as a fallback (this is kind of expensive...)
    // These ones don't use the adjusted coordinates
    for (const scene of pixelScenes) {
        const localX = worldX - scene.x;
        const localY = worldY - scene.y;
        if (localX >= 0 && localX < scene.width && localY >= 0 && localY < scene.height) {
            // Use original scene data via key to avoid recoloring issues
            // Need to use a variant though if there were random materials
            let imgData;
            let shortenedVariantKey = scene.variantKey ? scene.variantKey.replace(/&?biome=[^&]+/, '') : '';
            if (shortenedVariantKey !== '') {
                //console.log(`Using variant key ${shortenedVariantKey} for pixel scene ${scene.name} when looking up material at (${worldX}, ${worldY})`);
                imgData = PIXEL_SCENE_DATA[scene.key].variants[shortenedVariantKey];
            } else {
                imgData = PIXEL_SCENE_DATA[scene.key].imgElement;
            }
            if (!imgData) continue; // Hasn't been generated yet?
            const pixelIdx = (localY * scene.width + localX) * 4; // RGBA in one array
            const r = imgData[pixelIdx];
            const g = imgData[pixelIdx + 1];
            const b = imgData[pixelIdx + 2];
            const hex = (r << 16) | (g << 8) | b;
            const hexStr = `${hex.toString(16).padStart(6, '0')}`;
            //console.log(`Pixel scene color at (${worldX}, ${worldY}) [local: (${localX}, ${localY})]: #${hexStr}`);
            if (MATERIAL_COLOR_LOOKUP[hexStr]) {
                return MATERIAL_COLOR_LOOKUP[hexStr];
            }
            else {
                //console.log(`No material found for pixel scene color #${hexStr} at (${worldX}, ${worldY}) in scene ${scene.name}.`);
            }
            // Might be in a different pixel scene that is nested or something, but seems unlikely.
        }
    }
    return null;
}

export function getPWIndices(worldX, worldY, pw = 0, pwVertical = 0, isNGP = false) {
    const worldSize = getWorldSize(isNGP) * 512;
    const pwX = Math.floor((worldX + pw * worldSize) / worldSize);
    const pwY = Math.floor((worldY + pwVertical * 24576) / 24576);
    return [pwX, pwY];
}


export function roundHalfOfEven(n) {
    if (n % 1 === 0.5) {
        const floor = Math.floor(n);
        return (floor % 2 === 0) ? floor : floor + 1;
    }
    return Math.round(n);
}

export function* generateSpiral(startX, startY) {
    yield { x: startX, y: startY };
    let x = startX, y = startY, step = 1;

    while (true) {
        for (let i = 0; i < step; i++) yield { x: ++x, y }; // Right
        for (let i = 0; i < step; i++) yield { x, y: ++y }; // Down
        step++;
        for (let i = 0; i < step; i++) yield { x: --x, y }; // Left
        for (let i = 0; i < step; i++) yield { x, y: --y }; // Up
        step++;
    }
}

export function getPayloadSize(obj) {
    let bufferBytes = 0;

    // We use a custom replacer to catch binary buffers before they get stringified
    const jsonStr = JSON.stringify(obj, (key, value) => {
        // Intercept Uint8ClampedArray, Uint8Array, or any ArrayBuffer view
        if (value && value.buffer instanceof ArrayBuffer) {
            bufferBytes += value.byteLength;
            return '[Binary Buffer]'; // Swap it out so JSON doesn't bloat
        }
        return value;
    });

    // Get the exact byte size of the standard JSON text
    const jsonBytes = new Blob([jsonStr]).size; 
    
    // Add the binary buffer sizes back in
    const totalBytes = jsonBytes + bufferBytes;
    
    return (totalBytes / 1024 / 1024).toFixed(3) + ' MB';
}

export function getDateAndTime() {
    const date = new Date();
    return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
        second: date.getSeconds()
    };
}