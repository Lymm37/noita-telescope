import { NollaPrng } from './nolla_prng.js';
import { BLOCKED_COLORS, PIXEL_SCENE_BIOME_MAP } from './pixel_scene_config.js';
import { MATERIAL_COLOR_CONVERSION, MATERIAL_WANG_COLORS } from './potion_config.js';
import { getBiomeAtWorldCoordinates } from './utils.js';
import { sanitizePng, makeBlackTransparent } from './png_sanitizer.js';
import { prescanPixelScene } from './poi_scanner.js';
import { BIOME_BACKGROUND_COLORS, TILE_OVERLAY_COLORS } from './image_processing.js';

// This was originally constant but it sometimes needs to be cleared to regenerate the cache...
export let PIXEL_SCENE_DATA = {};

export async function reloadPixelSceneCache() {
	PIXEL_SCENE_DATA = {};
	await loadPixelSceneData();
}

function getBiomeAlias(biomeName) {
	// Aliases to avoid needing to duplicate files for repeated biomes
	if (biomeName === "coalmine_alt") return "coalmine";
	if (biomeName === "sandcave") return "snowcastle";
	if (biomeName === "rainforest_open" || biomeName === "rainforest_dark") return "rainforest";
	if (biomeName === "vault_frozen") return "vault";
	if (biomeName === "the_end") return "crypt";
	return biomeName;
}

function getPixelSceneVariant(pixelSceneKey, variantKey) {
	if (variantKey === '') return PIXEL_SCENE_DATA[pixelSceneKey].imgElement;
	if (PIXEL_SCENE_DATA[pixelSceneKey].variants[variantKey]) return PIXEL_SCENE_DATA[pixelSceneKey].variants[variantKey];
	console.log(`No variant found for pixel scene key ${pixelSceneKey} with variant key ${variantKey}?`);
	return null;
}

const GENERAL_SCENES = ["wand_altar", "wand_altar_vault", "potion_altar", "potion_altar_vault"]; // These scenes are used in multiple biomes, so we can check for them first before doing the biome-specific lookup

// Don't use the alias here because spawn points can have different indices per "duplicate" biome, so we need to keep them separate in the data
function getPixelSceneKey(biomeName, sceneName) {
	if (GENERAL_SCENES.includes(sceneName)) return "general/" + sceneName;
	return biomeName + "/" + sceneName;
}

export async function loadPixelSceneData() {
	// Load key value pairs for all pixel scenes
	let loaded = 0;
	for (const biome of Object.keys(PIXEL_SCENE_BIOME_MAP)) {
		const biomeScenes = PIXEL_SCENE_BIOME_MAP[biome];
		for (const sceneList of Object.values(biomeScenes)) {
			for (const scene of sceneList) {
				if (scene.name === "") continue; // Skip the "no scene" option
				const key = getPixelSceneKey(biome, scene.name);
				if (!PIXEL_SCENE_DATA[key]) {
					const url = `./data/pixel_scenes/${getBiomeAlias(biome)}/${scene.name}.png`;
					const cleanUrl = await sanitizePng(url);
					const img = new Image();
					img.src = cleanUrl;
					img.onload = () => {
						const canvas = document.createElement('canvas');
						canvas.width = img.width;
						canvas.height = img.height;
						const ctx = canvas.getContext('2d', { willReadFrequently: true });
						ctx.drawImage(img, 0, 0);
						makeBlackTransparent(ctx);
						// Prescan the pixel scene for spawn points and store them in a global lookup for later use during generation, keyed by biome and scene name
						const spawnPoints = prescanPixelScene(canvas, biome);
						PIXEL_SCENE_DATA[key] = {
							key: key,
							biome: biome,
							name: scene.name,
							imgElement: canvas, // Store the canvas directly since we need to manipulate it for recoloring
							width: img.width,
							height: img.height,
							spawnPoints: spawnPoints,
							isCosmetic: spawnPoints.length === 0, // If there are no spawn points, we can consider it purely cosmetic and can optionally skip some checks during generation
							variants: {}, // Used for color material changes, keyed as `${color}=${material}`
						};
						loaded++;
					};
				}
			}
		}
	}
	console.log(`Loaded ${loaded} pixel scenes.`);
}
// TODO: Move to main to make sure it shows the loading screen
console.log("Loading pixel scene data...");
await loadPixelSceneData();
console.log("Finished loading pixel scene data.");

