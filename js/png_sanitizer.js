import { getFromZipFirst } from "./zip_extraction.js";

// Detect Node so the rest of this file can pick ESM-local deps instead of the
// browser CDN URLs. `process` is injected by Node; browsers leave it undefined.
const IS_NODE = typeof process !== 'undefined' && !!process?.versions?.node;

/**
 * sanitizes a PNG buffer by removing ancillary chunks (gAMA, iCCP, sRGB, etc.)
 * that cause browsers to alter pixel values.
 * Returns a Blob to the cleaned image.
 */
export async function sanitizePng(url) {
    const response = await getFromZipFirst(url);
    const buffer = await response.arrayBuffer();
    const view = new DataView(buffer);
    
    // PNG Signature: 89 50 4E 47 0D 0A 1A 0A
    if (view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) {
        console.warn("Not a valid PNG, skipping sanitization:", url);
        return url; // Return original if not PNG
    }

    const chunks = [];
    // Header is 8 bytes
    chunks.push(buffer.slice(0, 8));

    let offset = 8;
    while (offset < buffer.byteLength) {
        // Chunk Length (4 bytes)
        const length = view.getUint32(offset);
        // Chunk Type (4 bytes)
        const type = String.fromCharCode(
            view.getUint8(offset + 4),
            view.getUint8(offset + 5),
            view.getUint8(offset + 6),
            view.getUint8(offset + 7)
        );

        // Check if we keep this chunk
        // Critical chunks: IHDR, PLTE, IDAT, IEND, tRNS
        // Ancillary chunks to strip: gAMA, cHRM, iCCP, sRGB
        const isCritical = ['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS'].includes(type);
        
        if (isCritical) {
            // Copy Length(4) + Type(4) + Data(length) + CRC(4) = Length + 12
            chunks.push(buffer.slice(offset, offset + length + 12));
        } else {
            //console.log(`[PNG] Stripping chunk ${type} from ${url.split('/').pop()}`);
        }

        offset += length + 12;
    }

    return new Blob(chunks, { type: 'image/png' });
}

// In Node, `getFromZipFirst` can't resolve browser-relative URLs or use
// `fetch`. Read the underlying PNG straight off disk; the zip bundles exist
// only to avoid N requests from the browser, which isn't a Node concern.
async function readPngBufferNode(url) {
    const fs = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const fileUrl = new URL(url, import.meta.url);
    return (await fs.readFile(fileURLToPath(fileUrl))).buffer;
}

// Updated version using UPNG

const decodeCanvas = new OffscreenCanvas(0, 0);
const decodeCtx = decodeCanvas.getContext("2d", { willReadFrequently: true });

export async function loadPNG(url, returnBitmap=false) {
    let originalBuffer;
    if (IS_NODE) {
        originalBuffer = await readPngBufferNode(url);
    } else {
        const response = await getFromZipFirst(url);
        originalBuffer = await response.arrayBuffer();
    }
    
    if (IS_NODE) {
        throw new Error("createImageBitmap is required, which Node does not support");
    }
    
    const blob = new Blob([originalBuffer], { type: 'image/png' });
    
    const bitmap = await createImageBitmap(blob, {
        // Prevents color correction due to ancillary chunks
        colorSpaceConversion: "none"
    });

    if (returnBitmap) {
        return bitmap;
    }

    const { width, height } = bitmap;

    decodeCanvas.width = width;
    decodeCanvas.height = height;

    decodeCtx.drawImage(bitmap, 0, 0);
    const imgData = decodeCtx.getImageData(0, 0, width, height);

    // Nothing that uses loadPNG ever refers to the returned bitmap.
    // This results in every single texture passed to loadPNG to stay
    // loaded separately in VRAM, without it actually being used.
    bitmap.close();

    return {
        data: new Uint8Array(imgData.data.buffer),
        width, height
    };
}

export function loadPNGBitmap(url) {
    return loadPNG(url, true);
}
