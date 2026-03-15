import { BIOME_COLOR_TO_NAME, BIOME_COLORS_WITH_TILES } from "./generator_config.js";
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

	//console.log(`Created biome color lookup with ${Object.keys(lookup).length} entries.`);
	return [nameLookup, backgroundColors];
}

// TODO: Rename these to something less confusing
export const [BIOME_BACKGROUND_COLORS, BIOME_COLOR_LOOKUP] = await createBiomeColorLookup('../data/biome_maps/biome_map_background.png');
export const [TILE_OVERLAY_COLORS, TILE_FOREGROUND_COLORS] = await createBiomeColorLookup('../data/biome_maps/biome_map_foreground.png');

export function createTileOverlaysCheap(biomeData, layers, pwIndex, pwIndexVertical, isNGP) {
    const recolorMaterials = appSettings.recolorMaterials; //document.getElementById('recolor-materials').checked;
    const clearSpawnPixels = appSettings.clearSpawnPixels; //document.getElementById('clear-spawn-pixels').checked;
	const mapWidth = getWorldSize(isNGP);
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

        for (let y = 4; y < mapH+4; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const srcIdx = idx * 3;
				const targetIdx = (y-4) * width + x;

                // Check for gray pixels
                if (buffer[srcIdx] === buffer[srcIdx + 1] && buffer[srcIdx + 1] === buffer[srcIdx + 2] && buffer[srcIdx] > 0) {
					// This still feels too expensive for how often it needs to run here
					const coords = tileToWorldCoordinates(layer.minX, layer.minY, x, y-4, pwIndex, pwIndexVertical, isNGP);
					const roundedPosition = {
						x: (Math.floor((coords.x + mapWidth*512/2)/512) % mapWidth + mapWidth) % mapWidth,
						y: (Math.floor((coords.y + 14*512)/512) % mapHeight + mapHeight) % mapHeight
					}

					// Find this pixel in the biome map and get the color...
					const biomeColor = biomeMap[roundedPosition.y * mapWidth + roundedPosition.x] & 0xffffff; // Mask out alpha if present
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
                        if (!clearSpawnPixels) {
                            // Still need to check it's in bounds of the biome...
                            const coords = tileToWorldCoordinates(layer.minX, layer.minY, x, y-4, pwIndex, pwIndexVertical, isNGP);
                            const roundedPosition = {
                                x: (Math.floor((coords.x + mapWidth*512/2)/512) % mapWidth + mapWidth) % mapWidth,
                                y: (Math.floor((coords.y + 14*512)/512) % mapHeight + mapHeight) % mapHeight
                            }
                            const biomeColor = biomeMap[roundedPosition.y * mapWidth + roundedPosition.x] & 0xffffff; // Mask out alpha if present
                            if (BIOME_COLORS_WITH_TILES.has(biomeColor)) {
                                out32[targetIdx] = (255 << 24) | (buffer[srcIdx + 2] << 16) | (buffer[srcIdx + 1] << 8) | buffer[srcIdx];
                            }
                        }
                        if (recolorMaterials) {
                            const coords = tileToWorldCoordinates(layer.minX, layer.minY, x, y-4, pwIndex, pwIndexVertical, isNGP);
                            const roundedPosition = {
                                x: (Math.floor((coords.x + mapWidth*512/2)/512) % mapWidth + mapWidth) % mapWidth,
                                y: (Math.floor((coords.y + 14*512)/512) % mapHeight + mapHeight) % mapHeight
                            }
                            // Find this pixel in the biome map and get the color...
					        const biomeColor = biomeMap[roundedPosition.y * mapWidth + roundedPosition.x] & 0xffffff; // Mask out alpha if present
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
	console.log(`Generated tile overlays in ${(t1 - t0).toFixed(2)} ms`);
    return overlays;
}

export function createTileOverlays(biomeData, recolorOffscreen, layers, pwIndex, pwIndexVertical, isNGP) {
	if (!appSettings.enableEdgeNoise) return createTileOverlaysCheap(biomeData, layers, pwIndex, pwIndexVertical, isNGP); // Edge noise is the main reason this is so expensive, so if it's disabled just do the cheap version which also skips the seam filling logic
    //if (!document.getElementById('debug-enable-edge-noise').checked) return createTileOverlaysCheap(biomeData, layers, pwIndex, pwIndexVertical, isNGP); // Edge noise is the main reason this is so expensive, so if it's disabled just do the cheap version which also skips the seam filling logic
	
    let biomeMap = biomeData.pixels;
    if (pwIndexVertical < 0) {
        biomeMap = biomeData.heavenPixels;
    }
    else if (pwIndexVertical > 0) {
        biomeMap = biomeData.hellPixels;
    }

    const recolorMaterials = appSettings.recolorMaterials; //document.getElementById('recolor-materials').checked;
    const clearSpawnPixels = appSettings.clearSpawnPixels; //document.getElementById('clear-spawn-pixels').checked;
    const referenceData = recolorOffscreen;
    
    const mapWidth = getWorldSize(isNGP);
	const t0 = performance.now();
    const overlays = []; 

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

        for (let y = 4; y < mapH+4; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const srcIdx = idx * 3;
				const targetIdx = (y-4) * width + x;

                // Check for gray pixels
                if (buffer[srcIdx] === buffer[srcIdx + 1] && buffer[srcIdx + 1] === buffer[srcIdx + 2] && buffer[srcIdx] > 0) {
					// This still feels too expensive for how often it needs to run here
					const coords = tileToWorldCoordinates(layer.minX, layer.minY, x, y-4, pwIndex, pwIndexVertical, isNGP);
					const biomeResult = getBiomeAtWorldCoordinates(biomeData, coords.x, coords.y, isNGP);

					// Find this pixel in the biome map and get the color...
					const biomeColor = biomeMap[biomeResult.pos.y * mapWidth + biomeResult.pos.x] & 0xffffff; // Mask out alpha if present
					const foregroundColor = TILE_FOREGROUND_COLORS[biomeColor];
					
					if (BIOME_COLORS_WITH_TILES.has(biomeColor) && foregroundColor) {
						//const bColor = TILE_OVERLAY_COLORS[layer.biomeName] || 0xff00ff;
                        // annoying that it's originally in BGR format for some reason
						const r = (foregroundColor >> 16) & 0xff;
						const g = (foregroundColor >> 8) & 0xff;
						const b = foregroundColor & 0xff;
						out32[targetIdx] = (255 << 24) | (b << 16) | (g << 8) | r;
					}
                }
                else {
                    if (buffer[srcIdx] > 0 || buffer[srcIdx + 1] > 0 || buffer[srcIdx + 2] > 0) {
                        if (!clearSpawnPixels) {
                            // Still need to check it's in bounds of the biome...
                            const coords = tileToWorldCoordinates(layer.minX, layer.minY, x, y-4, pwIndex, pwIndexVertical, isNGP);
                            const biomeResult = getBiomeAtWorldCoordinates(biomeData, coords.x, coords.y, isNGP);

                            // Find this pixel in the biome map and get the color...
                            const biomeColor = biomeMap[biomeResult.pos.y * mapWidth + biomeResult.pos.x] & 0xffffff; // Mask out alpha if present
                            
                            if (BIOME_COLORS_WITH_TILES.has(biomeColor)) {
                                out32[targetIdx] = (255 << 24) | (buffer[srcIdx + 2] << 16) | (buffer[srcIdx + 1] << 8) | buffer[srcIdx];
                            }
                        }
                        if (recolorMaterials) {
                            // This still feels too expensive for how often it needs to run here
                            const coords = tileToWorldCoordinates(layer.minX, layer.minY, x, y-4, pwIndex, pwIndexVertical, isNGP);
                            const biomeResult = getBiomeAtWorldCoordinates(biomeData, coords.x, coords.y, isNGP);

                            // Find this pixel in the biome map and get the color...
                            const biomeColor = biomeMap[biomeResult.pos.y * mapWidth + biomeResult.pos.x] & 0xffffff; // Mask out alpha if present
                            // Check if it's in a region with tiles
                            // TODO: This is still producing some noise near the edges because the wavy edge is being applied but only for some materials...
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
                            else {
                                // Replace with external biome background color?
                                const refIdx = (biomeResult.pos.y * recolorOffscreen.width + biomeResult.pos.x) * 4;
                                const r = referenceData[refIdx];
                                const g = referenceData[refIdx + 1];
                                const b = referenceData[refIdx + 2];
                                out32[targetIdx] = (255 << 24) | (b << 16) | (g << 8) | r;
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
	console.log(`Generated tile overlays in ${(t1 - t0).toFixed(2)} ms`);
    return overlays;
}

// TODO: This is both currently broken and very slow, but the idea is that it covers some outer edges of the biome in order to fill in the wavy chunk edges
export function createTileOverlaysExpanded(biomeData, recolorOffscreen, layers, pwIndex, pwIndexVertical, isNGP) {
	if (!appSettings.enableEdgeNoise) return createTileOverlaysCheap(biomeData, layers, pwIndex, pwIndexVertical, isNGP); // Edge noise is the main reason this is so expensive, so if it's disabled just do the cheap version which also skips the seam filling logic
    //if (!document.getElementById('debug-enable-edge-noise').checked) return createTileOverlaysCheap(biomeData, layers, pwIndex, pwIndexVertical, isNGP); // Edge noise is the main reason this is so expensive, so if it's disabled just do the cheap version which also skips the seam filling logic
    
    let biomeMap = biomeData.pixels;
    if (pwIndexVertical < 0) {
        biomeMap = biomeData.heavenPixels;
    }
    else if (pwIndexVertical > 0) {
        biomeMap = biomeData.hellPixels;
    }

    const recolorMaterials = appSettings.recolorMaterials; //document.getElementById('recolor-materials').checked;
    const clearSpawnPixels = appSettings.clearSpawnPixels; //document.getElementById('clear-spawn-pixels').checked;
    const mapWidth = getWorldSize(isNGP);
    const t0 = performance.now();
    const overlays = [];
    const referenceData = recolorOffscreen;

    const edgeThreshold = 4; // Padding size

    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        const buffer = layer.buffer;
        if (!buffer) { overlays.push(null); continue; }

        const width = layer.width;
        const mapH = layer.mapH;
        const minX = layer.minX;
        const minY = layer.minY;
        
        const outWidth = width + 2 * edgeThreshold;
        const outHeight = mapH + 2 * edgeThreshold;

        const canvas = new OffscreenCanvas(outWidth, outHeight);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const outImageData = ctx.createImageData(outWidth, outHeight);
        const out32 = new Uint32Array(outImageData.data.buffer);

        // Iterate over the FULL expanded bounds
        for (let outY = 0; outY < outHeight; outY++) {
            for (let outX = 0; outX < outWidth; outX++) {
                const targetIdx = outY * outWidth + outX;

                // Map back to the original layer coordinates (0 to width/height)
                const x = outX - edgeThreshold;
                const y = outY - edgeThreshold;

                let pixelWritten = false;

                // Central area
                if (x >= 0 && x < width && y >= 0 && y < mapH) {
                    // This srcIdx matches your working version (y+4 logic)
                    const srcIdx = ((y + 4) * width + x) * 3;
                    
                    const r = buffer[srcIdx];
                    const g = buffer[srcIdx + 1];
                    const b = buffer[srcIdx + 2];

                    // Check for valid tile data (non-black)
                    if (r > 0 || g > 0 || b > 0) {
                        if (!clearSpawnPixels) {
                            out32[targetIdx] = (255 << 24) | (b << 16) | (g << 8) | r;
                        }
						// More expensive check to replace non-gray pixels
						const coords = tileToWorldCoordinates(minX, minY, x, y, pwIndex, pwIndexVertical, isNGP);
                        const biomeResult = getBiomeAtWorldCoordinates(biomeData, coords.x, coords.y, isNGP);
                        // Check for gray material
                        if (r === g && g === b) {
                            if (biomeResult.biome) {
                                const bColor = TILE_OVERLAY_COLORS[biomeResult.biome];
                                if (bColor !== undefined) {
                                    const or = (bColor >> 16) & 0xff;
                                    const og = (bColor >> 8) & 0xff;
                                    const ob = bColor & 0xff;
                                    out32[targetIdx] = (255 << 24) | (ob << 16) | (og << 8) | or;
                                    pixelWritten = true;
                                }
                            }
                        } else if (!biomeResult.biome) {
                            // Non-gray pixel (keep original buffer color)
                            const refIdx = (biomeResult.pos.y * recolorOffscreen.width + biomeResult.pos.x) * 4;

                            const r = referenceData[refIdx];
                            const g = referenceData[refIdx + 1];
                            const b = referenceData[refIdx + 2];
                            const a = referenceData[refIdx + 3];

                            out32[targetIdx] = (a << 24) | (b << 16) | (g << 8) | r;
                            pixelWritten = true;
                        }
                        else {
                            if (recolorMaterials) {
                                // This still feels too expensive for how often it needs to run here
                                const coords = tileToWorldCoordinates(layer.minX, layer.minY, x, y-4, pwIndex, pwIndexVertical, isNGP);
                                const biomeResult = getBiomeAtWorldCoordinates(biomeData, coords.x, coords.y, isNGP);

                                // Find this pixel in the biome map and get the color...
                                const biomeColor = biomeMap[biomeResult.pos.y * mapWidth + biomeResult.pos.x] & 0xffffff; // Mask out alpha if present
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
                                        pixelWritten = true;
                                    }
                                }
                                else {
                                    // Replace with external biome background color?
                                    const refIdx = (biomeResult.pos.y * recolorOffscreen.width + biomeResult.pos.x) * 4;
                                    const r = referenceData[refIdx];
                                    const g = referenceData[refIdx + 1];
                                    const b = referenceData[refIdx + 2];
                                    out32[targetIdx] = (255 << 24) | (b << 16) | (g << 8) | r;
                                    pixelWritten = true;
                                }
                            }
                        }
                    }
                }

                // Edges / seams
                // If the pixel wasn't written by the buffer, check if we need to fill the background
                if (!pixelWritten) {
                    const isPadding = x < 0 || x >= width || y < 0 || y >= mapH;
                    // Check seams relative to world-space grid (cheap check)
                    const isNearSeam = (x % 51.2 <= edgeThreshold || x % 51.2 >= 51.2 - edgeThreshold || 
                                        y % 51.2 <= edgeThreshold || y % 51.2 >= 51.2 - edgeThreshold);

                    if (isPadding || isNearSeam) {
                        const coords = tileToWorldCoordinates(minX, minY, x, y, pwIndex, pwIndexVertical, isNGP);
                        const biomeResult = getBiomeAtWorldCoordinates(biomeData, coords.x, coords.y, isNGP);
                        
                        //if (!biomeResult.biome || !GENERATOR_CONFIG[biomeResult.biome] || biomeResult.biome === layer.biomeName) {
						if (!biomeResult.biome) {
                            const refIdx = (biomeResult.pos.y * recolorOffscreen.width + biomeResult.pos.x) * 4;
							out32[targetIdx] = (255 << 24) | (referenceData[refIdx + 2] << 16) | (referenceData[refIdx + 1] << 8) | referenceData[refIdx];
                        }
						else if (biomeResult.biome === layer.biomeName) {
							// Check that the other biome is empty (otherwise you could overwrite something)
							// Adding 1 here seems to help fix the 1 pixel seam...
							const adjBiomeResult = getBiomeAtWorldCoordinates(biomeData, 512*Math.floor(1+coords.x/512)+256, 512*Math.floor(1+coords.y/512)+256, isNGP);
							if (!adjBiomeResult.biome) {
								const refIdx = (biomeResult.pos.y * recolorOffscreen.width + biomeResult.pos.x) * 4;
								out32[targetIdx] = (255 << 24) | (referenceData[refIdx + 2] << 16) | (referenceData[refIdx + 1] << 8) | referenceData[refIdx];
							}
						}
                    }
                }
            }
        }

        ctx.putImageData(outImageData, 0, 0);

        //overlays.push(outputCanvas);
		overlays.push(canvas);
    }

    const t1 = performance.now();
    console.log(`Generated expanded tile overlays in ${(t1 - t0).toFixed(2)} ms`);
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