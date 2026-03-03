import { getWorldSize, CONTAINER_TYPES } from "./utils.js";
import { getDisplayName } from "./translations.js";
import { app } from "./app.js"; // Hacky workaround for orbs and PW display...
import { POTION_COLORS } from "./potion_config.js";

function generateHeaderHtml(name, sprite, extra, material=null) {
	let extraSprite = '';
	if (material) {
		// Attempt to colorize the PNG
		//const transparency = 'aa'; // Problem with this is that it makes the colors less saturated...
		// TODO: Look up colors from the material
		if (POTION_COLORS[material]) {
			const color = POTION_COLORS[material]; // Transparency ends up looking bad here anyway
			extraSprite = `<img class="item-sprite-header" src="./data/${sprite}_mask.png" style="filter: drop-shadow(0px 2000px 0 #${color}); mix-blend-mode: multiply; transform: translateY(-2000px);" onerror="this.style.display='none'">`;
		}
		else {
			console.log("No color found for material", material, POTION_COLORS[material]);
		}
		//console.log("Applying color filter to", sprite, "with color", color);
	}
	// Look for translation
	const translatedName = getDisplayName(name.toLowerCase());
	if (translatedName && translatedName.toLowerCase() !== name.toLowerCase()) {
		name = translatedName;
	}
	let wikiName = name;
	if (name.toLowerCase().includes('wand')) {
		// Wand names are not really going to work here...
		// I want to be able to get the custom wands, otherwise just redirect to the base wand page
		// Actually these are all on the same Wands page, at... Wands#Unique_wands
		if (name.toLowerCase().includes('ruusu')) {
			wikiName = 'Ruusu';
		}
		else if (name.toLowerCase().includes('kiekurakeppi')) {
			wikiName = 'Kiekurakeppi';
		}
		else if (name.toLowerCase().includes('valtikka')) {
			wikiName = 'Valtikka';
		}
		else if (name.toLowerCase().includes('vasta')) {
			wikiName = 'Vasta';
		}
		else if (name.toLowerCase().includes('vihta')) {
			wikiName = 'Vihta';
		}
		else if (name.toLowerCase().includes('arpaluu')) {
			wikiName = 'Arpaluu';
		}
		else if (name.toLowerCase().includes('varpuluuta')) {
			wikiName = 'Varpuluuta';
		}
		else if (name.toLowerCase().includes('taikasauva')) {
			wikiName = 'Taikasauva';
		}
		else {
			wikiName = 'Wands';
		}
	}
	if (name.toLowerCase().includes('potion')) {
		wikiName = name.toLowerCase().replace(' potion', ''); // Remove "potion" from the end of the name to just link to the material
	}
	if (name.toLowerCase().includes('pouch')) {
		wikiName = name.toLowerCase().replace(' pouch', ''); // Remove "pouch" from the end of the name to just link to the material
	}
	if (name.toLowerCase().includes('puzzle')) {
		if (name.toLowerCase() === 'vault puzzle') {
			wikiName = 'The_Vault#Puzzles';
		}
		// Need more details for the others which we don't really have here oops
	}
	if (name.toLowerCase().includes('holy mountain') || name.toLowerCase().includes('pacifist')) {
		wikiName = 'Holy_Mountain';
	}
	if (name.toLowerCase().includes('utility_box')) {
		wikiName = 'Utility_Box'; // Annoying this one doesn't redirect properly
	}
	// TODO: Still missing a lot, but at least the spells work correctly
	const wikiPage = `https://noita.wiki.gg/wiki/${wikiName.replace(/\s+/g, '_')}`;
	return `
		<div class="item-header">
			<a href=${wikiPage} target="_blank">
			<div class="header-slot" style="overflow: hidden; position: relative;">
				<img class="item-sprite-header" src="./data/${sprite}.png" onerror="this.style.display='none'">
				${extraSprite}
			</div>
			</a>
			<div>
				<b style="color:#dca44b; font-size: 20px;">${name.toUpperCase()}</b><br>
				${extra || ''}
			</div>
		</div>
	`;
}

function generateFooterHtml(hit) {
	let objX = hit.x;
	let objY = hit.y;
	const biomeName = getDisplayName(hit.biome) || hit.biome || 'Unknown';
	if (hit.type === 'item' && hit.item === 'orb') {
		// Hack positions for PWs since orbs are generated before PW shift and don't have their coordinates adjusted in scanLayerPois
		objX += app.pw * 512 * getWorldSize(app.isNGP);
	}
	return `
		<div style="margin-top:10px; font-size:12px; border-top:1px solid #333; padding-top:5px; color:#aaa;">
			Position: ${Math.floor(objX)}, ${Math.floor(objY)}<br>
			PW: ${app.pw}, ${app.pwVertical} | Biome: ${biomeName}
		</div>
	`;
}

