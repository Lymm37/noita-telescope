// PoI marker drawing: shapes, colours, the per-screen-size sprite cache, and the
// whole-world marker bake. No DOM here: the bake runs in js/poi_bake_worker.js,
// and everything the page reads from its settings (radius scale, zoom scaling)
// comes in as plain values.
import { POI_RADIUS } from './constants.js';
import { MATERIAL_CONTAINER_TYPES } from './utils.js';

// Traces one PoI's marker outline, centred on (px, py) with world-unit radius
// tempRadius, on a context that is already under the camera transform (or a
// sprite context scaled like it). Shared by the direct draw and the sprite
// cache below.
export function tracePoiShape(ctx, p, px, py, tempRadius, accessibility, simpleSymbols) {
	if (accessibility) {
		// Shapes for accessibility mode
		switch (p.type) {
			case 'wand':
				// Tall rectangle
				ctx.rect(px - tempRadius / 2, py - tempRadius, tempRadius, tempRadius * 2);
				break;
			case 'item':
				if (p.item) {
					if (p.item.includes('heart') || p.item === 'full_heal') {
						if (simpleSymbols) {
							ctx.moveTo(px - tempRadius, py - tempRadius);
							ctx.lineTo(px + tempRadius, py - tempRadius);
							ctx.lineTo(px, py + tempRadius);
							ctx.closePath();
						} else {
							ctx.moveTo(px, py - tempRadius / 3);
							ctx.bezierCurveTo(px - tempRadius, py - tempRadius, px - tempRadius, py + tempRadius / 3, px, py + tempRadius);
							ctx.bezierCurveTo(px + tempRadius, py + tempRadius / 3, px + tempRadius, py - tempRadius, px, py - tempRadius / 3);
							ctx.closePath();
						}
					}
					else if (MATERIAL_CONTAINER_TYPES.includes(p.item)) {
						if (simpleSymbols) {
							ctx.moveTo(px, py - tempRadius);
							ctx.lineTo(px + tempRadius, py + tempRadius);
							ctx.lineTo(px - tempRadius, py + tempRadius);
							ctx.closePath();
						} else {
							ctx.moveTo(px - tempRadius * 0.28, py - tempRadius);
							ctx.lineTo(px + tempRadius * 0.28, py - tempRadius);
							ctx.lineTo(px + tempRadius * 0.28, py - tempRadius * 0.42);
							ctx.bezierCurveTo(px + tempRadius * 0.28, py - tempRadius * 0.16, px + tempRadius * 0.86, py - tempRadius * 0.08, px + tempRadius * 0.88, py + tempRadius * 0.48);
							ctx.bezierCurveTo(px + tempRadius * 0.9, py + tempRadius * 0.83, px + tempRadius * 0.48, py + tempRadius, px, py + tempRadius);
							ctx.bezierCurveTo(px - tempRadius * 0.48, py + tempRadius, px - tempRadius * 0.9, py + tempRadius * 0.83, px - tempRadius * 0.88, py + tempRadius * 0.48);
							ctx.bezierCurveTo(px - tempRadius * 0.86, py - tempRadius * 0.08, px - tempRadius * 0.28, py - tempRadius * 0.16, px - tempRadius * 0.28, py - tempRadius * 0.42);
							ctx.closePath();
						}
					}
					else if (p.item === 'portal' || p.item === 'meditation_cube' || p.item === 'buried_eye_teleporter' || p.item === 'trailer_altar') {
						// Pentagon
						ctx.moveTo(px, py - tempRadius);
						for (let i = 1; i < 5; i++) {
							const angle = (Math.PI / 2) + (i * (2 * Math.PI / 5));
							ctx.lineTo(px - tempRadius * Math.cos(angle), py - tempRadius * Math.sin(angle));
						}
						ctx.closePath();
						break;
					}
					else if (p.item === 'refresh_mimic' || p.item === 'heart_mimic' || p.item === 'mimic' || p.item === 'chest_leggy' || p.item === 'mimic_potion') {
						// X shape
						const thickness = tempRadius / 2;
						ctx.moveTo(px - tempRadius, py - thickness);
						ctx.lineTo(px - thickness, py - tempRadius);
						ctx.lineTo(px, py - thickness);
						ctx.lineTo(px + thickness, py - tempRadius);
						ctx.lineTo(px + tempRadius, py - thickness);
						ctx.lineTo(px + thickness, py);
						ctx.lineTo(px + tempRadius, py + thickness);
						ctx.lineTo(px + thickness, py + tempRadius);
						ctx.lineTo(px, py + thickness);
						ctx.lineTo(px - thickness, py + tempRadius);
						ctx.lineTo(px - tempRadius, py + thickness);
						ctx.lineTo(px - thickness, py);
						ctx.closePath();
					}
					else {
						// Square (slightly scaled down because the other stuff looks smaller by area)
						ctx.rect(px - 3*tempRadius/4, py - 3*tempRadius/4, tempRadius * 1.5, tempRadius * 1.5);
					}
				}
				break;
			case 'utility_box':
			case 'puzzle':
			case 'vault_puzzle':
				// Diamond
				ctx.moveTo(px, py - tempRadius);
				ctx.lineTo(px - tempRadius, py);
				ctx.lineTo(px, py + tempRadius);
				ctx.lineTo(px + tempRadius, py);
				ctx.closePath();
				break;
			case 'chest':
			case 'pacifist_chest':
			case 'great_chest':
				// Wide rectangle
				ctx.rect(px - tempRadius, py - tempRadius/2, tempRadius * 2, tempRadius);
				break;
			case 'shop':
			case 'holy_mountain_shop':
				// Hexagon
				ctx.moveTo(px, py + tempRadius);
				for (let i = 1; i < 6; i++) {
					const angle = (Math.PI / 2) + (i * (2 * Math.PI / 6));
					ctx.lineTo(px + tempRadius * Math.cos(angle), py + tempRadius * Math.sin(angle));
				}
				ctx.closePath();
				break;
			case 'eye_room':
				// Eye shape (horizontal)
				ctx.moveTo(px - tempRadius, py);
				ctx.quadraticCurveTo(px, py - tempRadius, px + tempRadius, py);
				ctx.quadraticCurveTo(px, py + tempRadius, px - tempRadius, py);
				ctx.closePath();
				break;
			case 'enemies':
				// Circle
				ctx.arc(px, py, tempRadius*0.7, 0, Math.PI * 2);
				break;
			default:
				ctx.arc(px, py, tempRadius, 0, Math.PI * 2); // Default to circle
		}
	}
	else {
		// Colored circles
		ctx.arc(px, py, tempRadius, 0, Math.PI * 2);
	}
}