// This function scans the pixel scene image for blocked room colors, and returns an array of room objects with their coordinates and colors
export function blockOutRooms(pixels, width, height) {
	let rooms = [];
	for (let y = 4; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = (y * width + x) * 3;
			const color = (pixels[idx] << 16) | (pixels[idx+1] << 8) | pixels[idx+2];
			if (color === 0x000000 || color === 0xffffff) continue;
			if (!BLOCKED_COLORS.includes(color)) continue;

			let startX = x+1;
			let startY = y+1;
			let endX = x+1;
			let endY = y+1;
			let foundEnd = false;
			while (!foundEnd && endX < width) {
				if (endX >= width) break;
				const tempIdx = (startY * width + endX) * 3;
				const tempColor = (pixels[tempIdx] << 16) | (pixels[tempIdx+1] << 8) | pixels[tempIdx+2];
				if (tempColor === 0x000000 || tempColor === 0x323232) {
					endX++;
					continue;
				}
				endX--;
				foundEnd = true;
			}
			if (endX >= width) endX = width - 1;
			foundEnd = false;
			while (!foundEnd && endY < height) {
				if (endY >= height) break;
				const tempIdx = (endY * width + startX) * 3;
				const tempColor = (pixels[tempIdx] << 16) | (pixels[tempIdx+1] << 8) | pixels[tempIdx+2];
				if (tempColor === 0x000000 || tempColor === 0x323232) {
					endY++;
					continue;
				}
				endY--;
				foundEnd = true;
			}
			if (endY >= height) endY = height - 1;

			if (endX > startX && endY > startY) {
				//console.log(`Blocking out room from (${startX}, ${startY}) to (${endX}, ${endY})`);

				// Block out the room with pixels to block pathfinding
				for (let by = startY; by <= endY; by++) {
					for (let bx = startX; bx <= endX; bx++) {
						const bIdx = (by * width + bx) * 3;
						// Magenta for debug
						pixels[bIdx] = 0xff;
						pixels[bIdx + 1] = 0x01;
						pixels[bIdx + 2] = 0xff;
					}
				}
			}

			rooms.push({color, startX, startY, endX, endY});
		}
	}
	return rooms;
}

const CHECK_PIXEL_SCENE_CORNERS = true;
const PIXEL_SCENES_WITHOUT_BOUNDS_CHECK = [
	//"trailer_altar", // Nope this doesn't work
]
// TODO: This offset apparently works but I don't think it makes sense, so I am probably still misunderstanding exactly how it checks the bounds for pixel scenes
// Seed for debug: 119164939
// Appears in PW 0, disappears in PW -1, second one appears in PW 9
// Without the offset they don't appear until PW 8 / 17
// Visually the main world one is nearly split down the middle between biomes even with the edge noise,
// which seemingly contradicts my assumption that the bounds check looks for all 4 corners being in the same biome
const PIXEL_SCENE_BOUNDS_OFFSET = {
	"trailer_altar": {x: -67, y: 0},
}

