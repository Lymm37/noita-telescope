import { NollaPrng } from './nolla_prng.js';
import { BLOCKED_COLORS, GENERAL_SCENES, PIXEL_SCENE_BIOME_MAP } from './pixel_scene_config.js';
import { MATERIAL_COLOR_CONVERSION, MATERIAL_WANG_COLORS } from './potion_config.js';
import { getBiomeAtWorldCoordinates, getWorldSize } from './utils.js';
import { loadPNG } from './png_sanitizer.js';
import { prescanPixelScene } from './poi_scanner.js';
import { BIOME_BACKGROUND_COLORS, TILE_OVERLAY_COLORS, makeBlackTransparent } from './image_processing.js';
import { GENERATOR_CONFIG } from './generator_config.js';
import { app } from './app.js'; // Hacky but I don't feel like figuring out how to pass this data right now

// This was originally constant but it sometimes needs to be cleared to regenerate the cache...
export let PIXEL_SCENE_DATA = {};
const PIXEL_SCENE_CANVAS_CACHE = {};

const SCENES_TO_NOT_RECOLOR = ["wand_altar", "wand_altar_vault", "potion_altar", "potion_altar_vault"]; // It would be a waste to recolor these for every biome
const PIXEL_SCENE_AIR_TRANSPARENCY_EXCEPTIONS = {
	"the_end_shop": 0xff,
	"cavern": 0xff,
	"friendroom": 0xff,
	"eyespot": 0xff,
	"altar_snowcastle_capsule": 0xff,
	"altar_vault_capsule": 0xff,
	"altar_snowcave_capsule": 0xff,
	"tower_start": 0xff,
	// Otherwise assume transparent?
}

export async function reloadPixelSceneCache() {
	PIXEL_SCENE_DATA = {};
	await loadPixelSceneData();
}

export function getPixelSceneCanvas(pixelScene) {
	const pixelSceneKey = pixelScene.key;
	const variantKey = pixelScene.variantKey || '';
	const key = `${pixelSceneKey}/${variantKey}`;
	if (PIXEL_SCENE_CANVAS_CACHE[key]) return PIXEL_SCENE_CANVAS_CACHE[key];
	const pixelSceneData = PIXEL_SCENE_DATA[pixelSceneKey].variants[variantKey];
	const width = PIXEL_SCENE_DATA[pixelSceneKey].width;
	const height = PIXEL_SCENE_DATA[pixelSceneKey].height;
	const canvas = new OffscreenCanvas(width, height);
	const ctx = canvas.getContext('2d');
	const imageData = ctx.createImageData(width, height);
	imageData.data.set(pixelSceneData);
	ctx.putImageData(imageData, 0, 0);
	PIXEL_SCENE_CANVAS_CACHE[key] = canvas;
	return canvas;
}

function getBiomeAlias(biomeName) {
	// Aliases to avoid needing to duplicate files for repeated biomes
	if (biomeName === "coalmine_alt") return "coalmine";
	if (biomeName === "excavationsite_cube_chamber") return "excavationsite";
	if (biomeName === "snowcave_secret_chamber") return "snowcave";
	if (biomeName === "sandcave" || biomeName === "snowcastle_cavern" || biomeName === "snowcastle_hourglass_chamber") return "snowcastle";
	if (biomeName === "rainforest_open" || biomeName === "rainforest_dark") return "rainforest";
	if (biomeName === "vault_frozen") return "vault";
	if (biomeName === "the_end" || biomeName === "the_sky") return "crypt";
	if (biomeName === "scale") return "overworld";
	if (biomeName.includes("temple")) return "temple";
	if (biomeName.includes("pyramid")) return "pyramid";
	if (biomeName.includes("mountain")) return "mountain";
	return biomeName;
}

function getPixelSceneVariant(pixelSceneKey, variantKey) {
	if (variantKey === '') return PIXEL_SCENE_DATA[pixelSceneKey].imgElement;
	if (PIXEL_SCENE_DATA[pixelSceneKey].variants[variantKey]) return PIXEL_SCENE_DATA[pixelSceneKey].variants[variantKey];
	console.log(`No variant found for pixel scene key ${pixelSceneKey} with variant key ${variantKey}?`);
	return null;
}

//const GENERAL_SCENES = ["wand_altar", "wand_altar_vault", "potion_altar", "potion_altar_vault"]; // These scenes are used in multiple biomes, so we can check for them first before doing the biome-specific lookup
const GENERAL_SCENE_NAMES = GENERAL_SCENES["extras"].map(scene => scene.name);

