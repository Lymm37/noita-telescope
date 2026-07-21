import { BIOME_EDGE_NOISE_EXTENT, BIOME_EDGE_NOISE_PADDING_TILES, CHUNK_SIZE, TILE_SIZE } from "./constants.js";
import { BIOME_COLOR_TO_NAME, BIOME_COLORS_WITH_TILES, GENERATOR_CONFIG } from "./generator_config.js";
import { loadPNG } from "./png_sanitizer.js";
import { MATERIAL_COLOR_CONVERSION } from "./potion_config.js";
import { appSettings } from "./settings.js";
import { getBiomeAtWorldCoordinates, getWorldSize, tileToWorldCoordinates } from "./utils.js";

// Used for setting background color...

export async function createBiomeColorLookup(mapPath) {
	const [img1, img2] = await Promise.all([
		loadPNG('../data/biome_maps/biome_map.png'),
		loadPNG(mapPath)
	]);

	const nameLookup = {};
    const backgroundColors = {};

	for (let i = 0; i < img1.data.length; i += 4) {
		const color1 = (img1.data[i] << 16) | (img1.data[i + 1] << 8) | img1.data[i + 2];
		const color2 = (img2.data[i] << 16) | (img2.data[i + 1] << 8) | img2.data[i + 2];
		if (BIOME_COLOR_TO_NAME[color1]) {
			nameLookup[BIOME_COLOR_TO_NAME[color1]] = color2;
		}
		backgroundColors[color1] = color2;
	}

    // Using an image for the lookup is convenient but it was missing a couple of biomes that don't appear in NG.
    nameLookup['temple_altar_right_snowcave'] = 0x4e4132;
    backgroundColors[0x93cb4f] = 0x4e4132;
    nameLookup['temple_altar_right_snowcastle'] = 0x4e4133;
    backgroundColors[0x93cb5a] = 0x4e4133;

    // Specific exceptions just to make it look better?
    backgroundColors[0x42244d] = 0x2b1914; // solid_wall_hidden_cavern
    backgroundColors[0x5f8fab] = 0x2b1914; // teleroom
    backgroundColors[0x24888a] = 0x454341; // meditation cube
    backgroundColors[0x18d6d6] = 0x454341; // eye room
    backgroundColors[0xD6D8E3] = 0x0f121c; // winter (underground)
    backgroundColors[0xCC9944] = 0x201a14; // desert (underground)
    backgroundColors[0x157cb5] = 0x1d1714; // essence of water
    backgroundColors[0x57dace] = 0x1d1714; // dark chest
    backgroundColors[0x3d3e41] = 0x1d1714; // tower reward

	//console.log(`Created biome color lookup with ${Object.keys(lookup).length} entries.`);
	return [nameLookup, backgroundColors];
}

// TODO: Rename these to something less confusing
export const [BIOME_BACKGROUND_COLORS, BIOME_COLOR_LOOKUP] = await createBiomeColorLookup('../data/biome_maps/biome_map_background.png');
export const [TILE_OVERLAY_COLORS, TILE_FOREGROUND_COLORS] = await createBiomeColorLookup('../data/biome_maps/biome_map_foreground.png');

// Non-Wang biomes whose tile overlays must ignore edge noise on both sides of a
// border. Keep one-off map exceptions here rather than embedding them in
// renderer logic.
const edgeNoiseOverlayExceptions = new Set([
    'secret_lab', 'wizardcave_entrance', 'roboroom', 'meatroom', 'ghost_secret', 'mestari_secret',
    'boss_arena_top', 'boss_arena',
    'temple_altar', 'temple_altar_left', 'temple_altar_right', 'temple_altar_right_snowcave', 'temple_altar_right_snowcastle', 'temple_wall_ending', 'temple_wall', 'solid_wall_temple', 
    'friend_1', 'friend_2', 'friend_3', 'friend_4', 'friend_5', 'friend_6',
    'rock_room', 'snowcave_tunnel',
    'mountain_left_stub', 'mountain_right_stub', 'mountain_tree',
    'pyramid_hallway', 'pyramid_right', 'pyramid_entrance', 'pyramid_left', 'pyramid_top',
    'robot_egg', 'moon_room', 'gun_room', 'null_room', 'song_room', 'ocarina', 'gourd_room', 'alchemist_secret', 
    'snowcastle_cavern',
    'essenceroom_air', 'essenceroom', 'essenceroom_hell', 'essenceroom_alc', 
    'mystery_teleport', 'roadblock', 'sky_light_injector', 
    'lava', 'lake', 'lavalake', 'watercave', 'empty', 'lava_90percent',
    'solid_wall_tower_10', 'greed_room', 'boss_victoryroom',
    //'biome_watchtower', 'biome_potion_mimics', 'biome_darkness', 'biome_boss_sky', 'biome_barren',
    //'clouds', 'the_sky'
    // Really wish I didn't have to add these, but they end up looking weird
    'hills', 'hills2', 'desert', 'winter',
]);

