// Render HUD (debug panel "Render HUD"): a bottom-right overlay showing where
// wall time goes, what asynchronous render work is outstanding, and what
// recently finished.
//
// Three places time is spent, measured three different ways:
//   main   -- drawNow's per-layer buckets (the markLayer profiler in app.js),
//             plus main-thread work outside drawNow that reports itself.
//   worker -- the overlay worker's own clock around each job it runs
//             (JOB_START / JOB_DONE, overlay_worker.js), a separate thread.
//   gpu    -- EXT_disjoint_timer_query_webgl2 around the WebGL passes only
//             (terrain draw, decal material-id resolve). Canvas2D layers are
//             rasterized by the browser's GPU process, which JS cannot time:
//             their cost shows up as main-thread recording time only.
//
// Traced items ("rendering items") are worker jobs and GPU resolves: posted,
// staged (gpu -> queued -> running), finished. Tracing only happens while the
// HUD is on; nothing here touches the DOM until it is switched on, because the
// overlay worker and the Node GL tests import modules that import this one.

const WINDOW_MS = 2000;      // utilization window for the bars
const STRIP_MS = 30000;      // history strip span
const TICK_MS = 250;
const HISTORY_MAX = 14;
const QUEUE_ROWS = 12;
const STALE_MS = 60000;      // a traced item never answered is dropped after this

// Validated categorical slots 1-3 (dataviz reference palette, dark steps) on
// the HUD surface #141414 -- lightness band, CVD and contrast all pass.
const LANES = [
	{ key: 'main', label: 'main CPU', color: '#3987e5' },
	{ key: 'worker', label: 'worker CPU', color: '#199e70' },
	{ key: 'gpu', label: 'GPU (WebGL)', color: '#d95926' },
];
const INK = '#e8e8e6';
const INK_MUTED = '#9a9a96';
const GRID = '#333331';

const samples = [];          // { t, sys, lane, ms }
const strip = [];            // { t, main, worker, gpu } utilization % per tick
const frames = [];           // { t, ms } drawNow wall time
const active = new Map();    // id -> item
const history = [];
const pollers = [];
const statSources = new Map();   // name -> () => string, one line (or lines) under Caches
let nextId = 1;
let on = false;
let root = null, barsCanvas = null, stripCanvas = null, headEl = null, totalEl = null, queueEl = null, cachesEl = null, historyEl = null;
let timer = 0;
let pendingSource = null;    // () => number of async render items in flight (traced or not)
let gpuTimerState = 'unknown';

const now = () => performance.now();

export const renderHud = {
	get on() { return on; },

	setEnabled(enabled, container) {
		enabled = !!enabled;
		if (enabled === on) return;
		on = enabled;
		if (on) {
			buildDom(container || document.body);
			timer = setInterval(tick, TICK_MS);
			tick();
		} else {
			clearInterval(timer);
			timer = 0;
			root?.remove();
			root = null;
			samples.length = strip.length = frames.length = history.length = 0;
			active.clear();
		}
	},

	/** Count of async render work in flight, including work posted before the HUD was on. */
	setPendingSource(fn) { pendingSource = fn; },

	/** A named line of state for the Caches section, re-read every tick. Setting a name again replaces it. */
	setStat(name, fn) { statSources.set(name, fn); },

	/** Called each tick; the GL renderer resolves its timer queries here. */
	addPoller(fn) { pollers.push(fn); },

	/** 'yes' | 'unavailable' -- whether the WebGL timer query extension exists. */
	setGpuTimerState(state) { gpuTimerState = state; },

	/** One drawNow: per-layer main-thread ms, and the whole call's ms. */
	frame(layers, totalMs) {
		if (!on) return;
		const t = now();
		for (const sys in layers) if (layers[sys] > 0) samples.push({ t, sys, lane: 'main', ms: layers[sys] });
		frames.push({ t, ms: totalMs });
	},

	sample(sys, lane, ms) {
		if (!on || !(ms > 0)) return;
		samples.push({ t: now(), sys, lane, ms });
	},
};

/**
 * Traced render items. `begin` returns 0 while the HUD is off, and every other
 * call ignores id 0, so call sites need no guards of their own.
 */
