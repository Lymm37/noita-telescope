import { ALL_SPELLS } from "./spells.js";
import { getDisplayName } from "./translations.js";
import { setIconImg } from "./icon_sheets.js";
import { PERKS } from "./perks.js";

const PROGRESS_ENEMIES = [
	'player',
	'sheep',
	'sheep_bat',
	'sheep_fly',
	'scorpion',
	'fish',
	'fish_large',
	'duck',
	'wolf',
	'deer',
	'elk',
	'eel',
	'zombie_weak',
	'zombie',
	'miner_weak',
	'miner',
	'miner_fire',
	'miner_santa',
	'miner_chef',
	'goblin_bomb',
	'shotgunner_weak',
	'shotgunner',
	'scavenger_smg',
	'scavenger_grenade',
	'scavenger_mine',
	'scavenger_heal',
	'scavenger_glue',
	'scavenger_invis',
	'scavenger_shield',
	'scavenger_poison',
	'scavenger_clusterbomb',
	'scavenger_leader',
	'alchemist',
	'sniper',
	'shaman',
	'coward',
	'flamer',
	'icer',
	'bigzombie',
	'bigzombietorso',
	'bigzombiehead',
	'slimeshooter_weak',
	'slimeshooter',
	'acidshooter_weak',
	'acidshooter',
	'lasershooter',
	'giantshooter_weak',
	'giantshooter',
	'miniblob',
	'blob',
	'ant',
	'rat',
	'bat',
	'bigbat',
	'firebug',
	'bigfirebug',
	'bloom',
	'shooterflower',
	'fly',
	'frog',
	'frog_big',
	'fungus',
	'fungus_big',
	'fungus_giga',
	'lurker',
	'maggot',
	'skullrat',
	'skullfly',
	'tentacler_small',
	'tentacler',
	'ghoul',
	'giant',
	'pebble_physics',
	'longleg',
	'lukki_tiny',
	'lukki',
	'lukki_longleg',
	'lukki_creepy_long',
	'lukki_dark',
	'worm_tiny',
	'worm',
	'worm_big',
	'worm_skull',
	'worm_end',
	'drone_physics',
	'drone_lasership',
	'drone_shield',
	'basebot_sentry',
	'basebot_hidden',
	'basebot_neutralizer',
	'basebot_soldier',
	'healerdrone_physics',
	'roboguard',
	'roboguard_big',
	'assassin',
	'spearbot',
	'tank',
	'tank_rocket',
	'tank_super',
	// This is so silly but it's fun
	{
		id: 'turret',
		name: 'Turret',
		spriteId: 'turret_left',
		leftSpriteId: 'turret_left',
		rightSpriteId: 'turret_right',
		leftSearchTerm: 'turret_left',
		rightSearchTerm: 'turret_right'
	},
	'monk',
	'missilecrab',
	'necrobot',
	'necrobot_super',
	'fireskull',
	'iceskull',
	'thunderskull',
	'firemage_weak',
	'firemage',
	'icemage',
	'thundermage',
	'thundermage_big',
	'barfer',
	'wizard_dark',
	'wizard_tele',
	'wizard_poly',
	'wizard_swapper',
	'wizard_neutral',
	'wizard_returner',
	'wizard_hearty',
	'wizard_homing',
	'wizard_weaken',
	'wizard_twitchy',
	'enlightened_alchemist',
	'failed_alchemist',
	'failed_alchemist_b',
	'wraith',
	'wraith_storm',
	'wraith_glowing',
	'statue',
	'statue_physics',
	'snowcrystal',
	'hpcrystal',
	'ghost',
	'wand_ghost',
	'ethereal_being',
	'playerghost',
	'phantom_a',
	'phantom_b',
	'confusespirit',
	'berserkspirit',
	'weakspirit',
	'slimespirit',
	'necromancer',
	'gazer',
	'skygazer',
	'spitmonster',
	'crystal_physics',
	'bloodcrystal_physics',
	'skycrystal_physics',
	'chest_mimic',
	'chest_leggy',
	'miner_hell',
	'shotgunner_hell',
	'sniper_hell',
	'dark_alchemist',
	'shaman_wind',
	'necromancer_shop',
	'necromancer_super',
	'boss_dragon',
	'boss_limbs',
	'boss_meat',
	'boss_alchemist',
	'parallel_alchemist',
	'boss_ghost',
	'boss_ghost_polyp',
	'islandspirit',
	'boss_pit',
	'boss_robot',
	'fish_giga',
	'maggot_tiny',
	'parallel_tentacles',
	'minipit',
	'gate_monster_a',
	'gate_monster_b',
	'gate_monster_c',
	'gate_monster_d',
	'boss_wizard',
	'boss_centipede',
	'ultimate_killer',
	'friend',
	'boss_sky',
	'meatmaggot',
	'mimic_potion'
];
let usedSpells = new Set();
let showMissingSpells = false;

function formatProgressName(id) {
	return id.split('_')
		.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(' ');
}

