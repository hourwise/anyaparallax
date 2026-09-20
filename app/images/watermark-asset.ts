/**
 * Development watermark overlay (Slice 06 repair 01).
 *
 * The watermark is an ASSET, not a compositing routine. It is rendered once into
 * a transparent PNG and then handed to the platform's draw facility, so the
 * Worker never touches the photograph's pixels: it only supplies the overlay.
 * That is the whole difference between this repair and the previous approach,
 * which decoded the image and blended a mask in JavaScript.
 *
 * REPLACEABILITY: the asset is deliberately small and self-contained. Replacing
 * it means either dropping a real PNG in place of `developmentWatermarkOverlay()`
 * or editing `renderWordmark()` here; nothing else in the pipeline knows what the
 * mark looks like. `label` states plainly that this is a placeholder, and it is
 * surfaced through the checks so a placeholder cannot quietly ship as the final
 * asset.
 *
 * Pure module: a byte-level PNG writer over Web-standard APIs, no bindings, no
 * node built-ins. It runs inside a Worker.
 */
import type { WatermarkOverlay } from "./image-processor";

/** 5x7 glyphs for the characters the wordmark needs, as row bitmasks. */
const GLYPHS: Record<string, readonly number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  N: [0x11, 0x19, 0x19, 0x15, 0x13, 0x13, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  " ": [0, 0, 0, 0, 0, 0, 0],
};

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const GLYPH_GAP = 1;
/** Supersample factor: the mark is drawn 3x and box-filtered down for edges. */
const SUPERSAMPLE = 3;
/** Cap height of each line, before supersampling. */
const LINE_ONE_SCALE = 4;
const LINE_TWO_SCALE = 2;
const LINE_GAP = 4;
const PADDING = 4;

/** One rendered line: a coverage mask at the supersampled resolution. */
type Line = {
  readonly mask: Uint8Array;
  readonly width: number;
  readonly height: number;
};

/** Render `text` into a coverage mask (0 = transparent, 255 = opaque ink). */
function renderLine(text: string, scale: number): Line {
  const unit = scale * SUPERSAMPLE;
  const advance = (GLYPH_WIDTH + GLYPH_GAP) * unit;
  const width = Math.max(1, advance * text.length - GLYPH_GAP * unit);
  const height = GLYPH_HEIGHT * unit;
  const mask = new Uint8Array(width * height);

  for (let index = 0; index < text.length; index += 1) {
    const glyph = GLYPHS[text[index] ?? " "] ?? GLYPHS[" "];
    if (!glyph) {
      continue;
    }
    const originX = index * advance;
    for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
      const bits = glyph[row] ?? 0;
      for (let column = 0; column < GLYPH_WIDTH; column += 1) {
        // Bit 4 is the leftmost column of the 5-wide glyph.
        if ((bits & (1 << (GLYPH_WIDTH - 1 - column))) === 0) {
          continue;
        }
        for (let y = 0; y < unit; y += 1) {
          const targetY = row * unit + y;
          const rowStart = targetY * width;
          for (let x = 0; x < unit; x += 1) {
            const targetX = originX + column * unit + x;
            if (targetX < width) {
              mask[rowStart + targetX] = 255;
            }
          }
        }
      }
    }
  }
  return { mask, width, height };
}

/** Box-filter a supersampled mask down by `SUPERSAMPLE`, producing anti-aliasing. */
function downsample(line: Line): Line {
  const width = Math.max(1, Math.floor(line.width / SUPERSAMPLE));
  const height = Math.max(1, Math.floor(line.height / SUPERSAMPLE));
  const mask = new Uint8Array(width * height);
  const samples = SUPERSAMPLE * SUPERSAMPLE;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        const sourceRow = (y * SUPERSAMPLE + sy) * line.width;
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          total += line.mask[sourceRow + x * SUPERSAMPLE + sx] ?? 0;
        }
      }
      mask[y * width + x] = Math.round(total / samples);
    }
  }
  return { mask, width, height };
}

/** A rendered overlay: RGBA pixels with white ink and coverage as alpha. */
export type OverlayRaster = {
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
};

/**
 * Render the two-line development wordmark into a transparent RGBA raster.
 *
 * Exported so the check can assert the shape of the asset (two ink bands with a
 * gap, real anti-aliasing, transparent background) without decoding a PNG.
 */
