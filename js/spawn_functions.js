import { NollaPrng } from './nolla_prng.js';
import { loadPixelScene, loadRandomPixelScene } from './pixel_scene_generation.js';
import { PIXEL_SCENE_BIOME_MAP } from './pixel_scene_config.js';
import { spawnChest } from './chest_generation.js';
import { generateWand, spawnWand, spawnSpecialWand, checkWandAltar } from './wand_generation.js';
import { spawnJar, checkPotionAltar, createPotion, spawnItem } from './potion_generation.js';
import { generateShopItem } from './spell_generator.js';
import { spawnHeart } from './heart_generation.js';
import { BIOME_SPAWN_FUNCTION_MAP } from './spawn_function_config.js';
import { BIOMES_WITH_SMALL_ALTARS, BIOME_WAND_ALTAR_OFFSET_MAP, BIOME_POTION_ALTAR_OFFSET_MAP } from './spawn_config.js';
import { generateUtilityBox } from './utility_box_generation.js';
import { getBiomeAtWorldCoordinates, roundHalfOfEven } from './utils.js';

const BIOME_TIERS = {
	'coalmine': 1,
	'coalmine_alt': 1,
	'excavationsite': 2,
	'snowcave': 3,
	'snowcastle': 3,
	'rainforest': 4,
	'rainforest_open': 4,
	'vault': 4,
	'crypt': 5,
	'the_end': 10,
	'the_sky': 10,
	// Unclear what the shop level for the tower is, seems like it can just spawn any spell, I thought it was tier 10 but maybe it's just depth-dependent (null)
	/*
	'tower_coalmine': 10,
	'tower_excavationsite': 10,
	'tower_snowcave': 10,
	'tower_snowcastle': 10,
	'tower_fungicave': 10,
	'tower_rainforest': 10,
	'tower_vault': 10,
	'tower_crypt': 10,
	*/
}

// TODO: Might still need to block out rooms for some of these?

/*
0x00ac6e: "load_pixel_scene4_alt",
0x70d79e: "load_gunpowderpool_01",
0x70d79f: "unknown_70d79f",
0x70d7a1: "load_gunpowderpool_04",
0x7868ff: "load_gunpowderpool_02",
0xc35700: "load_oiltank",
0xff0080: "load_pixel_scene2",
0xff00ff: "unknown_ff00ff",
0xff0aff: "load_pixel_scene",
*/

export function getSpawnFunctionIndex(biomeName, color) {
	if (!BIOME_SPAWN_FUNCTION_MAP[biomeName]) return null;
	const spawnFunctions = BIOME_SPAWN_FUNCTION_MAP[biomeName];
	for (let i = 0; i < spawnFunctions.length; i++) {
		if (spawnFunctions[i].color === color) {
			return i; // Ignore whether it's active here?
			//if (spawnFunctions[i].active) return i;
			//break;
		}
	}
	return null;
}

function hiisi_safe(x, y) {
	if (x >= 125 && x <= 249 && y >= 5118 && y <= 5259) return false;
	if (y > 6100) return false;
	return true;
}

// Kind of seems like they forgot to use this
/*
function vault_safe(x, y) {
	if (x >= 125 && x <= 249 && y >= 8594 && y <= 8860) return false;
	return true;
}
*/

