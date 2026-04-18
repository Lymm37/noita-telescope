import biomeFlagsData from '../data/biome_flags.json' with { type: 'json' };

// Telescope biome keys align with noita's XML basenames (the xmlName noitrainer
// reports per chunk). Most are 1:1; a few telescope "biomes" group multiple
// noita XMLs under one render target — those list the extra XMLs in
// `aliasXMLs` so BIOME_COLOR_TO_NAME picks up all the variant colors AND
// canonicalBiome knows how to fold them. Primary wins: if an alias XML is
// itself another biome's primary, that primary keeps the color.
export const GENERATOR_CONFIG = {
    'coalmine': { color: 0xffd57917, wangFile: '../data/wang_tiles/coalmine.png', name: "Mines" },
    'coalmine_alt': { color: 0xffD56517, wangFile: '../data/wang_tiles/coalmine_alt.png', name: "Collapsed Mines" },
    'excavationsite': { color: 0xff124445, wangFile: '../data/wang_tiles/excavationsite.png', name: "Coal Mines" },
    'snowcave': { color: 0xff1775d5, wangFile: '../data/wang_tiles/snowcave.png', name: "Snowy Depths" },
    'snowcastle': { color: 0xff0046FF, wangFile: '../data/wang_tiles/snowcastle.png', name: "Hiisi Base" },
    'rainforest': { color: 0xff808000, wangFile: '../data/wang_tiles/rainforest.png', name: "Underground Jungle" },
    'rainforest_open': { color: 0xffA08400, wangFile: '../data/wang_tiles/rainforest_open.png', name: "Underground Jungle (Open)" },
    'vault': { color: 0xff008000, wangFile: '../data/wang_tiles/vault.png', name: "The Vault" },
    'crypt': { color: 0xff786C42, wangFile: '../data/wang_tiles/crypt.png', name: "Temple of the Art" },
    'fungicave': { color: 0xffe861f0, wangFile: '../data/wang_tiles/fungicave.png', name: "Fungal Caverns" },
    'fungiforest': { color: 0xffa861ff, wangFile: '../data/wang_tiles/fungiforest.png', name: "Overgrown Cavern" },
    'rainforest_dark': { color: 0xff375c00, wangFile: '../data/wang_tiles/rainforest_dark.png', name: "Lukki Lair" },
    'wizardcave': { color: 0xff726186, wangFile: '../data/wang_tiles/wizardcave.png', name: "Wizard's Den" },
    'liquidcave': { color: 0xff89a04b, wangFile: '../data/wang_tiles/liquidcave.png', name: "Ancient Laboratory", randomColors: {0x01CFEE: [0xF86868,0x7FCEEA,0xA3569F,0xC23055,0x0BFFE5]} }, /* 0x12BBEE: [0x000000,0xFFFFFF]} */
    'robobase': { color: 0xff4e5267, wangFile: '../data/wang_tiles/robobase.png', name: "Power Plant",
        aliasXMLs: ['roboroom'] },
    'vault_frozen': { color: 0xff0080a8, wangFile: '../data/wang_tiles/vault_frozen.png', name: "Frozen Vault" },
    'meat': { color: 0xff572828, wangFile: '../data/wang_tiles/meat.png', name: "Meat Realm",
        aliasXMLs: ['meatroom'] },
    'wandcave': { color: 0xff006C42, hasStuff: false, wangFile: '../data/wang_tiles/wand.png', name: "Magical Temple" },
    'pyramid': { color: 0xff967f11, hasStuff: false, wangFile: '../data/wang_tiles/pyramid.png', optional: true, name: "Pyramid",
        aliasXMLs: ['pyramid_hallway', 'pyramid_right', 'pyramid_entrance', 'pyramid_left'] },
    'sandcave': { color: 0xffE1CD32, hasStuff: false, wangFile: '../data/wang_tiles/sandcave.png', optional: true, name: "Sandcave" },
    // Surface biomes (cy < 14). No spawns; declared so biome-map lookups
    // return a name instead of null.
    'desert': { color: 0xffCC9944, hasStuff: false, optional: true, name: "Desert",
        aliasXMLs: ['scale'] },
    'winter': { color: 0xffD6D8E3, hasStuff: false, optional: true, name: "Winter Surface" },
    'lake':   { color: 0xff1133F1, hasStuff: false, optional: true, name: "Lake (Surface)",
        // lake_deep.xml is also in $biome_lake but has its own entry below;
        // the primary-wins rule keeps it separate.
        aliasXMLs: ['lake_blood', 'lake_statue'] },
    'lava':   { color: 0xffFF6A02, hasStuff: false, optional: true, name: "Lava",
        aliasXMLs: ['lava_90percent'] },
    'clouds': { color: 0xff36d5c9, hasStuff: false, wangFile: '../data/wang_tiles/clouds.png', optional: true, name: "Cloudscape" },
    'the_sky': { color: 0xffD3E6F0, hasStuff: false, wangFile: '../data/wang_tiles/the_sky.png', optional: true, name: "The Work (Sky)" },
    'the_end': { color: 0xff3C0F0A, hasStuff: false, wangFile: '../data/wang_tiles/the_end.png', name: "The Work (Hell)",
        // the_sky.xml also shares the $biome_boss_victoryroom translation, but
        // telescope renders it separately (primary-wins keeps its color distinct).
        aliasXMLs: ['boss_victoryroom'] },
    'winter_caves': { color: 0xff77A5BD, hasStuff: false, wangFile: '../data/wang_tiles/snowchasm.png', optional: true, name: "Snowy Chasm" },
    'mountain_floating_island': { color: 0xffC08082, hasStuff: false, optional: true, name: "Floating Island" },
    'solid_wall_tower_1': { color: 0xff3d3e37, wangFile: '../data/wang_tiles/coalmine.png', name: "Tower (Mines)" },
    'solid_wall_tower_2': { color: 0xff3d3e38, wangFile: '../data/wang_tiles/excavationsite.png', name: "Tower (Coal Mines)" },
    'solid_wall_tower_3': { color: 0xff3d3e39, wangFile: '../data/wang_tiles/snowcave.png', name: "Tower (Snowy Depths)" },
    'solid_wall_tower_4': { color: 0xff3d3e3a, wangFile: '../data/wang_tiles/snowcastle.png', name: "Tower (Hiisi Base)" },
    'solid_wall_tower_5': { color: 0xff3d3e3b, wangFile: '../data/wang_tiles/fungicave.png', name: "Tower (Fungal Caverns)" },
    'solid_wall_tower_6': { color: 0xff3d3e3c, wangFile: '../data/wang_tiles/rainforest.png', name: "Tower (Underground Jungle)" },
    'solid_wall_tower_7': { color: 0xff3d3e3d, wangFile: '../data/wang_tiles/vault.png', name: "Tower (The Vault)" },
    'solid_wall_tower_8': { color: 0xff3d3e3e, wangFile: '../data/wang_tiles/crypt.png', name: "Tower (Temple of the Art)" },
    'solid_wall_tower_9': { color: 0xff3d3e3f, wangFile: '../data/wang_tiles/the_end.png', name: "Tower (Hell)" },
    'lake_deep': { color: 0xff1158f1, wangFile: '../data/wang_tiles/water.png', optional: true, name: "Lake" }, // This is just silly
    // Extra generation biomes
    'excavationsite_cube_chamber': { color: 0xff24888a, name: "Meditation Cube" },
    'snowcave_secret_chamber': { color: 0xff18a0d6, name: "Snowcave Secret Chamber" },
    'snowcastle_cavern': { color: 0xff775ddb, name: "Hiisi Hourglass Shop" },
    'snowcastle_hourglass_chamber': { color: 0xff18d6d6, name: "Eye Room" },
    'robot_egg': { color: 0xff9e4302, name: "Robot Egg" },
    'pyramid_top': { color: 0xffc88f5f, name: "Pyramid Boss"},
    'secret_lab': { color: 0xffbaa345, name: "Alchemist Boss" },
    'wizardcave_entrance': { color: 0xff804169, name: "Triangle Boss"},
    'dragoncave': { color: 0xff364d24, name: "Dragoncave" },
    // Aliases pull every holy-mountain variant (altar_*, wall_*, empty_*).
    // 0x93cb4c is the entrance and is wobble-eligible; the rest are
    // filler/sides and are not. See data/biome_flags.json for the per-XML
    // noise_biome_edges flags.
    'temple_altar': { color: 0xff93cb4c, name: "Holy Mountain",
        aliasXMLs: [
            'temple_altar_left', 'temple_altar_right', 'temple_altar_right_snowcave',
            'temple_altar_right_snowcastle', 'temple_altar_secret',
            'temple_altar_empty', 'temple_altar_left_empty', 'temple_altar_right_empty',
            'temple_altar_right_snowcave_empty', 'temple_altar_right_snowcastle_empty',
            'temple_wall', 'temple_wall_ending', 'solid_wall_temple',
        ] },
    'boss_arena': { color: 0xff14EED7, name: "Boss Arena",
        aliasXMLs: ['boss_arena_top'] },
    // Pure markers: no wang tiles or content, just biome-map paint.
    'gold': { color: 0xffFFFF00, hasStuff: false, optional: true, name: "Gold Vein" },
    'water': { color: 0xff0000FF, hasStuff: false, optional: true, name: "Water Pocket" },
    'ghost_secret': { color: 0xff1F3B64, hasStuff: false, optional: true, name: "Ghost Secret" },
    'mestari_secret': { color: 0xff1F3B62, hasStuff: false, optional: true, name: "Mestari Secret" },
    // 12 orb rooms: colors jump from 0xFFD100 to 0xFFD10B (matching
    // orbrooms/orbroom_00.xml … orbroom_11.xml).
    'orbroom_marker': { color: 0xffFFD100, hasStuff: false, optional: true, name: "Orb Room",
        aliasXMLs: [
            'orbroom_00', 'orbroom_01', 'orbroom_02', 'orbroom_03',
            'orbroom_04', 'orbroom_05', 'orbroom_06', 'orbroom_07',
            'orbroom_08', 'orbroom_09', 'orbroom_10', 'orbroom_11',
        ] },

    // Static tile
    'biome_watchtower': { color: 0xffb70000, wangFile: '../data/wang_tiles/static/watchtower_fg.png', optional: true, name: "Watchtower" },
    'biome_potion_mimics': { color: 0xffff00fe, wangFile: '../data/wang_tiles/static/potion_mimics_fg.png', name: "Henkevä Temple" },
    'biome_darkness': { color: 0xffff00fd, wangFile: '../data/wang_tiles/static/darkness_fg.png', name: "Ominous Temple" },
    'biome_boss_sky': { color: 0xffff00fc, wangFile: '../data/wang_tiles/static/boss_fg.png', optional: true, name: "Kivi Temple" },
    'biome_barren': { color: 0xffff00fb, wangFile: '../data/wang_tiles/static/barren_fg.png', optional: true, name: "Barren Temple" },
};