export function renderWordmark(): OverlayRaster {
  const first = downsample(renderLine("ANYAPARALLAX", LINE_ONE_SCALE));
  const second = downsample(renderLine("PHOTOGRAPHY", LINE_TWO_SCALE));

  const width = Math.max(first.width, second.width) + PADDING * 2;
  const height = first.height + LINE_GAP + second.height + PADDING * 2;
  const pixels = new Uint8Array(width * height * 4);

  const paint = (line: Line, offsetY: number) => {
    const offsetX = Math.floor((width - line.width) / 2);
    for (let y = 0; y < line.height; y += 1) {
      for (let x = 0; x < line.width; x += 1) {
        const coverage = line.mask[y * line.width + x] ?? 0;
        if (coverage === 0) {
          continue;
        }
        const target = ((y + offsetY) * width + (x + offsetX)) * 4;
        // White ink: the mark reads on both dark and light photographs.
        pixels[target] = 255;
        pixels[target + 1] = 255;
        pixels[target + 2] = 255;
        pixels[target + 3] = coverage;
      }
    }
  };
  paint(first, PADDING);
  paint(second, PADDING + first.height + LINE_GAP);

  return { pixels, width, height };
}

// --- Minimal PNG writer ----------------------------------------------------

/** CRC-32 (IEEE), computed lazily into a table. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Adler-32, the checksum a zlib stream ends with. */
function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * Wrap `raw` in a zlib stream using STORED (uncompressed) deflate blocks.
 *
 * A stored stream is valid zlib and needs no compressor, so this stays a pure
 * synchronous function with no dependency on `CompressionStream`. The overlay is
 * a few kilobytes and is built once per process, so the size cost is irrelevant;
 * the simplicity is worth more than the bytes.
 */
function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  let cursor = 0;
  // CMF/FLG: deflate, 32K window, no preset dictionary, level bits set so the
  // FCHECK value makes the pair a multiple of 31 (required by RFC 1950).
  out[cursor++] = 0x78;
  out[cursor++] = 0x01;

  for (let block = 0; block < blocks; block += 1) {
    const start = block * 65535;
    const length = Math.min(65535, raw.length - start);
    const isLast = block === blocks - 1;
    out[cursor++] = isLast ? 1 : 0;
    out[cursor++] = length & 0xff;
    out[cursor++] = (length >>> 8) & 0xff;
    out[cursor++] = ~length & 0xff;
    out[cursor++] = (~length >>> 8) & 0xff;
    out.set(raw.subarray(start, start + length), cursor);
    cursor += length;
  }

  const sum = adler32(raw);
  out[cursor++] = (sum >>> 24) & 0xff;
  out[cursor++] = (sum >>> 16) & 0xff;
  out[cursor++] = (sum >>> 8) & 0xff;
  out[cursor++] = sum & 0xff;
  return out.subarray(0, cursor);
}

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + payload.length);
  const length = payload.length;
  out[0] = (length >>> 24) & 0xff;
  out[1] = (length >>> 16) & 0xff;
  out[2] = (length >>> 8) & 0xff;
  out[3] = length & 0xff;
  for (let index = 0; index < 4; index += 1) {
    out[4 + index] = type.charCodeAt(index);
  }
  out.set(payload, 8);
  const crcInput = out.subarray(4, 8 + payload.length);
  const crc = crc32(crcInput);
  out[8 + payload.length] = (crc >>> 24) & 0xff;
  out[9 + payload.length] = (crc >>> 16) & 0xff;
  out[10 + payload.length] = (crc >>> 8) & 0xff;
  out[11 + payload.length] = crc & 0xff;
  return out;
}

/** Encode an RGBA raster as a non-interlaced 8-bit RGBA PNG. */
export function encodeOverlayPng(raster: OverlayRaster): Uint8Array {
  const { pixels, width, height } = raster;
  // Each scanline is prefixed with its filter type; 0 means "no filtering".
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const target = y * (1 + width * 4);
    raw[target] = 0;
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), target + 1);
  }

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  ihdr[0] = (width >>> 24) & 0xff;
  ihdr[1] = (width >>> 16) & 0xff;
  ihdr[2] = (width >>> 8) & 0xff;
  ihdr[3] = width & 0xff;
  ihdr[4] = (height >>> 24) & 0xff;
  ihdr[5] = (height >>> 16) & 0xff;
  ihdr[6] = (height >>> 8) & 0xff;
  ihdr[7] = height & 0xff;
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const parts = [
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibStored(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

/** Built once per process: rendering and encoding are pure and deterministic. */
let cached: WatermarkOverlay | null = null;

/**
 * The development watermark overlay, ready to hand to the platform's draw call.
 *
 * `label` says what this is, so an operator surface or a check can report that a
 * placeholder is in use.
 */
export function developmentWatermarkOverlay(): WatermarkOverlay {
  if (cached) {
    return cached;
  }
  cached = {
    bytes: encodeOverlayPng(renderWordmark()),
    contentType: "image/png",
    label: "development wordmark ANYAPARALLAX / PHOTOGRAPHY — replace with the final asset",
  };
  return cached;
}
