import { NollaPrng } from "./nolla_prng.js";
import { GetRandomActionWithType } from "./spell_generator.js";
import { MODIFIER, PROJECTILE, STATIC_PROJECTILE, UTILITY } from "./spells.js";
import { getWorldSize, roundHalfOfEven, shuffleTable } from "./utils.js";

export const PERKS = [
  {
    "id": "CRITICAL_HIT",
    "name": "Critical Hit +",
    "stackable": true,
    "usable_by_enemies": true
  },
  {
    "id": "BREATH_UNDERWATER",
    "name": "Breathless",
    "stackable": true,
    "stackable_is_rare": true,
    "usable_by_enemies": true
  },
  {
    "id": "EXTRA_MONEY",
    "name": "Greed",
    "stackable": true
  },
  {
    "id": "EXTRA_MONEY_TRICK_KILL",
    "name": "Trick Greed",
    "stackable": true
  },
  {
    "id": "GOLD_IS_FOREVER",
    "name": "Gold Is Forever",
    "stackable": false
  },
  {
    "id": "TRICK_BLOOD_MONEY",
    "name": "Trick Blood Money",
    "stackable": false
  },
  {
    "id": "EXPLODING_GOLD",
    "name": "Exploding Gold",
    "stackable": true,
    "stackable_is_rare": true,
    "stackable_maximum": 6,
    "max_in_perk_pool": 1
  },
  {
    "id": "HOVER_BOOST",
    "name": "Strong Levitation", // AI Suggestion: Hoverier Fast lmao
    "stackable": true,
    "max_in_perk_pool": 1
  },
  {
    "id": "FASTER_LEVITATION",
    "name": "Faster Levitation",
    "stackable": true,
    "max_in_perk_pool": 1
  },
  {
    "id": "MOVEMENT_FASTER",
    "name": "Faster Movement",
    "stackable": true,
    "max_in_perk_pool": 2,
    "usable_by_enemies": true
  },
  {
    "id": "STRONG_KICK",
    "name": "Never Skip Leg Day",
    "stackable": true,
    "max_in_perk_pool": 1
  },
  {
    "id": "TELEKINESIS",
    "name": "Telekinetic Kick",
    "stackable": false
  },
  {
    "id": "REPELLING_CAPE",
    "name": "Repelling Cape",
    "stackable": true,
    "stackable_is_rare": true,
    "stackable_maximum": 8,
    "max_in_perk_pool": 2,
    "usable_by_enemies": true
  },
  {
    "id": "EXPLODING_CORPSES",
    "name": "Exploding Corpses",
    "remove_other_perks": ["PROTECTION_EXPLOSION"],
    "stackable": false,
  },
  {
    "id": "SAVING_GRACE",
    "name": "Saving Grace",
    "stackable": false,
    "usable_by_enemies": true
  },
  {
    "id": "INVISIBILITY",
    "name": "Invisibility",
    "stackable": false,
    "usable_by_enemies": true
  },
  {
    "id": "GLOBAL_GORE",
    "name": "More Blood",
    "stackable": true,
    "max_in_perk_pool": 1
  },
  {
    "id": "REMOVE_FOG_OF_WAR",
    "name": "All-Seeing Eye",
    "stackable": false
  },
  {
    "id": "LEVITATION_TRAIL",
    "name": "Levitation Trail",
    "stackable": true,
    "stackable_is_rare": true,
    "max_in_perk_pool": 2
  },
  {
    "id": "VAMPIRISM",
    "name": "Vampirism",
    "stackable": false
  },
  {
    "id": "EXTRA_HP",
    "name": "Extra Health",
    "stackable": true,
    "max_in_perk_pool": 3,
    "one_off_effect": true,
    "usable_by_enemies": true
  },
  {
    "id": "HEARTS_MORE_EXTRA_HP",
    "name": "Stronger Hearts",
    "stackable": true,
    "stackable_maximum": 9,
    "max_in_perk_pool": 2,
    "stackable_is_rare": true
  },
  {
    "id": "GLASS_CANNON",
    "name": "Glass Cannon",
    "stackable": true,
    "stackable_is_rare": true,
    "stackable_maximum": 2,
    "max_in_perk_pool": 2,
    "usable_by_enemies": true
  },
  {
    "id": "LOW_HP_DAMAGE_BOOST",
    "name": "Living on the Edge",
    "stackable": true,
    "max_in_perk_pool": 2,
    "stackable_is_rare": true,
    "usable_by_enemies": true
  },
  {
    "id": "RESPAWN",
    "name": "Extra Life",
    "one_off_effect": true,
    "do_not_remove": true,
    "stackable": true,
    "stackable_is_rare": true
  },
  {
    "id": "WORM_ATTRACTOR",
    "name": "Worm Attractor",
    "stackable": true,
    "stackable_is_rare": true,
    "usable_by_enemies": true
  },
  {
    "id": "RADAR_ENEMY",
    "name": "Enemy Radar",
    "stackable": false
  },
  {
    "id": "FOOD_CLOCK",
    "name": "Eat Your Vegetables",
    "stackable": false
  },
  {
    "id": "IRON_STOMACH",
    "name": "Iron Stomach",
    "stackable": false
  },
  {
    "id": "WAND_RADAR",
    "name": "Wand Radar",
    "stackable": false
  },
  {
    "id": "ITEM_RADAR",
    "name": "Item Radar",
    "stackable": false
  },
  {
    "id": "MOON_RADAR",
    "name": "Moon Radar",
    "not_in_default_perk_pool": true,
    "stackable": false
  },
  {
    "id": "MAP",
    "name": "Spatial Awareness",
    "not_in_default_perk_pool": true,
    "stackable": false
  },
  {
    "id": "PROTECTION_FIRE",
    "name": "Fire Immunity",
    "stackable": false,
    "usable_by_enemies": true
  },
  {
    "id": "PROTECTION_RADIOACTIVITY",
    "name": "Toxic Immunity",
    "stackable": false,
    "usable_by_enemies": true
  },
  {
    "id": "PROTECTION_EXPLOSION",
    "name": "Explosion Immunity",
    "stackable": false,
    "usable_by_enemies": true
  },
  {
    "id": "PROTECTION_MELEE",
    "name": "Melee Immunity",
    "stackable": false,
    "usable_by_enemies": true
  },
  {
    "id": "PROTECTION_ELECTRICITY",
    "name": "Electricity Immunity",
    "stackable": false,
    "usable_by_enemies": true
  },
  {
    "id": "TELEPORTITIS",
    "name": "Teleportitis",
    "stackable": false,
    "usable_by_enemies": true
  },
  {
    "id": "TELEPORTITIS_DODGE",
    "name": "Teleportitis Dodge",
    "stackable": false
  },
  {
    "id": "STAINLESS_ARMOUR",
    "name": "Stainless Armour",
    "stackable": true,
    "stackable_is_rare": true,
    "usable_by_enemies": true
  },
  {
    "id": "EDIT_WANDS_EVERYWHERE",
    "name": "Tinker with Wands Everywhere",
    "stackable": false
  },
  {
    "id": "NO_WAND_EDITING",
    "name": "No Wand Tinkering",
    "stackable": false
  },
  {
    "id": "WAND_EXPERIMENTER",
    "name": "Wand Experimenter",
    "stackable": true,
    "stackable_is_rare": true
  },
  {
    "id": "ADVENTURER",
    "name": "Healthy Exploration",
    "stackable": false
  },
  {
    "id": "ABILITY_ACTIONS_MATERIALIZED",
    "name": "Bombs Materialized",
    "stackable": false
  },
  {
    "id": "PROJECTILE_HOMING",
    "name": "Homing Shots",
    "stackable": false,
    "usable_by_enemies": true
  },
  {
    "id": "PROJECTILE_HOMING_SHOOTER",
    "name": "Boomerang Spells",
    "stackable": false,
    "usable_by_enemies": true
  },
  {
    "id": "UNLIMITED_SPELLS",
    "name": "Unlimited Spells",
    "stackable": false
  },
  {
    "id": "FREEZE_FIELD",
    "name": "Freeze Field",
    "stackable": false,
    "usable_by_enemies": true
  },
  {
    "id": "FIRE_GAS",
    "name": "Gas Fire",
    "stackable": false,
    "usable_by_enemies": true
  },
  {
    "id": "DISSOLVE_POWDERS",
    "name": "Dissolve Powders",
    "stackable": false,
    "usable_by_enemies": true
  },
  {
    "id": "BLEED_SLIME",
    "name": "Slime Blood",
    "stackable": true,
    "stackable_is_rare": true,
    "usable_by_enemies": true
  },
  {
    "id": "BLEED_OIL",
    "name": "Oil Blood",
    "stackable": false,
    "remove_other_perks": ["PROTECTION_FIRE"],
    "usable_by_enemies": true
  },
  {
    "id": "BLEED_GAS",
    "name": "Gas Blood",
    "stackable": false,
    "usable_by_enemies": true,
    "remove_other_perks": ["PROTECTION_RADIOACTIVITY"]
  },
  {
    "id": "SHIELD",
    "name": "Permanent Shield",
    "stackable": true,
    "stackable_how_often_reappears": 10,
    "stackable_maximum": 5,
    "max_in_perk_pool": 2,
    "usable_by_enemies": true
  },
  {
    "id": "REVENGE_EXPLOSION",
    "name": "Revenge Explosion",
    "stackable": true,
    "stackable_is_rare": true,
    "usable_by_enemies": true
  },
  {
    "id": "REVENGE_TENTACLE",
    "name": "Revenge Tentacle",
    "stackable": true,
    "stackable_is_rare": true,
    "usable_by_enemies": true
  },
  {
    "id": "REVENGE_RATS",
    "name": "Revenge Rats",
    "stackable": false
  },
  {
    "id": "REVENGE_BULLET",
    "name": "Revenge Bullets",
    "stackable": true,
    "stackable_is_rare": true,
    "usable_by_enemies": true
  },
  {
    "id": "ATTACK_FOOT",
    "name": "Lukki Mutation",
    "stackable": true,
    "stackable_maximum": 3,
    "max_in_perk_pool": 2,
    "stackable_is_rare": true,
    "usable_by_enemies": true
  },
  {
    "id": "LEGGY_FEET",
    "name": "Leggy Mutation",
    "stackable": true,
    "stackable_is_rare": true,
    "usable_by_enemies": true,
    "not_in_default_perk_pool": true
  },
  {
    "id": "PLAGUE_RATS",
    "name": "Plague Rats",
    "stackable": true,
    "stackable_is_rare": true,
    "stackable_maximum": 5,
    "max_in_perk_pool": 2
  },
  {
    "id": "VOMIT_RATS",
    "name": "Spontaneous Generation",
    "stackable": false
  },
  {
    "id": "CORDYCEPS",
    "name": "Cordyceps",
    "stackable": false
  },
  {
    "id": "MOLD",
    "name": "Fungal Colony",
    "stackable": false
  },
  {
    "id": "WORM_SMALLER_HOLES",
    "name": "Feared By Worms",
    "stackable": false,
  },
  {
    "id": "PROJECTILE_REPULSION",
    "name": "Projectile Repulsion Field",
    "stackable": true,
    "stackable_is_rare": true,
    "usable_by_enemies": true,
  },
  {
    "id": "RISKY_CRITICAL",
    "name": "Close Call",
    "stackable": true,
    "stackable_is_rare": true,
    "stackable_maximum": 3,
    "max_in_perk_pool": 2
  },
  {
    "id": "FUNGAL_DISEASE",
    "name": "Fungal Disease",
    "stackable": true,
    "stackable_is_rare": true,
    "stackable_maximum": 3,
    "max_in_perk_pool": 2
  },
  {
    "id": "PROJECTILE_SLOW_FIELD",
    "name": "Projectile Slower",
    "stackable": true,
    "stackable_is_rare": true,
    "usable_by_enemies": true,
  },
  {
    "id": "PROJECTILE_REPULSION_SECTOR",
    "name": "Projectile Repulsion Sector",
    "stackable": true,
    "stackable_is_rare": true
  },
  {
    "id": "PROJECTILE_EATER_SECTOR",
    "name": "Projectile Eater",
    "stackable": false
  },
  {
    "id": "ORBIT",
    "name": "Phasing",
    "usable_by_enemies": true,
    "stackable": true,
    "max_in_perk_pool": 2,
    "stackable_how_often_reappears": 10
  },
  {
    "id": "ANGRY_GHOST",
    "name": "Angry Ghost",
    "usable_by_enemies": true,
    "stackable": true
  },
  {
    "id": "HUNGRY_GHOST",
    "name": "Hungry Ghost",
    "usable_by_enemies": true,
    "stackable": true,
    "stackable_maximum": 5,
    "max_in_perk_pool": 2
  },
  {
    "id": "DEATH_GHOST",
    "name": "Mournful Spirit",
    "stackable": true,
    "stackable_is_rare": true
  },
  {
    "id": "HOMUNCULUS",
    "name": "Homunculus",
    "stackable": true,
    "stackable_maximum": 10,
    "max_in_perk_pool": 2
  },
  {
    "id": "LUKKI_MINION",
    "name": "Lukki Minion",
    "stackable": false
  },
  {
    "id": "ELECTRICITY",
    "name": "Electricity",
    "stackable": false,
    "remove_other_perks": ["PROTECTION_ELECTRICITY"],
    "usable_by_enemies": true
  },
  {
    "id": "ATTRACT_ITEMS",
    "name": "Attract Gold",
    "usable_by_enemies": false,
    "stackable": true,
    "stackable_maximum": 6,
    "max_in_perk_pool": 1
  },
  {
    "id": "EXTRA_KNOCKBACK",
    "name": "Extra Knockback On Spells",
    "stackable": true,
    "stackable_is_rare": true,
    "usable_by_enemies": true
  },
  {
    "id": "LOWER_SPREAD",
    "name": "Concentrated Spells",
    "stackable": true,
    "stackable_is_rare": true,
    "usable_by_enemies": true
  },
  {
    "id": "LOW_RECOIL",
    "name": "Low Recoil",
    "stackable": false
  },
  {
    "id": "BOUNCE",
    "name": "Bouncing Spells",
    "stackable": false,
    "usable_by_enemies": true
  },
  {
    "id": "FAST_PROJECTILES",
    "name": "Faster Projectiles",
    "usable_by_enemies": true,
    "stackable": false
  },
  {
    "id": "ALWAYS_CAST",
    "name": "Always Cast",
    "stackable": true,
    "one_off_effect": true
  },
  {
    "id": "EXTRA_MANA",
    "name": "High Mana, Low Capacity",
    "stackable": true,
    "one_off_effect": true
  },
  {
    "id": "NO_MORE_SHUFFLE",
    "name": "No More Shuffle",
    "stackable": false
  },
  {
    "id": "NO_MORE_KNOCKBACK",
    "name": "No More Knockback",
    "stackable": false
  },
  {
    "id": "DUPLICATE_PROJECTILE",
    "name": "Projectile Duplication",
    "stackable": true,
    "usable_by_enemies": true
  },
  {
    "id": "FASTER_WANDS",
    "name": "Faster Wands",
    "stackable": true,
    "one_off_effect": true
  },
  {
    "id": "EXTRA_SLOTS",
    "name": "Extra Wand Capacity",
    "stackable": true,
    "one_off_effect": true
  },
  {
    "id": "CONTACT_DAMAGE",
    "name": "Contact Damage",
    "stackable": false,
    "usable_by_enemies": true
  },
  {
    "id": "EXTRA_PERK",
    "name": "Extra Perk",
    "stackable": true,
    "stackable_maximum": 5,
    "max_in_perk_pool": 3
  },
  {
    "id": "PERKS_LOTTERY",
    "name": "Perk Lottery",
    "stackable": true,
    "stackable_is_rare": true,
    "stackable_maximum": 6,
    "max_in_perk_pool": 3
  },
  {
    "id": "GAMBLE",
    "name": "Gamble",
    "stackable": true,
    "one_off_effect": true
  },
  {
    "id": "EXTRA_SHOP_ITEM",
    "name": "Extra Item in Holy Mountain",
    "stackable": true,
    "stackable_maximum": 5,
    "max_in_perk_pool": 2
  },
  {
    "id": "GENOME_MORE_HATRED",
    "name": "More Hatred",
    "stackable": true
  },
  {
    "id": "GENOME_MORE_LOVE",
    "name": "More Love",
    "stackable": true
  },
  {
    "id": "PEACE_WITH_GODS",
    "name": "Peace with Gods",
    "stackable": false
  },
  {
    "id": "MANA_FROM_KILLS",
    "name": "Kills to Mana",
    "stackable": false
  },
  {
    "id": "ANGRY_LEVITATION",
    "name": "Rage-fueled Levitation",
    "stackable": false
  },
  {
    "id": "LASER_AIM",
    "name": "Pinpointer",
    "stackable": true,
    "stackable_is_rare": true
  },
  {
    "id": "PERSONAL_LASER",
    "name": "Personal Plasma Beam",
    "stackable": true,
    "stackable_is_rare": true,
    "stackable_maximum": 5,
    "max_in_perk_pool": 2
  },
  {
    "id": "MEGA_BEAM_STONE",
    "name": "Summon Sädekivi",
    "stackable": true,
    "one_off_effect": true
  }
];