function createProgressCard(item) {
	const card = document.createElement('button');
	card.type = 'button';
	card.className = `progress-card${item.used && !showMissingSpells ? ' complete' : ''}${item.missing && showMissingSpells ? ' missing' : ''}`;
	card.dataset.category = item.category;
	card.dataset.spellName = item.id;
	if (item.leftSearchTerm && item.rightSearchTerm) {
		card.dataset.leftSearchTerm = item.leftSearchTerm;
		card.dataset.rightSearchTerm = item.rightSearchTerm;
	}
	card.title = item.name;
	card.setAttribute('aria-label', item.name);

	const slot = document.createElement('span');
	slot.className = 'slot';
	const image = document.createElement('img');
	image.className = 'spell-icon';
	setIconImg(image, item.spriteFolder, (item.spriteId || item.id).toLowerCase());
	image.alt = item.name;
	if (item.leftSpriteId && item.rightSpriteId) {
		card.onpointermove = (event) => {
			const bounds = card.getBoundingClientRect();
			const spriteId = event.clientX < bounds.left + bounds.width / 2
				? item.leftSpriteId
				: item.rightSpriteId;
			setIconImg(image, item.spriteFolder, spriteId);
		};
		card.onpointerleave = () => {
			setIconImg(image, item.spriteFolder, item.spriteId);
		};
	}
	slot.appendChild(image);
	card.appendChild(slot);
	return card;
}

function renderProgressLists() {
	const lists = document.getElementById('progress-lists');
	if (!lists) return;

	const categories = [
		{
			title: 'Perks',
			items: PERKS.map(perk => ({
				id: perk.id,
				name: perk.name || formatProgressName(perk.id),
				category: 'perks',
				spriteFolder: 'perk_sprites'
			}))
		},
		{
			title: 'Spells',
			items: ALL_SPELLS.map(spell => ({
				id: spell.name,
				name: getDisplayName(spell.name) || formatProgressName(spell.name),
				category: 'spells',
				used: usedSpells.has(spell.name),
				missing: !usedSpells.has(spell.name),
				spriteFolder: 'spell_sprites'
			}))
		},
		{
			title: 'Enemies',
			items: PROGRESS_ENEMIES.map(enemy => ({
				id: typeof enemy === 'string' ? enemy : enemy.id,
				name: typeof enemy === 'string' ? formatProgressName(enemy) : enemy.name,
				category: 'enemies',
				spriteFolder: 'enemy_sprites',
				spriteId: typeof enemy === 'string' ? enemy : enemy.spriteId,
				leftSpriteId: typeof enemy === 'string' ? undefined : enemy.leftSpriteId,
				rightSpriteId: typeof enemy === 'string' ? undefined : enemy.rightSpriteId,
				leftSearchTerm: typeof enemy === 'string' ? undefined : enemy.leftSearchTerm,
				rightSearchTerm: typeof enemy === 'string' ? undefined : enemy.rightSearchTerm
			}))
		}
	];

	lists.replaceChildren(...categories.map(category => {
		const section = document.createElement('section');
		section.className = 'progress-section';
		section.dataset.category = category.items[0].category;
		const completed = category.items.filter(item => item.used).length;
		const heading = document.createElement('h3');
		heading.textContent = category.title === 'Spells'
			? `${category.title} - ${completed}/${category.items.length}`
			: category.title;
		const grid = document.createElement('div');
		grid.className = 'progress-grid';
		grid.append(...category.items.map(createProgressCard));
		section.append(heading, grid);
		return section;
	}));
}

export function updateUsedSpellProgress(actionFlags) {
	usedSpells = new Set([...actionFlags].map(flag => flag.replace(/^action_/, '').toUpperCase()));
	if (document.getElementById('progress-overlay')?.style.display === 'flex') renderProgressLists();
}

export function getMissingProgressSpells() {
	return ALL_SPELLS
		.map(spell => spell.name)
		.filter(spellName => !usedSpells.has(spellName));
}

export function setupProgressUI(onSpellSearch) {
	const overlay = document.getElementById('progress-overlay');
	const lists = document.getElementById('progress-lists');
	const closeButton = document.getElementById('progress-close');
	const showMissingCheckbox = document.getElementById('progress-show-missing');
	if (!overlay || !lists || !closeButton || !showMissingCheckbox) return;

	const setVisible = (visible) => {
		overlay.style.display = visible ? 'flex' : 'none';
		if (visible) {
			renderProgressLists();
			document.dispatchEvent(new CustomEvent('telescope-overlay-open', {
				detail: { overlayId: 'progress-overlay' }
			}));
		}
		document.getElementById('progress-button').textContent = overlay.style.display === 'flex' ? 'Close Progress ◀' : 'Open Progress ▶';
	};
	document.addEventListener('telescope-overlay-open', (event) => {
		if (event.detail.overlayId !== 'progress-overlay') setVisible(false);
	});

	document.getElementById('progress-button').onclick = () => {
		// Toggle visibility
		setVisible(overlay.style.display !== 'flex');
	};
	closeButton.onclick = () => {
		setVisible(false);
	};
	showMissingCheckbox.onchange = () => {
		showMissingSpells = showMissingCheckbox.checked;
		renderProgressLists();
	};
	lists.onclick = (event) => {
		const card = event.target.closest('.progress-card');
		if (card?.dataset.category === 'spells' || card?.dataset.category === 'enemies') {
			let searchTerm = card.dataset.spellName;
			if (card.dataset.leftSearchTerm && card.dataset.rightSearchTerm) {
				const bounds = card.getBoundingClientRect();
				searchTerm = event.clientX < bounds.left + bounds.width / 2
					? card.dataset.leftSearchTerm
					: card.dataset.rightSearchTerm;
			}
			onSpellSearch(searchTerm, card.dataset.category);
		}
	};
}