// Wang-tile biomes needing the same edge-noise treatment. Keep these separate
// from the non-Wang exceptions above so their special cases remain easy to
// review as the map is tuned.
const transparentBackgroundExceptions = new Set([
    'biome_watchtower', 'biome_potion_mimics', 'biome_darkness', 'biome_boss_sky', 'biome_barren',
    'clouds', 'the_sky'
]);

const isEdgeNoiseOverlayException = (biome) => edgeNoiseOverlayExceptions.has(biome);

function getUnwobbledTileOverlayBiome(biomeData, worldX, worldY, isNGP, gameMode) {
    let biomeMap = biomeData.pixels;
    if (worldY < -14 * CHUNK_SIZE) {
        biomeMap = biomeData.heavenPixels;
    }
    else if (worldY > 34 * CHUNK_SIZE) {
        biomeMap = biomeData.hellPixels;
    }

    const mapWidth = getWorldSize(isNGP, gameMode);
    const worldWidth = mapWidth * CHUNK_SIZE;
    const mapX = ((worldX + worldWidth / 2) % worldWidth + worldWidth) % worldWidth;
    const mapY = ((worldY + 14 * CHUNK_SIZE) % (48 * CHUNK_SIZE) + 48 * CHUNK_SIZE) % (48 * CHUNK_SIZE);
    const x = Math.floor(mapX / CHUNK_SIZE);
    const y = Math.floor(mapY / CHUNK_SIZE);
    const colorInt = biomeMap[y * mapWidth + x] & 0xffffff;
    const biome = BIOME_COLOR_TO_NAME[colorInt] || null;

    return {
        biome,
        origBiome: biome,
        colorInt,
        pos: { x, y },
        originalPos: { x, y },
        mightBeEdgeCase: false,
        edgeNoiseIgnored: false
    };
}