function generateWandHtml(wand) {
	const length = wand.tip.x - wand.grip.x;
	const tipOffset = wand.tip.y - wand.grip.y;
	const tipOffsetText = `${tipOffset != 0 ? ' | Offset ' + tipOffset : ''}`;
	const spellsHtml = generateSpellListHtml(wand.cards, wand.deck_capacity);
	
	let wandName = (wand.name) ? wand.name.toUpperCase() + ' WAND' : 'WAND';
	const wandType = (wand.original_force_unshuffle) ? 'non-shuffle' : `${wand.wand_type}`;
	
	if (wand.count && wand.count > 1) {
		wandName = `${wandName} ×${wand.count}`;
	}

	//const pos = `(${Math.floor(wand.x)}, ${Math.floor(wand.y)})`;

	let wandTier = wand.level ? 'tier ' + wand.level : '';
	let extraInfo = `<small>${wandType} ${wandTier} ${wand.is_rare ? '(rare)' : ''} | Length ${length}${tipOffsetText} | Sprite ${wand.sprite.substring(5)} </small>`;
	if (document.getElementById('debug-rng-info').checked) {
		extraInfo += `<br><small>RNG State: ${wand.r}, ${wand.r0}</small>`;
	}
	return `
	${generateHeaderHtml(wandName, 'wand_sprites/' + wand.sprite, extraInfo)}
	<div style="font-size: 14px; line-height: 1.5; text-align: left;">
		<b>Shuffle:</b> ${wand.shuffle_deck_when_empty ? 'Yes' : 'No'}<br>
		<b>Spells/Cast:</b> ${Math.floor(wand.actions_per_round)}<br>
		<b>Cast Delay:</b> ${(wand.fire_rate_wait/60).toFixed(2)}s<br>
		<b>Recharge Time:</b> ${(wand.reload_time/60).toFixed(2)}s<br>
		<b>Mana Max:</b> ${Math.floor(wand.mana_max)} <br>
		<b>Mana Charge Speed:</b> ${Math.floor(wand.mana_charge_speed)}<br>
		<b>Capacity:</b> ${Math.floor(wand.deck_capacity)}<br>
		<b>Spread:</b> ${wand.spread_degrees}°<br>
		<b>Speed Multiplier:</b> ${wand.speed_multiplier.toFixed(3)}<br>
		${wand.always_casts && wand.always_casts.length > 0 ? `<b>Always Casts:</b> ${generateSpellListHtml(wand.always_casts, wand.always_casts.length)}` : ''}
	</div>
	${spellsHtml}
	`;
}

function generateItemHtml(item) {

	if (item.enemy) {
		let spriteName = 'enemy_sprites/' + item.enemy.toLowerCase().replace(/\s+/g, '_');
		return generateHeaderHtml(item.enemy.toUpperCase(), spriteName, '', null);
	}

	if (item.item === 'spell') {
		let spriteName = 'spell_sprites/' + item.spell.toLowerCase().replace(/\s+/g, '_');
		let spellName = getDisplayName(item.spell) || item.spell;
		return generateHeaderHtml(spellName.toUpperCase(), spriteName, '', null);
	}

	let itemName = item.item || 'Item';
	
	let spriteName = 'item_sprites/' + itemName.toLowerCase().replace(/\s+/g, '_');
	// Hack for orbs
	if (app.pw !== 0 && item.item === 'orb') {
		spriteName = 'item_sprites/orb_cursed';
		itemName = 'Cursed Orb';
	}
	
	if (item.material) {
		// Translate to normal language
		const translatedMaterial = getDisplayName(item.material);
		itemName = `${translatedMaterial} ${itemName}`;
	}

	// Used for gold
	if (item.amount && item.amount > 1) {
		itemName = `${itemName} $${item.amount}`;
	}
	// Used for duplicate items
	else if (item.count && item.count > 1) {
		itemName = `${itemName} ×${item.count}`;
	}

	// Special treasure
	if (item.item === 'treasure') {
		if (app.perks["greedCurse"]) {
			itemName = 'Divide by 10';
			spriteName = 'spell_sprites/divide_10';
		}
		else {
			itemName = 'Burst of Air';
			spriteName = 'spell_sprites/air_bullet';
		}
	}

	let extraInfo = '';
	let material = null;
	if (item.item === 'potion' || item.item === 'pouch') {
		extraInfo = `<div><b>Material:</b> <span class="material-text">${item.material}</span></div>`;
		material = item.material;
	}
	if (item.item.includes('runestone')) {
		extraInfo = `<div><b>Active:</b> <span class="material-text">${item.active ? 'Yes' : 'No'}</span></div>`;
	}

	if (document.getElementById('debug-rng-info').checked) {
		extraInfo += `<br><small>RNG State: ${item.r}, ${item.r0}</small>`;
	}

	return generateHeaderHtml(itemName.toUpperCase(), spriteName, extraInfo, material);
}