export const renderTrace = {
	begin(kind, label, sys, stage = 'queued') {
		if (!on) return 0;
		const id = nextId++;
		const t = now();
		active.set(id, { id, kind, label, sys, t0: t, stage, stages: [{ name: stage, t }], workerMs: 0, gpuMs: null, gpuBatch: 0, cpuMs: 0 });
		return id;
	},

	stage(id, name) {
		const item = active.get(id);
		if (!item || item.stage === name) return;
		item.stage = name;
		item.stages.push({ name, t: now() });
	},

	/** A share of a batched GPU pass; may arrive before or after the item ends. */
	gpu(id, ms, batch) {
		if (!id) return;
		const item = active.get(id) || history.find((h) => h.id === id);
		if (!item) return;
		item.gpuMs = (item.gpuMs || 0) + ms;
		item.gpuBatch = batch;
	},

	end(id, { workerMs = 0, cpuMs = 0 } = {}) {
		const item = active.get(id);
		if (!item) return;
		active.delete(id);
		item.t1 = now();
		item.workerMs = workerMs;
		item.cpuMs += cpuMs;
		if (workerMs > 0) renderHud.sample(item.sys, 'worker', workerMs);
		pushHistory(item);
	},

	/** A synchronous main-thread item (bakes): straight into the history. */
	done(kind, label, sys, cpuMs) {
		if (!on) return;
		const t = now();
		pushHistory({ id: nextId++, kind, label, sys, t0: t - cpuMs, t1: t, stages: [{ name: 'run', t: t - cpuMs }], workerMs: 0, gpuMs: null, cpuMs });
	},
};

function pushHistory(item) {
	history.unshift(item);
	if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
}

// ---------------------------------------------------------------------------

function buildDom(container) {
	root = document.createElement('div');
	root.id = 'render-hud';
	root.setAttribute('aria-label', 'Render HUD');
	Object.assign(root.style, {
		position: 'absolute', right: '8px', bottom: '8px', width: '600px', maxWidth: 'calc(100% - 16px)',
		background: 'rgba(20,20,20,0.92)', color: INK, font: '11px/1.35 ui-monospace, Menlo, Consolas, monospace',
		padding: '8px 10px', borderRadius: '6px', border: `1px solid ${GRID}`, zIndex: 50,
		pointerEvents: 'none', boxSizing: 'border-box',
	});
	headEl = document.createElement('div');
	const legend = document.createElement('div');
	legend.style.margin = '4px 0 2px';
	for (const lane of LANES) {
		const sw = document.createElement('span');
		Object.assign(sw.style, { display: 'inline-block', width: '9px', height: '9px', background: lane.color, borderRadius: '2px', margin: '0 4px 0 0', verticalAlign: '-1px' });
		const label = document.createElement('span');
		label.textContent = lane.label;
		label.style.marginRight = '12px';
		legend.append(sw, label);
	}
	barsCanvas = document.createElement('canvas');
	stripCanvas = document.createElement('canvas');
	// index.html styles every canvas absolute + pixelated (the map layers).
	for (const c of [barsCanvas, stripCanvas]) Object.assign(c.style, { display: 'block', width: '100%', position: 'static', imageRendering: 'auto' });
	stripCanvas.style.marginTop = '4px';
	totalEl = document.createElement('div');
	totalEl.style.margin = '2px 0 0';
	const section = (title) => {
		const h = document.createElement('div');
		h.textContent = title;
		Object.assign(h.style, { marginTop: '6px', color: INK_MUTED, borderTop: `1px solid ${GRID}`, paddingTop: '4px' });
		const pre = document.createElement('pre');
		Object.assign(pre.style, { margin: 0, font: 'inherit', whiteSpace: 'pre', overflow: 'hidden' });
		return { h, pre };
	};
	queueEl = section('Queue');
	historyEl = section('Recently completed — ms; wkr = worker time, gpu = its share of a batched GPU pass');
	cachesEl = section('Caches');
	// The HUD is anchored bottom-right, so the fixed-height parts (the graphs
	// and the cache lines) go last: they stay put while the queue and history
	// above them grow and shrink.
	Object.assign(legend.style, { marginTop: '6px', borderTop: `1px solid ${GRID}`, paddingTop: '4px' });
	root.append(headEl, queueEl.h, queueEl.pre, historyEl.h, historyEl.pre,
		legend, barsCanvas, totalEl, stripCanvas, cachesEl.h, cachesEl.pre);
	container.appendChild(root);
}

