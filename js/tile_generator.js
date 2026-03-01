import { NollaPrng } from './nolla_prng.js';
import { stbhw_generate_image, stbhw_build_tileset_from_image, StbhwTileset, stbhw_set_prng } from './stbhw.js';
import { applyMainBiomeHack, applyCoalmineHack, applyPostprocessingHacks, undoCoalmineHack } from './biome_hacks.js';
import { blockOutRooms } from './pixel_scene_generation.js';
import { findMinPath } from './pathfinding.js';
import { CHUNK_SIZE, TILE_SIZE } from './constants.js';
import { getWorldCenter } from './utils.js';

//import { spawnWandAltar, spawnPotionAltar, spawnChest, spawnHeart } from './spell_generator.js';

// Constants

const MAX_PATHFINDING_ATTEMPTS = 100; 
const BIOME_PATH_HEIGHT_LIMIT_CHUNKS = 4;
//const BIOME_PATH_FIND_WORLD_POS_MIN_X = 159;
//const BIOME_PATH_FIND_WORLD_POS_MAX_X = 223;
const BYPASS_PATHFINDING = false; // Debug

const DEFAULT_OFFSET_Y = 4; 
const prng = new NollaPrng(0);
const TILESET_CACHE = {};

// Debug: Disable all but one biome for testing
// const debugBiome = 'excavationsite';
//Object.keys(GENERATOR_CONFIG).forEach(k => { if (k !== debugBiome) GENERATOR_CONFIG[k].enabled = false; });

function calculateMapDimensions(bbox) {
    const [minX, minY, maxX, maxY] = bbox;
    // Chunks which have x % 5 == -1 have an extra pixel in width
    // Chunks which have y % 5 == -1 have an extra pixel in height
    let totalWidth = 0;
    for (let x = minX; x <= maxX; x++) {
        totalWidth += 51; // Base width for 1 chunk
        if (x % 5 === 4) totalWidth += 1; // Extra pixel for this chunk
    }
    let totalHeight = 0;
    for (let y = minY; y <= maxY; y++) {
        totalHeight += 51; // Base height for 1 chunk
        if (y % 5 === 4) totalHeight += 1; // Extra pixel for this chunk
    }
    return { width: totalWidth, height: totalHeight };
}

function getCachedTileset(biomeName, wangData) {
    if (TILESET_CACHE[biomeName]) return TILESET_CACHE[biomeName];

    let ts = new StbhwTileset();
    if (wangData) {
        const rgba = wangData.data;
        const w = wangData.width;
        const h = wangData.height;
        const rgb = new Uint8Array(w * h * 3);
        for(let i=0; i < w * h; i++) {
            rgb[i*3] = rgba[i*4];
            rgb[i*3+1] = rgba[i*4+1];
            rgb[i*3+2] = rgba[i*4+2];
        }
        
        //console.log(`[Generator] Building tileset for ${biomeName}...`);
        stbhw_build_tileset_from_image(ts, rgb, w * 3, w, h);
    }
    
    TILESET_CACHE[biomeName] = ts;
    return ts;
}