export const PERK_INDEX_LOOKUP = PERKS.map(perk => perk.id).reduce((lookup, id, index) => {
  lookup[id] = index;
  return lookup;
}, {});

//console.log(`Loaded ${PERKS.length} perks.`);

export function getPerkDeck(ws, ng, perkPickups={}, ignoreList=[], gameMode='normal') {
	const MIN_DISTANE_BETWEEN_DUPLICATE_PERKS = 4;
	const DEFAULT_MAX_STACKABLE_PERK_COUNT = 128;

	const prng = new NollaPrng(0);
	prng.SetRandomSeed(ws + ng, 1, 2);
	let perkDeck = [];
	let stackableDistances = {};
	let stackableCount = {};

	// Create initial perk deck with duplicates
	for (let i = 0; i < PERKS.length; i++) {
		const perk = PERKS[i];
		if (perk.not_in_default_perk_pool === true) continue;
		if (ignoreList.includes(perk.id)) continue;
		const perkName = perk.id;
    // Nightmare specifically excludes invisibility
    if (gameMode === 'nightmare' && perkName === 'INVISIBILITY') continue;
		let howManyTimes = 1;
		stackableDistances[perkName] = -1;
		stackableCount[perkName] = -1;
		if (perk.stackable === true) {
			let maxPerks = prng.Random(1, 2);
			if (perk.max_in_perk_pool) {
				maxPerks = prng.Random(1, perk.max_in_perk_pool);
			}
			if (perk.stackable_maximum) {
				stackableCount[perkName] = perk.stackable_maximum;
			}
			else {
				stackableCount[perkName] = DEFAULT_MAX_STACKABLE_PERK_COUNT;
			}
			if (perk.stackable_is_rare === true) {
				maxPerks = 1;
			}
			stackableDistances[perkName] = perk.stackable_how_often_reappears || MIN_DISTANE_BETWEEN_DUPLICATE_PERKS;
			howManyTimes = prng.Random(1, maxPerks);
		}
		for (let j = 0; j < howManyTimes; j++) {
			perkDeck.push(perkName);
		}
	}

	// Shuffle
	shuffleTable(perkDeck, prng);

	// Remove duplicates that are too close to each other
	for (let i = perkDeck.length - 1; i >= 0; i--) {
		const perkName = perkDeck[i];
		if (stackableDistances[perkName] === -1) continue;
		const minDistance = stackableDistances[perkName];
		let toRemove = false;

		for (let ri = i - minDistance; ri < i; ri++) {
			if (ri >= 0 && perkDeck[ri] === perkName) {
				toRemove = true;
				break;
			}
		}

		if (toRemove) {
			perkDeck.splice(i, 1);
		}
	}

	// Changes based on perks that have been picked up
	for (let i = 0; i < perkDeck.length; i++) {
		const perkName = perkDeck[i];
		const pickupCount = perkPickups[perkName] || 0;
		if (pickupCount > 0) {
			const stackCount = stackableCount[perkName] || -1;
			if (stackCount === -1 || pickupCount >= stackCount) {
				perkDeck[i] = ""; // To be skipped
			}
		}
	}

	return perkDeck;
}

