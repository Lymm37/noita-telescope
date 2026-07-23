import { NollaPrng } from './nolla_prng.js';

// Data Tables
const materialsFrom = [
    { probability: 1.0, materials: ["water", "water_static", "water_salt", "water_ice"], nameMaterial: "water" },
    { probability: 1.0, materials: ["lava"], nameMaterial: "lava" },
    { probability: 1.0, materials: ["radioactive_liquid", "poison", "material_darkness"], nameMaterial: "radioactive_liquid" },
    { probability: 1.0, materials: ["oil", "swamp", "peat"], nameMaterial: "oil" },
    { probability: 1.0, materials: ["blood"], nameMaterial: "blood" },
    { probability: 1.0, materials: ["blood_fungi", "fungi", "fungisoil"], nameMaterial: "fungi" },
    { probability: 1.0, materials: ["blood_cold", "blood_worm"], nameMaterial: "blood_cold" },
    { probability: 1.0, materials: ["acid"], nameMaterial: "acid" },
    { probability: 0.4, materials: ["acid_gas", "acid_gas_static", "poison_gas", "fungal_gas", "radioactive_gas", "radioactive_gas_static"], nameMaterial: "acid_gas" },
    { probability: 0.4, materials: ["magic_liquid_polymorph", "magic_liquid_unstable_polymorph"], nameMaterial: "magic_liquid_polymorph" },
    { probability: 0.4, materials: ["magic_liquid_berserk", "magic_liquid_charm", "magic_liquid_invisibility"], nameMaterial: "magic_liquid_berserk" },
    { probability: 0.6, materials: ["diamond"], nameMaterial: "diamond" },
    { probability: 0.6, materials: ["silver", "brass", "copper"], nameMaterial: "silver" },
    { probability: 0.2, materials: ["steam", "smoke"], nameMaterial: "steam" },
    { probability: 0.4, materials: ["sand"], nameMaterial: "sand" },
    { probability: 0.4, materials: ["snow_sticky"], nameMaterial: "snow_sticky" },
    { probability: 0.05, materials: ["rock_static"], nameMaterial: "rock_static" },
    { probability: 0.0003, materials: ["gold", "gold_box2d"], nameMaterial: "gold" }
];

const materialsTo = [
    { probability: 1.0, material: "water" },
    { probability: 1.0, material: "lava" },
    { probability: 1.0, material: "radioactive_liquid" },
    { probability: 1.0, material: "oil" },
    { probability: 1.0, material: "blood" },
    { probability: 1.0, material: "blood_fungi" },
    { probability: 1.0, material: "acid" },
    { probability: 1.0, material: "water_swamp" },
    { probability: 1.0, material: "alcohol" },
    { probability: 1.0, material: "sima" },
    { probability: 1.0, material: "blood_worm" },
    { probability: 1.0, material: "poison" },
    { probability: 1.0, material: "vomit" },
    { probability: 1.0, material: "pea_soup" },
    { probability: 1.0, material: "fungi" },
    { probability: 0.8, material: "sand" },
    { probability: 0.8, material: "diamond" },
    { probability: 0.8, material: "silver" },
    { probability: 0.8, material: "steam" },
    { probability: 0.5, material: "rock_static" },
    { probability: 0.5, material: "gunpowder" },
    { probability: 0.5, material: "material_darkness" },
    { probability: 0.5, material: "material_confusion" },
    { probability: 0.2, material: "rock_static_radioactive" },
    { probability: 0.02, material: "magic_liquid_polymorph" },
    { probability: 0.02, material: "magic_liquid_random_polymorph" },
    { probability: 0.15, material: "magic_liquid_teleportation" },
    { probability: 0.10, material: "mimic_liquid" },
    { probability: 0.01, material: "urine" },
    { probability: 0.01, material: "poo" },
    { probability: 0.01, material: "void_liquid" },
    { probability: 0.01, material: "cheese_static" }
];

const greedyMaterials = [
    "brass", "silver", "radioactive_liquid", "pea_soup",
    "acid_gas", "poo", "mammi", "rotten_meat_radioactive", "vomit"
];

// Helper Functions
function pickRandomFromTableWeighted(ws, items, rndState) {
    let table = [];
    let weightSum = 0.0;

    for (const item of items) {
        let newWeightMax = weightSum + item.probability;
        table.push({ item: item, min: weightSum, max: newWeightMax });
        weightSum = newWeightMax;
    }

    let val = randomNextFloat(ws, 0.0, weightSum, rndState);
    for (const it of table) {
        if (val >= it.min && val <= it.max) {
            return it.item;
        }
    }
    return items[0].item;
}

function randomNextFloat(seed, a, b, rndState) {
    let rng = new NollaPrng(0);
    rng.SetRandomSeed(seed, rndState.x, rndState.y);
    let result = a + ((b - a) * rng.Next());
    rndState.y += 1;
    return result;
}

function randomNext(seed, a, b, rndState) {
    let rng = new NollaPrng(0);
    rng.SetRandomSeed(seed, rndState.x, rndState.y);
    let result = rng.Random(Math.round(a), Math.round(b));
    rndState.y += 1;
    return result;
}

/**
 * Gets fungal shifts for a seed and returns them as a JSON-serializable array of objects.
 * 
 * @param {number} seed - The base world seed.
 * @param {number} ngPlusCount - The NG+ level (default: 0).
 * @returns {Array<Object>} Array of shift objects.
 */
export function getFungalShifts(seed, ngPlusCount = 0) {
	const maxShifts = 20;
    const ws = seed + ngPlusCount;
    const shifts = [];
	const prng = new NollaPrng(0);

    for (let iter = 0; iter < maxShifts; iter++) {
        let convertTries = 0;
        let convertedAny = false;

        while (!convertedAny && convertTries < 20) {
            let seed2 = 42345 + iter + (1000 * convertTries);
            let rndState = { x: 9123, y: seed2 };
			prng.SetRandomSeed(ws, 89346, seed2);

            let fromItem = pickRandomFromTableWeighted(ws, materialsFrom, rndState);
            let toItem = pickRandomFromTableWeighted(ws, materialsTo, rndState);

            let flaskFrom = false;
            let flaskTo = false;
            let goldToX = null;
            let grassToX = null;

            if (randomNext(ws, 1, 100, rndState) <= 75) {
                if (randomNext(ws, 1, 100, rndState) <= 50) {
                    flaskFrom = true;
                } else {
                    flaskTo = true;
                    if (randomNext(ws, 1, 1000, rndState) !== 1) {
                        const greedyIndex = Math.floor(prng.Next() * greedyMaterials.length);
                        goldToX = greedyMaterials[greedyIndex];
                    }
					else {
						goldToX = "gold";
					}
					if (randomNext(ws, 1, 1000, rndState) !== 1) {
						grassToX = "grass";
					}
					else {
						grassToX = "grass_holy";
					}
                }
            }

            let fromMaterials = [];
            let toMaterial = toItem.material;

            for (const material of fromItem.materials) {
                if (material != toMaterial) {
                    fromMaterials.push(material);
                    convertedAny = true;
                }
            }

            if (convertedAny) {
                shifts.push({
                    flaskTo: flaskTo,
                    flaskFrom: flaskFrom,
                    fromMaterials: fromItem.materials,
                    toMaterial: toMaterial,
                    goldToX: goldToX,
                    grassToX: grassToX
                });
            }

            convertTries += 1;
        }
    }

    return shifts;
}