function generateItemListHtml(items) {
	let html = '<div class="inventory-grid">';
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		if (item) {
			html += `<div class="slot">`;
			const icon = item.item.toLowerCase() + ".png";
			let itemCount = "";
			if (item.amount && item.amount > 1) {
				itemCount = ` $${item.amount}&nbsp;`;
			}
			else if (item.count && item.count > 1) {
				itemCount = ` ×${item.count}&nbsp;`;
			}
			const translatedName = getDisplayName(item.item.toLowerCase());
			const title = translatedName ? translatedName : item.item;
			const wikiPage = `https://noita.wiki.gg/wiki/${item.item}`;
			html += `<a href="${wikiPage}" target="_blank"><img class="spell-icon" src="./data/item_sprites/${icon}" title="${title}" onerror="this.style.display='none'"></a>`;
			html += `</div>${itemCount}`;
		}
	}
	html += '</div>';
	return html;
}

function generateSpellListHtml(spells, capacity) {
	let html = '<div class="inventory-grid">';
	for (let i = 0; i < Math.floor(capacity); i++) {
		const spellName = spells[i];
		html += `<div class="slot">`;
		if (spellName) {
			const icon = spellName.toLowerCase() + ".png";
			const translatedName = getDisplayName(spellName);
			const title = translatedName ? `${translatedName} (${spellName})` : spellName;
			const wikiPage = `https://noita.wiki.gg/wiki/${spellName}`;
			html += `<a href="${wikiPage}" target="_blank"><img class="spell-icon" src="./data/spell_sprites/${icon}" title="${title}" onerror="this.style.display='none'"></a>`;
		}
		html += `</div>`;
	}
	html += '</div>';
	return html;
}