function generateRawTileBuffer(regionPoints, bbox, wangData, worldSeed, ngPlus, extraRerolls, biomeName) {
    const minX = bbox[0];
    const minY = bbox[1];
    //const [minX, minY, maxX, maxY] = bbox;
    //const wChunks = 1 + maxX - minX;
    //const hChunks = 1 + maxY - minY;
    //const mapW = getMapWidth(wChunks, biomeName);
    //const mapH = Math.ceil(512 * hChunks / 10);
    const mapDimensions = calculateMapDimensions(bbox);
    const mapW = mapDimensions.width;
    const mapH = mapDimensions.height;
    // Add offset per biome? Might not be necessary with fix actually
    //console.log(`[Generator] Calculated map dimensions for ${biomeName}: ${mapW}x${mapH} (chunks: ${wChunks}x${hChunks})`);
    const outH = mapH + 4;
    
    const ts = getCachedTileset(biomeName, wangData);
    if (ts.h_tiles.length === 0) return null; 

    stbhw_set_prng(prng);
    prng.SetRandomFromWorldSeed(worldSeed + ngPlus);
    prng.Next();

    const iters = mapW + (worldSeed + ngPlus) - 11 * Math.floor(mapW / 11) - 12 * Math.floor((worldSeed + ngPlus) / 12);
    for (let i = 0; i < iters; i++) prng.Next();
    for (let i = 0; i < extraRerolls; i++) prng.Next();
    
    prng.Seed = prng.NextU();
    prng.Next();

    const rawBuffer = new Uint8Array(mapW * outH * 3);
    let coffee_hack = false;
    const tile_indices = stbhw_generate_image(ts, rawBuffer, mapW * 3, mapW, outH, coffee_hack);
    if (!tile_indices) return null;

    // Missing step: block out rooms related to pixel scenes
    let shouldBlockOutRooms = biomeName === 'coalmine' || biomeName === 'excavationsite';
    let pixelSceneRooms = [];
    if (shouldBlockOutRooms) {
        pixelSceneRooms = blockOutRooms(rawBuffer, mapW, outH);
    }
    
    //if (isMainBiome) applyMainBiomeHack(rawBuffer, mapW, outH, biomeName, ngPlus > 0);
    //console.log(`${biomeName} - ${bbox[0]},${bbox[2]} to ${bbox[1]},${bbox[3]} - Main biome: ${isMainBiome} - Pathfinding attempts: ${extraRerolls}`);
    // Apparently doesn't need to be main biome, just needs to be in the right range
    // Previous: if (isMainBiome && ...)
    if (bbox[0] <= getWorldCenter(ngPlus > 0) && bbox[2] >= getWorldCenter(ngPlus > 0)) {
        applyMainBiomeHack(bbox[0], rawBuffer, mapW, outH, biomeName, ngPlus > 0);
    }
    if (biomeName === 'coalmine' || biomeName === 'tower_coalmine') {
        applyCoalmineHack(rawBuffer, mapW, outH, 'coalmine');
    }

    return { 
        buffer: rawBuffer, 
        width: mapW, 
        height: outH, 
        tileIndices: tile_indices.tileIndices, 
        xmax: tile_indices.xmax, 
        ymax: tile_indices.ymax, 
        tileSize: ts.short_side_len, 
        numHTiles: ts.num_h_tiles,
        numVTiles: ts.num_v_tiles,
        minX, minY, mapH, 
        pixelSceneRooms: pixelSceneRooms
    };
}

function findBiomeRegions(pixels, width, height, targetColor) {
    const visited = new Uint8Array(width * height);
    const regions = [];
    const bboxes = [];

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (visited[idx] === 0 && pixels[idx] === targetColor) {
                const regionPoints = [];
                const queue = [[x, y]];
                visited[idx] = 1;
                let minX = width, maxX = 0, minY = height, maxY = 0;

                while (queue.length > 0) {
                    const [cx, cy] = queue.shift();
                    // Snowchasm hack (didn't work)
                    //if (cy > maxY && maxY - minY == 19) continue;
                    regionPoints.push([cx, cy]);
                    if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
                    if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;

                    const neighbors = [[1,0], [-1,0], [0,1], [0,-1]];
                    for (const [dx, dy] of neighbors) {
                        const nx = cx + dx;
                        const ny = cy + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const nIdx = ny * width + nx;
                            if (visited[nIdx] === 0 && pixels[nIdx] === targetColor) {
                                visited[nIdx] = 1;
                                queue.push([nx, ny]);
                            }
                        }
                    }
                }
                // Special consideration literally only for the 1x1 chunk of overgrown with diagonal pattern
                // Check other region boxes
                let valid = true;
                for (let i = 0; i < regions.length; i++) {
                    const [rMinX, rMinY, rMaxX, rMaxY] = bboxes[i];
                    if (minX >= rMinX && maxX <= rMaxX && minY >= rMinY && maxY <= rMaxY) {
                        // This region is fully contained within an existing region
                        // Attempt to merge
                        for (const p of regionPoints) {
                            regions[i].push(p);
                        }
                        valid = false;
                    }
                }
                if (valid) {
                    regions.push(regionPoints);
                    bboxes.push([minX, minY, maxX, maxY]);
                }
            }
        }
    }
    return { regions, bboxes };
}

function applyMasking(pixels, imgData, mapW, bbox, validChunks, offsetY = 4) {
    const [minCX, minCY, maxCX, maxCY] = bbox;
    let tx = 0;
    for (let cx = minCX; cx <= maxCX; cx++) {
        let cw = 51;
        if (cx % 5 === 4) cw += 1;
        let ty = 0;
        for (let cy = minCY; cy <= maxCY; cy++) {
            let ch = 51;
            if (cy % 5 === 4) ch += 1;
            if (validChunks.has(`${cx},${cy}`)) {
                for (let y = 0; y < ch; y++) {
                    for (let x = 0; x < cw; x++) {
                        const srcIdx = ((ty + y + offsetY) * mapW + (tx + x)) * 3;
                        const dstIdx = ((ty + y) * mapW + (tx + x)) * 4;
                        const r = pixels[srcIdx], g = pixels[srcIdx + 1], b = pixels[srcIdx + 2];
                        imgData.data[dstIdx] = r; imgData.data[dstIdx+1] = g; imgData.data[dstIdx+2] = b;
                        imgData.data[dstIdx+3] = (r <= 1 && g <= 1 && b <= 1) ? 0 : 255; // TODO: Hopefully this doesn't miss anything.
                        // Actually, not really seeing any effect from this?
                    }
                }
            }
            else {
                for (let y = 0; y < ch; y++) {
                    for (let x = 0; x < cw; x++) {
                        const srcIdx = ((ty + y + offsetY) * mapW + (tx + x)) * 3;
                        // Apply mask to original buffer as well to avoid getting false positive PoI scans in masked areas
                        pixels[srcIdx] = 0; pixels[srcIdx + 1] = 0; pixels[srcIdx + 2] = 0;
                    }
                }
            }
            ty += ch;
        }
        tx += cw;
    }
}

