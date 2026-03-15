import { NollaPrng } from "./nolla_prng.js";
import { loadPNG } from "./png_sanitizer.js";
import { getWorldCenter } from "./utils.js";

const BIOME_PATH_FIND_WORLD_POS_X = 159;
const BIOME_PATH_FIND_WORLD_POS_X_MINES = 975; // Shrug

export function getMainBiomePathStartX(biomeName, chunkX, isNGP) {
	let startX = Math.floor((BIOME_PATH_FIND_WORLD_POS_X - (chunkX - getWorldCenter(isNGP)) * 512)/10);
	if (biomeName === 'coalmine') {
		startX = Math.floor((BIOME_PATH_FIND_WORLD_POS_X_MINES - (chunkX - getWorldCenter(isNGP)) * 512)/10);
	}
	return startX;
}

export function applyMainBiomeHack(chunkX, pixels, width, height, biomeName, isNGP) {
	// Find tile coordinates of the start pos x (coalmine will have some special hack)

	let startX = getMainBiomePathStartX(biomeName, chunkX, isNGP);
	//console.log(`Applying main biome hack for ${biomeName} at chunk ${chunkX}, startX: ${startX}`);

	for (let y = 0; y < 11; y++) {
		for (let x = startX; x < startX + 7; x++) {
			if (x < width && y < height) {
				let idx = (y * width + x) * 3;
				pixels[idx] = 0; pixels[idx+1] = 0; pixels[idx+2] = 0;
			}
		}
	}
}

// Coalmine hack
const BiomeOverlays = {
	'coalmine': { path: '../data/wang_tiles/extra_layers/coalmine.png', image: null },
};

async function preloadOverlays() {
	//let toLoad = Object.keys(BiomeOverlays).length;

	for (let key in BiomeOverlays) {
		const entry = BiomeOverlays[key];
		entry.image = await loadPNG(entry.path);
	}
}
preloadOverlays();
// TODO: Preload this with all other wang tiles

export function applyCoalmineHack(pixels, width, height, biomeName) {
	const overlay = BiomeOverlays[biomeName]?.image;
	if (!overlay || !overlay.data) {
		console.warn(`Overlay for ${biomeName} not ready!`);
		return;
	}
	// We iterate over the overlay dimensions. 
	for (let y = 0; y < Math.min(height, overlay.height); y++) {
		for (let x = 0; x < Math.min(width, overlay.width); x++) {
			const oIdx = (y * overlay.width + x) * 4;
			const r = overlay.data[oIdx];
			const g = overlay.data[oIdx + 1];
			const b = overlay.data[oIdx + 2];
			const a = overlay.data[oIdx + 3];
			if (a === 0) continue; // Skip transparent pixels

			const hex = (r << 16) | (g << 8) | b;
			const pIdx = ((y+4) * width + x) * 3;

			// Logic:
			// 1. 0x000042 -> Replace with Black (0,0,0) [Entrance/Air]
			// 2. 0xffffff -> Ignore (Keep Wang tile)
			// 3. Everything else -> Replace with White (1,1,1) [Solid/Border]
			
			if (hex === 0x000042) {
				pixels[pIdx] = 0;
				pixels[pIdx + 1] = 0;
				pixels[pIdx + 2] = 0;
			} else if (hex !== 0xffffff) {
				// Overwrite with *some* solid color to block pathfinding (does not really matter what)
				pixels[pIdx] = 1;
				pixels[pIdx + 1] = 1;
				pixels[pIdx + 2] = 1;
			}
		}
	}
}

export function undoCoalmineHack(pixels, width, height, biomeName) {
	const overlay = BiomeOverlays[biomeName]?.image;
	if (!overlay || !overlay.data) {
		console.warn(`Overlay for ${biomeName} not ready!`);
		return;
	}
	// We iterate over the overlay dimensions. 
	for (let y = 0; y < Math.min(height, overlay.height); y++) {
		for (let x = 0; x < Math.min(width, overlay.width); x++) {
			const oIdx = (y * overlay.width + x) * 4;
			const r = overlay.data[oIdx];
			const g = overlay.data[oIdx + 1];
			const b = overlay.data[oIdx + 2];
			const a = overlay.data[oIdx + 3];
			if (a === 0) continue; // Skip transparent pixels

			const hex = (r << 16) | (g << 8) | b;
			const pIdx = ((y+4) * width + x) * 3;

			// Logic:
			// 1. 0x000042 -> Replace with Black (0,0,0) [Entrance/Air]
			// 2. 0xffffff -> Ignore (Keep Wang tile)
			// 3. Everything else -> Replace with White (1,1,1) [Solid/Border]
			
			if (hex === 0x000042) {
				pixels[pIdx] = 0;
				pixels[pIdx + 1] = 0;
				pixels[pIdx + 2] = 0;
			} else if (hex !== 0xffffff) {
				// To undo, also replace these with air (matches what's in game at least)
				pixels[pIdx] = 0;
				pixels[pIdx + 1] = 0;
				pixels[pIdx + 2] = 0;
			}
		}
	}
}

// TODO: Create reusable flood fill function, I was being lazy copying the code multiple times

