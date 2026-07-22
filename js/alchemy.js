import { NollaPrng } from './nolla_prng.js';

class MaterialPicker {
    static LIQUIDS = Object.freeze([
        "acid",
        "alcohol",
        "blood",
        "blood_fungi",
        "blood_worm",
        "cement",
        "lava",
        "magic_liquid_berserk",
        "magic_liquid_charm",
        "magic_liquid_faster_levitation",
        "magic_liquid_faster_levitation_and_movement",
        "magic_liquid_invisibility",
        "magic_liquid_mana_regeneration",
        "magic_liquid_movement_faster",
        "magic_liquid_protection_all",
        "magic_liquid_teleportation",
        "magic_liquid_unstable_polymorph",
        "magic_liquid_unstable_teleportation",
        "magic_liquid_worm_attractor",
        "material_confusion",
        "mud",
        "oil",
        "poison",
        "radioactive_liquid",
        "swamp",
        "urine",
        "water",
        "water_ice",
        "water_swamp",
        "magic_liquid_random_polymorph"
    ]);

    static POWDERS = Object.freeze([
        "bone",
        "brass",
        "coal",
        "copper",
        "diamond",
        "fungi",
        "gold",
        "grass",
        "gunpowder",
        "gunpowder_explosive",
        "rotten_meat",
        "sand",
        "silver",
        "slime",
        "snow",
        "soil",
        "wax",
        "honey"
    ]);

    constructor(prng, worldSeed) {
        this.PRNG = prng;
        this.Materials = [];

        this.pickMaterials(MaterialPicker.LIQUIDS, 3);
        this.pickMaterials(MaterialPicker.POWDERS, 1);

        this.shuffleList(worldSeed);

        this.PRNG.Next();
        this.PRNG.Next();
    }

    pickMaterials(source, count) {
        let counter = 0;
        let failed = 0;

        while (counter < count && failed < 99999) {
            const randomIndex = Math.trunc(
                this.PRNG.Next() * source.length
            );

            const picked = source[randomIndex];

            if (!this.Materials.includes(picked)) {
                this.Materials.push(picked);
                counter++;
            } else {
                failed++;
            }
        }
    }

    shuffleList(worldSeed) {
        const unsignedWorldSeed = worldSeed >>> 0;

        const shuffleSeed =
            (unsignedWorldSeed >>> 1) + 12534;

        const prng = new NollaPrng(shuffleSeed);

        for (let i = this.Materials.length - 1; i >= 0; i--) {
            const randomIndex = Math.trunc(
                prng.Next() * (i + 1)
            );

            const temporary = this.Materials[i];
            this.Materials[i] = this.Materials[randomIndex];
            this.Materials[randomIndex] = temporary;
        }
    }
}

export function pickAlchemyMaterials(worldSeed) {
    const unsignedWorldSeed = worldSeed >>> 0;

    const initialPrngSeed =
        unsignedWorldSeed * 0.17127000 +
        1323.59030000;

    const prng = new NollaPrng(initialPrngSeed);

    for (let i = 0; i < 5; i++) {
        prng.Next();
    }

    const livelyConcoction = new MaterialPicker(
        prng,
        unsignedWorldSeed
    );

    const alchemicPrecursor = new MaterialPicker(
        prng,
        unsignedWorldSeed
    );

    return {
        livelyConcoction:
            livelyConcoction.Materials.slice(0, 3),

        alchemicPrecursor:
            alchemicPrecursor.Materials.slice(0, 3),
    };
}