Object.values(GENERATOR_CONFIG).forEach(conf => {
    conf.enabled = true; // Default to all enabled, we can disable later if needed
    if (conf.name === 'Lake') conf.enabled = false; // Lake is just silly, especially without enemy spawns implemented. Though it can affect NG+ overlaps
    conf.pois = conf.pois || []; // No longer used... Overlaps made PoIs not really work per-biome
});

// Index biome_flags.json by xmlName (the basename noitrainer emits per
// chunk). Basenames are unique across noita's biome tree — any collisions
// are the same XML appearing under multiple biome-map colors, which we want
// to gather.
const biomeFlagsByBasename = new Map();
for (const b of biomeFlagsData.biomes) {
    if (!biomeFlagsByBasename.has(b.xmlName)) biomeFlagsByBasename.set(b.xmlName, []);
    biomeFlagsByBasename.get(b.xmlName).push(b);
}

function resolveAliasColors(conf) {
    const result = new Set();
    if (Array.isArray(conf.aliasXMLs)) {
        for (const xml of conf.aliasXMLs) {
            for (const entry of (biomeFlagsByBasename.get(xml) || [])) {
                result.add(parseInt(entry.color, 16) & 0xffffff);
            }
        }
    }
    result.delete(conf.color & 0xffffff);
    return result;
}