function tick() {
	if (!on || !root) return;
	for (const p of pollers) {
		try { p(); } catch { /* a lost GL context just yields no samples */ }
	}
	const t = now();
	while (samples.length && samples[0].t < t - STRIP_MS) samples.shift();
	while (frames.length && frames[0].t < t - WINDOW_MS) frames.shift();
	for (const [id, item] of active) if (t - item.t0 > STALE_MS) active.delete(id);

	// Per subsystem x lane over the window.
	const rows = new Map();
	const laneTotals = { main: 0, worker: 0, gpu: 0 };
	for (const s of samples) {
		if (s.t < t - WINDOW_MS) continue;
		let row = rows.get(s.sys);
		if (!row) rows.set(s.sys, row = { sys: s.sys, main: 0, worker: 0, gpu: 0 });
		row[s.lane] += s.ms;
		laneTotals[s.lane] += s.ms;
	}
	const pct = (ms) => (100 * ms) / WINDOW_MS;
	strip.push({ t, main: pct(laneTotals.main), worker: pct(laneTotals.worker), gpu: pct(laneTotals.gpu) });
	while (strip.length && strip[0].t < t - STRIP_MS) strip.shift();

	const drawMs = frames.map((f) => f.ms);
	const avg = drawMs.length ? drawMs.reduce((a, b) => a + b, 0) / drawMs.length : 0;
	headEl.textContent = `Render HUD · last ${WINDOW_MS / 1000}s · ${(drawMs.length * 1000 / WINDOW_MS).toFixed(0)} draws/s · ` +
		`drawNow avg ${avg.toFixed(1)} max ${Math.max(0, ...drawMs).toFixed(1)} ms · GPU timer ${gpuTimerState}`;

	const sorted = [...rows.values()]
		.map((r) => ({ ...r, total: r.main + r.worker + r.gpu }))
		.filter((r) => r.total >= 0.5)
		.sort((a, b) => b.total - a.total);
	drawBars(sorted, laneTotals);
	drawStrip(t);
	renderQueue(t);
	renderCaches();
	renderHistory();
}

function setupCanvas(canvas, cssH) {
	const dpr = window.devicePixelRatio || 1;
	const cssW = canvas.clientWidth || 440;
	if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
		canvas.width = Math.round(cssW * dpr);
		canvas.height = Math.round(cssH * dpr);
		canvas.style.height = `${cssH}px`;
	}
	const ctx = canvas.getContext('2d');
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, cssW, cssH);
	ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
	ctx.textBaseline = 'middle';
	return { ctx, w: cssW };
}

// Axis ceiling: the next of 5/10/25/50/100/200/300 % above the largest value.
function niceMax(v) {
	for (const m of [5, 10, 25, 50, 100, 200, 300]) if (v <= m) return m;
	return Math.ceil(v / 100) * 100;
}

function drawBars(rows, laneTotals) {
	const ROW = 15, NAME_W = 112, SPLIT_W = 126, VAL_W = 96, MAX_ROWS = 12;
	const shown = rows.slice(0, MAX_ROWS);
	const other = rows.slice(MAX_ROWS);
	if (other.length) {
		const o = { sys: `+${other.length} more`, main: 0, worker: 0, gpu: 0, total: 0 };
		for (const r of other) { o.main += r.main; o.worker += r.worker; o.gpu += r.gpu; o.total += r.total; }
		shown.push(o);
	}
	const h = Math.max(1, shown.length) * ROW + 14;
	const { ctx, w } = setupCanvas(barsCanvas, h);
	const x0 = NAME_W;
	const barW = w - NAME_W - SPLIT_W - VAL_W - 8;
	const pct = (ms) => (100 * ms) / WINDOW_MS;
	const axis = niceMax(Math.max(1, ...shown.map((r) => pct(r.total))));
	const plotH = Math.max(1, shown.length) * ROW;

	if (!shown.length) {
		ctx.fillStyle = INK_MUTED;
		ctx.textAlign = 'left';
		ctx.fillText('no samples yet — pan or zoom the map', 0, ROW / 2);
		totalEl.replaceChildren();
		return;
	}
	// Recessive grid: quarter lines, axis labels under the plot.
	ctx.strokeStyle = GRID;
	ctx.lineWidth = 1;
	for (let q = 0; q <= 4; q++) {
		const x = Math.round(x0 + (barW * q) / 4) + 0.5;
		ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, plotH); ctx.stroke();
	}
	ctx.fillStyle = INK_MUTED;
	ctx.textAlign = 'left';
	ctx.fillText('0', x0, plotH + 7);
	ctx.textAlign = 'right';
	ctx.fillText(`${axis}% of wall`, x0 + barW, plotH + 7);
	ctx.fillText('split %', x0 + barW + 8 + SPLIT_W - 4, plotH + 7);
	ctx.fillText('% · ms', w, plotH + 7);

	shown.forEach((r, i) => {
		const y = i * ROW, mid = y + ROW / 2;
		ctx.fillStyle = INK_MUTED;
		ctx.textAlign = 'left';
		ctx.fillText(r.sys.length > 16 ? r.sys.slice(0, 15) + '…' : r.sys, 0, mid);
		let x = x0;
		for (const lane of LANES) {
			const segW = Math.min((barW * pct(r[lane.key])) / axis, x0 + barW - x);
			if (segW <= 0) continue;
			ctx.fillStyle = lane.color;
			// 2px surface gap between segments; never thinner than 1px so a
			// tiny share stays visible.
			ctx.fillRect(x, y + 3, Math.max(1, segW - 2), ROW - 6);
			x += segW;
		}
		// Per-lane split, m/w/g, so small segments still read.
		ctx.fillStyle = INK_MUTED;
		ctx.fillText(LANES.filter((l) => r[l.key] > 0).map((l) => `${l.key[0]}${pct(r[l.key]).toFixed(1)}`).join(' '), x0 + barW + 8, mid);
		ctx.fillStyle = INK;
		ctx.textAlign = 'right';
		ctx.fillText(`${pct(r.total).toFixed(1).padStart(5)}% ${r.total.toFixed(0).padStart(5)}`, w, mid);
	});

	// Totals per lane, as text: lanes are different threads, so their sum is
	// not a share of anything; each lane's own % of wall time is what reads.
	totalEl.replaceChildren('TOTAL ');
	for (const lane of LANES) {
		const sw = document.createElement('span');
		Object.assign(sw.style, { display: 'inline-block', width: '9px', height: '9px', background: lane.color, borderRadius: '2px', margin: '0 4px 0 10px', verticalAlign: '-1px' });
		totalEl.append(sw, `${lane.key} ${pct(laneTotals[lane.key]).toFixed(1)}% (${laneTotals[lane.key].toFixed(0)} ms)`);
	}
}

