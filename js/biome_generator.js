import { NollaPrng } from './nolla_prng.js';
import { shuffleTable } from './utils.js';

export const BIOME_CONFIG = {
    CHUNK_SIZE: 512,
    W_NG0: 70, H_NG0: 48,
    W_NGP: 64, H_NGP: 48
};

// Internal Helper to interact with the pixel buffer
class BiomePainter {
    constructor(pixels, w, h, rng) {
        this.pixels = pixels; // Uint32Array
        this.w = w;
        this.h = h;
        this.rng = rng;
    }

    set(x, y, c) {
        if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
        this.pixels[y * this.w + x] = c;
    }

    rect(x, y, w, h, c, buf) {
        let ex = this.rng.Random(0, buf);
        x -= ex; 
        w += ex + this.rng.Random(0, buf);
        for (let iy = y; iy < y + h; iy++) {
            for (let ix = x; ix < x + w; ix++) {
                this.set(ix, iy, c);
            }
        }
    }

    rectSplit(x, y, w, h, c1, c2, buf) {
        let ex = this.rng.Random(0, buf);
        x -= ex; 
        w += ex + this.rng.Random(0, buf);
        let cut = this.rng.Random(y + 1, y + h - 2);
        
        for (let ix = x; ix < x + w; ix++) {
            for (let iy = y; iy < y + h; iy++) {
                this.set(ix, iy, iy < cut ? c1 : c2);
            }
            cut += this.rng.Random(-1, 1);
            cut = Math.max(y + 1, Math.min(y + h - 2, cut));
        }
    }

    cave(x, y, dir, c, len) {
        for (let i = 1; i <= len; i++) {
            this.set(x, y, c);
            
            // Random walk X
            if (i < 5 || this.rng.Random(0, 100) < 75) x += dir;
            else x -= dir;
            x = Math.max(2, Math.min(62, x));
            
            this.set(x, y, c);

            // Random walk Y
            if (i > 3) {
                if (this.rng.Random(0, 100) < 65) y++;
                else y--;
            }
            y = Math.max(17, Math.min(45, y));

            // Blobbing
            if (i > 6) {
                if (this.rng.Random(0, 100) < 35) this.set(x - 1, y, c);
                if (this.rng.Random(0, 100) < 35) this.set(x + 1, y, c);
                if (this.rng.Random(0, 100) < 35) this.set(x, y - 1, c);
                if (this.rng.Random(0, 100) < 35) this.set(x, y + 1, c);
            }
        }
    }
}

/**
 * Generates the biome map data.
 * @param {number} seed World Seed
 * @param {number} ng New Game+ Count
 * @param {Uint32Array} basePixels Initial pixel data from the base PNG
 * @param {number} width 
 * @param {number} height 
 * @returns {Object} { pixels: Uint32Array, orbs: Array }
 */
