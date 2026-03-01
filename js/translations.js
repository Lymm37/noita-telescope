// Used for additional common names
// Note that the first alias is used as the display name
const ALIASES = {
	'LONG_DISTANCE_CAST': ['long-distance cast', 'long distance cast', 'ldc'],
	'TELEPORT_PROJECTILE_SHORT': ['short teleport bolt', 'small teleport bolt', 'tp'],
	'TELEPORT_PROJECTILE': ['teleport bolt', 'tp'],
	'BLACK_HOLE': ['black hole', 'bh'],
	'SPELLS_TO_POWER': ['spells to power', 'stp'],
	'GOLD_TO_POWER': ['gold to power', 'gtp'],
	'BLOOD_TO_POWER': ['blood to power', 'btp'],
	'DIVIDE_2': ['divide by 2', 'd2'],
	'DIVIDE_3': ['divide by 3', 'd3'],
	'DIVIDE_4': ['divide by 4', 'd4'],
	'DIVIDE_10': ['divide by 10', 'd10'],
	'ALL_SPELLS': ['end of everything', 'eoe'],
	'REGENERATION_FIELD': ['circle of vigour', 'circle of vigor', 'vigor', 'cov'],
	'great_chest': ['great treasure chest', 'great chest', 'gtc'],
	'true_orb': ['34th orb', '34th', '34', 'orb 34'],
	'mimic_potion': ['potion mimic', 'mimic potion', 'mimicium'],
	'chest_leggy': ['leggy mimic', 'leggy', 'legs'],
	'paha_silma': ['paha silmä', 'paha silma', 'silma', 'eye', 'evil eye'],
	// Some shortcuts for potions which get passed through the translations
	'unstable teleportatium potion': ['unstable teleportatium potion', 'unstable tele potion', 'tele potion'],
	'teleportatium potion': ['teleportatium potion', 'tele potion'],
	'lively concoction potion': ['lively concoction potion', 'lc potion', 'lc'],
	'alchemical precursor potion': ['alchemical precursor potion', 'ap potion', 'ap'],
	// Funny "lc" and "ap" don't really work because they are substrings of other things
};

// Stuff that wasn't in the translations file for some reason (mostly items)
const EXTRA_TRANSLATIONS = {
	'egg_slime': 'Slimy Egg',
	'egg_monster': 'Egg',
	'egg_fire': 'Warm Egg',
	'egg_purple': 'Chilly Egg',
	'chaos_die': 'Chaos Die',
	'greed_die': 'Greed Die',
	'shiny_orb': 'Shiny Orb',
	'greed_orb': 'Greed Orb',
	'paha_silma': 'Paha Silmä',
	'broken_wand': 'Broken Wand',
	'runestone_light': 'Runestone of Light',
	'runestone_fire': 'Runestone of Fire',
	'runestone_magma': 'Runestone of Magma',
	'runestone_weight': 'Runestone of Weight',
	'runestone_emptiness': 'Runestone of Emptiness',
	'runestone_edges': 'Runestone of Edges',
	'runestone_metal': 'Runestone of Metal',
	'mimic_potion': 'Potion Mimic',
	'refresh_mimic': 'Refresh Mimic',
	'heart_mimic': 'Heart Mimic',
	'chest_leggy': 'Leggy Mimic',

	// Missing biomes with weird capitalization (in no particular order)
	'coalmine': 'Mines',
	'vault_frozen': 'Frozen Vault',
	'robobase': 'Power Plant',
	'wizardcave': 'Wizards\' Den',
	'wandcave': 'Magical Temple',
	'meat': 'Meat Realm',
	'liquidcave': 'Ancient Laboratory',
	'secret_lab': 'Abandoned Alchemy Lab',
	'fungiforest': 'Overgrown Cavern',
	'pyramid_top': 'Pyramid Top',
	'snowchasm': 'Snowy Chasm',
	'tower_coalmine': 'Tower (Mines)',
	'tower_excavationsite': 'Tower (Coal Mines)',
	'tower_snowcave': 'Tower (Snowy Depths)',
	'tower_snowcastle': 'Tower (Hiisi Base)',
	'tower_fungicave': 'Tower (Fungal Caverns)',
	'tower_rainforest': 'Tower (Underground Jungle)',
	'tower_vault': 'Tower (The Vault)',
	'tower_crypt': 'Tower (Temple of the Art)',
	'tower_end': 'Tower (Hell)',
	'coalmine_alt': 'Collapsed Mines',
	'rainforest_open': 'Underground Jungle (Open)',
	'temple_altar': 'Holy Mountain',
	'wizardcave_entrance': 'Wizards\' Den Entrance',
	'snowcastle_cavern': 'Hiisi Hourglass Shop',
	'snowcastle_hourglass_chamber': 'Eye Room',
	'snowcave_secret_chamber': 'Snowcave Secret Chamber',
	'excavationsite_cube_chamber': 'Meditation Cube',
	'lake_deep': 'Lake',
	'the_sky': 'The Work (Heaven)',
	'the_end': 'The Work (Hell)',
	'biome_watchtower': 'Watchtower',
	'biome_barren': 'Barren Temple',
	'biome_potion_mimics': 'Henkevä Temple',
	'biome_darkness': 'Ominous Temple',
	'biome_boss_sky': 'Kivi Temple',
}

let TRANSLATIONS = {};

export async function loadTranslations() {
	try {
		const response = await fetch('./data/translations.csv');
		const text = await response.text();
		const lines = text.split('\n');

		lines.forEach(line => {
			const parts = line.split(',');
			if (parts.length < 2) return;

			let key = parts[0].trim();
			const name = parts[1].trim();

			// Handle Spells: "action_light_bullet" -> "LIGHT_BULLET"
			if (key.startsWith('action_')) {
				const normalizedKey = key.replace('action_', '').toUpperCase();
				TRANSLATIONS[normalizedKey] = name;
			} 
			// Handle Materials: "mat_gold" -> "gold"
			else if (key.startsWith('mat_')) {
				const normalizedKey = key.replace('mat_', '').toLowerCase();
				TRANSLATIONS[normalizedKey] = name;
			}
			// Biomes
			else if (key.startsWith('biome_')) {
				const normalizedKey = key.replace('biome_', '').toLowerCase();
				TRANSLATIONS[normalizedKey] = name;
			}
			// Fallback for exact matches
			TRANSLATIONS[key] = name;
		});
		TRANSLATIONS = { ...TRANSLATIONS, ...EXTRA_TRANSLATIONS }; // Merge in any extra translations
		//console.log(`Loaded ${Object.keys(TRANSLATIONS).length} aliases/translations.`);
	} catch (e) {
		console.error("Could not load translations.csv, search will use technical names.", e);
	}
}

export function getDisplayName(techId) {
	if (!techId) return '???';
	if (ALIASES[techId]) {
		return ALIASES[techId][0]; // Return the first alias as the display name
	}
	return TRANSLATIONS[techId] || techId;
}

export function isMatch(techId, query) {
	if (!techId || !query) return false;
	const tid = techId.toLowerCase();
	const q = query.toLowerCase().trim();
	if (ALIASES[techId]) {
		return ALIASES[techId].some(alias => alias.toLowerCase().includes(q));
	}
	if (tid.includes(q)) return true;
	const translated = TRANSLATIONS[techId];
	return translated && translated.toLowerCase().includes(q);
}