// Might just make this cover all colors?
export function spawnSwitch(biomeData, biomeName, functionIndex, ws, ng, x, y, skipCosmeticScenes=true, perks={}) {

	// Adjust biome with edge noise
	const adjustedBiomeResults = getBiomeAtWorldCoordinates(biomeData, x, y, ng > 0);
	// Hacky to reference app but I am feeling lazy and this is easier than passing in a parameter
	// Actually this isn't working anyway, determining if it's an edge case might be hard
	/*
	if (app.excludeEdgeCases && adjustedBiomeResults.mightBeEdgeCase) {
		console.log(`Excluding spawn at (${x}, ${y}) in biome ${biomeName} due to edge noise uncertainty`);
		return null; // Don't spawn anything if this is an edge case and we're excluding them
	}
	*/
	biomeName = adjustedBiomeResults.biome;

	const spawns = BIOME_SPAWN_FUNCTION_MAP[biomeName];
	if (!spawns) {
		//console.warn(`No spawn mapping for ${biomeName}, trying to spawn at (${x}, ${y}) with function index ${functionIndex}`);
		return;
	}
	let func;
	if (functionIndex >= spawns.length) {
		//console.warn(`Function index ${functionIndex} out of bounds for biome ${biomeName}, trying to spawn at (${x}, ${y})`);
		return;
	}
	const spawn = spawns[functionIndex];
	if (spawn) {
		func = spawn.funcName;
		if (spawn.active === false) {
			return; // Inactive spawn, don't spawn anything
		}
	}
	else {
		console.warn(`No spawn function at index ${functionIndex} for biome ${biomeName}, trying to spawn at (${x}, ${y})`);
		return;
	}
	if (!func) {
		console.warn(`No spawn function at index ${functionIndex} for biome ${biomeName}, trying to spawn at (${x}, ${y})`);
		return;
	}
	const scenes = PIXEL_SCENE_BIOME_MAP[biomeName];
	const prng = new NollaPrng(0);
	prng.SetRandomSeed(ws + ng, x, y);

	// Specific biome spawn functions

	// Coalmine
	if (biomeName === "coalmine") {
		if (func === "load_pixel_scene") {
			if (prng.Random(1, 100) > 50)
				return loadRandomPixelScene(biomeData, biomeName, PIXEL_SCENE_BIOME_MAP[biomeName]["g_oiltank"], ws, ng, x, y, skipCosmeticScenes);
			else
				return loadRandomPixelScene(biomeData, biomeName, PIXEL_SCENE_BIOME_MAP[biomeName]["g_pixel_scene_01"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "load_oiltank") {
			if (prng.Random(1, 100) <= 50) {
				return loadRandomPixelScene(biomeData, biomeName, scenes["g_oiltank"], ws, ng, x, y, skipCosmeticScenes);
			}
			else {
				return loadRandomPixelScene(biomeData, biomeName, scenes["g_pixel_scene_01"], ws, ng, x, y, skipCosmeticScenes);
			}
		}
		else if (func === "load_oiltank_alt") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_oiltank_alt"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "spawn_trapwand") {
			const options = ["premade_1", "premade_2", "premade_3", "premade_4", "premade_5", "premade_6", "premade_7", "premade_8", "premade_9", "wand_level_01"];
			let rnd = prng.Random(1, options.length);
			let wandType = options[rnd-1];
			return generateWand(ws, ng, x, y, wandType, perks);
		}
		else if (func === "spawn_bbqbox") {
			//prng.SetRandomSeed(x, y);
			if (prng.Random(1, 100) <= 99) {
				//console.log('BBQ box spawning heart');
				// Doesn't actually call spawnHeart, just directly spawns a heart?
				// TODO: Doubt?
				return spawnHeart(ws, ng, x+10, y+10, biomeName, perks); // {type: 'item', item: 'heart', x: x+10, y: y+10};
			}
			else {
				return spawnJar(x, y);
			}
		}
		else if (func === "spawn_swing_puzzle_target") {
			return spawnChest(ws, ng, x - 75, y - 70, false, perks);
		}
		else if (func === "spawn_oiltank_puzzle") {
			// TODO: Wand from this puzzle?
			//console.log("Spawning oiltank puzzle at", x, y);
			const materials = ["water", "blood", "alcohol", "radioactive_liquid", "water_salt", "slime", "water", "blood", "alcohol", "radioactive_liquid", "water_salt", "slime", "magic_liquid_berserk", "magic_liquid_charm", "oil"];
			const choice = 1 + (materials.length - 1) * Math.floor(prng.ProceduralRandom(ws + ng, x, y));
			console.log(`Oiltank puzzle material choice: ${materials[choice-1]}`); // Material not actually relevant to the puzzle
			// Might be better to recolor the pixel scene with it instead, even though it technically spawns a material spawner and not a pool of the material
			return spawnChest(ws, ng, x, y - 25, false, perks);
		}
		else if (func === "spawn_receptacle_oil") {
			return spawnSpecialWand(ws, ng, x + 72, y - 22, "ruusu");
		}
		else if (func === "spawn_potion" || func === "spawn_props3") {
			let r = prng.Next() * 0.4; //prng.ProceduralRandom(ws + ng, x, y) * 0.4;
			if (r > 0.1) {
				// No idea why this offset works, it was supposed to be x, y+5 based on the Lua but this is what works...
				return createPotion(ws, ng, x+5, y, 'normal');
			}
			else {
				return null;
			}
		}
	}
	else if (biomeName === "excavationsite") {
		if (func === "load_puzzleroom") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_puzzleroom"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "load_gunpowderpool_01") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_gunpowderpool_01"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "load_gunpowderpool_02") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_gunpowderpool_02"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "load_gunpowderpool_03") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_gunpowderpool_03"], ws, ng, x-3, y+3, skipCosmeticScenes);
		}
		else if (func === "load_gunpowderpool_04") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_gunpowderpool_04"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "spawn_meditation_cube") {
			let rnd = prng.Random(1, 100);
			if (rnd > 96) {
				return {type: 'item', item: 'meditation_cube', x: x, y: y};
			}
		}
		else if (func === "spawn_receptacle") {
			return spawnSpecialWand(ws, ng, x, y - 25, "kiekurakeppi");
		}
	}
	else if (biomeName === "snowcave") {
		if (func === "load_puzzle_capsule") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_puzzle_capsule"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "load_puzzle_capsule_b") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_puzzle_capsule_b"], ws, ng, x-50, y-230, skipCosmeticScenes);
		}
		else if (func === "load_acidtank_right") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_acidtank_right"], ws, ng, x-12, y-12, skipCosmeticScenes);
		}
		else if (func === "load_acidtank_left") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_acidtank_left"], ws, ng, x-252, y-12, skipCosmeticScenes);
		}
		else if (func === "spawn_buried_eye_teleporter") {
			return {type: 'item', item: 'buried_eye_teleporter', x: x, y: y};
		}
		else if (func === "spawn_receptacle") {
			return spawnSpecialWand(ws, ng, x, y - 85, "valtikka");
		}
	}
	else if (biomeName === "snowcastle") {
		if (func === "load_pixel_scene" || func === "load_pixel_scene2") {
			if (!hiisi_safe(x, y)) return null;
			// Handled by default otherwise
		}
		if (func === "spawn_brimstone") {
			return {type: 'item', item: 'kiuaskivi', x: x, y: y};
		}
		else if (func === "spawn_vasta_or_vihta") {
			if(x > 190) {
				return spawnSpecialWand(ws, ng, x, y, "vasta");
			}
			else {
				return spawnSpecialWand(ws, ng, x, y, "vihta");
			}
		}
		else if (func === "load_chamfer_top_r") {
			if (!hiisi_safe(x, y)) return null;
			return loadPixelScene(biomeData, biomeName, "chamfer_top_r", ws, ng, x-10, y, skipCosmeticScenes);
		}
		else if (func === "load_chamfer_top_l") {
			if (!hiisi_safe(x, y)) return null;
			return loadPixelScene(biomeData, biomeName, "chamfer_top_l", ws, ng, x-1, y, skipCosmeticScenes);
		}
		else if (func === "load_chamfer_bottom_r") {
			if (!hiisi_safe(x, y)) return null;
			return loadPixelScene(biomeData, biomeName, "chamfer_bottom_r", ws, ng, x-10, y-20, skipCosmeticScenes);
		}
		else if (func === "load_chamfer_bottom_l") {
			if (!hiisi_safe(x, y)) return null;
			return loadPixelScene(biomeData, biomeName, "chamfer_bottom_l", ws, ng, x-1, y-20, skipCosmeticScenes);
		}
		else if (func === "load_chamfer_inner_top_r") {
			if (!hiisi_safe(x, y)) return null;
			return loadPixelScene(biomeData, biomeName, "chamfer_inner_top_r", ws, ng, x-10, y, skipCosmeticScenes);
		}
		else if (func === "load_chamfer_inner_top_l") {
			if (!hiisi_safe(x, y)) return null;
			return loadPixelScene(biomeData, biomeName, "chamfer_inner_top_l", ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "load_chamfer_inner_bottom_r") {
			if (!hiisi_safe(x, y)) return null;
			return loadPixelScene(biomeData, biomeName, "chamfer_inner_bottom_r", ws, ng, x-10, y-20, skipCosmeticScenes);
		}
		else if (func === "load_chamfer_inner_bottom_l") {
			if (!hiisi_safe(x, y)) return null;
			return loadPixelScene(biomeData, biomeName, "chamfer_inner_bottom_l", ws, ng, x, y-20, skipCosmeticScenes);
		}
		else if (func === "load_pillar_filler") {
			if (!hiisi_safe(x, y)) return null;
			return loadPixelScene(biomeData, biomeName, "pillar_filler_01", ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "load_pillar_filler_tall") {
			if (!hiisi_safe(x, y)) return null;
			return loadPixelScene(biomeData, biomeName, "pillar_filler_tall_01", ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "load_pod_large") {
			if (!hiisi_safe(x, y)) return null;
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pods_large"], ws, ng, x, y-50, skipCosmeticScenes);
		}
		else if (func === "load_pod_small_l") {
			if (!hiisi_safe(x, y)) return null;
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pods_small_l"], ws, ng, x-30, y-40, skipCosmeticScenes);
		}
		else if (func === "load_pod_small_r") {
			if (!hiisi_safe(x, y)) return null;
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pods_small_r"], ws, ng, x-10, y-40, skipCosmeticScenes);
		}
		else if (func === "spawn_potion" || func === "spawn_props3") {
			// 0.1 nothing, 0.3 green, 0.3 red, 0.3 blue, 0.2 yellow, 0.1 alcohol, 0.025 potion
			let r = prng.Next() * 1.325;
			if (r > 1.3) {
				// No idea why this offset works, it was supposed to be x, y+5 based on the Lua but this is what works...
				return createPotion(ws, ng, x+5, y, 'normal');
			}
			else if (r > 1.2) {
				return {type: 'item', item: 'potion', material: 'alcohol', x: x+5, y: y};
			}
			else {
				return null;
			}
		}
	}
	else if (biomeName === "rainforest" || biomeName === "rainforest_open") {
		// Note this is not implemented for the vault, even though the function exists
		if (func === "spawn_dragonspot") {
			return {type: 'enemy', enemy: 'dragon', x: x, y: y};
		}
	}
	else if (biomeName === "vault" || biomeName === "vault_frozen") {
		if (func === "load_pixel_scene_wide") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pixel_scene_wide"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "load_pixel_scene_tall") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pixel_scene_tall"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "spawn_stains") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_stains"], ws, ng, x-10, y, skipCosmeticScenes);
		}
		else if (func === "spawn_stains_ceiling") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_stains_ceiling"], ws, ng, x-20, y-10, skipCosmeticScenes);
		}
		else if (func === "spawn_laser_trap") {
			return loadPixelScene(biomeData, biomeName, "hole", ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "spawn_lab_puzzle") {
			//console.log("Spawning lab puzzle at", x, y);
			const type_a = ["poly", "tele", "charm", "berserk"];
			const type_b = ["protect", "worm", "invis", "speed"];
			const firstMaterial = prng.Random(1, type_a.length);
			const secondMaterial = prng.Random(1, type_b.length);
			const materials = [type_a[firstMaterial-1], type_b[secondMaterial-1]];
			// TODO: Could make these a bit more readable
			const r = prng.ProceduralRandom(ws + ng, x, y);
			let wand;
			if (r > 0.3) {
				wand = spawnSpecialWand(ws, ng, x+70, y+10, "arpaluu");
			}
			else {
				wand = spawnSpecialWand(ws, ng, x+70, y+10, "varpuluuta");
			}
			return {
				type: 'vault_puzzle',
				materials: materials,
				items: [wand],
				x: x+70,
				y: y+10,
			};
		}
		else if (func === "spawn_pipes_hor") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pipes_hor"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "spawn_pipes_ver") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pipes_ver"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "spawn_pipes_turn_right") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pipes_turn_right"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "spawn_pipes_turn_left") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pipes_turn_left"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "spawn_pipes_cross") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pipes_cross"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "spawn_pipes_big_hor") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pipes_big_hor"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "spawn_pipes_big_ver") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pipes_big_ver"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "spawn_pipes_big_turn_right") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pipes_big_turn_right"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "spawn_pipes_big_turn_left") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pipes_big_turn_left"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (func === "load_catwalk") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_catwalks"], ws, ng, x, y-20, skipCosmeticScenes);
		}
	}
	else if (biomeName === "crypt" || biomeName === "wizardcave") {
		if (func === "load_beam") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_beam"], ws, ng, x, y-65, skipCosmeticScenes);
		}
		else if (func === "load_cavein") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_cavein"], ws, ng, x-60, y-10, skipCosmeticScenes);
		}
	}
	else if (biomeName === "liquidcave") {
		if (func === "load_pixel_scene") {
			// Took me way too long to realize this one has a custom offset
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pixel_scene_01"], ws, ng, x-5, y-3, skipCosmeticScenes);
		}
	}
	else if (biomeName === "the_end" || biomeName === "the_sky") {
		if (func === "spawn_heart" || func === "spawn_potions" || func === "spawn_wands" || func === "spawn_potion_altar") {
			// Hell specifically disables these function despite having spawn pixels for hearts/chests
			// Note that this does not apply to the hell version of the tower, which actually can spawn hearts (from what I have seen)
			return null;
		}
		else if (func === "spawn_shopitem") {
			if (prng.Random(1, 50) === 1) {
				return generateShopItem(ws, ng, x, y, BIOME_TIERS[biomeName], 0);
			}
			else {
				return null;
			}
		}
		else if (func === "spawn_specialshop") {
			return generateShopItem(ws, ng, x, y, BIOME_TIERS[biomeName], 0);
		}
	}
	else if (biomeName === "biome_watchtower" || biomeName === "biome_barren" || biomeName === "biome_potion_mimics" || biomeName === "biome_darkness" || biomeName === "biome_boss_sky") {
		// I thought these would make cool overlaps but I think they're not actually possible at all, the cloudscape doesn't have much, and the watchtower isn't in NG+, and even if it was it wouldn't overlap with any of these
		/*
		if (func === "spawn_boss") {
			if (x < 16000 && x > -16000) {
				return {type: 'enemy', enemy: 'kivi', x: x, y: y};
			}
			else {
				return null;
			}
		}
		else if (func === "spawn_boss_phase2_marker") {
			if (x < 16000 && x > -16000) {
				return {type: 'enemy', enemy: 'kummitus', x: x+7, y: y};
			}
			else {
				return null;
			}
		}
		else if (func === "spawn_potion_mimic_empty") {
			if (x < 16000 && x > -16000) {
				return {type: 'enemy', enemy: 'potion_mimic_empty', x: x, y: y};
			}
			else {
				return null;
			}
		}
		*/
		if (func === "spawn_potion_mimic") {
			if (x < 16000 && x > -16000) {
				return {type: 'item', item: 'mimic_potion', x: x, y: y};
			}
			else {
				return null;
			}
		}
		else if (func === "spawn_potion_beer") {
			return {type: 'item', item: 'potion', material: 'beer', x: x, y: y};
		}
		else if (func === "spawn_potion_milk") {
			return {type: 'item', item: 'potion', material: 'milk', x: x, y: y};
		}
		else if (func === "spawn_potions" || func === "spawn_wands") {
			return null; // disabled
		}
	}

	// Default functions come after biome-specific ones
	if (func === "spawn_shopitem") {
		// TODO: The default version of this assumes tier 10, but it's not clear which biomes that would apply to.
		// Also this behavior is overwritten in some weird places like snowchasm
		return generateShopItem(ws, ng, x, y, BIOME_TIERS[biomeName], 0);
	}
	// Enemies (TODO: At minimum need taikasauva)
	else if (func === "spawn_small_enemies") {
		// In general should use enemy config or something for the biome enemy data
		// However right now I only care about taikasauva
		if (biomeName === "wandcave") {
			let r = prng.Next() * 0.4;
			if (r >= 0.3) {
				let offsetX = 5;
				let offsetY = 5;
				let count = 1 + prng.ProceduralRandom(ws + ng, x+offsetX, y+offsetY);
				let wand;
				for (let i = 1; i <= count; i++) {
					let px = x + offsetX - 4 + prng.ProceduralRandom(ws + ng, x+i+offsetX, y+offsetY) * 8;
					let py = y + offsetY - 4 + prng.ProceduralRandom(ws + ng, x+i+offsetX, y+offsetY) * 8;
					wand = generateWand(ws, ng, roundHalfOfEven(px), roundHalfOfEven(py), "wand_level_03", perks);
				}
				if (wand) {
					wand['name'] = "Taikasauva";
				}
				return wand;
			}
		}
	}
	/*
	else if (func === "spawn_big_enemies") {

	}
	else if (func === "spawn_unique_enemy") {

	}
	else if (func === "spawn_unique_enemy2") {
	
	}
	else if (func === "spawn_unique_enemy3") {

	}
	*/
	// Props
	/*
	else if (func === "spawn_props") {

	}
	else if (func === "spawn_props2") {

	}
	*/
	// Used for potions in some areas (potion laboratory in mines, hiisi base bar, as implemented above), other props are not interesting
	/*
	else if (func === "spawn_props3") {

	}
	*/
	/*
	else if (func === "spawn_lamp") {

	}
	else if (func === "spawn_ghostlamp") {

	}
	*/
	// Kummitus spawns (might be nice, though we can't really predict the bones wands)
	/*
	else if (func === "spawn_candles") {

	}
	else if (func === "spawn_apparition") {

	}
	*/
	// Other junk I don't care about
	/*
	else if (func === "spawn_portal") {

	}
	else if (func === "spawn_end_portal") {

	}
	else if (func === "spawn_orb") {

	}
	else if (func === "spawn_perk") {

	}
	else if (func === "spawk_all_perks") {

	}
	else if (func === "spawn_wand_trap") {

	}
	else if (func === "spawn_wand_trap_ignite") {

	}
	else if (func === "spawn_wand_trap_electricity_source") {

	}
	else if (func === "spawn_wand_trap_electricity") {

	}
	else if (func === "spawn_moon") {

	}
	else if (func === "spawn_collapse") {

	}
	*/
	// Wand altar (just called "items")
	else if (func === "spawn_wand_altar" || func === "spawn_items") {
		// TODO: Block spawn for specific biomes where it's explicitly overwritten to not generate, low priority since it would require specific overlaps
		const checkResult = checkWandAltar(ws, ng, x, y, biomeName);
		if (checkResult === 'utility_box') {
			return generateUtilityBox(ws, ng, x, y);
		}
		else if (checkResult) {
			let offsetX = -10;
			let offsetY = -17;
			if (BIOME_WAND_ALTAR_OFFSET_MAP[biomeName]) {
				offsetX = BIOME_WAND_ALTAR_OFFSET_MAP[biomeName].x;
				offsetY = BIOME_WAND_ALTAR_OFFSET_MAP[biomeName].y;
			}
			if (BIOMES_WITH_SMALL_ALTARS.includes(biomeName)) {
				// Small altar
				return loadPixelScene(biomeData, biomeName, "wand_altar_vault", ws, ng, x+offsetX, y+offsetY, skipCosmeticScenes);
			}
			else {
				// Normal size altar
				return loadPixelScene(biomeData, biomeName, "wand_altar", ws, ng, x+offsetX, y+offsetY, skipCosmeticScenes);
			}
		}
		else {
			return null;
		}
	}
	else if (func === "spawn_wand" || func === "spawn_wands") {
		return spawnWand(ws, ng, x, y, biomeName, perks);
	}
	else if (func === "spawn_potion_altar") {
		const checkResult = checkPotionAltar(ws, ng, x, y, biomeName);
		if (checkResult) {
			let offsetX = -5;
			let offsetY = -15;
			if (BIOME_POTION_ALTAR_OFFSET_MAP[biomeName]) {
				offsetX = BIOME_POTION_ALTAR_OFFSET_MAP[biomeName].x;
				offsetY = BIOME_POTION_ALTAR_OFFSET_MAP[biomeName].y;
			}
			if (BIOMES_WITH_SMALL_ALTARS.includes(biomeName)) {
				// Small altar
				return loadPixelScene(biomeData, biomeName, "potion_altar_vault", ws, ng, x+offsetX, y+offsetY, skipCosmeticScenes);
			}
			else {
				// Normal size altar
				return loadPixelScene(biomeData, biomeName, "potion_altar", ws, ng, x+offsetX, y+offsetY, skipCosmeticScenes);
			}
		}
		else {
			return null;
		}
	}
	else if (func === "spawn_potion" || func === "spawn_potions") {
		return spawnItem(ws, ng, x, y, biomeName, perks);
	}
	else if (func === "spawn_heart") {
		return spawnHeart(ws, ng, x, y, biomeName, perks);
	}
	// Not technically a default spawn function, used for mines and tower
	else if (func === "spawn_chest") {
		// Note *only* tower has the higher GTC rate without greed curse
		return spawnChest(ws, ng, x, y, biomeName.includes('tower'), perks);
	}
	// Also not technically default, used for mines and snowy depths
	else if (func === "load_altar") {
		//console.log("Spawning altar pixel scene at", x, y);
		return loadPixelScene(biomeData, biomeName, "trailer_altar", ws, ng, x-92, y-96, skipCosmeticScenes);
	}
	else if (func === "spawn_treasure") {
		// TODO: This is probably better as an isolated spell but it's easier to set up as an item
		return {type: 'item', item: 'treasure', x: x, y: y};
	}
	else if (func === "spawn_specialshop") {
		// Apparently this is broken and doesn't actually spawn the spells, instead it just gets a Lua error.
		/*
		console.log("Spawning special shop at", x, y);
		if (y > -3000 && y < 1000) {
			return generateShopItem(ws, ng, x, y, 0, 0);
		}
		else {
			return generateShopItem(ws, ng, x, y, 10, 0);
		}
		*/
	}
	else if (func === "spawn_music_machine") {
		return {type: 'item', item: 'music_machine', x: x, y: y};
	}
	// Default pixel scenes (technically only 1 and 2 are, but adding the other reused ones for convenience here)
	if (PIXEL_SCENE_BIOME_MAP[biomeName]) {
		if (PIXEL_SCENE_BIOME_MAP[biomeName]["g_pixel_scene_01"] && func === "load_pixel_scene") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pixel_scene_01"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (PIXEL_SCENE_BIOME_MAP[biomeName]["g_pixel_scene_01_alt"] && func === "load_pixel_scene_alt") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pixel_scene_01_alt"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (PIXEL_SCENE_BIOME_MAP[biomeName]["g_pixel_scene_02"] && func === "load_pixel_scene2") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pixel_scene_02"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (PIXEL_SCENE_BIOME_MAP[biomeName]["g_pixel_scene_03"] && func === "load_pixel_scene3") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pixel_scene_03"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (PIXEL_SCENE_BIOME_MAP[biomeName]["g_pixel_scene_04"] && func === "load_pixel_scene4") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pixel_scene_04"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (PIXEL_SCENE_BIOME_MAP[biomeName]["g_pixel_scene_04_alt"] && func === "load_pixel_scene4_alt") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pixel_scene_04_alt"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (PIXEL_SCENE_BIOME_MAP[biomeName]["g_pixel_scene_05"] && func === "load_pixel_scene5") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pixel_scene_05"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (PIXEL_SCENE_BIOME_MAP[biomeName]["g_pixel_scene_05b"] && func === "load_pixel_scene5b") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pixel_scene_05b"], ws, ng, x, y, skipCosmeticScenes);
		}
		else if (PIXEL_SCENE_BIOME_MAP[biomeName]["g_pixel_scene_05_alt"] && func === "load_pixel_scene5_alt") {
			return loadRandomPixelScene(biomeData, biomeName, scenes["g_pixel_scene_05_alt"], ws, ng, x, y, skipCosmeticScenes);
		}
	}
	return null;
}