function drawStrip(t) {
	const H = 44;
	const { ctx, w } = setupCanvas(stripCanvas, H);
	const plotH = H - 12;
	const max = niceMax(Math.max(1, ...strip.flatMap((s) => [s.main, s.worker, s.gpu])));
	ctx.strokeStyle = GRID;
	ctx.lineWidth = 1;
	ctx.beginPath(); ctx.moveTo(0, plotH + 0.5); ctx.lineTo(w, plotH + 0.5); ctx.stroke();
	ctx.fillStyle = INK_MUTED;
	ctx.textAlign = 'left';
	ctx.fillText(`last ${STRIP_MS / 1000}s, % of wall (max ${max}%)`, 0, H - 5);
	ctx.lineWidth = 2;
	ctx.lineJoin = 'round';
	for (const lane of LANES) {
		ctx.strokeStyle = lane.color;
		ctx.beginPath();
		strip.forEach((s, i) => {
			const x = w - ((t - s.t) / STRIP_MS) * w;
			const y = plotH - (s[lane.key] / max) * (plotH - 2);
			if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
		});
		ctx.stroke();
	}
}

const pad = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
const ms = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));

function renderQueue(t) {
	const items = [...active.values()].sort((a, b) => a.t0 - b.t0);
	const untraced = pendingSource ? Math.max(0, pendingSource() - items.filter((i) => i.kind === 'scene' || i.kind === 'decal').length) : 0;
	queueEl.h.textContent = `Queue — ${items.length} traced` + (untraced ? `, ${untraced} posted before the HUD was on` : '');
	if (!items.length) { queueEl.pre.textContent = '(idle)'; return; }
	const lines = items.slice(0, QUEUE_ROWS).map((i) =>
		`${pad(i.stage, 8)} ${pad(i.kind, 7)} ${pad(i.label, 24)} ${ms(t - i.t0).padStart(6)} ago`);
	if (items.length > QUEUE_ROWS) lines.push(`… ${items.length - QUEUE_ROWS} more`);
	queueEl.pre.textContent = lines.join('\n');
}

function renderCaches() {
	const lines = [];
	for (const [name, fn] of statSources) {
		let text;
		try { text = fn(); } catch (err) { text = `(error: ${err?.message ?? err})`; }
		if (text) lines.push(`${pad(name, 8)} ${text}`);
	}
	cachesEl.pre.textContent = lines.length ? lines.join('\n') : '(none)';
}

function renderHistory() {
	if (!history.length) { historyEl.pre.textContent = '(nothing yet)'; return; }
	historyEl.pre.textContent = history.map((i) => {
		const parts = [];
		if (i.cpuMs) parts.push(`cpu ${ms(i.cpuMs)}`);
		// Latency by stage: resolve (GPU pass + async readback), wait (in the
		// worker's FIFO); the run itself is the worker's own time.
		for (let k = 0; k < i.stages.length; k++) {
			const name = i.stages[k].name;
			if (name !== 'gpu' && name !== 'queued') continue;
			const next = k + 1 < i.stages.length ? i.stages[k + 1].t : i.t1;
			parts.push(`${name === 'gpu' ? 'resolve' : 'wait'} ${ms(next - i.stages[k].t)}`);
		}
		if (i.workerMs) parts.push(`wkr ${ms(i.workerMs)}`);
		if (i.gpuMs != null) parts.push(`gpu ${i.gpuMs.toFixed(2)}`);
		return `${pad(i.kind, 7)} ${pad(i.label, 22)} ${ms(i.t1 - i.t0).padStart(6)}  ${parts.join(' · ')}`;
	}).join('\n');
}
