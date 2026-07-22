import { NollaPrng } from "./nolla_prng.js";
const { pow, cos, sin, floor, round, sqrt, PI } = Math;

const e = [
	{x:13456,y:-5360},
	{x:13520,y:-5328},
	{x:13456,y:-5296},
];
const t = [
	{x:13744,y:-5584},
	{x:13776,y:-5584},
	{x:13776,y:-5552},
];
const b = [
	{x:13024,y:-4816},
	{x:13632,y:-4880},
	{x:13984,y:-4720},
];

const s = [];
const g = [];
const d = [];
const h = [];
for (let i = 0; i < 3; i++) {
	const r1 = [];
	const r2 = [];
	const r3 = [];
	const r4 = [];
	for (let j = 0; j < 3; j++) {
		r1.push((t[j].y-e[i].y)/(t[j].x-e[i].x));
		r2.push((b[j].y-e[i].y)/(b[j].x-e[i].x));
		r3.push(pow(pow(t[j].x-e[i].x, 2) + pow(t[j].y-e[i].y, 2), 0.5));
		r4.push(pow(pow(b[j].x-e[i].x, 2) + pow(b[j].y-e[i].y, 2), 0.5));
	}
	s.push(r1);
	g.push(r2);
	d.push(r3);
	h.push(r4);
}

const m = [];
const q = 1377.7;

for (let i = 0; i < 3; i++) {
	for (let j = 0; j < 3; j++) {
		m.push({x: round(e[i].x+q*d[i][j]/sqrt(1+s[i][j]*s[i][j])), y: round(e[i].y+q*s[i][j]*d[i][j]/sqrt(1+s[i][j]*s[i][j]))});
	}
}
for (let i = 0; i < 3; i++) {
	for (let j = 0; j < 3; j++) {
		const sign = j === 0 ? -1 : 1;
		m.push({x: round(e[i].x+sign*q*h[i][j]/sqrt(1+g[i][j]*g[i][j])), y: round(e[i].y+q*sign*g[i][j]*h[i][j]/sqrt(1+g[i][j]*g[i][j]))});
	}
}


function renderVariedStar(ctx, x, y, v) {
	const col = 15<<((v%3)*4); 
	ctx.fillStyle = '#'+col.toString(16).padStart(3, '0').split("").reverse().join("");
	for (let a = 1; a < 7; a++) {
		for (let b = 0; b < 4; b++) {
			const c = cos((b/2)*PI);
			const s = sin((b/2)*PI);
			ctx.fillRect(
				x + 3*floor((a+1+a%2)/2)*(c-s*((a+1)%2)),
				y + 3*floor((a+1+a%2)/2)*(s+c*((a+1)%2)),
				3, 3
			);
		}
		if (a > 1) ctx.fillStyle = v%2 === 1 ? 'white' : 'black';
		v = floor(v/(a===1?3:2));
	}
}


export function renderStarClusters(ctx, isNGP, pw, pwv) {
	if (isNGP) return;
	const worldSize = 35840;
	const xoff = worldSize/2 - worldSize*pw;
	const yoff = 7168 - 24576*pwv;
	for (let i = 0; i < m.length; i++) {
		for (let j = 0; j < starClusters[i].length; j++) {
			const v = starClusters[i][j];
			const dx = j%13 - 7;
			const dy = floor(j/13) - 7;
			renderVariedStar(ctx, 39*dx + m[i].x + xoff, 39*dy + m[i].y + yoff, v);
		}
	}
}

export function renderTwinklingStars(ctx, ws, isNGP, pw, pwv) {
	if (isNGP) return;
	const worldSize = 35840;
	const xoff = worldSize/2 - worldSize*pw;
	const yoff = 7168 - 24576*pwv;
	const prng = new NollaPrng(0);
	// Use current time to seed the PRNG for twinkling effect
	prng.Seed = floor(Date.now()/40) ^ ws ^ 0x5a5a5a5a;
	for (let i = 0; i < 3; i++) {
		if (prng.NextU()%128 === 0) {
			renderVariedStar(ctx, e[i].x + xoff, e[i].y + yoff, prng.NextU());
		}
	}
}