function isPerkLucky(ws, ng, x, y, perkPickups) {
	// TODO: Check whether or not this should be a float
	const lotteryCount = perkPickups['PERKS_LOTTERY'] || 0;
	const perkDestroyChance = 100/Math.pow(2, lotteryCount);
	const prng = new NollaPrng(0);
	prng.SetRandomSeed(ws + ng, x, y);
	return (prng.Random(1, 100) > perkDestroyChance);
}

function getLuckyStates(ws, ng, x, y) {
	let states = [];
	for (let i = 0; i < 7; i++) {
		states.push(isPerkLucky(ws, ng, x, y, { 'PERKS_LOTTERY': i }));
	}
	return states;
}

export function getAlwaysCasts(ws, ng, x, y) {
	let goodCards = ["DAMAGE", "CRITICAL_HIT", "HOMING", "SPEED", "ACID_TRAIL", "SINEWAVE"];
	let prng = new NollaPrng(0);
	prng.SetRandomSeed(ws + ng, x, y);
	let card = goodCards[prng.Random(1, goodCards.length) - 1];
	let r = prng.Random(1, 100);
	let level = 6;
	if (r <= 50) {
		let p = prng.Random(1, 100);
		if (p <= 86) {
			card = GetRandomActionWithType(x, y, level, MODIFIER, ws, 666);
		}
		else if (p <= 93) {
			card = GetRandomActionWithType(x, y, level, STATIC_PROJECTILE, ws, 666);
		}
		else if (p < 100) {
			card = GetRandomActionWithType(x, y, level, PROJECTILE, ws, 666);
		}
		else {
			card = GetRandomActionWithType(x, y, level, UTILITY, ws, 666);
		}
    card = card.name;
	}
	return card;
}