export function generateBiomeData(seed, ng, basePixels, width, height) {
    // Copy base pixels to new buffer to avoid modifying the cached source
    const pixels = new Uint32Array(basePixels);
    const orbs = [];
    
    // If NG+ is 0, we just return the base map (static)
    if (ng === 0) {
        return { pixels, orbs }; 
    }

    const rng = new NollaPrng(0);
    rng.SetRandomSeed(seed + ng, 4573, 4621);
    const painter = new BiomePainter(pixels, width, height, rng);

    // 1. Biome Colors (Standard Palette)
    let b = {
        coal: 0xFFD56517, 
        coll: 0xFFD56517, 
        fungi: 0xFFE861F0, 
        excav: 0xFF124445,
        snow: 0xFF1775D5, 
        hiisi: 0xFF0046FF, 
        j1: 0xFFA08400, j2: 0xFF808000,
        vault: 0xFF008000, 
        sand: 0xFFE1CD32, 
        snowvault: 0xFF0080A8,
        wand: 0xFF006C42, 
        crypt: 0xFF786C42
    };

    // 2. NG+ Variations
    if (ng % 2 === 0) {
        // Tower
        // Wrong, this was an LLM "optimization"
        //const g = 0xFF3D3E37;
        //const keys = Object.keys(b);
        //keys.forEach((k, i) => b[k] = g + i);
        b.coal = 0xFF3D3E37; 
        b.coll = 0xFF3D3E37; 
        b.fungi = 0xFF3D3E3B; 
        b.excav = 0xFF3D3E38;
        b.snow = 0xFF3D3E39; 
        b.hiisi = 0xFF3D3E3A; 
        b.j1 = 0xFF3D3E3C; 
        b.j2 = 0xFF3D3E3C;
        b.vault = 0xFF3D3E3D; 
        b.crypt = 0xFF3D3E3E;
    }

    if (ng % 3 === 0) {
        // Shuffled world
        let pool = [
            0xFFD56517, 
            0xFFD56517, 
            0xFFE861F0, 
            0xFF124445, 
            0xFF1775D5, 
            0xFF0046FF, 
            0xFFA08400, 
            0xFF808000,
            0xFF008000, 
            0xFFE1CD32, 
            0xFF0080A8, 
            0xFF006C42, 
            0xFF786C42
        ];
        shuffleTable(pool, rng);
        
        b.coal = pool[0]; 
        b.coll = pool[1]; 
        b.fungi = pool[2]; 
        b.excav = pool[3];
        b.snow = pool[4]; 
        b.hiisi = pool[5]; 
        b.j1 = pool[6]; 
        b.j2 = pool[7];
        b.vault = pool[8]; 
        b.crypt = pool[9];
    }

    const doWalls = (ng % 5 === 0);

    if (ng % 7 === 0) {
        // Specific color replacement at (16, 5)
        const t = Math.floor(ng / 7) % 3;
        const c = (t === 0) ? 0xFFCC9944 : (t === 1) ? 0xFFD6D8E3 : 0xFF33E311;
        const target = pixels[5 * width + 16];
        for (let i = 0; i < pixels.length; i++) {
            if (pixels[i] === target) pixels[i] = c;
        }
    }

    // 3. Swaps
    const swap = (k1, k2) => {
        if (rng.Random(0, 100) < 35) {
            let t = b[k1]; b[k1] = b[k2]; b[k2] = t;
        }
    };
    swap('coal', 'coll');
    swap('fungi', 'excav');
    swap('snow', 'hiisi');
    swap('j1', 'j2');
    swap('sand', 'fungi');
    swap('wand', 'sand');

    // 4. Caves
    const doCave = (x, y, dir, c, lMin, lMax) => {
        if (rng.Random(0, 100) < 65) {
            painter.cave(x, y, dir, c, rng.Random(lMin, lMax));
        }
    };

    doCave(27, 15, -1, b.fungi, 4, 50); 
    doCave(35, 15, 1, b.fungi, 4, 50);
    doCave(27, 18, -1, b.fungi, 4, 50); 
    doCave(35, 18, 1, b.fungi, 4, 50);

    if (rng.Random(0, 100) < 65) painter.cave(27, 20 + rng.Random(0, 5), -1, b.wand, rng.Random(5, 50));
    if (rng.Random(0, 100) < 65) painter.cave(35, 20 + rng.Random(0, 5), 1, b.wand, rng.Random(5, 50));
    if (rng.Random(0, 100) < 65) painter.cave(27, 27 + rng.Random(0, 6), -1, b.sand, rng.Random(5, 50));
    if (rng.Random(0, 100) < 65) painter.cave(35, 27 + rng.Random(0, 6), 1, b.sand, rng.Random(5, 50));

    // 5. Rect Areas
    painter.rect(32, 14, 3, 2, b.coal, 0);
    painter.rect(28, 15, 4, 1, b.coll, 1);
    painter.rect(28, 17, 4, 2, b.excav, 2);
    painter.rectSplit(28, 20, 7, 6, b.snow, b.hiisi, 3);
    painter.rectSplit(28, 27, 7, 4, b.j1, b.j2, 4);
    painter.rectSplit(28, 29, 7, 5, b.j2, b.vault, 4);
    painter.rect(29, 35, 11, 3, b.crypt, 0);

    if (doWalls) {
        painter.rect(23, 15, rng.Random(2, 6), 25, 0xFF3D3D3D, 0);
        painter.rect(33 + (4 - rng.Random(1, 4)), 16, 10, 22, 0xFF3D3D3D, 0);
    }

    // 6. Orbs
    const addOrb = (x, y, name) => {
        painter.set(x, y, 0xFFFFFFFF);
        //let worldX = x * 512 + 256 - 32 * 512; // Center of chunk
        //let worldY = y * 512 + 256 - 14 * 512;
        // Uses chunk x and y, unlike other objects... Weird inconsistency as a result of this being the first PoI type thing added
        orbs.push({ x: x, y: y, name, type: 'item', item: 'orb', biome: 'orb_room'});
    };

    addOrb(51, 11, "Pyramid");
    addOrb(33, 11, "Floating Island");
    addOrb(rng.Random(0, 5) + 10, rng.Random(0, 2) + 18, "Vault");
    addOrb(rng.Random(0, 5) + 49, rng.Random(0, 3) + 17, "Pyramid (Inside)");

    let hy = rng.Random(0, 2) + 44;
    if (ng === 3 || ng >= 25) hy = 47;
    addOrb(rng.Random(0, 9) + 27, hy, "Hell");

    addOrb(rng.Random(0, 6) + 12, rng.Random(0, 3) + 40, "Snowcave");
    addOrb(rng.Random(0, 4) + 51, rng.Random(0, 5) + 41, "Desert");
    addOrb(rng.Random(0, 5) + 58, rng.Random(0, 5) + 34, "Nuke");
    addOrb(rng.Random(0, 9) + 40, rng.Random(0, 11) + 21, "Orb 1");
    addOrb(rng.Random(0, 7) + 17, rng.Random(0, 8) + 21, "Orb 2");
    addOrb(rng.Random(0, 7) + 1, rng.Random(0, 9) + 24, "Orb 3");

    return { pixels, orbs };
}