// Don't use the alias here because spawn points can have different indices per "duplicate" biome, so we need to keep them separate in the data
function getPixelSceneKey(biomeName, sceneName) {
	if (biomeName.includes("temple")) return "temple/" + sceneName;
	if (biomeName.includes("pyramid")) return "pyramid/" + sceneName;
	if (biomeName.includes("mountain")) return "mountain/" + sceneName;
	if (!biomeName || GENERAL_SCENE_NAMES.includes(sceneName) || !GENERATOR_CONFIG[biomeName]) return "general/" + sceneName;
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
					const imgData = await loadPNG(url);
					makeBlackTransparent(imgData.data);
					// Prescan the pixel scene for spawn points and store them in a global lookup for later use during generation, keyed by biome and scene name
					const spawnPoints = prescanPixelScene(imgData, biome);
					PIXEL_SCENE_DATA[key] = {
						key: key,
						biome: biome,
						name: scene.name,
						imgElement: imgData.data, // Store the image data directly since we need to manipulate it for recoloring
						width: imgData.width,
						height: imgData.height,
						spawnPoints: spawnPoints,
						isCosmetic: spawnPoints.length === 0, // If there are no spawn points, we can consider it purely cosmetic and can optionally skip some checks during generation
						variants: {}, // Used for color material changes, keyed as `${color}=${material}`
					};
					loaded++;
				}
			}
		}
	}
	console.log(`Loaded ${loaded} pixel scenes.`);
}

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