function getNextPerk(ws, ng, perkIndex, perkPickups={}, gameMode='normal') {
	const perkDeck = getPerkDeck(ws, ng, perkPickups, [], gameMode);
	let perk = perkDeck[perkIndex];
	while (perk === "") {
		perkIndex++;
		if (perkIndex >= perkDeck.length) {
			perkIndex = 0;
		}
		perk = perkDeck[perkIndex];
	}
	perkIndex++;
	if (perkIndex >= perkDeck.length) {
		perkIndex = 0;
	}
	return {
		perk,
		perkIndex
	};
}

// Still trying to decide how to use this, since picking it up requires adjusting future perks
export function getGamblePerks(ws, ng, perkIndex, perkPickups={}, gameMode='normal') {
	let count = 2;
	let perks = [];
	while (count > 0) {
		let { perk, perkIndex: newPerkIndex } = getNextPerk(ws, ng, perkIndex, perkPickups, gameMode);
		if (perk !== 'GAMBLE') {
			perks.push(perk);
			count--;
		}
		perkIndex = newPerkIndex;
	}
	return {
		perks,
		perkIndex
	};
}

export function pickupPerk(perkName, perkPickups={}) {
	perkPickups[perkName] = (perkPickups[perkName] || 0) + 1;
	if (PERKS[PERK_INDEX_LOOKUP[perkName]].remove_other_perks) {
		for (const perkToRemove of PERKS[PERK_INDEX_LOOKUP[perkName]].remove_other_perks) {
			perkPickups[perkToRemove] = (perkPickups[perkToRemove] || 0) + 1;
		}
	}

	return perkPickups;
}