export function loadPixelScene(biomeData, biomeName, sceneName, ws, ng, x, y, skipCosmeticScenes = true) {
	const pixelSceneKey = getPixelSceneKey(biomeName, sceneName);
	if (!PIXEL_SCENE_DATA[pixelSceneKey]) {
		console.warn(`Pixel scene data not found for key ${pixelSceneKey}. This should not happen because we preload all pixel scene images.`);
		return null;
	}
	const pixelSceneData = PIXEL_SCENE_DATA[pixelSceneKey];
	if (pixelSceneData.isCosmetic && skipCosmeticScenes) {
		// If the scene is purely cosmetic and we're skipping cosmetic scenes, skip it
		return null;
	}
	// Check whether it is actually in the right biome completely
	// Need to check all corners I think, otherwise we get edge cases that break
	if (CHECK_PIXEL_SCENE_CORNERS && !PIXEL_SCENES_WITHOUT_BOUNDS_CHECK.includes(sceneName)) {
		const boundsOffset = PIXEL_SCENE_BOUNDS_OFFSET[sceneName] || {x: 0, y: 0};
		const topCornerCoords = {x: x + boundsOffset.x, y: y + boundsOffset.y};
		const targetTopLeft = getBiomeAtWorldCoordinates(biomeData, topCornerCoords.x, topCornerCoords.y, ng > 0);
		const targetBiomeTopLeft = targetTopLeft ? targetTopLeft.biome : null;
		if (!targetBiomeTopLeft || targetBiomeTopLeft !== biomeName) {
			return null;
		}
		const topRightCoords = {x: x + pixelSceneData.width + boundsOffset.x, y: y + boundsOffset.y};
		const targetTopRight = getBiomeAtWorldCoordinates(biomeData, topRightCoords.x, topRightCoords.y, ng > 0);
		const targetBiomeTopRight = targetTopRight ? targetTopRight.biome : null;
		if (!targetBiomeTopRight || targetBiomeTopRight !== biomeName) {
			return null;
		}
		const bottomLeftCoords = {x: x + boundsOffset.x, y: y + pixelSceneData.height + boundsOffset.y};
		const targetBottomLeft = getBiomeAtWorldCoordinates(biomeData, bottomLeftCoords.x, bottomLeftCoords.y, ng > 0);
		const targetBiomeBottomLeft = targetBottomLeft ? targetBottomLeft.biome : null;
		if (!targetBiomeBottomLeft || targetBiomeBottomLeft !== biomeName) {
			return null;
		}
		const bottomRightCoords = {x: x + pixelSceneData.width + boundsOffset.x, y: y + pixelSceneData.height + boundsOffset.y};
		const targetBottomRight = getBiomeAtWorldCoordinates(biomeData, bottomRightCoords.x, bottomRightCoords.y, ng > 0);
		const targetBiomeBottomRight = targetBottomRight ? targetBottomRight.biome : null;
		if (!targetBiomeBottomRight || targetBiomeBottomRight !== biomeName) {
			return null;
		}
	}
	// Recolor the pixel scene for the biome if needed
	const variantKey = `biome=${biomeName}`;
	if (!PIXEL_SCENE_DATA[pixelSceneKey].variants[variantKey]) {
		PIXEL_SCENE_DATA[pixelSceneKey].variants[variantKey] = recolorPixelSceneForBiome(getPixelSceneVariant(pixelSceneKey, ''), biomeName);
		//console.log(`Created biome variant of pixel scene ${pixelSceneKey} with key ${variantKey}`);
	}
	const pixelSceneImage = PIXEL_SCENE_DATA[pixelSceneKey].variants[variantKey];
	return {
		key: pixelSceneKey,
		variantKey: variantKey,
		name: sceneName,
		imgElement: pixelSceneImage,
		width: pixelSceneData.width,
		height: pixelSceneData.height,
		x: x,
		y: y,
		spawnPoints: pixelSceneData.spawnPoints,
		material: null,
		type: 'pixel_scene'
	};
}

