// Used for additional common names
// Note that the first alias is used as the display name
const ALIASES = {
	// Spell aliases
	'LONG_DISTANCE_CAST': ['long-distance cast', 'long distance cast', 'ldc'],
	'TELEPORT_PROJECTILE_SHORT': ['short teleport bolt', 'small teleport bolt', 'tp'],
	'TELEPORT_PROJECTILE_CLOSER': ['homebringer teleport bolt', 'homebringer bolt', 'homebringer tp', 'ldt'],
	'TELEPORT_PROJECTILE': ['teleport bolt', 'tp'],
	'BLACK_HOLE': ['black hole', 'bh'],
	'BLACK_HOLE_DEATH_TRIGGER': ['black hole with death trigger', 'black hole death trigger', 'bh dt', 'bh death trigger', 'bhdt', 'ldt'],
	'NOLLA': ['nolla', 'rare', 'ldt'],
	'DELAYED_SPELLCAST': ['delayed spellcast', 'delayed cast', 'ldt'],
	'FLY_UPWARDS': ['fly upwards', 'fly up', 'flyup', 'ldt'],
	'FLY_DOWNWARDS': ['fly downwards', 'fly down', 'flydown', 'ldt'],
	'TENTACLE_TIMER': ['tentacle with timer', 'tentacle timer', 'ldt'],
	'SPELLS_TO_POWER': ['spells to power', 'stp', 'spells to crash'],
	'GOLD_TO_POWER': ['gold to power', 'gtp'],
	'BLOOD_TO_POWER': ['blood to power', 'btp'],
	'DIVIDE_2': ['divide by 2', 'd2', 'div2', 'rare', 'ldt'],
	'DIVIDE_3': ['divide by 3', 'd3', 'div3', 'rare', 'ldt'],
	'DIVIDE_4': ['divide by 4', 'd4', 'div4', 'rare', 'ldt'],
	'DIVIDE_10': ['divide by 10', 'd10', 'div10', 'rare', 'ldt'],
	'ALL_SPELLS': ['end of everything', 'eoe', 'rare'],
	'REGENERATION_FIELD': ['circle of vigour', 'circle of vigor', 'vigor', 'cov', 'rare'],
	'CASTER_CAST': ['inner spell', 'innerspell', 'ldt'],
	'FUNKY_SPELL': ['???', 'funky spell', 'chaingun', 'bullet'],
	'BOMB': ['bomb', 'bomb spell', 'summon bomb'],
	'ALPHA': ['alpha', 'greek', 'greeks', 'rare', 'ldt'],
	'GAMMA': ['gamma', 'greek', 'greeks', 'rare', 'ldt'],
	'TAU': ['tau', 'greek', 'greeks', 'rare', 'ldt'],
	'PHI': ['phi', 'greek', 'greeks', 'rare'],
	'OMEGA': ['omega', 'greek', 'greeks', 'rare'],
	'ZETA': ['zeta', 'greek', 'greeks', 'rare'],
	'MU': ['mu', 'greek', 'greeks', 'rare'],
	'MATERIAL_WATER': ['water', 'material water', 'water material', 'rare'],
	'MATERIAL_OIL': ['oil', 'material oil', 'oil material', 'rare'],
	'MATERIAL_BLOOD': ['blood', 'material blood', 'blood material', 'rare'],
	'MATERIAL_ACID': ['acid', 'material acid', 'acid material', 'rare'],
	'MATERIAL_CEMENT': ['cement', 'material cement', 'cement material', 'rare'],
	'SIGMA': ['sigma', 'greek', 'greeks', 'rare'],
	'RESET': ['wand refresh', 'wandrefresh', 'wr', 'reset', 'rare', 'ldt'],
	'ADD_TRIGGER': ['add trigger', 'at', 'rare', 'ldt'],
	'ADD_TIMER': ['add timer', 'at', 'rare', 'ldt'],
	'ADD_DEATH_TRIGGER': ['add expiration trigger', 'add death trigger', 'aet', 'adt', 'add dt', 'add et', 'rare', 'ldt'],
	'SUMMON_WANDGHOST': ['summon taikasauva', 'summon wand ghost', 'summon wandghost', 'rare', 'ldt'],
	'WORM_RAIN': ['matosade', 'worm rain', 'rain of worms', 'rare'],
	'CESSATION': ['cessation', 'rare'],
	'TOUCH_GOLD': ['touch of gold', 'touch gold', 'gold touch', 'rare'],
	'TOUCH_BLOOD': ['touch of blood', 'touch blood', 'blood touch', 'rare'],
	'TOUCH_WATER': ['touch of water', 'touch water', 'water touch', 'rare'],
	'TOUCH_SMOKE': ['touch of smoke', 'touch smoke', 'smoke touch', 'rare'],
	'TOUCH_PISS': ['touch of gold?', 'touch of piss', 'touch of urine', 'touch piss', 'touch urine', 'piss touch', 'urine touch', 'rare'],
	'TOUCH_GRASS': ['touch of grass', 'touch grass', 'grass touch', 'rare'],
	'TOUCH_OIL': ['touch of oil', 'touch oil', 'oil touch', 'rare'],
	'TOUCH_ALCOHOL': ['touch of spirits', 'touch of alcohol', 'touch of whiskey', 'touch spirits', 'touch alcohol', 'touch whiskey', 'spirits touch', 'alcohol touch', 'whiskey touch', 'rare'],
	// General rare search types
	'rare': ['rare'],
	'ldt': ['ldt'],
	'high capacity': ['high capacity', 'highcapacity', 'highcap'],
	'rare sprite': ['rare sprite', 'raresprite'],
	// Item aliases
	'great_chest': ['great treasure chest', 'great chest', 'gtc'],
	'true_orb': ['34th orb', '34th', '34', 'orb 34', 'orb of true knowledge'],
	'mimic_potion': ['potion mimic', 'mimic potion', 'mimicium', 'henkeva potion', 'henkevä potion'],
	'chest_leggy': ['leggy mimic', 'leggy', 'legs', 'leggy mutation'],
	'paha_silma': ['paha silmä', 'paha silma', 'silma', 'eye', 'evil eye'],
	'refresh_mimic': ['refresh mimic', 'spell refresh mimic', 'valhe', 'wind shaman', 'fake refresh', 'fake spell refresh'],
	'heart_mimic': ['heart mimic', 'fake heart', 'pahan muisto', 'evil memory', 'memory of evil'],
	'mimic': ['mimic', 'chest mimic', 'fake chest', 'mimic chest', 'matkija', 'not a mimic'],
	'treasure': ['treasure', 'avarice', 'greed', 'greed diamond', 'avarice diamond'],
	'kuu': ['kuu', 'moon', 'akuu'],
	'greed_die': ['greed die', 'cursed die'],
	'greed_orb': ['cruel orb', 'greed orb', 'cursed orb'],
	'kammi': ['kammi', 'house', 'safe haven'],
	'ukkoskivi': ['ukkoskivi', 'thunderstone', 'thunder stone', 'lightning stone'],
	'kiuaskivi': ['kiuaskivi', 'fire stone', 'firestone', 'saunastone', 'sauna stone', 'heat stone'],
	'vuoksikivi': ['vuoksikivi', 'water stone', 'waterstone'],
	'kakkakikkare': ['kakkakikkare', 'poopstone', 'poop stone'],
	'full_heal': ['full health regeneration', 'full heal', 'full regeneration', 'health regeneration', 'full health', 'full heart'],
	'monster_powder_test': ['monstrous powder', 'monster powder', 'monstruous', 'monsterous'],
	// Some shortcuts for potions which get passed through the translations
	'unstable teleportatium potion': ['unstable teleportatium potion', 'unstable tele potion', 'tele potion'],
	'teleportatium potion': ['teleportatium potion', 'tele potion'],
	'lively concoction potion': ['lively concoction potion', 'lc potion', 'lc', 'rare'],
	'alchemical precursor potion': ['alchemical precursor potion', 'ap potion', 'ap', 'rare'],
	'healthium potion': ['healthium potion', 'health potion', 'hp potion', 'hp', 'rare'],
	'instant deathium potion': ['instant deathium potion', 'death potion', 'rare'],
	'grass_ice': ['frozen grass'],
	'grass_dry': ['dry grass'],
	'shock_powder': ['shock powder', 'electric powder', 'fungal soil'], // typo in the game...
	// Funny "lc" and "ap" don't really work because they are substrings of other things
	// Puzzle aliases
	'oil_receptacle_puzzle': ['oil receptacle puzzle', 'receptacle', 'oil puzzle', 'mines puzzle', 'puzzle', 'ruusu', 'rose wand', 'rose'],
	'steam_receptacle_puzzle': ['steam receptacle puzzle', 'receptacle', 'steam puzzle', 'coal pits puzzle', 'puzzle', 'kiekurakeppi', 'spiral rod', 'wooden wand', 'wood'],
	'water_receptacle_puzzle': ['water receptacle puzzle', 'receptacle', 'water puzzle', 'snowy depths puzzle', 'puzzle', 'valtikka', 'scepter'],
	'vault_puzzle_arpaluu': ['vault puzzle', 'puzzle', 'receptacle', 'arpaluu', 'skull wand', 'skull'],
	'vault_puzzle_varpuluuta': ['vault puzzle', 'puzzle', 'receptacle', 'varpuluuta', 'broom wand', 'broom'],
	// Silly things
	'CHAINSAW': ['chainsaw', 'dunk', 'bald', 'dunkisbald', 'dunk is bald', 'rant'],
	'MANA_REDUCE': ['add mana', 'mana reduce', 'addmana', 'lasiace', 'lasiacchi'],
	'dragon': ['dragon', 'dwagon', 'suomuhauki'],
	'tiny': ['tiny', 'slime maggot', 'limatoukka'],
	// The well-known boss of many names. Not actually useful for search though.
	'pit_boss': ['pit boss', 'pitboss', 'sauvojen tuntija', 'connoisseur of wands', 'wand connoisseur', 'bridge boss', 'wand boss', 'bridgeboss', 'wandboss', 'squidward'],
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
	'greed_orb': 'Cruel Orb',
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
	// Oddly named materials (using different names in their material data from their IDs)
	'just_death': 'Instant Deathium',
	
	'fungus_powder': 'Fungal Soil',
	'grass_ice': 'Ice', // Not a great display name
	'grass_dark': 'Grass',
	'grass_dry': 'Grass',
	'plastic_grey': 'Plastic',
	'plastic_grey_molten': 'Molten Plastic',
	'material_darkness': 'Ominous Liquid',
	'glass_broken': 'Glass',
	'slime_yellow': 'Slime',
	'slime_green': 'Slime',
	'gunpowder_unstable_big': 'Gunpowder',
	'sand_petrify': 'Sand',
	'sand_surface': 'Sand',
	'plant_material_dark': 'Plant Material',
	'soil_lush': 'Soil',
	'soil_dead': 'Barren Soil',
	'soil_lush_dark': 'Soil',
	'soil_dark': 'Barren Soil',
	'shock_powder': 'Fungal Soil', // Typo included lol

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
	'winter_caves': 'Snowy Chasm',
	'solid_wall_tower_1': 'Tower (Mines)',
	'solid_wall_tower_2': 'Tower (Coal Mines)',
	'solid_wall_tower_3': 'Tower (Snowy Depths)',
	'solid_wall_tower_4': 'Tower (Hiisi Base)',
	'solid_wall_tower_5': 'Tower (Fungal Caverns)',
	'solid_wall_tower_6': 'Tower (Underground Jungle)',
	'solid_wall_tower_7': 'Tower (The Vault)',
	'solid_wall_tower_8': 'Tower (Temple of the Art)',
	'solid_wall_tower_9': 'Tower (Hell)',
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

	// Renamed perks (only a few exceptions, not worth storing all the info about perk display names)
	'WAND_RADAR': 'Wand Radar', //radar_wand
	'ITEM_RADAR': 'Item Radar', //radar_item
	'MOON_RADAR': 'Moon Radar', //radar_moon
	'FIRE_GAS': 'Gas Fire', //gas_fire
	'BLEED_GAS': 'Gas Blood', //gas_blood
	'DUPLICATE_PROJECTILE:': 'Duplicate Projectile', // spell_duplication
	'PEACE_WITH_GODS': 'Peace With Gods', // peace_with_steve
}