const templeX = [-32, -32, -32, -32, -32, -32, 2560];
const templeY = [1410, 2946, 4994, 6530, 8578, 10626, 13181];

const templeXNGPlus = [-32, -32, -32, -32, 2560];
const templeYNGPlus = [1410, 2946, 6530, 10626, 13181];

// Need to maintain this index as temples are loaded
export function getTemplePerks(ws, ng, pwIndex, templeIndex, perkIndex=null, perkPickups={}, gameMode='normal') {
	const isNGP = ng > 0;
	const templeXPos = isNGP ? templeXNGPlus : templeX;
	const templeYPos = isNGP ? templeYNGPlus : templeY;
	const perkCount = perkPickups['EXTRA_PERK'] ? perkPickups['EXTRA_PERK'] + 3 : 3;
	const width = 60;
	const stepSize = width / perkCount;
	const perkDeck = getPerkDeck(ws, ng, perkPickups, [], gameMode);
	if (perkIndex === null) {
		perkIndex = 0;
	}
	let perks = [];
	for (let i = 0; i < perkCount; i++) {
		let perk = perkDeck[perkIndex];
		while (perk === "") {
			perkIndex++;
			if (perkIndex >= perkDeck.length) {
				perkIndex = 0;
			}
			perk = perkDeck[perkIndex];
		}
		perkIndex++;
		if (perkIndex >= perkDeck.length) {
			perkIndex = 0;
		}
		const origX = pwIndex * 512 * getWorldSize(ng > 0, gameMode) + templeXPos[templeIndex] + (i + 0.5)*stepSize;
		const x = roundHalfOfEven(origX); //Math.fround(origX); // Used for spells but not perks I guess
		const y = templeYPos[templeIndex];
		const luckyStates = getLuckyStates(ws, ng, x, y);
		const alwaysCast = perk === 'ALWAYS_CAST' ? getAlwaysCasts(ws, ng, x, y) : null;
		const hypotheticalGamble = perk === 'GAMBLE' ? getGamblePerks(ws, ng, perkIndex, perkPickups, gameMode) : null;
		perks.push({
			type: 'perk',
			perk: perk,
			x: x,
			y: y,
			luckyStates: luckyStates,
			alwaysCast: alwaysCast,
			hypotheticalGamble: hypotheticalGamble,
		});
	}
	return {
		perks,
		perkIndex
	};
}

