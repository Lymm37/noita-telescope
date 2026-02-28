import { NollaPrng } from "./nolla_prng.js";
import { generateChest, generateGreatChest } from "./chest_generation.js";

// TODO: Not working for NG+?
export function spawnHeart(ws, ng, x, y, biome, perks={}) {
	let prng = new NollaPrng(0);
	let r = prng.ProceduralRandom(ws+ng, x, y);
	let heart_spawn_rate = 0.7;

	//console.log(`spawnHeart at (${x}, ${y}): r = ${r}`);

	if (r > heart_spawn_rate) {
		return {type: 'item', item: 'heart', x: x, y: y};
	}
	else if (r > 0.3) {
		prng.SetRandomSeed(ws+ng, x + 45, y - 2123);
		let rnd = prng.Random(1, 100);
		if (rnd <= 90 || y < 512 * 3) {
			rnd = prng.Random(1, 1000);
			//let hasSign = false;
			if (prng.Random(1, 300) == 1) {
				//hasSign = true;
			}
			if (rnd >= 1000) {
				return generateGreatChest(ws, ng, x, y, perks);
			}
			else {
				return generateChest(ws, ng, x, y, perks);
			}
		}
		else {
			rnd = prng.Random(1, 100);
			//let hasSign = false;
			if (prng.Random(1, 30) == 1) {
				//hasSign = true;
			}
			if (rnd <= 95) {
				return {type: 'enemy', enemy: 'mimic', x: x, y: y};
			}
			else {
				return {type: 'enemy', enemy: 'chest_leggy', x: x, y: y};
			}
		}
	}
	else {
		return null;
	}
}