export function updateTooltip(e, hit, tip) {
	//const displayName = ALIASES[hit.name] ? `${hit.name} (${ALIASES[hit.name][0]})` : hit.name;

	const rect = document.getElementById('view').getBoundingClientRect();
	tip.style.display = 'block';

	// If e is provided, use mouse position. Otherwise, use fixed center (from search)
	if (e) {
		// Normal Hover/Click position
		tip.style.left = (e.clientX - rect.left + 15) + 'px';
		tip.style.top = (e.clientY - rect.top + 15) + 'px';
		tip.style.transform = 'none';
	} else {
		// Goto (Search) position - centered
		tip.style.left = '50%';
		tip.style.top = '45%';
		tip.style.transform = 'translate(-50%, -50%)';
	}

	if (hit) {
		if (hit.type === 'wand') {
			let wandHtml = generateWandHtml(hit);
			tip.innerHTML = `${wandHtml}
				${generateFooterHtml(hit)}`;
		}
		else if (hit.type === 'item') {
			tip.innerHTML = `
				${generateItemHtml(hit)}
				${generateFooterHtml(hit)}
			`;
		}
		else if (hit.type === 'enemy') {
			// Currently only used for mimics
			const tempItem = {type:'item', item: hit.enemy}
			tip.innerHTML = `
				${generateItemHtml(tempItem)}
				${generateFooterHtml(hit)}
			`;
		}
		else if (hit.type === 'holy_mountain_shop') {
			const shop = hit;
			const items = shop.items;
			let shop_contents = '';
			if (items && items.length > 0) {
				if (items[0].item === 'wand') {
					// Wands
					shop_contents += items.map(wand => generateWandHtml(wand)).join('');
				}
				else {
					// Spells (two rows of some amount)
					const capacity = Math.floor(items.length / 2);
					let top_shelf = []
					let bottom_shelf = [];
					for (let i = 0; i < capacity; i++) {
						top_shelf.push(items[2*i].spell);
						bottom_shelf.push(items[2*i + 1].spell);
					}
					shop_contents += `${generateSpellListHtml(top_shelf, capacity)}<br>${generateSpellListHtml(bottom_shelf, capacity)}`;
				}
			}
			let displayType = hit.type.replace(/_/g, ' ').toUpperCase();
			tip.innerHTML = `
				${generateHeaderHtml(displayType, 'item_sprites/' + hit.type, '')}
				<div style="font-size: 14px; line-height: 1.5; text-align: left;">
					${shop_contents}
					${generateFooterHtml(hit)}
				</div>
			`;
		}
		// Containers
		else if (CONTAINER_TYPES.includes(hit.type)) {
			const box = hit;
			const items = box.items;
			let box_spells = [];
			let box_containers = [];
			let box_items = [];
			let box_wands = [];
			let box_contents;// = '';
			if (items && items.length > 0) {
				box_contents = '<b>Contains:</b><br>';
				// TODO: Handle duplicates and just note the count instead of making a bunch of copies in the HTML
				items.forEach(item => {
					if (item.ignore) return; // Skip dummy items to identify
					if (item.item === 'wand') {
						box_wands.push(item);
					}
					else if (item.item === 'potion' || item.item === 'pouch') {
						box_containers.push(item);
					}
					else if (item.item === 'spell') {
						const spellName = item.spell;
						box_spells.push(spellName);
					}
					else if (item.type === 'enemy') {
						// TODO: Only used for mimics
						box_items.push({item: item.enemy});
					}
					else {
						box_items.push(item);
					}
				});
				if (box_items.length > 0) {
					box_contents += generateItemListHtml(box_items);
				}
				if (box_spells.length > 0) {
					box_contents += generateSpellListHtml(box_spells, box_spells.length);
				}
				if (box_containers.length > 0) {
					box_contents += box_containers.map(container => generateItemHtml(container)).join('');
				}
				// Add special disclaimer for dragon
				if (hit.type === 'dragon') {
					box_contents += `<br><small style="font-size: 13px; color: red;">Note: You must kill the dragon before it moves, or the wand will be different than what is shown here!</small><br>`;
				}
				if (box_wands.length > 0) {
					box_contents += box_wands.map(wand => generateWandHtml(wand)).join('');
				}
			} else {
				box_contents = '<i>Empty</i>';
			}
			if (box.materials) {
				box_contents += `<br><small><b>Puzzle materials:</b> ${box.materials}</small>`;
			}
			let displayType = hit.type.replace(/_/g, ' ').toUpperCase();
			tip.innerHTML = `
				${generateHeaderHtml(displayType, 'item_sprites/' + hit.type, '')}
				<div style="font-size: 14px; line-height: 1.5; text-align: left;">
					${box_contents}
					${generateFooterHtml(hit)}
				</div>
			`;
		}
		else if (hit.type === 'pixel_scene') {
			tip.innerHTML = `${hit.name.toUpperCase()}<br>${hit.name}<br><small>This shouldn't happen!</small><br>${generateFooterHtml(hit)}`;
		}
		else {
			tip.innerHTML = `${hit.name.toUpperCase()}<br>${hit}<br>${generateFooterHtml(hit)}`;
		}
		// Debug info
		/*
		if (hit.originalBiome) {
			tip.innerHTML += `<br><small>Original Biome: ${hit.originalBiome}</small>`;
		}
		if (hit.originalX && hit.originalY) {
			tip.innerHTML += `<br><small>Original Position: ${Math.floor(hit.originalX)}, ${Math.floor(hit.originalY)}</small>`;
		}
		*/
	} else {
		tip.innerHTML = `<b>${hit.name}</b><br>Chunk: ${hit.x}, ${hit.y}`;
	}

	if (e) {
		let x = e.clientX - rect.left + 15;
		let y = e.clientY - rect.top + 15;

		// Horizontal Flip (keep your existing logic)
		if (x + tip.offsetWidth > rect.width) {
			x = e.clientX - rect.left - tip.offsetWidth - 15;
		}

		// Vertical Constraint (Constraint bottom to screen edge)
		// If (Position + Height) > Screen Height
		if (y + tip.offsetHeight > rect.height) {
			// Shift Y upward by the amount it overflowed, plus a small margin
			y = rect.height - tip.offsetHeight - 10;
		}

		// Ensure it doesn't go off the top of the screen if the tooltip is massive
		y = Math.max(10, y);

		tip.style.left = x + 'px';
		tip.style.top = y + 'px';
		tip.style.transform = 'none';
	} else {
		// Search "Goto" position remains centered
		tip.style.left = '60%';
		tip.style.top = '40%';
		tip.style.transform = 'translate(-10%, -50%)';
	}
}

export function toggleTooltipPinned(tip, pin) {
	if (pin) tip.classList.add('pinned');
	else tip.classList.remove('pinned');
}