// Note this uses a separate index, going in reverse
// Original index still needed *only* for gamble, what a pain. Maybe it would be better to just not precalculate gamble.
export function rerollTemplePerks(ws, ng, pwIndex, templeIndex, perkIndex=null, rerollIndex=null, perkPickups={}, gameMode='normal') {
	const isNGP = ng > 0;
	const templeXPos = isNGP ? templeXNGPlus : templeX;
	const templeYPos = isNGP ? templeYNGPlus : templeY;
	const perkCount = perkPickups['EXTRA_PERK'] ? perkPickups['EXTRA_PERK'] + 3 : 3;
	const width = 60;
	const stepSize = width / perkCount;
	const perkDeck = getPerkDeck(ws, ng, perkPickups, [], gameMode);
	if (perkIndex === null) {
		perkIndex = 0;
	}
	if (rerollIndex === null) {
		rerollIndex = perkDeck.length - 1;
	}
	let perks = [];
	for (let i = 0; i < perkCount; i++) {
		let perk = perkDeck[rerollIndex];
		while (perk === "") {
			rerollIndex--;
			if (rerollIndex < 0) {
				rerollIndex = perkDeck.length - 1;
			}
			perk = perkDeck[rerollIndex];
		}
		rerollIndex--;
		if (rerollIndex < 0) {
			rerollIndex = perkDeck.length - 1;
		}
		const origX = pwIndex * 512 * getWorldSize(ng > 0, gameMode) + templeXPos[templeIndex] + (i + 0.5)*stepSize;
		const x = roundHalfOfEven(origX); //Math.fround(origX); // Used for spells but not perks I guess
		const y = templeYPos[templeIndex];
		const luckyStates = getLuckyStates(ws, ng, x, y);
		const alwaysCast = perk === 'ALWAYS_CAST' ? getAlwaysCasts(ws, ng, x, y) : null;
		// Note that gamble uses the perk index, not the reroll index, making this even more annoying
		const hypotheticalGamble = perk === 'GAMBLE' ? getGamblePerks(ws, ng, perkIndex, perkPickups, gameMode) : null;
		perks.push({
			type: 'perk',
			perk: perk,
			x: x,
			y: y,
			luckyStates: luckyStates,
			alwaysCast: alwaysCast,
			hypotheticalGamble: hypotheticalGamble,
		});
	}
	return {
		perks,
		perkIndex,
		rerollIndex
	};
}