function getTileOverlayBiome(biomeData, worldX, worldY, isNGP, gameMode, useEdgeNoise) {
    const subChunkX = ((worldX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const subChunkY = ((worldY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const isInterior = subChunkX >= BIOME_EDGE_NOISE_EXTENT && subChunkX <= CHUNK_SIZE - BIOME_EDGE_NOISE_EXTENT &&
        subChunkY >= BIOME_EDGE_NOISE_EXTENT && subChunkY <= CHUNK_SIZE - BIOME_EDGE_NOISE_EXTENT;

    // Edge noise cannot affect cells outside the 42px chunk-border band. Avoid
    // GetBiomeOffset(), neighbor probes, and wobble resolution for the large
    // interior area; this mirrors getBiomeAtWorldCoordinates' original lookup.
    if (!useEdgeNoise || isInterior) {
        return getUnwobbledTileOverlayBiome(biomeData, worldX, worldY, isNGP, gameMode);
    }

    // The wobbled result alone does not always reveal an exception on the
    // opposite side of an edge: it can resolve back to this non-exception
    // chunk. Inspect the actual neighboring chunk before applying noise, so an
    // exception blocks overlay changes symmetrically on left/top/right/bottom.
    const adjacentBiomeIsException = (adjacentX, adjacentY) =>
        isEdgeNoiseOverlayException(getUnwobbledTileOverlayBiome(biomeData, adjacentX, adjacentY, isNGP, gameMode).biome);
    if ((subChunkX < BIOME_EDGE_NOISE_EXTENT && adjacentBiomeIsException(worldX - subChunkX - 1, worldY)) ||
        (subChunkY < BIOME_EDGE_NOISE_EXTENT && adjacentBiomeIsException(worldX, worldY - subChunkY - 1)) ||
        (subChunkX > CHUNK_SIZE - BIOME_EDGE_NOISE_EXTENT && adjacentBiomeIsException(worldX + CHUNK_SIZE - subChunkX, worldY)) ||
        (subChunkY > CHUNK_SIZE - BIOME_EDGE_NOISE_EXTENT && adjacentBiomeIsException(worldX, worldY + CHUNK_SIZE - subChunkY))) {
        return {
            ...getUnwobbledTileOverlayBiome(biomeData, worldX, worldY, isNGP, gameMode),
            edgeNoiseIgnored: true
        };
    }

    const noisyResult = getBiomeAtWorldCoordinates(biomeData, worldX, worldY, isNGP, gameMode, useEdgeNoise);
    if (!useEdgeNoise || (!isEdgeNoiseOverlayException(noisyResult.biome) && !isEdgeNoiseOverlayException(noisyResult.origBiome))) {
        return { ...noisyResult, edgeNoiseIgnored: false };
    }

    // Either side of this edge is exceptional: use the unwobbled chunk so the
    // source overlay stays unchanged and expanded buffers do not synthesize it.
    return {
        ...getUnwobbledTileOverlayBiome(biomeData, worldX, worldY, isNGP, gameMode),
        edgeNoiseIgnored: true
    };
}

// Tile generation lays chunks out with Math.trunc(chunk * 512 / 10), rather
// than a simple repeating 51/52 pattern. Mirror that exact layout when mapping
// a layer-local tile coordinate to its source chunk; otherwise left-side and
// non-Wang boundaries can be assigned to the wrong layer.
const chunkRasterStart = (chunk) => Math.trunc(chunk * CHUNK_SIZE / TILE_SIZE);
const chunkAtRasterTile = (tile) => tile >= 0
    ? Math.ceil((tile + 1) * TILE_SIZE / CHUNK_SIZE) - 1
    : Math.floor(tile * TILE_SIZE / CHUNK_SIZE);

export function createTileOverlaysCheap(biomeData, layers, pwIndex, pwIndexVertical, isNGP, gameMode='normal') {
    const recolorMaterials = appSettings.recolorMaterials; //document.getElementById('recolor-materials').checked;
    const clearSpawnPixels = appSettings.clearSpawnPixels; //document.getElementById('clear-spawn-pixels').checked;
	const mapWidth = getWorldSize(isNGP, gameMode);
    const mapHeight = 48;
	const t0 = performance.now();
    const overlays = []; 

    let biomeMap = biomeData.pixels;
    if (pwIndexVertical < 0) {
        biomeMap = biomeData.heavenPixels;
    }
    else if (pwIndexVertical > 0) {
        biomeMap = biomeData.hellPixels;
    }

    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
		const buffer = layer.buffer;
		if (!buffer) { overlays.push(null); continue; } // Skip layers without pixel data (shouldn't happen but just in case)
		const width = layer.width;
		const mapH = layer.mapH;
        
        const canvas = new OffscreenCanvas(width, mapH);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const outImageData = ctx.createImageData(width, mapH);
        const out32 = new Uint32Array(outImageData.data.buffer);

        // tileToWorldCoordinates is affine in the tile coordinates: everything but
        // `tileX * TILE_SIZE` / `tileY * TILE_SIZE` depends only on the layer and the
        // parallel world. Evaluate it once at tile (0,0) and step by TILE_SIZE, rather
        // than calling it (and allocating two objects) for every gray pixel.
        const originCoords = tileToWorldCoordinates(layer.minX, layer.minY, 0, 0, pwIndex, pwIndexVertical, isNGP, gameMode);

        for (let y = 4; y < mapH+4; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const srcIdx = idx * 3;
				const targetIdx = (y-4) * width + x;

                // Check for gray pixels
                if (buffer[srcIdx] === buffer[srcIdx + 1] && buffer[srcIdx + 1] === buffer[srcIdx + 2] && buffer[srcIdx] > 0) {
					const coordX = originCoords.x + x * TILE_SIZE;
					const coordY = originCoords.y + (y - 4) * TILE_SIZE;
					const roundedX = (Math.floor((coordX + mapWidth*512/2)/512) % mapWidth + mapWidth) % mapWidth;
					const roundedY = (Math.floor((coordY + 14*512)/512) % mapHeight + mapHeight) % mapHeight;

					// Find this pixel in the biome map and get the color...
					const biomeColor = biomeMap[roundedY * mapWidth + roundedX] & 0xffffff; // Mask out alpha if present
					const foregroundColor = TILE_FOREGROUND_COLORS[biomeColor];

                    if (BIOME_COLORS_WITH_TILES.has(biomeColor) && foregroundColor) {
                        //const bColor = TILE_OVERLAY_COLORS[layer.biomeName] || 0xff00ff;
                        const r = (foregroundColor >> 16) & 0xff;
                        const g = (foregroundColor >> 8) & 0xff;
                        const b = foregroundColor & 0xff;
                        out32[targetIdx] = (255 << 24) | (b << 16) | (g << 8) | r;
                    }
                }
                else {
                    if (buffer[srcIdx] > 0 || buffer[srcIdx + 1] > 0 || buffer[srcIdx + 2] > 0) {
                        // Both branches below want the same world position for this pixel.
                        // tileToWorldCoordinates is pure, so resolve it once.
                        const spawnCoordX = originCoords.x + x * TILE_SIZE;
                        const spawnCoordY = originCoords.y + (y - 4) * TILE_SIZE;
                        const spawnRoundedX = (Math.floor((spawnCoordX + mapWidth*512/2)/512) % mapWidth + mapWidth) % mapWidth;
                        const spawnRoundedY = (Math.floor((spawnCoordY + 14*512)/512) % mapHeight + mapHeight) % mapHeight;
                        const spawnBiomeColor = biomeMap[spawnRoundedY * mapWidth + spawnRoundedX] & 0xffffff; // Mask out alpha if present

                        if (!clearSpawnPixels) {
                            // Still need to check it's in bounds of the biome...
                            if (BIOME_COLORS_WITH_TILES.has(spawnBiomeColor)) {
                                out32[targetIdx] = (255 << 24) | (buffer[srcIdx + 2] << 16) | (buffer[srcIdx + 1] << 8) | buffer[srcIdx];
                            }
                        }
                        if (recolorMaterials) {
                            const biomeColor = spawnBiomeColor;
                            // Check if it's in a region with tiles
                            if (biomeColor && BIOME_COLORS_WITH_TILES.has(biomeColor)) {
                                // Look up color in materials table
                                const wangColor = (buffer[srcIdx] << 16) | (buffer[srcIdx + 1] << 8) | buffer[srcIdx + 2];
                                const materialColor = MATERIAL_COLOR_CONVERSION[wangColor]; // Fallback to original color if not found in conversion table
                                if (materialColor) {
                                    const r = (materialColor >> 16) & 0xff;
                                    const g = (materialColor >> 8) & 0xff;
                                    const b = materialColor & 0xff;
                                    out32[targetIdx] = (255 << 24) | (b << 16) | (g << 8) | r;
                                }
                            }
                        }
                    }
                }
            }
        }

        ctx.putImageData(outImageData, 0, 0);
        overlays.push(canvas);
    }

	const t1 = performance.now();
	console.log(`[Tile Overlays] PW ${pwIndex},${pwIndexVertical} took ${(t1 - t0).toFixed(2)} ms`);
    return overlays;
}

export function createTileOverlays(biomeData, recolorOffscreen, layers, pwIndex, pwIndexVertical, isNGP, gameMode='normal') {
    if (!appSettings.enableEdgeNoise) return createTileOverlaysCheap(biomeData, layers, pwIndex, pwIndexVertical, isNGP, gameMode); 
    
    let biomeMap = biomeData.pixels;
    if (pwIndexVertical < 0) {
        biomeMap = biomeData.heavenPixels;
    }
    else if (pwIndexVertical > 0) {
        biomeMap = biomeData.hellPixels;
    }

    const recolorMaterials = appSettings.recolorMaterials; 
    const clearSpawnPixels = appSettings.clearSpawnPixels; 
    const referenceData = recolorOffscreen;
    
    const mapWidth = getWorldSize(isNGP, gameMode);
    
    const mapHeight = Math.floor(biomeData.pixels.length / mapWidth);
    const wrapThreshold = Math.max(2, Math.floor(mapHeight / 4));
    
    const t0 = performance.now();
    const overlays = []; 
    
    let isWrapped = (pos_y, y) => false;

    const writeReferenceBackground = (out32, target, biomeResult, localY) => {
        if (pwIndexVertical !== 0) return; 
        if (localY !== undefined && isWrapped(biomeResult.pos.y, localY)) return;
        
        const refIdx = (biomeResult.pos.y * mapWidth + biomeResult.pos.x) * 3;
        if (refIdx >= 0 && refIdx < referenceData.length - 2) {
            const r = referenceData[refIdx];
            const g = referenceData[refIdx + 1];
            const b = referenceData[refIdx + 2];
            out32[target] = (255 << 24) | (b << 16) | (g << 8) | r;
        }
    };

    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        const buffer = layer.buffer;
        if (!buffer) { overlays.push(null); continue; } 
        const width = layer.width;
        const mapH = layer.mapH;

        const useLayerEdgeNoise = appSettings.enableEdgeNoise && !isEdgeNoiseOverlayException(layer.biomeName);
        
        const canvas = new OffscreenCanvas(width, mapH);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const outImageData = ctx.createImageData(width, mapH);
        const out32 = new Uint32Array(outImageData.data.buffer);

        const originCoords = tileToWorldCoordinates(layer.minX, layer.minY, 0, 0, pwIndex, pwIndexVertical, isNGP, gameMode);
        const coordX = (tx) => originCoords.x + tx * TILE_SIZE;
        const coordY = (ty) => originCoords.y + ty * TILE_SIZE;
        
        const topValidWorldY = originCoords.y;
        const bottomValidWorldY = originCoords.y + (mapH - 1) * TILE_SIZE;
        const topValidPosY = getBiomeAtWorldCoordinates(biomeData, originCoords.x, topValidWorldY, isNGP, gameMode, false).pos.y;
        const bottomValidPosY = getBiomeAtWorldCoordinates(biomeData, originCoords.x, bottomValidWorldY, isNGP, gameMode, false).pos.y;

        isWrapped = (pos_y, y) => {
            if (y < 10 && pos_y > topValidPosY + wrapThreshold) return true;
            if (y >= mapH - 10 && pos_y < bottomValidPosY - wrapThreshold) return true;
            return false;
        };

        for (let y = 4; y < mapH+4; y++) {
            const localY = y - 4;
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const srcIdx = idx * 3;
                const targetIdx = localY * width + x;

                const r = buffer[srcIdx];
                const g = buffer[srcIdx + 1];
                const b = buffer[srcIdx + 2];

                if (r > 0 || g > 0 || b > 0) {
                    // Optimization: We only call this once per solid pixel instead of once per branch
                    const biomeResult = getTileOverlayBiome(biomeData, coordX(x), coordY(localY), isNGP, gameMode, useLayerEdgeNoise);
                    
                    let rawColor = undefined;
                    if (!isWrapped(biomeResult.pos.y, localY)) {
                        rawColor = biomeMap[biomeResult.pos.y * mapWidth + biomeResult.pos.x];
                    }
                    const biomeColor = rawColor !== undefined ? rawColor & 0xffffff : 0x000000;
                    
                    // EXCLUSION FIX: Block tiles that drift into an exclusion biome or a tileless biome
                    const inExclusionList = biomeResult.biome && biomeResult.biome !== layer.biomeName && isEdgeNoiseOverlayException(biomeResult.biome);
                    const shouldExclude = biomeResult.edgeNoiseIgnored || !BIOME_COLORS_WITH_TILES.has(biomeColor) || inExclusionList;

                    if (r === g && g === b) {
                        if (!shouldExclude) {
                            const foregroundColor = TILE_FOREGROUND_COLORS[biomeColor];
                            if (foregroundColor !== undefined) {
                                const fr = (foregroundColor >> 16) & 0xff;
                                const fg = (foregroundColor >> 8) & 0xff;
                                const fb = foregroundColor & 0xff;
                                out32[targetIdx] = (255 << 24) | (fb << 16) | (fg << 8) | fr;
                            }
                        }
                    }
                    else {
                        if (!shouldExclude) {
                            if (!clearSpawnPixels) {
                                out32[targetIdx] = (255 << 24) | (b << 16) | (g << 8) | r;
                            }
                            
                            if (recolorMaterials) {
                                const wangColor = (r << 16) | (g << 8) | b;
                                const materialColor = MATERIAL_COLOR_CONVERSION[wangColor]; 
                                if (materialColor !== undefined) {
                                    const mr = (materialColor >> 16) & 0xff;
                                    const mg = (materialColor >> 8) & 0xff;
                                    const mb = materialColor & 0xff;
                                    out32[targetIdx] = (255 << 24) | (mb << 16) | (mg << 8) | mr;
                                }
                            }
                        } else if (recolorMaterials && pwIndexVertical === 0) {
                            //writeReferenceBackground(out32, targetIdx, biomeResult, localY);
                        }
                    }
                }
            }
        }

        ctx.putImageData(outImageData, 0, 0);
        overlays.push(canvas);
    }

    const t1 = performance.now();
    console.log(`[Tile Overlays] PW ${pwIndex},${pwIndexVertical} took ${(t1 - t0).toFixed(2)} ms`);
    return overlays;
}