export function loadPixelScene(biomeData, biomeName, sceneName, ws, ng, x, y, skipCosmeticScenes = true, checkBounds = true) {
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
	if (checkBounds && biomeName && CHECK_PIXEL_SCENE_CORNERS && !PIXEL_SCENES_WITHOUT_BOUNDS_CHECK.includes(sceneName)) {
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
	if (!biomeName || biomeName === "general") {
		// Better fallback
		if (SCENES_TO_NOT_RECOLOR.includes(sceneName)) {
			biomeName = "general";
		} else {
			biomeName = getBiomeAtWorldCoordinates(app.biomeData, x + pixelSceneData.width/2, y + pixelSceneData.height/2, app.ngPlusCount > 0)?.biome || "general";
		}
	}
	const variantKey = `biome=${biomeName}`;
	if (!PIXEL_SCENE_DATA[pixelSceneKey].variants[variantKey]) {
		PIXEL_SCENE_DATA[pixelSceneKey].variants[variantKey] = recolorPixelSceneForBiome(sceneName, getPixelSceneVariant(pixelSceneKey, ''), PIXEL_SCENE_DATA[pixelSceneKey].width, PIXEL_SCENE_DATA[pixelSceneKey].height, biomeName, x, y);
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
					const materials = scene.color_material[color];
					prng.SetRandomSeed(ws + ng, x + 11, y - 21); //?
					let r = prng.ProceduralRandom(ws + ng, x + 11, y - 21); // Note ProceduralRandom returns a value in (0, 1] so this is actually fine
					let mr = Math.ceil(r * materials.length) - 1;
					
					const targetMaterial = materials[mr];
					outputScene.material = targetMaterial;
					let materialColor = MATERIAL_WANG_COLORS[materials[mr]];
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
			}
			// Recolor the pixel scene for the biome if needed
			const finalVariantKey = variantKey + (variantKey !== '' ? '&' : '') + `biome=${biomeName}`;
			if (!PIXEL_SCENE_DATA[pixelSceneKey].variants[finalVariantKey]) {
				PIXEL_SCENE_DATA[pixelSceneKey].variants[finalVariantKey] = recolorPixelSceneForBiome(scene.name, getPixelSceneVariant(pixelSceneKey, variantKey), PIXEL_SCENE_DATA[pixelSceneKey].width, PIXEL_SCENE_DATA[pixelSceneKey].height, biomeName, x, y);
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

function recolorPixelSceneForBiome(sceneName, sourceData, width, height, targetBiome, x, y) {
	const recolorMaterials = document.getElementById('recolor-materials').checked;
	
	const outData = new Uint8Array(sourceData.length);
	outData.set(sourceData);

	// Some scene name exceptions because this just isn't working


	let targetColor = TILE_OVERLAY_COLORS[targetBiome] || 0xff00ff;
	let bgColor = BIOME_BACKGROUND_COLORS[targetBiome] || 0x000000;
	let targetR = (targetColor >> 16) & 0xFF;
	let targetG = (targetColor >> 8) & 0xFF;
	let targetB = targetColor & 0xFF;
	let bgColorR = (bgColor >> 16) & 0xFF;
	let bgColorG = (bgColor >> 8) & 0xFF;
	let bgColorB = bgColor & 0xFF;
	/*
	const biomeMapWidth = getWorldSize(app.ngPlusCount > 0);
	if (targetR === 255 && targetG === 0 && targetB === 255) {
		// As a fallback, use the color of the biome map?
		// TODO: Currently using app references here when I probably shouldn't
		// Using center of the pixel scene, but it shouldn't really matter
		const chunkX = (Math.floor((biomeMapWidth * 256 + x + width/2) / 512) % getWorldSize(app.ngPlusCount > 0) + getWorldSize(app.ngPlusCount > 0)) % getWorldSize(app.ngPlusCount > 0);
		let chunkY = Math.floor((14*512 + y + height/2) / 512);
		if (chunkY < 0) chunkY = 0;
		if (chunkY > 47) chunkY = 47;
		const bgColorIdx = (chunkY * biomeMapWidth + chunkX)*3;
		const bgColor = (app.recolorOffscreenBuffer[bgColorIdx] << 16) | (app.recolorOffscreenBuffer[bgColorIdx + 1] << 8) | app.recolorOffscreenBuffer[bgColorIdx + 2];
		if (y > 22000) {
			console.log(bgColor, BIOME_BACKGROUND_COLORS["the_end"] & 0xffffff)
		}
		// TODO: Some attempt to make the background color not exactly the same as the terrain color... Need to just get a better background and foreground.
		targetR = Math.floor(app.recolorOffscreenBuffer[bgColorIdx] * 0.75);
		targetG = Math.floor(app.recolorOffscreenBuffer[bgColorIdx + 1] * 0.75);
		targetB = Math.floor(app.recolorOffscreenBuffer[bgColorIdx + 2] * 0.75);
		bgColorR = 0;
		bgColorG = 0;
		bgColorB = 0;
	}
	*/

	for (let i = 0; i < outData.length; i += 4) {
		const r = outData[i];
		const g = outData[i + 1];
		const b = outData[i + 2];

		// Handle Grays (Material Recolor)
		if (r === g && g === b && r > 0) {
			outData[i] = targetR;
			outData[i + 1] = targetG;
			outData[i + 2] = targetB;
			//outData[i + 3] = targetA;
		} 
		// Replace Air with Background
		else if (r === 0x00 && g === 0x00 && b === 0x42) {
			outData[i] = bgColorR;
			outData[i + 1] = bgColorG;
			outData[i + 2] = bgColorB;
			// I think I need to set this differently depending on what the scene is, in the case of some of the static pixel scenes.
			if (PIXEL_SCENE_AIR_TRANSPARENCY_EXCEPTIONS[sceneName]) {
				outData[i + 3] = PIXEL_SCENE_AIR_TRANSPARENCY_EXCEPTIONS[sceneName];
			}
			else {
				outData[i + 3] = 0x00;
			}
		} 
		// Recolor Wang Colors
		else if (recolorMaterials && (r > 0 || g > 0 || b > 0)) {
			const rgb = (r << 16) | (g << 8) | b;
			const matColor = MATERIAL_COLOR_CONVERSION[rgb];
			if (matColor) {
				outData[i] = (matColor >> 16) & 0xFF;
				outData[i + 1] = (matColor >> 8) & 0xFF;
				outData[i + 2] = matColor & 0xFF;
			}
		}
	}

	return outData;
}

// Width and height are not actually needed here
function recolorPixelScene(sourceData, sourceColor, targetColor) {
    const outData = new Uint8Array(sourceData.length);
	outData.set(sourceData);

	const sourceR = (sourceColor >> 16) & 0xFF;
	const sourceG = (sourceColor >> 8) & 0xFF;
	const sourceB = sourceColor & 0xFF;

	const targetR = (targetColor >> 16) & 0xFF;
	const targetG = (targetColor >> 8) & 0xFF;
	const targetB = targetColor & 0xFF;

    for (let i = 0; i < outData.length; i += 4) {
        const r = outData[i];
		const g = outData[i + 1];
		const b = outData[i + 2];
		if (r === sourceR && g === sourceG && b === sourceB) {
			outData[i] = targetR;
			outData[i + 1] = targetG;
			outData[i + 2] = targetB;
		}
    }

    return outData;
}