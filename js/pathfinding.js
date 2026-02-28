import { getWorldCenter } from "./utils.js";
import { getMainBiomePathStartX } from "./biome_hacks.js";

//let global_extra_rerolls = 0; // Seed 3 requires 10 rerolls, even though it seems like there is a valid path much earlier??

function findSequences(pixels, width, rowY, stride) {
    const seqs = [];
    let start = null;
    const rowOffset = rowY * width;
    
    for (let x = 0; x < width; x++) {
        const idx = (rowOffset + x) * stride;
        const isBlack = (pixels[idx] === 0 && pixels[idx+1] === 0 && pixels[idx+2] === 0);
        
        if (isBlack) {
            if (start === null) start = x;
        } else {
            if (start !== null) {
                seqs.push([start, x - 1]);
                start = null;
            }
        }
    }
    if (start !== null) seqs.push([start, width - 1]);
    return seqs;
}

export function findMinPath(bbox, pixels, width, height, biomeName = '', isNGPlus) {
    const stride = 3;
    let startY = 4;
    let topSequences = [];

    // Actually turns out it doesn't need to be a main biome, just needs to be in this range
    // Previous: if (isMainBiome && ...)
    if (bbox[0] <= getWorldCenter(isNGPlus) && bbox[2] >= getWorldCenter(isNGPlus)) {
        startY = 4;
        const startX = getMainBiomePathStartX(biomeName, bbox[0], isNGPlus); //MAIN_PATH_LOOKUP[biomeName];
        if (startX !== undefined) {
            const idx = (startY * width + startX) * stride;
            if (pixels[idx] === 0 && pixels[idx+1] === 0 && pixels[idx+2] === 0) {
                topSequences.push([startX, startX]);
            }
        }
    } else {
        topSequences = findSequences(pixels, width, startY, stride);
    }

    if (topSequences.length === 0) return null;

    //const bottomSequences = findSequences(pixels, width, height - 1, stride);
    //if (bottomSequences.length === 0) return null;

    const directions = [[0, 1], [-1, 0], [1, 0], [0, -1]];

    for (const startSeq of topSequences) {
        const startX = Math.floor((startSeq[0] + startSeq[1]) / 2);

        const visited = new Uint8Array(width * height);
        const parents = new Int32Array(width * height).fill(-1); 
        
        const queue = [];
        queue.push({x: startX, y: startY});
        
        visited[startY * width + startX] = 1;
        parents[startY * width + startX] = -2; 

        let found = false;
        let finalNode = null;

        while (queue.length > 0) {
            const curr = queue.shift();
            
            if (curr.y === height - 1) {
                found = true;
                finalNode = curr;
                break;
            }

            for (const [dx, dy] of directions) {
                const nx = curr.x + dx;
                const ny = curr.y + dy;

                if (nx >= 0 && nx < width && ny > 3 && ny < height) {
                    const nIdx = ny * width + nx;
                    if (visited[nIdx] === 0) {
                        const pIdx = nIdx * stride;
                        const pixelColor = (pixels[pIdx] << 16) | (pixels[pIdx+1] << 8) | pixels[pIdx+2];
                        if ((pixelColor === 0x000000) || (pixelColor === 0xc0ffee) || (pixelColor === 0x8aff80)) {
                            visited[nIdx] = 1;
                            parents[nIdx] = curr.y * width + curr.x;
                            queue.push({x: nx, y: ny});
                        }
                    }
                }
            }
        }

        if (found) {
            const path = [];
            let currIdx = finalNode.y * width + finalNode.x;
            while (currIdx !== -2 && currIdx !== -1) {
                const py = Math.floor(currIdx / width);
                const px = currIdx % width;
                path.push({x: px, y: py});
                
                const pIdx = parents[currIdx];
                if (pIdx === -2) break; 
                currIdx = pIdx;
            }
            return path.reverse();
        }
    }
    return null;
}

