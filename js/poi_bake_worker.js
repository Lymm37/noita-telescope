// Builds the zoomed-out PoI marker bake (js/poi_markers.js bakePoiMarkers) off
// the draw thread. Rebuilding it in the frame was 7-13 ms every couple of wheel
// steps while zooming; the page now keeps drawing its last bake, rescaled,
// until this answers.
//
// Messages: { cmd: 'list', listId, ...flattened markers } whenever a list's
// markers, highlights or settings change; { cmd: 'bake', id, listId, z,
// accessibility, simpleSymbols } per zoom, answered with { id, bake, ms }.
import { bakePoiMarkers } from './poi_markers.js';

const lists = new Map();   // listId -> flattened markers

self.onmessage = (e) => {
	const msg = e.data;
	if (msg.cmd === 'list') {
		lists.set(msg.listId, msg);
		return;
	}
	if (msg.cmd === 'drop') {
		lists.delete(msg.listId);
		return;
	}
	const t0 = performance.now();
	let bake = null;
	try {
		const m = lists.get(msg.listId);
		if (m) bake = bakePoiMarkers(m, msg.z, msg.accessibility, msg.simpleSymbols);
	} catch (err) {
		console.error('[poi bake] failed:', err);
	}
	self.postMessage({ id: msg.id, bake, ms: performance.now() - t0 }, bake ? [bake.bitmap] : []);
};