// PoI marker sprites. At the overview zoom every PoI in the world is on screen
// -- thousands of anti-aliased path fills and strokes a frame, which the GPU
// canvas rasterizes one by one (it was the difference between 0 and ~30 long
// frames per 120 while dragging). A marker a few screen pixels across is
// rendered once per (shape, colour, screen radius) into a screen-resolution
// sprite and blitted from then on; drawImage of the same bitmap batches.
// Large markers (zoomed in, few in view) keep the direct path draw.
export const POI_SPRITE_MAX_SCREEN_RADIUS = 24;
const POI_SPRITE_CACHE_MAX = 512;
const poiSpriteCache = new Map();

export function poiSprite(p, poiColor, tempRadius, zoom, accessibility, simpleSymbols) {
	const highlight = p.highlight === true;
	// Half-pixel steps keep the set bounded while zooming continuously.
	const screenR = Math.round(tempRadius * zoom * 2) / 2;
	const shape = accessibility ? `${p.type}|${p.item || ''}|${simpleSymbols ? 1 : 0}` : 'o';
	const key = `${shape}|${poiColor}|${highlight ? 1 : 0}|${screenR}`;
	let sprite = poiSpriteCache.get(key);
	if (sprite) return sprite;
	const lineScale = highlight ? 0.4 : 0.08;
	const size = Math.ceil(2 * screenR * (1 + lineScale / 2)) + 4;
	const scale = screenR / tempRadius;
	const canvas = new OffscreenCanvas(size, size);
	const ctx = canvas.getContext('2d');
	ctx.translate(size / 2, size / 2);
	ctx.scale(scale, scale);
	ctx.strokeStyle = '#000000AA';
	ctx.beginPath();
	tracePoiShape(ctx, p, 0, 0, tempRadius, accessibility, simpleSymbols);
	ctx.fillStyle = poiColor;
	ctx.fill();
	ctx.lineWidth = tempRadius * lineScale;
	ctx.stroke();
	if (poiSpriteCache.size >= POI_SPRITE_CACHE_MAX) {
		for (const old of poiSpriteCache.values()) old.bitmap.close?.();
		poiSpriteCache.clear();
	}
	sprite = { bitmap: canvas.transferToImageBitmap(), size, scale };
	poiSpriteCache.set(key, sprite);
	return sprite;
}

// The marker colour of one PoI, by what it is.
export function poiColorFor(p) {
	let poiColor = '#FFFFFFAA'; // Default color for unknown PoIs
	// If the wand has specific world data, use it for exact precision
	switch (p.type) {
		case 'wand':
			poiColor = '#00FFFFAA';
			break;
		case 'item':
			if (p.item) {
				if (p.item.includes('heart') || p.item === 'full_heal') {
					poiColor = '#FF0000AA';
				}
				else if (MATERIAL_CONTAINER_TYPES.includes(p.item)) {
					poiColor = '#0000FFAA';
				}
				else if (p.item === 'portal' || p.item === 'meditation_cube' || p.item === 'buried_eye_teleporter' || p.item === 'trailer_altar') {
					poiColor = '#800080AA';
				}
				else if (p.item === 'refresh_mimic' || p.item === 'heart_mimic' || p.item === 'mimic' || p.item === 'chest_leggy' || p.item === 'mimic_potion') {
					poiColor = '#AAAAAAAA';
				}
				else {
					poiColor = '#FFFF00AA';
				}
			}
			break;
		case 'utility_box':
		case 'puzzle':
		case 'vault_puzzle':
			poiColor = '#FF00FFAA';
			break;
		case 'chest':
		case 'pacifist_chest':
			poiColor = '#FFA500AA';
			break;
		case 'great_chest':
			poiColor = '#FF5500AA';
			break;
		case 'shop':
		case 'eye_room':
		case 'holy_mountain_shop':
			poiColor = '#00FF00AA';
			break;
		case 'enemies':
			poiColor = '#AAAAAAAA';
			for (let item of p.items) {
				if (item.type === 'wand') {
					poiColor = '#00FFFFAA';
					break;
				}
			}
			break;
		// Add more cases as needed for different PoI types
	}
	return poiColor;
}