export function loadRandomPixelScene(biomeData, biomeName, scene_list, ws, ng, x, y, skipCosmeticScenes = true) {
	if (!scene_list || scene_list.length === 0) return null;
	const prng = new NollaPrng(0);
	let total_prob = 0;
	for (const scene of scene_list) {
		total_prob += scene.prob;
	}
	let r = prng.ProceduralRandom(ws + ng, x, y) * total_prob;
	for (const scene of scene_list) {
		if (scene.prob <= 0) continue;
		if (r <= scene.prob) {
			if (scene.name === "") return null; // Rolled for no scene
			const pixelSceneKey = getPixelSceneKey(biomeName, scene.name);
			if (!PIXEL_SCENE_DATA[pixelSceneKey]) {
				console.warn(`Pixel scene data not found for key ${pixelSceneKey}. This should not happen because we preload all pixel scene images.`);
				return null;
			}
			const pixelSceneData = PIXEL_SCENE_DATA[pixelSceneKey];
			if (pixelSceneData.isCosmetic && skipCosmeticScenes) {
				// If the scene is purely cosmetic and we're skipping cosmetic scenes, skip it
				return null;
			}
			let outputScene = {
				key: pixelSceneKey,
				name: scene.name, 
				imgElement: pixelSceneData.imgElement,
				width: pixelSceneData.width,
				height: pixelSceneData.height,
				x: x, 
				y: y, 
				material: null,
				spawnPoints: pixelSceneData.spawnPoints,
				type: 'pixel_scene'
			};
			// Check whether it is actually in the right biome completely
			// Need to check all corners I think, otherwise we get edge cases that break
			if (CHECK_PIXEL_SCENE_CORNERS) {
				const topCornerCoords = {x: x, y: y};
				const targetTopLeft = getBiomeAtWorldCoordinates(biomeData, topCornerCoords.x, topCornerCoords.y, ng > 0);
				const targetBiomeTopLeft = targetTopLeft ? targetTopLeft.biome : null;
				if (!targetBiomeTopLeft || targetBiomeTopLeft !== biomeName) {
					return null;
				}
				const topRightCoords = {x: x + outputScene.width, y: y};
				const targetTopRight = getBiomeAtWorldCoordinates(biomeData, topRightCoords.x, topRightCoords.y, ng > 0);
				const targetBiomeTopRight = targetTopRight ? targetTopRight.biome : null;
				if (!targetBiomeTopRight || targetBiomeTopRight !== biomeName) {
					return null;
				}
				const bottomLeftCoords = {x: x, y: y + outputScene.height};
				const targetBottomLeft = getBiomeAtWorldCoordinates(biomeData, bottomLeftCoords.x, bottomLeftCoords.y, ng > 0);
				const targetBiomeBottomLeft = targetBottomLeft ? targetBottomLeft.biome : null;
				if (!targetBiomeBottomLeft || targetBiomeBottomLeft !== biomeName) {
					return null;
				}
				const bottomRightCoords = {x: x + outputScene.width, y: y + outputScene.height};
				const targetBottomRight = getBiomeAtWorldCoordinates(biomeData, bottomRightCoords.x, bottomRightCoords.y, ng > 0);
				const targetBiomeBottomRight = targetBottomRight ? targetBottomRight.biome : null;
				if (!targetBiomeBottomRight || targetBiomeBottomRight !== biomeName) {
					return null;
				}
			}
			// Recolor random materials first so material lookups still work
			let variantKey = '';
			if (scene.color_material) {
				// Sort keys to ensure consistent ordering for caching variants
				const sortedColors = Object.keys(scene.color_material).sort((a, b) => parseInt(a, 16) - parseInt(b, 16));
				for (const color of sortedColors) {
					// Start with the recolored variant
					let pixelSceneImage = getPixelSceneVariant(pixelSceneKey, variantKey);
					//const color = Object.keys(scene.color_material)[0];
					// TODO: Need to adjust to work for multiple materials. Low priority since as far as I can tell it's only used for one pixel scene in the vault, and the materials are boring
					const materials = scene.color_material[color];
					prng.SetRandomSeed(ws + ng, x + 11, y - 21); //?
					let r = prng.ProceduralRandom(ws + ng, x + 11, y - 21); // Note ProceduralRandom returns a value in (0, 1] so this is actually fine
					//console.log(x, y, r);
					let mr = Math.ceil(r * materials.length) - 1;
					
					const targetMaterial = materials[mr];
					outputScene.material = targetMaterial;
					let materialColor = MATERIAL_WANG_COLORS[materials[mr]];
					// It took me a bit too long to notice that this was the source of my issues, we shouldn't be recoloring it yet
					/*
					if (POTION_COLORS[materials[mr]]) {
						// If it's a potion, use the potion color instead of the material color
						materialColor = POTION_COLORS[materials[mr]];
					}
					*/
					// See if the recolored pixel scene is already cached
					variantKey += (variantKey !== '' ? '&' : '') + `${color}=${targetMaterial}`;
					if (!PIXEL_SCENE_DATA[pixelSceneKey].variants[variantKey]) {
						PIXEL_SCENE_DATA[pixelSceneKey].variants[variantKey] = recolorPixelScene(
							pixelSceneImage, 
							parseInt(color, 16), 
							parseInt(materialColor, 16)
						);
						//console.log(`Created variant of pixel scene ${pixelSceneKey} with key ${variantKey}`);
					}
				}
				//console.log(`Pixel scene ${scene.name} has recolorable material ${materials[mr]} with color ${materialColor}`);
				// Handling this by a global setting so it's not so weirdly nondeterminstic, depends on whether or not you've loaded the unique pixel scene
				// (of which there is only one, shrine_alt in coalmine_alt)
				/*
				if (scene.unique) {
					scene.prob = 0.0;
					console.log(`Pixel scene ${scene.name} is unique, setting its probability to 0.`);
				}
				*/
			}
			// Recolor the pixel scene for the biome if needed
			const finalVariantKey = variantKey + (variantKey !== '' ? '&' : '') + `biome=${biomeName}`;
			if (!PIXEL_SCENE_DATA[pixelSceneKey].variants[finalVariantKey]) {
				PIXEL_SCENE_DATA[pixelSceneKey].variants[finalVariantKey] = recolorPixelSceneForBiome(getPixelSceneVariant(pixelSceneKey, variantKey), biomeName);
				//console.log(`Created biome variant of pixel scene ${pixelSceneKey} with key ${finalVariantKey}`);
			}
			outputScene.variantKey = finalVariantKey;
			outputScene.imgElement = PIXEL_SCENE_DATA[pixelSceneKey].variants[finalVariantKey];

			//console.log(`Loaded pixel scene ${scene.name} at (${x}, ${y}) in biome ${biomeName}.`);
			return outputScene;
		}
		r -= scene.prob;
	}
	console.log(`Impossible zero probability outcome for pixel scene at (${x}, ${y}), total prob ${total_prob}, r ${r}: ${JSON.stringify(scene_list)}`);
	return null;
}

