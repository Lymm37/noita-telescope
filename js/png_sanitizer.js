import { getFromZipFirst } from "./zip_extraction.js";

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

// Also applies to "air"
export function makeBlackTransparent(ctx) {
    const imgData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    const data = imgData.data;

    for (let i = 0; i < data.length; i += 4) {
        // Check if R=0, G=0, B=0
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0) {
            data[i + 3] = 0; // Set Alpha to 0 (Transparent)
        }
    }

    ctx.putImageData(imgData, 0, 0);
}