function clearPath(pixels, width, height, path) {
	for (let i = 0; i < path.length; i++) {
		const x = path[i].x, y = path[i].y;
		if (x >= 0 && x < width && y >= 0 && y < height) {
			const idx = (y * width + x) * 3;
			if (pixels[idx] === 0xc0 && pixels[idx+1] === 0xff && pixels[idx+2] === 0xee) {
				const selectedColor = 0x000000;
				//let totalCoffee = 0;
				//console.log(`Changing coffee pixel at (${x}, ${y}) to color ${selectedColor === 0 ? 'black' : 'white'}`);
				// Fill the whole adjacent region of coffee pixels with selected color
				const queue = [[x, y]];
				const visited = new Set();
				while (queue.length > 0) {
					//totalCoffee++;
					const [cx, cy] = queue.shift();
					let idx = (cy * width + cx) * 3;
					pixels[idx] = selectedColor;
					pixels[idx+1] = selectedColor; //selectedColor;
					pixels[idx+2] = selectedColor;
					const neighbors = [[1,0], [-1,0], [0,1], [0,-1]];
					for (const [dx, dy] of neighbors) {
						const nx = cx + dx, ny = cy + dy;
						const nidx = (ny * width + nx) * 3;
						if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited.has(`${nx},${ny}`) &&
							pixels[nidx] === 0xc0 && pixels[nidx+1] === 0xff && pixels[nidx+2] === 0xee) {
							visited.add(`${nx},${ny}`);
							queue.push([nx, ny]);
						}
					}
				}       
				//console.log(`Total coffee pixels changed: ${totalCoffee}`);
			}
		}
	}
}

// Oh, the coffee hack is actually after the pathfinding, so maybe not too important?
export function applyCoffeeHack(pixels, width, height, worldSeed) {
	let prng = new NollaPrng(0);
	prng.SetRandomFromWorldSeed(worldSeed);
	prng.Next();
	for (let y = 4; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const startIdx = (y * width + x) * 3;
			if (pixels[startIdx] === 0xc0 && pixels[startIdx+1] === 0xff && pixels[startIdx+2] === 0xee) {
				const selectedColor = prng.Next() < 0.5 ? 0xff : 0x00;
				//let totalCoffee = 0;
				//console.log(`Changing coffee pixel at (${x}, ${y}) to color ${selectedColor === 0 ? 'black' : 'white'}`);
				// Fill the whole adjacent region of coffee pixels with selected color
				const queue = [[x, y]];
				const visited = new Set();
				while (queue.length > 0) {
					//totalCoffee++;
					const [cx, cy] = queue.shift();
					let idx = (cy * width + cx) * 3;
					pixels[idx] = selectedColor;
					pixels[idx+1] = selectedColor; //selectedColor;
					pixels[idx+2] = selectedColor;
					const neighbors = [[1,0], [-1,0], [0,1], [0,-1]];
					for (const [dx, dy] of neighbors) {
						const nx = cx + dx, ny = cy + dy;
						const nidx = (ny * width + nx) * 3;
						if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited.has(`${nx},${ny}`) &&
							pixels[nidx] === 0xc0 && pixels[nidx+1] === 0xff && pixels[nidx+2] === 0xee) {
							visited.add(`${nx},${ny}`);
							queue.push([nx, ny]);
						}
					}
				}       
				//console.log(`Total coffee pixels changed: ${totalCoffee}`);
			}
		}
	}
}

export function applyRandomColors(pixels, width, height, worldSeed, ngPlus, randomColors) {
	for (const [color, options] of Object.entries(randomColors)) {
		let prng = new NollaPrng(0);
		prng.SetRandomFromWorldSeed(worldSeed + ngPlus);
		prng.Next();

		const iters = width + (worldSeed + ngPlus) - 11 * Math.floor(width / 11) - 12 * Math.floor((worldSeed + ngPlus) / 12);
		for (let i = 0; i < iters; i++) prng.Next();
		prng.Next();

		for (let y = 4; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const startIdx = (y * width + x) * 3;
				if (pixels[startIdx] === ((color >> 16) & 0xff) && pixels[startIdx+1] === ((color >> 8) & 0xff) && pixels[startIdx+2] === (color & 0xff)) {
					const selectedColor = options[Math.floor(prng.Next() * options.length)];
					//const selectedColor = options[Math.floor(prng.ProceduralRandom(x, y, worldSeed) * options.length)];
					//const selectedColor = options[Math.floor(prng.ProceduralRandom(x+11, y-21, worldSeed) * options.length)];
					//let totalChanged = 0;
					// Fill the whole adjacent region of pixels with selected color
					const queue = [[x, y]];
					const visited = new Set();
					while (queue.length > 0) {
						//totalChanged++;
						const [cx, cy] = queue.shift();
						let idx = (cy * width + cx) * 3;
						pixels[idx] = (selectedColor >> 16) & 0xff;
						pixels[idx+1] = (selectedColor >> 8) & 0xff;
						pixels[idx+2] = selectedColor & 0xff;
						const neighbors = [[1,0], [-1,0], [0,1], [0,-1]];
						for (const [dx, dy] of neighbors) {
							const nx = cx + dx, ny = cy + dy;
							const nidx = (ny * width + nx) * 3;
							if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited.has(`${nx},${ny}`) &&
								pixels[nidx] === ((color >> 16) & 0xff) && pixels[nidx+1] === ((color >> 8) & 0xff) && pixels[nidx+2] === (color & 0xff)) {
								visited.add(`${nx},${ny}`);
								queue.push([nx, ny]);
							}
						}
					}       
					//console.log(`Total random color pixels changed: ${totalChanged} to color ${selectedColor.toString(16)}`);
				}
			}
		}
	}
}

export function applyPostprocessingHacks(pixels, width, height, worldSeed, ngPlus, path, randomColors) {
	clearPath(pixels, width, height, path);
	applyCoffeeHack(pixels, width, height, worldSeed, ngPlus);
	if (randomColors) {
		applyRandomColors(pixels, width, height, worldSeed, ngPlus, randomColors);
	}
}