function generateStaticTile(biomeName, config, bbox) {
    //const wangFile = config.wangFile;
    // For static tiles, we can just load the image and convert it to the same format as the generated buffers
    
    const wangData = config.wangData;
    // Generate canvas and buffer
    const canvas = document.createElement('canvas');
    canvas.width = wangData.width;
    canvas.height = wangData.height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(wangData.width, wangData.height + 4); // Add 4 pixels of height to match generated buffers
    const buffer = new Uint8Array(wangData.width * (wangData.height + 4) * 3);
    for (let y = 0; y < wangData.height; y++) {
        for (let x = 0; x < wangData.width; x++) {
            // Original data is RGBA, need to convert to canvas format
            const inIdx = (y * wangData.width + x) * 4;
            const outIdxBuffer = ((y+4) * wangData.width + x) * 3;
            const outIdxCanvas = ((y+4) * wangData.width + x) * 4;
            const r = wangData.data[inIdx], g = wangData.data[inIdx + 1], b = wangData.data[inIdx + 2], a = wangData.data[inIdx + 3];
            imgData.data[outIdxCanvas] = r; imgData.data[outIdxCanvas + 1] = g; imgData.data[outIdxCanvas + 2] = b; imgData.data[outIdxCanvas + 3] = a;
            buffer[outIdxBuffer] = r; buffer[outIdxBuffer + 1] = g; buffer[outIdxBuffer + 2] = b;
        }
    }
    ctx.putImageData(imgData, 0, 0);

    // Try to make corrected position...
    const div5x = Math.floor(bbox[0] / 5);
    const div5y = Math.floor(bbox[1] / 5);
    const mod5x = bbox[0] % 5;
    const mod5y = bbox[1] % 5;
    const correctedX = div5x * 5 * 512 + mod5x * 51 * 10;
    const correctedY = div5y * 5 * 512 + mod5y * 51 * 10;

    return {
        biomeName: biomeName,
        x: bbox[0] * CHUNK_SIZE, 
        y: bbox[1] * CHUNK_SIZE,
        correctedX,
        correctedY,
        w: wangData.width * TILE_SIZE, 
        h: wangData.height * TILE_SIZE,
        canvas: canvas,
        path: null,
        // Storage for independent PW scanning
        buffer: buffer, 
        width: wangData.width, 
        mapH: wangData.height,
        tileIndices: null,
        xmax: null, 
        ymax: null, 
        tileSize: null,
        numHTiles: null, 
        numVTiles: null,
        chunkBasePos: {x: bbox[0], y: bbox[1]},
        minX: bbox[0], // TODO: Refactor references to these
        minY: bbox[1], 
        validChunks: null, // Not needed for static tiles
        poisByPW: {}, // Initialize PW cache
        pixelSceneRooms: null
    };
}

/**
 * Visual Generation Loop
 * Removed PoI scanning from here. It now stores the raw buffer for later use.
 */