export const BIOME_COLOR_TO_NAME = {};

// Pass 1: primaries (canonical biome → color).
Object.entries(GENERATOR_CONFIG).forEach(([biomeName, conf]) => {
    BIOME_COLOR_TO_NAME[conf.color & 0xffffff] = biomeName;
});

// Pass 2: aliases. A color that's already a primary stays pointing at that
// primary's biome — this is how the_sky stays distinct from the_end despite
// sharing the $biome_boss_victoryroom group.
Object.entries(GENERATOR_CONFIG).forEach(([biomeName, conf]) => {
    for (const alias of resolveAliasColors(conf)) {
        if (BIOME_COLOR_TO_NAME[alias] === undefined) {
            BIOME_COLOR_TO_NAME[alias] = biomeName;
        }
    }
});

// Only the ones with wang tiles
export const BIOME_COLORS_WITH_TILES = new Set(Object.values(GENERATOR_CONFIG).filter(conf => conf.wangFile != null).map(conf => conf.color & 0xffffff));

// Holy-mountain-region chunk colors used by static_spawns.js as a proxy
// for "this column is a holy mountain basin" when placing altar_top pixel
// scenes. Not a wobble-eligibility source — use
// biomeEdgeNoiseFlag(color, 'noise_biome_edges') in wobble_flags.js (backed
// by data/biome_flags.json) for that.
export const HOLY_MOUNTAIN_REGION_COLORS = new Set([
    0x93cb4c, 0x93cb4d, 0x93cb4e, 0x93cb4f, 0x93cb5a, // temple_altar variants
    0x6dcb28, 0xB8A928, 0x5a9628,                       // temple_wall variants
    0x14EED7, 0x0DA899,                                 // boss_arena variants
    0x364D24,                                            // dragoncave
    0x50EED7,                                            // boss_victoryroom (Hell)
    0xFF6A02, 0xFFA717,                                 // lava
]);