let starPositions = [];
let variedStarPositions = [];
const starClusters = [];
// Use actual RNG data for stars
const seeds = await fetch('../data/rng/sampo_seeds.json').then(res => res.json());

export function generateStars(ws, ng) {
	const starCount = 4096; // Don't use too many, don't want to slow things down for cosmetics
	let prng = new NollaPrng(0);
	prng.SetRandomSeed(ws + ng, 83, 26);
	for (let i = 0; i < starCount; i++) {
		const x = pow(-1, prng.NextU()%2) * floor(prng.Next() * prng.Next() * 1e6)
		const y = -1e6 + floor(prng.Next() * prng.Next() * 1e6);
		starPositions.push({ x, y });
	}
	// More interesting varied stars higher up using the RNG from sampo seeds
	prng.SetRandomSeed(ws + ng, 26, 83);
	for (let i = 0; i < starCount; i++) {
		const x = floor(seeds[prng.NextU()%seeds.length]%1e6 - 5e5);
		const y = -2e5 - floor(seeds[prng.NextU()%seeds.length]%6e5);
		const value = seeds[prng.NextU()%seeds.length];
		variedStarPositions.push({ x, y, value });
	}
	// Some clusters of stars based on sampo seeds directly
	//const clusterInds = [];
	for (let i = 0; i < m.length; i++) {
		const prng = new NollaPrng(0);
		for (let j = 0; j < i; j++) prng.Next();
		const nextIdx = prng.NextU() % seeds.length;
		prng.Seed = seeds[nextIdx] ^ 0xe4bc7e0;
		prng.Seed = 0x7fffffff | prng.Seed; // Ensure it's a 31-bit positive integer
		for (let j = 0; j < i; j++) prng.Next();
		const row = [];
		prng.Seed = pow(2,31) - prng.NextU() - 4;
		for (let j = 0; j < 169; j++) {
			const idx = (169*i+j+prng.Next()-1+seeds.length)%seeds.length;
			row.push(seeds[idx]);
		}
		starClusters.push(row);
	}
}




export function renderStars(ctx, ws, ng, pw, pwv) {
	//const t0 = performance.now();
	const worldSize = 512*(ng > 0 ? 64 : 70);
	const xoff = worldSize/2 - worldSize*pw;
	const yoff = 7168 - 24576*pwv;
	// Render more stars based on height
	if (starPositions.length === 0) {
		generateStars(ws, ng);
	}
	// Estimate bounds based on max zoom I guess
	const minX = (pw-2) * worldSize;
	const maxX = (pw+2) * worldSize;
	const minY = (pwv-2) * 24576;
	const maxY = (pwv+2) * 24576;

	ctx.fillStyle = 'white';
	for (let i = 0; i < starPositions.length; i++) {
		const { x, y } = starPositions[i];
		if (x < minX || x > maxX || y < minY || y > maxY) continue; // Skip stars outside of bounds
		ctx.fillRect(x + xoff + 13, y + yoff, 13, 39);
		ctx.fillRect(x + xoff, y + yoff + 13, 39, 13);
	}
	for (let i = 0; i < variedStarPositions.length; i++) {
		const { x, y, value } = variedStarPositions[i];
		if (x < minX || x > maxX || y < minY || y > maxY) continue; // Skip stars outside of bounds
		renderVariedStar(ctx, x + xoff, y + yoff, value);
	}
	renderTwinklingStars(ctx, ws, ng > 0, pw, pwv);
	renderStarClusters(ctx, ng > 0, pw, pwv);
	//const t1 = performance.now();
	//console.log(`Rendered stars in ${t1 - t0} ms`);
	// About 0.1 ms for 4096
}