export async function generateBiomeTiles(biomePixels, width, height, biomeConfig, worldSeed, ngPlus, global_extra_rerolls = 0) {
    const t0 = performance.now();
    const layers = [];

    for (let biomeName of Object.keys(biomeConfig)) {
        const conf = biomeConfig[biomeName];
        if (!conf.enabled) continue;

        const offsetY = (conf.offsetY !== undefined) ? conf.offsetY : DEFAULT_OFFSET_Y;
        const { regions, bboxes } = findBiomeRegions(biomePixels, width, height, conf.color);
        
        for (let i = 0; i < regions.length; i++) {
            if (!biomeConfig[biomeName].wangFile) continue;
            if (biomeConfig[biomeName].wangFile.includes('static')) {
                // Static tile, just use the image as the whole region
                layers.push(generateStaticTile(biomeName, biomeConfig[biomeName], bboxes[i]));
                continue;
            }
            let valid = false;
            let currentRerolls = conf.extraRerolls || 0;
            currentRerolls += global_extra_rerolls; // Global extra rerolls for all biomes
            let attempts = 0;
            let rawResult = null;
            let finalPath = null;

            while (!valid && attempts < MAX_PATHFINDING_ATTEMPTS) {
                rawResult = generateRawTileBuffer(regions[i], bboxes[i], conf.wangData, worldSeed, ngPlus, currentRerolls, biomeName);
                if (!rawResult) break;
                let path = (1 + bboxes[i][3] - bboxes[i][1] > BIOME_PATH_HEIGHT_LIMIT_CHUNKS) ? [] : findMinPath(bboxes[i], rawResult.buffer, rawResult.width, rawResult.height, biomeName, ngPlus > 0);
                if (BYPASS_PATHFINDING && !path) path = [];
                if (path) { valid = true; finalPath = path; } 
                else { currentRerolls++; attempts++; }
            }

            //console.log(`[Generator] ${biomeName} region ${i} (${rawResult.width}x${rawResult.height-4}): ${valid ? 'Valid path found' : 'Failed to find valid path'} after ${attempts} attempts`);

            if (attempts == MAX_PATHFINDING_ATTEMPTS) {
                console.warn(`[Generator] Failed to generate valid tile buffer for ${biomeName} after ${MAX_PATHFINDING_ATTEMPTS} attempts`);
                rawResult = generateRawTileBuffer(regions[i], bboxes[i], conf.wangData, worldSeed, ngPlus, currentRerolls, biomeName);
                valid = true;
                finalPath = [];
            }

            if (valid && rawResult) {
                // After pathfinding, restore blocked rooms
                if (rawResult.pixelSceneRooms) {
                    for (const room of rawResult.pixelSceneRooms) {
                        for (let y = room.startY; y <= room.endY; y++) {
                            for (let x = room.startX; x <= room.endX; x++) {
                                const idx = (y * rawResult.width + x) * 3;
                                rawResult.buffer[idx] = 0x00;
                                rawResult.buffer[idx + 1] = 0x00;
                                rawResult.buffer[idx + 2] = 0x00;
                            }
                        }
                    }
                }

                // Replace coalmine hack blocked area with air
                if (biomeName === 'coalmine' || biomeName === 'tower_coalmine') {
                    undoCoalmineHack(rawResult.buffer, rawResult.width, rawResult.height, 'coalmine');
                }

                // Clear path, fill coffee, randomize colors
                applyPostprocessingHacks(rawResult.buffer, rawResult.width, rawResult.height, worldSeed, ngPlus, finalPath, conf.randomColors);

                const { minX, minY, width: mapW, mapH: renderH } = rawResult;
                const canvas = document.createElement('canvas');
                canvas.width = mapW; canvas.height = renderH;
                const ctx = canvas.getContext('2d');
                const imgData = ctx.createImageData(mapW, renderH);
                const validChunks = new Set(regions[i].map(p => `${p[0]},${p[1]}`));

                // Masking off sections which aren't in valid chunks (writes to buffer and imgData)
                applyMasking(rawResult.buffer, imgData, mapW, bboxes[i], validChunks);
                ctx.putImageData(imgData, 0, 0);

                // Try to make corrected position...
                const div5x = Math.floor(bboxes[i][0] / 5);
                const div5y = Math.floor(bboxes[i][1] / 5);
                const mod5x = bboxes[i][0] % 5;
                const mod5y = bboxes[i][1] % 5;
                const correctedX = div5x * 5 * 512 + mod5x * 51 * 10;
                const correctedY = div5y * 5 * 512 + mod5y * 51 * 10;

                // TODO: Clean this up, I have a bunch of old unused/redundant things here
                layers.push({
                    biomeName: biomeName,
                    x: minX * CHUNK_SIZE, 
                    y: minY * CHUNK_SIZE,
                    correctedX,
                    correctedY,
                    w: mapW * TILE_SIZE, 
                    h: renderH * TILE_SIZE,
                    canvas: canvas,
                    path: finalPath ? finalPath.map(p => ({ x: p.x, y: p.y - offsetY })) : null,
                    // Storage for independent PW scanning
                    buffer: rawResult.buffer, 
                    width: mapW, 
                    mapH: renderH,
                    tileIndices: rawResult.tileIndices,
                    xmax: rawResult.xmax, 
                    ymax: rawResult.ymax, 
                    tileSize: rawResult.tileSize,
                    numHTiles: rawResult.numHTiles, 
                    numVTiles: rawResult.numVTiles,
                    chunkBasePos: {x: minX, y: minY},
                    minX, // TODO: Refactor references to these
                    minY, 
                    validChunks,
                    poisByPW: {}, // Initialize PW cache
                    pixelSceneRooms: rawResult.pixelSceneRooms
                });
            }
        }
    }

    const t1 = performance.now();
    console.log(`[Generator] Biome tile generation completed in ${(t1 - t0).toFixed(2)} ms`);
    return layers;
}