/**
 * A marker's radius in world units at camera zoom `zoom`. `opts` is what the
 * page reads from its debug inputs once per draw (poiRadiusOptions in app.js):
 * { scale, hlScale, zoomScaled, hlZoomScaled }.
 */
export function poiRadius(poi, zoom, opts) {
	const [constant, perInvZoom] = poiRadiusTerms(poi, opts);
	return constant + perInvZoom / zoom;
}

/**
 * poiRadius as `constant + perInvZoom / zoom`: exactly one of the two is non-zero
 * (markers either keep a world size or, with zoom scaling on, a screen size), so
 * the bake worker can take them once per marker list and apply any zoom itself.
 */
export function poiRadiusTerms(poi, opts) {
	const isHighlighted = poi.highlight === true;
	const factor = (isHighlighted ? 3.0 : 1.0) * (isHighlighted ? opts.hlScale : opts.scale);
	if (isHighlighted ? opts.hlZoomScaled : opts.zoomScaled) {
		// It's way too big when zoomed
		return [0, POI_RADIUS * 0.25 * factor];
	}
	let radius = POI_RADIUS;
	if (poi.type === 'enemies' || poi.type === 'props') {
		radius /= 2.0;
		for (const item of poi.items) {
			if (item.type === 'wand') {
				radius = POI_RADIUS;
				break;
			}
		}
	}
	return [radius * factor, 0];
}

/**
 * Every marker of one world copy drawn at screen resolution for zoom `z`, as
 * one bitmap. `m` is the list flattened by the page (which resolves colours
 * and radius terms from its settings): xs/ys in world units, rConst/rInvZ
 * (radius = rConst + rInvZ / z), colors, hls (highlight 0/1), types, items.
 * Returns { bitmap, x, y, w, h } with the rect in world units, or null when
 * there is nothing to draw or the bitmap would be too large.
 */
export function bakePoiMarkers(m, z, accessibility, simpleSymbols) {
	const { xs, ys, rConst, rInvZ, colors, hls, types, items } = m;
	const n = xs.length;
	if (!n) return null;
	const rs = new Float32Array(n);
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (let i = 0; i < n; i++) {
		const r = rs[i] = rConst[i] + rInvZ[i] / z;
		const reach = r * 2;
		if (xs[i] - reach < minX) minX = xs[i] - reach;
		if (ys[i] - reach < minY) minY = ys[i] - reach;
		if (xs[i] + reach > maxX) maxX = xs[i] + reach;
		if (ys[i] + reach > maxY) maxY = ys[i] + reach;
	}
	// Rounded up to a 256 px grid: each zoom step would otherwise produce a bitmap
	// of a new size, and the page's canvas allocates a new GPU texture for every
	// size it has not drawn yet -- the first zoom through a range paid that on
	// nearly every step. The padding is transparent.
	const w = Math.ceil((Math.ceil((maxX - minX) * z) + 2) / 256) * 256;
	const h = Math.ceil((Math.ceil((maxY - minY) * z) + 2) / 256) * 256;
	if (w > 8192 || h > 8192) return null;
	const canvas = new OffscreenCanvas(w, h);
	const bctx = canvas.getContext('2d');
	bctx.imageSmoothingEnabled = false;
	bctx.scale(z, z);
	bctx.translate(-minX, -minY);
	bctx.strokeStyle = '#000000AA';
	const p = { type: '', item: null, highlight: false };
	for (let i = 0; i < n; i++) {
		p.type = types[i]; p.item = items[i]; p.highlight = hls[i] === 1;
		const x = xs[i], y = ys[i], r = rs[i], color = colors[i];
		if (r * z <= POI_SPRITE_MAX_SCREEN_RADIUS) {
			const sprite = poiSprite(p, color, r, z, accessibility, simpleSymbols);
			const half = sprite.size / (2 * sprite.scale), full = sprite.size / sprite.scale;
			bctx.drawImage(sprite.bitmap, x - half, y - half, full, full);
		} else {
			bctx.beginPath();
			tracePoiShape(bctx, p, x, y, r, accessibility, simpleSymbols);
			bctx.fillStyle = color;
			bctx.fill();
			bctx.lineWidth = r * (p.highlight ? 0.4 : 0.08);
			bctx.stroke();
		}
	}
	return { bitmap: canvas.transferToImageBitmap(), x: minX, y: minY, w: w / z, h: h / z };
}