export function createTileOverlaysExpanded(biomeData, recolorOffscreen, layers, pwIndex, pwIndexVertical, isNGP, gameMode='normal') {
    if (!appSettings.enableEdgeNoise) return createTileOverlaysCheap(biomeData, layers, pwIndex, pwIndexVertical, isNGP, gameMode); 
    
    let biomeMap = biomeData.pixels;
    if (pwIndexVertical < 0) {
        biomeMap = biomeData.heavenPixels;
    }
    else if (pwIndexVertical > 0) {
        biomeMap = biomeData.hellPixels;
    }

    const debugColor = 0xff00ff;
    const writeDebugAt = (out32, target) => {
        out32[target] = (255 << 24) | (0xff << 16) | (0x00 << 8) | 0xff;
    };

    const recolorMaterials = appSettings.recolorMaterials; 
    const clearSpawnPixels = appSettings.clearSpawnPixels; 
    const mapWidth = getWorldSize(isNGP, gameMode);
    const t0 = performance.now();
    const overlays = [];
    const referenceData = recolorOffscreen;

    const edgeThreshold = BIOME_EDGE_NOISE_PADDING_TILES;
    let referenceAlpha = 255;
    
    const mapHeight = Math.floor(biomeData.pixels.length / mapWidth);
    const wrapThreshold = Math.max(2, Math.floor(mapHeight / 4));
    
    const writeReferenceBackgroundAt = (out32, target, position, y) => {
        if (pwIndexVertical !== 0) return;
        if (y !== undefined && isWrapped(position.y, y)) return;
        
        const refIdx = (position.y * mapWidth + position.x) * 3;
        if (refIdx >= 0 && refIdx < referenceData.length - 2) {
            const r = referenceData[refIdx];
            const g = referenceData[refIdx + 1];
            const b = referenceData[refIdx + 2];
            out32[target] = (referenceAlpha << 24) | (b << 16) | (g << 8) | r;
        }
    };
    
    const writeReferenceBackground = (out32, target, biomeResult, y) =>
        writeReferenceBackgroundAt(out32, target, biomeResult.pos, y);

    let isWrapped = (pos_y, y) => false;

    const getSafeBiomeColor = (pos, y) => {
        if (isWrapped(pos.y, y)) return 0x000000;
        const rawColor = biomeMap[pos.y * mapWidth + pos.x];
        return rawColor !== undefined ? rawColor & 0xffffff : 0x000000;
    };

    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        const buffer = layer.buffer;
        if (!buffer) { overlays.push(null); continue; }

        const width = layer.width;
        const mapH = layer.mapH;
        const minX = layer.minX;
        const minY = layer.minY;
        const useLayerEdgeNoise = appSettings.enableEdgeNoise && !isEdgeNoiseOverlayException(layer.biomeName);
        const sourceRasterX = chunkRasterStart(minX);
        const sourceRasterY = chunkRasterStart(minY);
        const layerBiomeColor = GENERATOR_CONFIG[layer.biomeName]?.color & 0xffffff;
        const layerBackgroundColor = BIOME_BACKGROUND_COLORS[layerBiomeColor];
        let backgroundAlpha = 255;
        referenceAlpha = 255;
        
        if (transparentBackgroundExceptions.has(layer.biomeName)) {
            backgroundAlpha = 0;
            referenceAlpha = 0;
        }
        
        // Zero-allocation chunk validation map: Parses strings into an integer Map of Sets once.
        const validChunksMap = new Map();
        if (layer.validChunks) {
            for (const chunkKey of layer.validChunks) {
                const comma = chunkKey.indexOf(',');
                const cx = parseInt(chunkKey.substring(0, comma));
                const cy = parseInt(chunkKey.substring(comma + 1));
                let col = validChunksMap.get(cx);
                if (!col) {
                    col = new Set();
                    validChunksMap.set(cx, col);
                }
                col.add(cy);
            }
        }
        
        const checkChunkValid = (cx, cy) => {
            if (!layer.validChunks) return true;
            const col = validChunksMap.get(cx);
            return col ? col.has(cy) : false;
        };
        
        const originCoords = tileToWorldCoordinates(minX, minY, 0, 0, pwIndex, pwIndexVertical, isNGP, gameMode);
        const topValidWorldY = originCoords.y;
        const bottomValidWorldY = originCoords.y + (mapH - 1) * TILE_SIZE;
        const topValidPosY = getBiomeAtWorldCoordinates(biomeData, originCoords.x, topValidWorldY, isNGP, gameMode, false).pos.y;
        const bottomValidPosY = getBiomeAtWorldCoordinates(biomeData, originCoords.x, bottomValidWorldY, isNGP, gameMode, false).pos.y;

        isWrapped = (pos_y, y) => {
            if (y < 10 && pos_y > topValidPosY + wrapThreshold) return true;
            if (y >= mapH - 10 && pos_y < bottomValidPosY - wrapThreshold) return true;
            return false;
        };

        const writeLayerBackground = (target, fallbackBiomeResult, y) => {
            if (layerBackgroundColor !== undefined) {
                const r = (layerBackgroundColor >> 16) & 0xff;
                const g = (layerBackgroundColor >> 8) & 0xff;
                const b = layerBackgroundColor & 0xff;
                out32[target] = (backgroundAlpha << 24) | (b << 16) | (g << 8) | r;
            }
            else {
                writeReferenceBackground(out32, target, fallbackBiomeResult, y);
            }
        };
        
        const outWidth = width + 2 * edgeThreshold;
        const outHeight = mapH + 2 * edgeThreshold;

        const canvas = new OffscreenCanvas(outWidth, outHeight);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const outImageData = ctx.createImageData(outWidth, outHeight);
        const out32 = new Uint32Array(outImageData.data.buffer);
        
        // Cache massive amounts of redundant per-column and per-row math
        const worldXByOutput = new Float64Array(outWidth);
        const worldYByOutput = new Float64Array(outHeight);
        const nearChunkEdgeX = new Uint8Array(outWidth);
        const nearChunkEdgeY = new Uint8Array(outHeight);
        
        const xByOutput = new Int32Array(outWidth);
        const yByOutput = new Int32Array(outHeight);
        const isPaddingXByOutput = new Uint8Array(outWidth);
        const isPaddingYByOutput = new Uint8Array(outHeight);
        
        const subChunkXByOutput = new Int32Array(outWidth);
        const subChunkYByOutput = new Int32Array(outHeight);
        
        const cxByOutput = new Int32Array(outWidth);
        const cyByOutput = new Int32Array(outHeight);
        const clampedCxByOutput = new Int32Array(outWidth);
        const clampedCyByOutput = new Int32Array(outHeight);

        for (let outX = 0; outX < outWidth; outX++) {
            const worldX = originCoords.x + (outX - edgeThreshold) * TILE_SIZE;
            const subChunkX = ((worldX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            worldXByOutput[outX] = worldX;
            subChunkXByOutput[outX] = subChunkX;
            nearChunkEdgeX[outX] = subChunkX < BIOME_EDGE_NOISE_EXTENT || subChunkX > CHUNK_SIZE - BIOME_EDGE_NOISE_EXTENT;
            
            const x = outX - edgeThreshold;
            xByOutput[outX] = x;
            isPaddingXByOutput[outX] = (x < 0 || x >= width) ? 1 : 0;
            
            cxByOutput[outX] = chunkAtRasterTile(sourceRasterX + x);
            const clampedX = Math.max(0, Math.min(width - 1, x));
            clampedCxByOutput[outX] = chunkAtRasterTile(sourceRasterX + clampedX);
        }
        for (let outY = 0; outY < outHeight; outY++) {
            const worldY = originCoords.y + (outY - edgeThreshold) * TILE_SIZE;
            const subChunkY = ((worldY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            worldYByOutput[outY] = worldY;
            subChunkYByOutput[outY] = subChunkY;
            nearChunkEdgeY[outY] = subChunkY < BIOME_EDGE_NOISE_EXTENT || subChunkY > CHUNK_SIZE - BIOME_EDGE_NOISE_EXTENT;
            
            const y = outY - edgeThreshold;
            yByOutput[outY] = y;
            isPaddingYByOutput[outY] = (y < 0 || y >= mapH) ? 1 : 0;
            
            cyByOutput[outY] = chunkAtRasterTile(sourceRasterY + y);
            const clampedY = Math.max(0, Math.min(mapH - 1, y));
            clampedCyByOutput[outY] = chunkAtRasterTile(sourceRasterY + clampedY);
        }

        // Iterate over the FULL expanded bounds
        for (let outY = 0; outY < outHeight; outY++) {
            const worldY = worldYByOutput[outY];
            const y = yByOutput[outY];
            const isPadY = isPaddingYByOutput[outY];
            const subChunkY = subChunkYByOutput[outY];
            const cy = cyByOutput[outY];
            const clampedCy = clampedCyByOutput[outY];
            const isNearSeamY = nearChunkEdgeY[outY];
            const srcRowOffset = (y + 4) * width;
            
            // Loop target offset calculated safely here
            let targetIdx = outY * outWidth; 

            for (let outX = 0; outX < outWidth; outX++, targetIdx++) {
                const worldX = worldXByOutput[outX];
                const x = xByOutput[outX];
                const isPadX = isPaddingXByOutput[outX];

                let pixelWritten = false;
                let biomeResult = null;
                let biomeColor = -1; 

                // Central area
                if (isPadX === 0 && isPadY === 0) {
                    const srcIdx = (srcRowOffset + x) * 3;
                    
                    const r = buffer[srcIdx];
                    const g = buffer[srcIdx + 1];
                    const b = buffer[srcIdx + 2];

                    if (r > 0 || g > 0 || b > 0) {
                        biomeResult = getTileOverlayBiome(biomeData, worldX, worldY, isNGP, gameMode, useLayerEdgeNoise);
                        biomeColor = getSafeBiomeColor(biomeResult.pos, y);

                        // EXCLUSION FIX: Check if the tile drifted into an excluded biome
                        const inExclusionList = biomeResult.biome && biomeResult.biome !== layer.biomeName && isEdgeNoiseOverlayException(biomeResult.biome);

                        if (r === g && g === b) {
                            if (biomeResult.edgeNoiseIgnored || inExclusionList) {
                                // Block drawing, pixelWritten remains false to fall through to seam logic
                                continue;
                            }
                            
                            const foregroundColor = TILE_FOREGROUND_COLORS[biomeColor];
                            if (BIOME_COLORS_WITH_TILES.has(biomeColor) && foregroundColor !== undefined) {
                                const or = (foregroundColor >> 16) & 0xff;
                                const og = (foregroundColor >> 8) & 0xff;
                                const ob = foregroundColor & 0xff;
                                out32[targetIdx] = (255 << 24) | (ob << 16) | (og << 8) | or;
                            }
                            else {
                                writeReferenceBackground(out32, targetIdx, biomeResult, y);
                            }
                            pixelWritten = true;
                        }
                        else if (!inExclusionList) {
                            // Only process material pixels if they are not inside an excluded biome
                            if (!BIOME_COLORS_WITH_TILES.has(biomeColor)) {
                                writeReferenceBackground(out32, targetIdx, biomeResult, y);
                                pixelWritten = true;
                            }
                            else if (recolorMaterials) {
                                const wangColor = (r << 16) | (g << 8) | b;
                                const materialColor = MATERIAL_COLOR_CONVERSION[wangColor];
                                if (materialColor !== undefined) {
                                    const mr = (materialColor >> 16) & 0xff;
                                    const mg = (materialColor >> 8) & 0xff;
                                    const mb = materialColor & 0xff;
                                    out32[targetIdx] = (255 << 24) | (mb << 16) | (mg << 8) | mr;
                                    pixelWritten = true;
                                }
                                else if (!clearSpawnPixels) {
                                    out32[targetIdx] = (255 << 24) | (b << 16) | (g << 8) | r;
                                    pixelWritten = true;
                                }
                            }
                            else if (!clearSpawnPixels) {
                                out32[targetIdx] = (255 << 24) | (b << 16) | (g << 8) | r;
                                pixelWritten = true;
                            }
                        }
                    }
                }

                // Edges / seams
                if (!pixelWritten) {
                    const isNearSeam = nearChunkEdgeX[outX] || isNearSeamY;

                    if (isPadX || isPadY || isNearSeam) {
                        const clampedCx = clampedCxByOutput[outX];
                        
                        const owningChunkIsInLayer = checkChunkValid(clampedCx, clampedCy);

                        if (!owningChunkIsInLayer) {
                            continue; 
                        }

                        if (!biomeResult) {
                            biomeResult = getTileOverlayBiome(biomeData, worldX, worldY, isNGP, gameMode, useLayerEdgeNoise);
                            biomeColor = getSafeBiomeColor(biomeResult.pos, y);
                        }
                        
                        const originalBiomeColor = getSafeBiomeColor(biomeResult.originalPos, y);
                        
                        // EXCLUSION FIX: Extend edgeNoiseIgnored to block seam rendering inside excluded biomes
                        const inExclusionListSeam = biomeResult.biome && biomeResult.biome !== layer.biomeName && isEdgeNoiseOverlayException(biomeResult.biome);
                        let edgeNoiseIgnored = biomeResult.edgeNoiseIgnored || !useLayerEdgeNoise || inExclusionListSeam;
                        
                        let expandsIntoNonWang = !BIOME_COLORS_WITH_TILES.has(originalBiomeColor);
                        const subChunkX = subChunkXByOutput[outX];

                        if (subChunkX < BIOME_EDGE_NOISE_EXTENT) {
                            const leftResult = getBiomeAtWorldCoordinates(biomeData, worldX - subChunkX - 1, worldY, isNGP, gameMode, false);
                            edgeNoiseIgnored ||= isEdgeNoiseOverlayException(leftResult.biome) || isEdgeNoiseOverlayException(leftResult.origBiome);
                        }
                        if (subChunkY < BIOME_EDGE_NOISE_EXTENT) {
                            const topResult = getBiomeAtWorldCoordinates(biomeData, worldX, worldY - subChunkY - 1, isNGP, gameMode, false);
                            edgeNoiseIgnored ||= isEdgeNoiseOverlayException(topResult.biome) || isEdgeNoiseOverlayException(topResult.origBiome);
                        }
                        if (!expandsIntoNonWang && subChunkX > CHUNK_SIZE - BIOME_EDGE_NOISE_EXTENT) {
                            const rightResult = getBiomeAtWorldCoordinates(biomeData, worldX + CHUNK_SIZE - subChunkX, worldY, isNGP, gameMode, false);
                            const rightColor = getSafeBiomeColor(rightResult.pos, y);
                            expandsIntoNonWang = !BIOME_COLORS_WITH_TILES.has(rightColor);
                            edgeNoiseIgnored ||= isEdgeNoiseOverlayException(rightResult.biome) || isEdgeNoiseOverlayException(rightResult.origBiome);
                        }
                        if (!expandsIntoNonWang && subChunkY > CHUNK_SIZE - BIOME_EDGE_NOISE_EXTENT) {
                            const bottomResult = getBiomeAtWorldCoordinates(biomeData, worldX, worldY + CHUNK_SIZE - subChunkY, isNGP, gameMode, false);
                            const bottomColor = getSafeBiomeColor(bottomResult.pos, y);
                            expandsIntoNonWang = !BIOME_COLORS_WITH_TILES.has(bottomColor);
                            edgeNoiseIgnored ||= isEdgeNoiseOverlayException(bottomResult.biome) || isEdgeNoiseOverlayException(bottomResult.origBiome);
                        }

                        const sourceChunkIsInLayer = isPadX === 0 && isPadY === 0 && checkChunkValid(cxByOutput[outX], cy);

                        if (!edgeNoiseIgnored && !isEdgeNoiseOverlayException(layer.biomeName) && expandsIntoNonWang) {
                            if (isNearSeam) {
                                writeLayerBackground(targetIdx, biomeResult, y);
                            }
                        }
                        else if (!edgeNoiseIgnored && !BIOME_COLORS_WITH_TILES.has(biomeColor)) {
                            writeReferenceBackground(out32, targetIdx, biomeResult, y);
                        }
                        else if (!edgeNoiseIgnored && isNearSeam && sourceChunkIsInLayer) {
                            writeReferenceBackgroundAt(out32, targetIdx, biomeResult.originalPos, y);
                        }
                    }
                }
            }
        }

        ctx.putImageData(outImageData, 0, 0);
        overlays.push(canvas);
    }

    const t1 = performance.now();
    console.log(`[Tile Overlays] PW ${pwIndex},${pwIndexVertical} took ${(t1 - t0).toFixed(2)} ms`);
    return overlays;
}

export function makeBlackTransparent(data) {
    for (let i = 0; i < data.length; i += 4) {
        // Check if R=0, G=0, B=0
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0) {
            data[i + 3] = 0; // Set Alpha to 0 (Transparent)
        }
    }
}

// Static tile areas have their own background images, so they need to be excluded or it will look bad
// Also adding sky biomes
const alphaMaskExceptions = new Set([
    0xb70000, // watchtower
    0xff00fb, // temples
    0xff00fc,
    0xff00fd,
    0xff00fe,
    0x36d5c9, // cloudscape
    0xD3E6F0, // heaven
]);

export function createBiomeMapAlphaMask(biomeData, width, height) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const biomeColor = biomeData.pixels[y * width + x] & 0xffffff;
            if (BIOME_COLORS_WITH_TILES.has(biomeColor) && !alphaMaskExceptions.has(biomeColor)) {
                const overlayColor = BIOME_COLOR_LOOKUP[biomeColor] || 0xff00ff;
                data[idx] = (overlayColor >> 16) & 0xff;
                data[idx + 1] = (overlayColor >> 8) & 0xff;
                data[idx + 2] = overlayColor & 0xff;
                data[idx + 3] = 255; // Fully opaque
            }
            else {
                data[idx + 3] = 0; // Fully transparent
            }
        }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}