function recolorPixelSceneForBiome(sourceCanvas, targetBiome) {
    const recolorMaterials = document.getElementById('recolor-materials').checked;
    const width = sourceCanvas.width;
    const height = sourceCanvas.height;

    // 1. Create a NEW canvas and context for the output
    const outCanvas = document.createElement('canvas');
    outCanvas.width = width;
    outCanvas.height = height;
    const outCtx = outCanvas.getContext('2d');

    // 2. Draw source to output, then grab THAT data so source stays pristine
    outCtx.drawImage(sourceCanvas, 0, 0);
    const imgData = outCtx.getImageData(0, 0, width, height);
    const data32 = new Uint32Array(imgData.data.buffer);

    // Prepare color values for 32-bit ABGR format (Little-Endian)
    const pack = (hex) => (0xFF << 24) | ((hex & 0xFF) << 16) | (hex & 0xFF00) | ((hex >> 16) & 0xFF);
    
    const targetColor = pack(TILE_OVERLAY_COLORS[targetBiome] || 0xff00ff);
    const bgColor = pack(BIOME_BACKGROUND_COLORS[targetBiome] || 0x000000);
    const airDetect = 0xFF420000; // ABGR for 0x000042 (Air)

    for (let i = 0; i < data32.length; i++) {
        const color = data32[i];
        const r = color & 0xFF;
        const g = (color >> 8) & 0xFF;
        const b = (color >> 16) & 0xFF;

        // A. Handle Grays (Material Recolor)
        if (r === g && g === b && r > 0) {
            data32[i] = targetColor;
        } 
        // B. Replace Air with Background
        else if (color === airDetect) {
            data32[i] = bgColor;
        } 
        // C. Recolor Wang Colors
        else if (recolorMaterials && (r > 0 || g > 0 || b > 0)) {
            const rgb = (r << 16) | (g << 8) | b;
            const matColor = MATERIAL_COLOR_CONVERSION[rgb];
            if (matColor) data32[i] = pack(matColor);
        }
    }

    outCtx.putImageData(imgData, 0, 0);
    return outCanvas;
}

function recolorPixelScene(sourceCanvas, source_color, target_color) {
    const width = sourceCanvas.width;
    const height = sourceCanvas.height;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = width;
    outCanvas.height = height;
    const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });

    // Draw the original image to the new canvas
    outCtx.drawImage(sourceCanvas, 0, 0);
    const imgData = outCtx.getImageData(0, 0, width, height);
    const data32 = new Uint32Array(imgData.data.buffer);

    // Convert hex RRGGBB to ABGR (Little-Endian)
    // We ignore the top 8 bits (Alpha) in the pack for the source comparison
    const pack = (hex) => ((hex & 0xFF) << 16) | (hex & 0xFF00) | ((hex >> 16) & 0xFF);
    
    const sBGR = pack(source_color);
    const tABGR = (0xFF << 24) | pack(target_color); // Force alpha to 255 for output

    for (let i = 0; i < data32.length; i++) {
        // Mask out the Alpha channel (top 8 bits) to compare only BGR
        if ((data32[i] & 0x00FFFFFF) === sBGR) {
            data32[i] = tABGR;
        }
    }

    outCtx.putImageData(imgData, 0, 0);
    return outCanvas;
}