export let TRANSLATIONS = {};

export function injectTranslations(cachedData) {
	TRANSLATIONS = cachedData;
}

export async function loadTranslations() {
	try {
		const dataUrl = new URL('../data/translations.csv', import.meta.url);
		const response = await fetch(dataUrl);
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
			// Perks
			else if (key.startsWith('perk_')) {
				const normalizedKey = key.replace('perk_', '').toLowerCase();
				TRANSLATIONS[normalizedKey] = name;
			}
			// Enemies
			else if (key.startsWith('animal_')) {
				const normalizedKey = key.replace('animal_', '').toLowerCase();
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
	if (!techId) return null;
	if (ALIASES[techId]) {
		return ALIASES[techId][0]; // Return the first alias as the display name
	}
	return TRANSLATIONS[techId] || techId;
}

export function isMatch(techId, query) {
	if (!techId || !query) return false;
	const tid = techId.toLowerCase().replace(/_/g, ' ').trim();
	let q = query.toLowerCase().trim();
	if (q.match(new RegExp(`".*"`))) {
		// Exact match mode
		q = q.replace(/"/g, '').trim();
		if (tid === q) return true;
		const translated = TRANSLATIONS[techId];
		return translated && translated.toLowerCase() === q;
	}
	else {
		// Substring match mode
		if (ALIASES[techId]) {
			return ALIASES[techId].some(alias => alias.toLowerCase().includes(q));
		}
		if (tid.includes(q)) return true;
		const translated = TRANSLATIONS[techId];
		return translated && translated.toLowerCase().includes(q);
	}
}