export function getAllTemplePerks(ws, ng, pwIndex, perkIndex=null, perkPickups={}, gameMode='normal') {
	if (perkIndex === null) {
		perkIndex = 0;
	}
	const isNGP = ng > 0;
	const templeCount = isNGP ? templeXNGPlus.length : templeX.length;
	let allTemplePerks = [];
	for (let templeIndex = 0; templeIndex < templeCount; templeIndex++) {
		const { perks, perkIndex: newPerkIndex } = getTemplePerks(ws, ng, pwIndex, templeIndex, perkIndex, perkPickups, gameMode);
		allTemplePerks.push(perks);
		perkIndex = newPerkIndex;
	}
	return {
		allTemplePerks,
		perkIndex
	};
}

// Testing
/*
// Load individual temples
console.log(getTemplePerks(1, 0, 0, 0, 0, {}));
// Correct lucky values are shown with 1 perk lottery (obviously...)
// In practice we could also predict the lucky ones with multiple copies of perk lottery
// Instead I think I'll just precompute all lucky states and use one based on the number of perk lotteries selected.
//console.log(getTemplePerks(1, 0, 0, 0, 0, {'PERKS_LOTTERY': 1})); 
console.log(getTemplePerks(1, 0, 0, 1, 3, {}));
console.log(getTemplePerks(1, 0, 0, 2, 6, {}));
console.log(getTemplePerks(1, 0, 0, 3, 9, {}));
console.log(getTemplePerks(1, 0, 0, 4, 12, {}));
console.log(getTemplePerks(1, 0, 0, 5, 15, {}));
console.log(getTemplePerks(1, 0, 0, 6, 18, {}));

// Load a whole PW at once (assuming temples are visited in order)
console.log(getAllTemplePerks(1, 0, 0, 0, {}));

// Rerolls use a separate index
// The idea is to store the output index and use it in the next rerolls
// Initial value of null will have it initialize to the end of the deck properly
console.log(rerollTemplePerks(1, 0, 0, 0, null, null, {}));
*/