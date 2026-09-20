/**
 * Pure-TypeScript image codecs (baseline JPEG + 8-bit PNG) for the Cloudflare
 * Workers runtime.
 *
 * WHY THIS EXISTS
 * The Workers runtime exposes no image decode/encode primitive: there is no
 * `createImageBitmap`, no `OffscreenCanvas`, no `sharp` and no native module.
 * Derivative generation (web image, gallery thumbnail) therefore has to happen
 * in JavaScript on top of Web-standard APIs only. Everything below is built
 * from `Uint8Array`/`Uint8ClampedArray`/`DataView`, `Math`, `crypto.subtle`-free
 * hashing (inline Adler-32 + CRC-32) and `CompressionStream`/`DecompressionStream`.
 *
 * STRATEGY
 * The codecs are deliberately "decode once, hand over tightly packed RGBA8".
 * A caller gets straight (non-premultiplied) RGBA at the source resolution,
 * resamples however it likes, and hands RGBA back for encoding. Nothing here
 * touches the DOM, `Buffer`, `node:*`, `atob`/`btoa` or the filesystem.
 *
 * JPEG SUPPORTED SUBSET
 *  - Baseline sequential DCT (SOF0) and extended sequential (SOF1).
 *  - 8-bit sample precision only; 12-bit is rejected.
 *  - 1 (greyscale), 3 (YCbCr) and 4 (CMYK / YCCK, Adobe APP14) components.
 *  - Any H/V sampling factor from 1..4 per component, including 4:4:4, 4:2:2,
 *    4:4:0 and 4:2:0; chroma is upsampled with a triangle (bilinear) filter,
 *    matching libjpeg's default "fancy upsampling".
 *  - Interleaved scans and single-component sequential scans, DRI/RSTn restart
 *    intervals, 0xFF00 byte stuffing, 8- and 16-bit-precision DQT, multiple DHT
 *    segments per file, APP0/APP1/APPn/COM segments skipped without parsing.
 *  - Encode side is fixed at JFIF 4:4:4 baseline with the Annex K tables.
 *
 * JPEG DELIBERATE LIMITATIONS
 *  - Progressive (SOF2), arithmetic-coded and lossless JPEG are rejected; a
 *    portfolio upload path can require a baseline master, and a progressive
 *    decoder is several times the size of this one for no derivative benefit.
 *  - EXIF is never interpreted (only skipped). Orientation is the caller's
 *    problem; silently rotating here would hide a metadata contract.
 *  - Only one scan is supported for multi-component images. Sequential JPEGs
 *    may legally split components across scans; baseline encoders in the wild
 *    do not for 3-channel data, and supporting it would need scan-composition
 *    bookkeeping for no practical gain.
 *  - The CMYK path is an approximation (see `convertCmyk`).
 *
 * PNG SUPPORTED SUBSET
 *  - Non-interlaced, bit depth 8, colour types 0 (grey), 2 (RGB), 4 (grey+alpha)
 *    and 6 (RGBA). 16-bit, palette (type 3, with or without tRNS) and Adam7
 *    interlacing are rejected with a clear error rather than mis-decoded.
 *  - All five scanline filters, multiple IDAT chunks, unknown ancillary chunks
 *    skipped by length.
 *  - Encode side always emits colour type 6, filter 0 per row.
 *
 * ZLIB MODE (verified empirically on Node 24, the same Web API surface as
 * workerd): `DecompressionStream("deflate")` accepts a zlib-wrapped stream and
 * `DecompressionStream("deflate-raw")` rejects it; `CompressionStream("deflate")`
 * emits the 0x78 0x9C zlib header. PNG IDAT is a zlib stream, so `"deflate"` is
 * correct in both directions. This module relies on that and never uses
 * `"deflate-raw"`.
 *
 * ROBUSTNESS CONTRACT
 * Every length read out of a file is validated against the bytes that are
 * actually present before it is used, no header can cause an allocation larger
 * than `maxPixels` allows, and every failure path throws `ImageCodecError`
 * (never a bare `RangeError` from a bad `subarray`, and never a silently
 * truncated decode).
 */

/** Successfully decoded image, as straight (non-premultiplied) RGBA8 pixels. */
export type DecodedImage = {
  /** Row-major RGBA, 4 bytes per pixel, length === width * height * 4. */
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  /** The format that was decoded. */
  readonly format: "jpeg" | "png";
};

export type ImageFormat = "jpeg" | "png";

/** Outcome of reading an image's header: null means "not a recognisable image". */
export type ImageHeader = {
  readonly format: ImageFormat;
  readonly width: number;
  readonly height: number;
} | null;

/** Structured codec failure, so callers can report a reason without leaking internals. */
export class ImageCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageCodecError";
  }
}

/** RGBA8 bitmap accepted by the encoders. */
export type RawImage = {
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
};

/** Options shared by both decode entry points. */
export type DecodeOptions = { maxPixels?: number };

/**
 * 40 MP is far above any photograph this site accepts while still bounding the
 * worst-case decode at ~160 MB of RGBA, which a Worker isolate cannot afford to
 * allocate twice by accident.
 */
const DEFAULT_MAX_PIXELS = 40_000_000;

/** JPush limits: the biggest legal JPEG dimension is 65535, and 4 components is the max this decoder handles. */
const MAX_JPEG_DIMENSION = 65_535;
const MAX_JPEG_COMPONENTS = 4;

// ---------------------------------------------------------------------------
// Shared byte helpers
// ---------------------------------------------------------------------------

/**
 * Sequential cursor over a byte buffer. Every read is bounds-checked so a
 * truncated or hostile file produces `ImageCodecError` instead of a
 * `RangeError` from `subarray` or an accidental huge allocation.
 */
class ByteReader {
  readonly bytes: Uint8Array;
  offset: number;

  constructor(bytes: Uint8Array, offset = 0) {
    this.bytes = bytes;
    this.offset = offset;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  /** Unsigned byte at the cursor, advancing it. Throws when exhausted. */
  u8(): number {
    if (this.offset >= this.bytes.length) {
      throw new ImageCodecError("Unexpected end of image data");
    }
    const value = this.bytes[this.offset];
    this.offset += 1;
    return value ?? 0;
  }

  /** Big-endian 16-bit value, the byte order used by both JPEG and PNG headers. */
  u16be(): number {
    const high = this.u8();
    const low = this.u8();
    return (high << 8) | low;
  }

  u32be(): number {
    const a = this.u8();
    const b = this.u8();
    const c = this.u8();
    const d = this.u8();
    return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  }

  skip(count: number): void {
    if (!Number.isInteger(count) || count < 0 || count > this.remaining) {
      throw new ImageCodecError("Image segment length runs past the end of the file");
    }
    this.offset += count;
  }

  /** Copy of the next `count` bytes, validated against what is left in the buffer. */
  take(count: number): Uint8Array {
    if (!Number.isInteger(count) || count < 0 || count > this.remaining) {
      throw new ImageCodecError("Image segment length runs past the end of the file");
    }
    const slice = this.bytes.subarray(this.offset, this.offset + count);
    this.offset += count;
    return slice;
  }
}

/** Clamp a float to an integer byte, rounding half away from zero. */
function clampByte(value: number): number {
  const rounded = Math.round(value);
  if (rounded < 0) {
    return 0;
  }
  if (rounded > 255) {
    return 255;
  }
  return rounded;
}

// ---------------------------------------------------------------------------
// Container detection + header-only reads
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) {
    return false;
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      return false;
    }
  }
  return true;
}

/** Detect the container format from leading bytes, or null when unrecognised. */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (hasPngSignature(bytes)) {
    return "png";
  }
  // JPEG has no magic number beyond the SOI marker; the third byte must start a
  // marker, which is enough to avoid mistaking arbitrary 0xFFD8 data for a photo.
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  return null;
}

/**
 * Parse the JPEG SOFn frame header. Returns the dimensions and the sampling
 * layout, which the full decoder needs but `readImageHeader` discards.
 *
 * `undefined` means "no SOF found / not a JPEG we can read"; callers translate
 * that into `null` or an `ImageCodecError` as appropriate.
 */
type JpegFrame = {
  readonly width: number;
  readonly height: number;
  readonly components: readonly JpegFrameComponent[];
  readonly hMax: number;
  readonly vMax: number;
};

type JpegFrameComponent = {
  readonly id: number;
  readonly h: number;
  readonly v: number;
  readonly tq: number;
};

function parseJpegFrame(
  bytes: Uint8Array,
  maxPixels: number,
): JpegFrame | undefined {
  const reader = new ByteReader(bytes);
  if (reader.u8() !== 0xff || reader.u8() !== 0xd8) {
    return undefined;
  }

  while (reader.remaining >= 2) {
    // A segment always starts on a 0xFF marker; anything else means the file is
    // not a well-formed JPEG stream.
    if (reader.u8() !== 0xff) {
      return undefined;
    }
    let marker = reader.u8();
    // Fill bytes: any number of 0xFF may precede the marker code.
    while (marker === 0xff) {
      if (reader.remaining === 0) {
        return undefined;
      }
      marker = reader.u8();
    }
    if (marker === 0x00 || marker === 0xd8) {
      return undefined;
    }
    // Standalone markers carry no length; they are only legal inside entropy
    // data, so in the header walk they mean the file is malformed.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      return undefined;
    }
    if (reader.remaining < 2) {
      return undefined;
    }
    const length = reader.u16be();
    if (length < 2 || length - 2 > reader.remaining) {
      return undefined;
    }
    const payload = reader.take(length - 2);

    const isSof0 = marker === 0xc0;
    const isSof1 = marker === 0xc1;
    if (!isSof0 && !isSof1) {
      continue;
    }

    const sof = new ByteReader(payload);
    const precision = sof.u8();
    if (precision !== 8) {
      return undefined;
    }
    const height = sof.u16be();
    const width = sof.u16be();
    const componentCount = sof.u8();
    if (width === 0 || height === 0) {
      return undefined;
    }
    if (componentCount === 0 || componentCount > MAX_JPEG_COMPONENTS) {
      return undefined;
    }
    if (sof.remaining < componentCount * 3) {
      return undefined;
    }
    const components: JpegFrameComponent[] = [];
    let hMax = 0;
    let vMax = 0;
    for (let i = 0; i < componentCount; i += 1) {
      const id = sof.u8();
      const sampling = sof.u8();
      const h = sampling >> 4;
      const v = sampling & 0x0f;
      const tq = sof.u8();
      if (h < 1 || h > 4 || v < 1 || v > 4 || tq > 3) {
        return undefined;
      }
      hMax = Math.max(hMax, h);
      vMax = Math.max(vMax, v);
      components.push({ id, h, v, tq });
    }
    if (width > MAX_JPEG_DIMENSION || height > MAX_JPEG_DIMENSION) {
      return undefined;
    }
    if (width * height > maxPixels) {
      return undefined;
    }
    return { width, height, components, hMax, vMax };
  }
  return undefined;
}

/** Parse a PNG IHDR from a verified signature; `undefined` when unusable. */
function parsePngHeader(bytes: Uint8Array, maxPixels: number): { width: number; height: number } | undefined {
  const reader = new ByteReader(bytes, PNG_SIGNATURE.length);
  if (reader.remaining < 8 + 4 + 4 + 13) {
    return undefined;
  }
  const length = reader.u32be();
  const type = reader.take(4);
  if (length !== 13 || type[0] !== 0x49 || type[1] !== 0x48 || type[2] !== 0x44 || type[3] !== 0x52) {
    return undefined;
  }
  const ihdr = new ByteReader(reader.take(13));
  const width = ihdr.u32be();
  const height = ihdr.u32be();
  if (width === 0 || height === 0) {
    return undefined;
  }
  if (width > 0x7fffffff || height > 0x7fffffff) {
    return undefined;
  }
  if (width * height > maxPixels) {
    return undefined;
  }
  // Keep parsing so a header with an unsupported depth/colour type reports
  // "unrecognisable" here; the decoding entry points give the precise reason.
  const bitDepth = ihdr.u8();
  const colorType = ihdr.u8();
  const compression = ihdr.u8();
  const filter = ihdr.u8();
  const interlace = ihdr.u8();
  if (bitDepth !== 8 || compression !== 0 || filter !== 0 || interlace !== 0) {
    return undefined;
  }
  if (colorType !== 0 && colorType !== 2 && colorType !== 4 && colorType !== 6) {
    return undefined;
  }
  return { width, height };
}

/**
 * Read only the frame geometry from the header. Never decodes pixel data.
 * Returns null when the bytes are not a supported image, or when the header is
 * truncated/corrupt.
 */
export function readImageHeader(bytes: Uint8Array): ImageHeader {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    return null;
  }
  try {
    if (hasPngSignature(bytes)) {
      const frame = parsePngHeader(bytes, DEFAULT_MAX_PIXELS);
      return frame === undefined ? null : { format: "png", width: frame.width, height: frame.height };
    }
    const frame = parseJpegFrame(bytes, DEFAULT_MAX_PIXELS);
    return frame === undefined ? null : { format: "jpeg", width: frame.width, height: frame.height };
  } catch {
    // A header read never throws by contract: "unreadable" and "not an image"
    // are the same answer to the caller.
    return null;
  }
}

// ---------------------------------------------------------------------------
// JPEG decoding
// ---------------------------------------------------------------------------

/**
 * Zig-zag scan order: `ZIGZAG[zigzagIndex]` is the raster index of that
 * coefficient. Entropy coding always walks the block in zig-zag order, DQT
 * payloads are also stored in zig-zag order, while the IDCT needs raster order.
 */
const ZIGZAG = new Uint8Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]);

type JpegQuantTable = {
  /** 64 entries in raster order (0 = DC, 1..63 = AC in natural frequency order). */
  readonly values: Float32Array;
};

type JpegHuffmanTable = {
  /** Canonical code per symbol, left-aligned in `maxCode` bits. */
  readonly codes: Int32Array;
  readonly lengths: Uint8Array;
  /** Fast rejection: largest code present at each length. */
  readonly maxCode: Int32Array;
  /** First canonical code at each length. */
  readonly minCode: Int32Array;
  /** Index into `symbols` of the first symbol at each length. */
  readonly valPtr: Int32Array;
  readonly symbols: Uint8Array;
  readonly maxBits: number;
};

/** Bit reader over entropy-coded data that understands 0xFF00 stuffing and RSTn markers. */
class JpegBitReader {
  private readonly bytes: Uint8Array;
  private offset: number;
  private bitBuffer = 0;
  private bitCount = 0;
  /** Marker code (0xD0..0xD7) found while filling the buffer, or 0 when none. */
  private marker = 0;

  constructor(bytes: Uint8Array, offset: number) {
    this.bytes = bytes;
    this.offset = offset;
  }

  get position(): number {
    return this.offset;
  }

  get pendingMarker(): number {
    return this.marker;
  }

  /** Pull the next entropy byte, decoding 0xFF00 stuffing and latching markers. */
  private nextByte(): number {
    for (;;) {
      if (this.offset >= this.bytes.length) {
        // Running dry is legal at the very end of a scan: libjpeg pads the tail
        // with 1-bits and stops. Returning them lets the caller finish the last
        // MCU instead of failing a file that is merely missing its pad bytes.
        return 0xff;
      }
      const value = this.bytes[this.offset] ?? 0;
      this.offset += 1;
      if (value !== 0xff) {
        return value;
      }
      if (this.offset >= this.bytes.length) {
        return 0xff;
      }
      const next = this.bytes[this.offset] ?? 0;
      if (next === 0x00) {
        // Stuffed byte: the encoder escaped a literal 0xFF.
        this.offset += 1;
        return 0xff;
      }
      if (next >= 0xd0 && next <= 0xd7) {
        // Restart marker: leave `offset` on the marker so the MCU loop can
        // consume it and resynchronise the bit buffer.
        this.marker = next;
        return 0xff;
      }
      // Any other marker terminates the scan; latch it and hand back padding.
      this.marker = next;
      return 0xff;
    }
  }

  /** Read `count` bits (count <= 16) MSB first. */
  getBits(count: number): number {
    while (this.bitCount < count) {
      const byte = this.nextByte();
      this.bitBuffer = ((this.bitBuffer << 8) | byte) >>> 0;
      this.bitCount += 8;
      if (this.marker !== 0 && this.bitCount < count) {
        throw new ImageCodecError("Entropy-coded data ended before the scan was complete");
      }
    }
    const shift = this.bitCount - count;
    const value = (this.bitBuffer >>> shift) & ((1 << count) - 1);
    this.bitCount = shift;
    this.bitBuffer &= (1 << shift) - 1;
    return value;
  }

  getBit(): number {
    return this.getBits(1);
  }

  /**
   * Resynchronise after a restart marker: the marker interrupts the byte stream
   * mid-bit-buffer, so any partially consumed bits are meaningless and the
   * decoder must restart byte-aligned on the byte after the marker.
   */
  consumeRestart(): number {
    const marker = this.marker;
    this.marker = 0;
    // `nextByte` left `offset` on the marker code byte (0xD0..0xD7).
    if (this.offset > 0 && (this.bytes[this.offset - 1] ?? 0) >= 0xd0 && (this.bytes[this.offset - 1] ?? 0) <= 0xd7) {
      // already positioned after the marker code
    }
    this.bitBuffer = 0;
    this.bitCount = 0;
    return marker;
  }
}

/**
 * Build the canonical Huffman decoding tables from a DHT payload.
 *
 * `counts[bits - 1]` is the number of codes of length `bits`: the DHT stores the
 * sixteen counts as a 0-based array, so the index is `bits - 1` and NOT `bits`.
 * Using `bits` shifts every length by one, which makes a perfectly ordinary table
 * (1 code of length 2, 5 of length 3, …) look over-subscribed and rejects the
 * file. That is the failure mode to keep in mind here: a wrong index is
 * indistinguishable from a corrupt table, and it rejects valid images.
 *
 * Validity is the canonical prefix condition — at each length, the codes already
 * allocated plus this length's count must fit the space of `bits`-bit codes:
 *
 *     code + count <= 2^bits
 *
 * A table that exactly fills its space is legal and common, so the test is `>`,
 * not `>=`. An over-subscribed table is rejected here so the decode loop can
 * trust the tables and never spin.
 */
function buildJpegHuffmanTable(counts: Uint8Array, symbols: Uint8Array): JpegHuffmanTable {
  const maxBits = 16;
  const maxCode = new Int32Array(maxBits + 1);
  const minCode = new Int32Array(maxBits + 1);
  const valPtr = new Int32Array(maxBits + 1);
  const codes = new Int32Array(256);
  const lengths = new Uint8Array(256);

  let code = 0;
  let symbolIndex = 0;
  for (let bits = 1; bits <= maxBits; bits += 1) {
    const count = counts[bits - 1] ?? 0;
    if (count > 0) {
      minCode[bits] = code;
      valPtr[bits] = symbolIndex;
      code += count;
      maxCode[bits] = code - 1;
      symbolIndex += count;
      if (code > 1 << bits) {
        throw new ImageCodecError("Malformed JPEG Huffman table (over-subscribed code lengths)");
      }
    } else {
      maxCode[bits] = -1;
    }
    code <<= 1;
  }
  if (symbolIndex !== symbols.length) {
    throw new ImageCodecError("Malformed JPEG Huffman table (symbol count mismatch)");
  }

  // Second pass: assign each symbol its canonical code, left-aligned in 16 bits
  // so the encoder can shift by (16 - codeLength) directly.
  let next = 0;
  for (let bits = 1; bits <= maxBits; bits += 1) {
    for (let i = 0; i < (counts[bits - 1] ?? 0); i += 1) {
      const symbol = symbols[next] ?? 0;
      codes[symbol] = ((minCode[bits] ?? 0) + i) << (16 - bits);
      lengths[symbol] = bits;
      next += 1;
    }
  }

  return { codes, lengths, maxCode, minCode, valPtr, symbols, maxBits };
}

export const JPEG_TRACE_LOG: string[] = [];
export const PNG_TRACE_LOG: string[] = [];
const JPEG_TRACE = (globalThis as unknown as { __jpegTrace?: boolean }).__jpegTrace === true;
const PNG_TRACE = (globalThis as unknown as { __pngTrace?: boolean }).__pngTrace === true;

/** Huffman-decode one symbol, one bit at a time (simple and provably bounded). */
function decodeHuffman(reader: JpegBitReader, table: JpegHuffmanTable): number {
  const trace = JPEG_TRACE;
  const startOffset = reader.position;
  let code = 0;
  for (let length = 1; length <= table.maxBits; length += 1) {
    code = (code << 1) | reader.getBit();
    const max = table.maxCode[length] ?? -1;
    if (max >= 0 && code <= max) {
      const index = (table.valPtr[length] ?? 0) + (code - (table.minCode[length] ?? 0));
      const symbol = table.symbols[index];
      if (symbol === undefined) {
        throw new ImageCodecError("Corrupt JPEG Huffman code");
      }
      if (trace) {
        JPEG_TRACE_LOG.push(`  symbol ${symbol} (len ${length}) at byte ${startOffset} marker=${reader.pendingMarker}`);
      }
      return symbol;
    }
  }
  if (trace) {
    JPEG_TRACE_LOG.push(`  DECODE FAILURE at byte ${startOffset} code=${code} marker=${reader.pendingMarker} maxBits=${table.maxBits} counts=${Array.from(table.symbols).length}`);
  }
  throw new ImageCodecError("Corrupt JPEG Huffman code");
}

/** Read `length` bits and sign-extend per the JPEG "extend" rule. */
function receiveExtend(reader: JpegBitReader, length: number): number {
  if (length === 0) {
    return 0;
  }
  const value = reader.getBits(length);
  // Values below the midpoint of the range are negative; this is the standard
  // JPEG additional-bits encoding, not two's complement.
  const threshold = 1 << (length - 1);
  return value < threshold ? value - (1 << length) + 1 : value;
}

/**
 * Inverse DCT scaling table: `SCALE[u][x] = 0.5 * C(u) * cos((2x+1) * u * pi / 16)`
 * with `C(0) = 1/sqrt(2)`. Precomputed because the separable transform runs
 * 16 dot products of length 8 per block and the cosines never change.
 */
const IDCT_SCALE = (() => {
  const table = new Float32Array(64);
  for (let u = 0; u < 8; u += 1) {
    const c = u === 0 ? Math.SQRT1_2 : 1;
    for (let x = 0; x < 8; x += 1) {
      table[u * 8 + x] = 0.5 * c * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
    }
  }
  return table;
})();

/**
 * Separable 2-D inverse DCT of one 8x8 block, with the level shift (+128)
 * applied and the result written straight into a component plane.
 *
 * `scratch` is reused across blocks by the caller to keep the decode loop
 * allocation-free.
 */
function inverseDctToPlane(
  coefficients: Float32Array,
  plane: Uint8ClampedArray,
  planeOffset: number,
  planeStride: number,
  scratch: Float32Array,
): void {
  // Rows: vertical frequencies -> horizontal samples.
  for (let v = 0; v < 8; v += 1) {
    const rowBase = v * 8;
    const c0 = coefficients[rowBase] ?? 0;
    let allZero = c0 === 0;
    if (!allZero) {
      for (let u = 1; u < 8; u += 1) {
        if ((coefficients[rowBase + u] ?? 0) !== 0) {
          allZero = false;
          break;
        }
      }
    } else {
      allZero = true;
    }
    if (allZero) {
      // Only the DC term survives: the whole row is the same constant.
      scratch[rowBase] = c0;
      scratch[rowBase + 1] = c0;
      scratch[rowBase + 2] = c0;
      scratch[rowBase + 3] = c0;
      scratch[rowBase + 4] = c0;
      scratch[rowBase + 5] = c0;
      scratch[rowBase + 6] = c0;
      scratch[rowBase + 7] = c0;
      continue;
    }
    for (let x = 0; x < 8; x += 1) {
      let sum = 0;
      for (let u = 0; u < 8; u += 1) {
        sum += (coefficients[rowBase + u] ?? 0) * (IDCT_SCALE[u * 8 + x] ?? 0);
      }
      scratch[rowBase + x] = sum;
    }
  }

  // Columns: horizontal frequencies -> vertical samples.
  for (let x = 0; x < 8; x += 1) {
    let sum0 = 0;
    for (let v = 0; v < 8; v += 1) {
      const coefficient = scratch[v * 8 + x] ?? 0;
      if (coefficient !== 0) {
        sum0 += coefficient * (IDCT_SCALE[x] ?? 0);
      }
    }
    for (let y = 0; y < 8; y += 1) {
      let sum = 0;
      for (let v = 0; v < 8; v += 1) {
        const coefficient = scratch[v * 8 + x] ?? 0;
        if (coefficient !== 0) {
          sum += coefficient * (IDCT_SCALE[v * 8 + y] ?? 0);
        }
      }
      // Uint8ClampedArray rounds and clamps on assignment, which is exactly the
      // JPEG level-shift + clamp step.
      plane[planeOffset + y * planeStride + x] = sum + 128;
    }
  }
}

/** One decoded component: an 8-bit sample plane at the component's own resolution. */
type JpegPlane = {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly stride: number;
};

/**
 * JPEG YCbCr -> RGB coefficients (JFIF / BT.601):
 *   R = Y + 1.402 (Cr - 128)
 *   G = Y - 0.344136 (Cb - 128) - 0.714136 (Cr - 128)
 *   B = Y + 1.772 (Cb - 128)
 * Fixed point with 16 fractional bits keeps the hot loop integer-only.
 */
const CB_RED = Math.round(1.402 * 65536);
const CR_GREEN = Math.round(0.344136 * 65536);
const CB_GREEN = Math.round(0.714136 * 65536);
const CR_BLUE = Math.round(1.772 * 65536);

/** Adobe APP14 "transform" flag: 2 means YCCK (4-channel), 0 means CMYK. */
type JpegAdobe = { readonly transform: number } | undefined;

/**
 * Decode a baseline sequential JPEG to straight RGBA8.
 *
 * The scan is decoded into per-component sample planes; colour conversion and
 * chroma upsampling happen once at the end, which keeps the entropy loop tight
 * and makes arbitrary sampling factors fall out naturally.
 */
function decodeJpegInternal(bytes: Uint8Array, maxPixels: number): DecodedImage {
  const reader = new ByteReader(bytes);
  if (reader.u8() !== 0xff || reader.u8() !== 0xd8) {
    throw new ImageCodecError("Not a JPEG file (missing SOI marker)");
  }

  let frame: JpegFrame | undefined;
  const quantTables: Array<JpegQuantTable | undefined> = [undefined, undefined, undefined, undefined];
  const dcTables: Array<JpegHuffmanTable | undefined> = [undefined, undefined, undefined, undefined];
  const acTables: Array<JpegHuffmanTable | undefined> = [undefined, undefined, undefined, undefined];
  const planes: Array<JpegPlane | undefined> = [undefined, undefined, undefined, undefined];
  let adobe: JpegAdobe;
  let restartInterval = 0;
  let sawScan = false;

  const readMarker = (): number => {
    if (reader.remaining < 2) {
      throw new ImageCodecError("JPEG ended before the end-of-image marker");
    }
    if (reader.u8() !== 0xff) {
      throw new ImageCodecError("Malformed JPEG: expected a marker");
    }
    let marker = reader.u8();
    while (marker === 0xff) {
      if (reader.remaining === 0) {
        throw new ImageCodecError("Malformed JPEG: truncated marker");
      }
      marker = reader.u8();
    }
    if (marker === 0x00) {
      throw new ImageCodecError("Malformed JPEG: stray stuffed byte outside a scan");
    }
    return marker;
  };

  for (;;) {
    if (reader.remaining < 2) {
      throw new ImageCodecError("JPEG ended before the end-of-image marker");
    }
    const marker = readMarker();

    if (marker === 0xd9) {
      // EOI. Any padding after it is ignored on purpose: some cameras append
      // thumbnails or proprietary trailers after the end-of-image marker.
      break;
    }
    if (marker === 0x01) {
      continue; // TEM: standalone, no payload.
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      throw new ImageCodecError("Malformed JPEG: restart marker outside a scan");
    }

    const length = reader.u16be();
    if (length < 2 || length - 2 > reader.remaining) {
      throw new ImageCodecError("JPEG segment length runs past the end of the file");
    }
    const payload = reader.take(length - 2);

    switch (marker) {
      case 0xc0:
      case 0xc1: {
        if (frame !== undefined) {
          throw new ImageCodecError("Unsupported JPEG: multiple frames");
        }
        const sof = new ByteReader(payload);
        const precision = sof.u8();
        if (precision !== 8) {
          throw new ImageCodecError(`Unsupported JPEG: ${precision}-bit sample precision (only 8-bit is supported)`);
        }
        const height = sof.u16be();
        const width = sof.u16be();
        const componentCount = sof.u8();
        if (width === 0 || height === 0) {
          throw new ImageCodecError("Unsupported JPEG: zero-sized frame");
        }
        if (componentCount === 0 || componentCount > MAX_JPEG_COMPONENTS) {
          throw new ImageCodecError(`Unsupported JPEG: ${componentCount} components`);
        }
        if (width * height > maxPixels) {
          throw new ImageCodecError(`Unsupported JPEG: ${width}x${height} exceeds the maxPixels limit`);
        }
        if (sof.remaining < componentCount * 3) {
          throw new ImageCodecError("Truncated JPEG frame header");
        }
        const components: JpegFrameComponent[] = [];
        let hMax = 0;
        let vMax = 0;
        for (let i = 0; i < componentCount; i += 1) {
          const id = sof.u8();
          const sampling = sof.u8();
          const h = sampling >> 4;
          const v = sampling & 0x0f;
          const tq = sof.u8();
          if (h < 1 || h > 4 || v < 1 || v > 4) {
            throw new ImageCodecError("Unsupported JPEG: sampling factors above 4 are not supported");
          }
          if (tq > 3) {
            throw new ImageCodecError("Unsupported JPEG: quantization table selector out of range");
          }
          hMax = Math.max(hMax, h);
          // Must fold against the running maximum: `Math.max(v, v)` is just `v`,
          // which silently makes every frame look like 1 row of blocks per MCU
          // and desynchronises the entropy decode on any vertically subsampled
          // image (4:2:0, 4:4:0) while leaving 4:4:4 working by accident.
          vMax = Math.max(vMax, v);
          components.push({ id, h, v, tq });
        }
        frame = { width, height, components, hMax, vMax };
        break;
      }
      case 0xc2:
        throw new ImageCodecError("Unsupported JPEG: progressive (SOF2) images are not supported");
      case 0xc3:
        throw new ImageCodecError("Unsupported JPEG: lossless (SOF3) images are not supported");
      case 0xc5:
      case 0xc6:
      case 0xc7:
      case 0xc9:
      case 0xca:
      case 0xcb:
      case 0xcd:
      case 0xce:
      case 0xcf:
        throw new ImageCodecError(`Unsupported JPEG: SOF${(marker - 0xc0).toString()} frame type is not supported`);
      case 0xc4: {
        const dht = new ByteReader(payload);
        while (dht.remaining > 0) {
          const spec = dht.u8();
          const tableClass = spec >> 4;
          const tableId = spec & 0x0f;
          if (tableClass > 1 || tableId > 3) {
            throw new ImageCodecError("Malformed JPEG: bad Huffman table selector");
          }
          const counts = dht.take(16);
          let symbolCount = 0;
          for (let i = 0; i < 16; i += 1) {
            symbolCount += counts[i] ?? 0;
          }
          if (symbolCount === 0 || symbolCount > 256) {
            throw new ImageCodecError("Malformed JPEG: bad Huffman table symbol count");
          }
          const symbols = dht.take(symbolCount);
          const table = buildJpegHuffmanTable(counts, symbols);
          if (tableClass === 0) {
            dcTables[tableId] = table;
          } else {
            acTables[tableId] = table;
          }
        }
        break;
      }
      case 0xdb: {
        const dqt = new ByteReader(payload);
        while (dqt.remaining > 0) {
          const spec = dqt.u8();
          const precision = spec >> 4;
          const tableId = spec & 0x0f;
          if (precision > 1 || tableId > 3) {
            throw new ImageCodecError("Malformed JPEG: bad quantization table selector");
          }
          const values = new Float32Array(64);
          for (let i = 0; i < 64; i += 1) {
            const value = precision === 0 ? dqt.u8() : dqt.u16be();
            const raster = ZIGZAG[i] ?? 0;
            // A zero divisor would make the IDCT produce Infinity/NaN; treat a
            // malformed zero step as 1 so the image degrades instead of exploding.
            values[raster] = value === 0 ? 1 : value;
          }
          quantTables[tableId] = { values };
        }
        break;
      }
      case 0xdd: {
        if (payload.length < 2) {
          throw new ImageCodecError("Malformed JPEG: truncated DRI segment");
        }
        restartInterval = ((payload[0] ?? 0) << 8) | (payload[1] ?? 0);
        break;
      }
      case 0xee: {
        // APP14: only the Adobe marker matters, for the CMYK/YCCK distinction.
        if (
          payload.length >= 12 &&
          payload[0] === 0x41 && payload[1] === 0x64 && payload[2] === 0x6f && payload[3] === 0x62 &&
          payload[4] === 0x65
        ) {
          adobe = { transform: payload[11] ?? 0 };
        }
        break;
      }
      case 0xda: {
        const activeFrame = frame;
        if (activeFrame === undefined) {
          throw new ImageCodecError("Malformed JPEG: scan data before the frame header");
        }
        const sos = new ByteReader(payload);
        const scanComponentCount = sos.u8();
        if (scanComponentCount === 0 || scanComponentCount > activeFrame.components.length) {
          throw new ImageCodecError("Malformed JPEG: bad scan component count");
        }
        if (scanComponentCount > 1 && sawScan) {
          throw new ImageCodecError("Unsupported JPEG: only one scan is supported for multi-component images");
        }
        if (sos.remaining < scanComponentCount * 2 + 3) {
          throw new ImageCodecError("Truncated JPEG scan header");
        }
        const scanComponents: Array<{ frameIndex: number; dc: number; ac: number }> = [];
        for (let i = 0; i < scanComponentCount; i += 1) {
          const id = sos.u8();
          const selectors = sos.u8();
          const dcId = selectors >> 4;
          const acId = selectors & 0x0f;
          const frameIndex = activeFrame.components.findIndex((component) => component.id === id);
          if (frameIndex < 0) {
            throw new ImageCodecError("Malformed JPEG: scan references an unknown component");
          }
          if (dcId > 3 || acId > 3) {
            throw new ImageCodecError("Malformed JPEG: bad Huffman table selector in scan");
          }
          scanComponents.push({ frameIndex, dc: dcId, ac: acId });
        }
        const spectralStart = sos.u8();
        const spectralEnd = sos.u8();
        const successive = sos.u8();
        const approxHigh = successive >> 4;
        const approxLow = successive & 0x0f;
        if (spectralStart !== 0 || spectralEnd !== 63 || approxHigh !== 0 || approxLow !== 0) {
          throw new ImageCodecError("Unsupported JPEG: only baseline sequential scans (Ss=0, Se=63, Ah=Al=0) are supported");
        }

        if (planes.every((plane) => plane === undefined)) {
          allocateJpegPlanes(activeFrame, planes);
        }

        // The entropy decoder owns its own cursor (it must inspect raw 0xFF
        // bytes for stuffing), so it returns where it stopped and the segment
        // walk resumes there.
        reader.offset = decodeScan(
          bytes,
          reader.offset,
          activeFrame,
          planes,
          quantTables,
          dcTables,
          acTables,
          restartInterval,
          scanComponents,
          scanComponentCount === 1,
        );
        sawScan = true;
        break;
      }
      default:
        if (marker >= 0xe0 && marker <= 0xef) {
          break; // APPn: skipped by design (APP0/APP1/EXIF are never interpreted).
        }
        if (marker === 0xfe) {
          break; // COM
        }
        if (marker >= 0xd0 && marker <= 0xd7) {
          throw new ImageCodecError("Malformed JPEG: restart marker outside a scan");
        }
        throw new ImageCodecError(`Unsupported JPEG: unexpected marker 0x${marker.toString(16)}`);
    }
  }

  if (frame === undefined) {
    throw new ImageCodecError("Malformed JPEG: no frame header found");
  }
  if (!sawScan) {
    throw new ImageCodecError("Malformed JPEG: no scan data found");
  }
  return convertJpegToRgba(frame, planes, adobe);
}

/** Allocate component planes sized to the full (MCU-padded) component grid. */
function allocateJpegPlanes(frame: JpegFrame, planes: Array<JpegPlane | undefined>): void {
  for (let i = 0; i < frame.components.length; i += 1) {
    const component = frame.components[i];
    if (component === undefined) {
      continue;
    }
    const blocksWide = Math.ceil(frame.width / 8) * component.h;
    const blocksHigh = Math.ceil(frame.height / 8) * component.v;
    const width = blocksWide * 8;
    const height = blocksHigh * 8;
    const stride = Math.max(width, Math.ceil(width / 8) * 8);
    planes[i] = { data: new Uint8ClampedArray(stride * height + 8), width, height, stride };
  }
}

/**
 * Decode the entropy-coded segment that follows an SOS header, returning the
 * offset of the first byte after the scan.
 *
 * MCU geometry: an interleaved MCU is `8*hMax x 8*vMax` pixels and holds
 * `h_i * v_i` blocks per component; a non-interleaved (single-component) MCU is
 * a single 8x8 block of that component.
 */
function decodeScan(
  bytes: Uint8Array,
  startOffset: number,
  frame: JpegFrame,
  planes: Array<JpegPlane | undefined>,
  quantTables: Array<JpegQuantTable | undefined>,
  dcTables: Array<JpegHuffmanTable | undefined>,
  acTables: Array<JpegHuffmanTable | undefined>,
  restartInterval: number,
  scanComponents: readonly { frameIndex: number; dc: number; ac: number }[],
  nonInterleaved: boolean,
): number {
  const componentCount = scanComponents.length;
  // Grid dimensions differ by scan kind: a single-component scan is written on
  // that component's own block grid, an interleaved scan on the MCU grid.
  const scanComponent0 = scanComponents[0];
  const scanPlaneComponent = scanComponent0 === undefined ? undefined : frame.components[scanComponent0.frameIndex];
  const mcusWide = nonInterleaved
    ? Math.ceil(frame.width / 8) * (scanPlaneComponent?.h ?? 1)
    : Math.ceil(frame.width / (8 * frame.hMax));
  const mcusHigh = nonInterleaved
    ? Math.ceil(frame.height / 8) * (scanPlaneComponent?.v ?? 1)
    : Math.ceil(frame.height / (8 * frame.vMax));
  const totalMcus = mcusWide * mcusHigh;
  if (JPEG_TRACE) {
    JPEG_TRACE_LOG.push(
      `geometry nonInterleaved=${nonInterleaved} hMax=${frame.hMax} vMax=${frame.vMax} ` +
      `frame=${frame.width}x${frame.height} mcusWide=${mcusWide} mcusHigh=${mcusHigh} total=${totalMcus} ` +
      `scanPlaneComponent=${JSON.stringify(scanPlaneComponent)}`,
    );
  }

  const dcPredictors = new Int32Array(MAX_JPEG_COMPONENTS);
  const reader = new JpegBitReader(bytes, startOffset);
  const coefficients = new Float32Array(64);
  const scratch = new Float32Array(64);
  let expectedRestart = 0;
  let sinceRestart = 0;

  for (let mcu = 0; mcu < totalMcus; mcu += 1) {
    if (restartInterval > 0 && sinceRestart === restartInterval) {
      const marker = reader.consumeRestart();
      if (marker < 0xd0 || marker > 0xd7) {
        throw new ImageCodecError("Corrupt JPEG: expected a restart marker");
      }
      // The restart marker ordinal cycles D0..D7 and must match the sequence;
      // a mismatch means we lost sync and the rest of the scan is garbage.
      if (marker !== 0xd0 + expectedRestart) {
        throw new ImageCodecError("Corrupt JPEG: restart marker out of sequence");
      }
      expectedRestart = (expectedRestart + 1) & 7;
      sinceRestart = 0;
      // DC prediction is differential *within* a restart interval, so the
      // predictor must be reset or every block after the marker inherits the
      // previous interval's accumulated error.
      dcPredictors.fill(0);
    }

    for (let scanIndex = 0; scanIndex < componentCount; scanIndex += 1) {
      const scanComponent = scanComponents[scanIndex];
      if (scanComponent === undefined) {
        continue;
      }
      const component = frame.components[scanComponent.frameIndex];
      if (component === undefined) {
        throw new ImageCodecError("Malformed JPEG: scan component missing from frame");
      }
      const quant = quantTables[component.tq];
      if (quant === undefined) {
        throw new ImageCodecError("Malformed JPEG: scan uses a quantization table that was never defined");
      }
      const dcTable = dcTables[scanComponent.dc];
      const acTable = acTables[scanComponent.ac];
      if (dcTable === undefined || acTable === undefined) {
        throw new ImageCodecError("Malformed JPEG: scan uses a Huffman table that was never defined");
      }
      const plane = planes[scanComponent.frameIndex];
      if (plane === undefined) {
        throw new ImageCodecError("Malformed JPEG: component plane missing");
      }

      const blocksWide = nonInterleaved ? 1 : component.h;
      const blocksHigh = nonInterleaved ? 1 : component.v;
      const mcuColumn = mcu % mcusWide;
      const mcuRow = Math.floor(mcu / mcusWide);

      for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
        for (let blockX = 0; blockX < blocksWide; blockX += 1) {
          if (JPEG_TRACE) {
            JPEG_TRACE_LOG.push(`block mcu=${mcu}/${totalMcus} (${mcuColumn},${mcuRow}) scan=${scanIndex} comp=${scanComponent.frameIndex} block=(${blockX},${blockY}) byte=${reader.position}`);
          }
          const dc = decodeHuffman(reader, dcTable);
          const differential = receiveExtend(reader, dc);
          dcPredictors[scanComponent.frameIndex] = (dcPredictors[scanComponent.frameIndex] ?? 0) + differential;

          coefficients.fill(0);
          coefficients[0] = (dcPredictors[scanComponent.frameIndex] ?? 0) * (quant.values[0] ?? 1);
          // AC coefficients are transmitted in zig-zag order starting at index 1.
          let zigzag = 1;
          while (zigzag < 64) {
            const symbol = decodeHuffman(reader, acTable);
            const run = symbol >> 4;
            const size = symbol & 0x0f;
            if (size === 0) {
              if (run === 15) {
                zigzag += 16; // ZRL: sixteen zeros, continue.
                continue;
              }
              break; // EOB: the rest of the block is zero.
            }
            zigzag += run;
            if (zigzag > 63) {
              throw new ImageCodecError("Corrupt JPEG: AC coefficient index out of range");
            }
            const raster = ZIGZAG[zigzag] ?? 0;
            coefficients[raster] = receiveExtend(reader, size) * (quant.values[raster] ?? 1);
            zigzag += 1;
          }

          // Block origin inside the component's padded plane. Both the luma and
          // chroma resolutions are MCU-aligned, so the row pointer is unique and
          // the dequantised block can be written with a single stride.
          const blockColumn = nonInterleaved ? mcuColumn : mcuColumn * component.h + blockX;
          const blockRow = nonInterleaved ? mcuRow : mcuRow * component.v + blockY;
          const planeOffset = blockRow * 8 * plane.stride + blockColumn * 8;
          inverseDctToPlane(coefficients, plane.data, planeOffset, plane.stride, scratch);
        }
      }
    }
    sinceRestart += 1;
  }

  return reader.position;
}
/**
 * Triangle-filter upsampling for one axis. The weights are the area of overlap
 * between the output pixel's footprint and each contributing input pixel, which
 * is what libjpeg's "fancy upsampling" computes; nearest-neighbour would leave
 * visible block edges on 4:2:0 chroma.
 *
 * `source` is read with `stride` (so one row of a strided plane can be passed
 * directly), starting at `sourceOffset`.
 */
function resampleAxisTriangle(
  source: Uint8ClampedArray,
  sourceSize: number,
  targetSize: number,
  output: Float32Array,
  outputOffset: number,
  sourceOffset: number,
  stride: number,
  horizontal: boolean,
): void {
  if (sourceSize === targetSize) {
    for (let x = 0; x < targetSize; x += 1) {
      output[outputOffset + x] = source[sourceOffset + (horizontal ? x : x * stride)] ?? 0;
    }
    return;
  }
  const ratio = sourceSize / targetSize;
  // The filter is stretched when minifying and kept at one input pixel wide when
  // magnifying, which is what makes the two axes separable but not identical.
  const filterScale = ratio > 1 ? ratio : 1;
  const limit = sourceSize - 1;
  for (let x = 0; x < targetSize; x += 1) {
    const center = (x + 0.5) * ratio;
    let left = Math.floor(center - filterScale + 0.5);
    const right = Math.ceil(center + filterScale - 0.5);
    if (left < 0) {
      left = 0;
    }
    const clampedRight = right > sourceSize ? sourceSize : right;
    let total = 0;
    let weighted = 0;
    for (let i = left; i < clampedRight; i += 1) {
      const distance = Math.abs(i + 0.5 - center) / filterScale;
      const weight = distance < 1 ? 1 - distance : 0;
      if (weight === 0) {
        continue;
      }
      weighted += (source[sourceOffset + (horizontal ? i : i * stride)] ?? 0) * weight;
      total += weight;
    }
    if (total <= 0) {
      // The footprint fell between samples (can happen at the edges when
      // minifying hard); fall back to the nearest sample so the row still has a
      // defined value instead of dividing by zero.
      const fallback = left > limit ? limit : left;
      output[outputOffset + x] = source[sourceOffset + (horizontal ? fallback : fallback * stride)] ?? 0;
    } else {
      output[outputOffset + x] = weighted / total;
    }
  }
}

/**
 * Vertical triangle filter between two source rows. Only the two rows adjacent
 * to the output position can contribute when the ratio is at least 1:2 (the
 * cases this decoder supports), so the blend is a single lerp with a pair of
 * weights — no intermediate column buffer and no extra allocation per row.
 */
function verticalPairWeights(sourceHeight: number, targetHeight: number, y: number): { top: number; bottom: number; topWeight: number } {
  if (sourceHeight === targetHeight) {
    return { top: y, bottom: y, topWeight: 1 };
  }
  const ratio = sourceHeight / targetHeight;
  const filterScale = ratio > 1 ? ratio : 1;
  const center = (y + 0.5) * ratio;
  const upper = Math.floor(center - 0.5);
  const lower = Math.ceil(center - 0.5);
  const weightBelow = (lower + 0.5 - center) / filterScale;
  const lowerWeight = weightBelow < 0 ? 0 : weightBelow > 1 ? 1 : weightBelow;
  const top = upper < 0 ? 0 : upper > sourceHeight - 1 ? sourceHeight - 1 : upper;
  const bottom = lower < 0 ? 0 : lower > sourceHeight - 1 ? sourceHeight - 1 : lower;
  return { top, bottom, topWeight: 1 - lowerWeight };
}

/**
 * Per-component row provider used by `convertJpegToRgba`.
 *
 * It keeps the two horizontally-resampled source rows that bracket the current
 * output row (and the blend weight between them), so each source row is
 * resampled once and reused by every output row that needs it. Without the
 * cache, vertical resampling would resample each source row twice, and the
 * horizontal pass is the expensive half.
 */
type RowBlend = {
  /** Resampled row that carries `weight` of the result. */
  readonly row: Float32Array;
  /** Weight of `row`; `other` supplies the remainder. */
  readonly weight: number;
  /** The other resampled row in the blend, or the same array when they coincide. */
  readonly other: Float32Array;
};

type RowSampler = {
  /** Width of every returned row: the full image width. */
  readonly targetWidth: number;
  readonly targetHeight: number;
  sample(outputY: number): RowBlend;
};

/**
 * Convert decoded component planes to RGBA.
 *
 * The output is produced one row of pixels at a time. Materialising every
 * component at full resolution instead would cost `components * width * height`
 * floats on top of the RGBA output, which a Worker isolate cannot afford on a
 * large master; a row-at-a-time pass touches each source row twice (once as the
 * blend's top row, once as its bottom row) and allocates only row-sized buffers.
 *
 * For 3-component images the JFIF/BT.601 YCbCr matrix is used; for 4-component
 * images the Adobe convention is applied (see `convertCmyk`).
 */
function convertJpegToRgba(
  frame: JpegFrame,
  planes: Array<JpegPlane | undefined>,
  adobe: JpegAdobe,
): DecodedImage {
  const { width, height, components } = frame;
  const componentCount = components.length;
  if (componentCount !== 1 && componentCount !== 3 && componentCount !== 4) {
    throw new ImageCodecError(`Unsupported JPEG: ${componentCount}-component images are not supported`);
  }

  const pixels = new Uint8ClampedArray(width * height * 4);

  /**
   * Resample one component into full-width rows, caching the pair of source
   * rows that bracket the requested output row.
   */
  const makeRowSampler = (index: number): RowSampler => {
    const component = components[index];
    const targetWidth = component === undefined ? width : Math.max(1, Math.round((width * component.h) / frame.hMax));
    const targetHeight = component === undefined ? height : Math.max(1, Math.round((height * component.v) / frame.vMax));
    const plane = planes[index];
    // `top`/`bottom` are reassigned (not const) because the cache reuses the
    // buffer that is no longer referenced instead of allocating a new row.
    let top = new Float32Array(targetWidth);
    let bottom = new Float32Array(targetWidth);
    let topRow = -1;
    let bottomRow = -1;

    const fillRow = (target: Float32Array, sourceRow: number): void => {
      if (plane === undefined) {
        // A component that was never decoded reads as zero rather than failing
        // the whole image; the caller decides whether that is acceptable.
        target.fill(0);
        return;
      }
      const sourceOffset = (sourceRow < 0 ? 0 : sourceRow > plane.height - 1 ? plane.height - 1 : sourceRow) * plane.stride;
      resampleAxisTriangle(plane.data, plane.width, targetWidth, target, 0, sourceOffset, plane.stride, true);
    };

    return {
      targetWidth,
      targetHeight,
      sample(outputY: number): RowBlend {
        const blend = plane === undefined
          ? { top: 0, bottom: 0, topWeight: 1 }
          : verticalPairWeights(plane.height, targetHeight, outputY);
        if (blend.top !== topRow) {
          if (blend.top === bottomRow) {
            // The row we need is already resampled, just in the other buffer.
            const swap = bottom;
            bottom = top;
            top = swap;
          } else {
            fillRow(top, blend.top);
          }
          topRow = blend.top;
        }
        if (blend.bottom === topRow) {
          // Common case when magnifying: both taps are the same source row.
          bottomRow = topRow;
          bottom = top;
        } else if (blend.bottom !== bottomRow) {
          fillRow(bottom, blend.bottom);
          bottomRow = blend.bottom;
        }
        return { row: top, weight: blend.topWeight, other: bottom };
      },
    };
  };

  const lumaSampler = makeRowSampler(0);
  const cbSampler = makeRowSampler(1);
  const crSampler = makeRowSampler(2);
  const keySampler = makeRowSampler(3);
  const isYcck = adobe !== undefined && adobe.transform === 2;

  for (let y = 0; y < height; y += 1) {
    // Component rows advance at their own rate; map the output row back into
    // each component's resolution instead of assuming they line up.
    const lumaRow = Math.min(height - 1, Math.floor(((y + 0.5) * lumaSampler.targetHeight) / height));
    const luma = lumaSampler.sample(lumaRow);
    let p = y * width * 4;

    if (componentCount === 1) {
      for (let x = 0; x < width; x += 1) {
        const grey = luma.weight * (luma.row[x] ?? 0) + (1 - luma.weight) * (luma.other[x] ?? 0);
        pixels[p] = grey;
        pixels[p + 1] = grey;
        pixels[p + 2] = grey;
        pixels[p + 3] = 255;
        p += 4;
      }
      continue;
    }

    const cbRow = Math.min(height - 1, Math.floor(((y + 0.5) * cbSampler.targetHeight) / height));
    const crRow = Math.min(height - 1, Math.floor(((y + 0.5) * crSampler.targetHeight) / height));
    const cb = cbSampler.sample(cbRow);
    const cr = crSampler.sample(crRow);

    if (componentCount === 3) {
      // No component-ID sniffing: JFIF defines the order as Y, Cb, Cr and every
      // mainstream encoder follows it. A mis-ordered file shows as colour skew,
      // which is preferable to guessing wrong from optional IDs.
      for (let x = 0; x < width; x += 1) {
        const lumaValue = luma.weight * (luma.row[x] ?? 0) + (1 - luma.weight) * (luma.other[x] ?? 0);
        const cbValue = cb.weight * (cb.row[x] ?? 0) + (1 - cb.weight) * (cb.other[x] ?? 0) - 128;
        const crValue = cr.weight * (cr.row[x] ?? 0) + (1 - cr.weight) * (cr.other[x] ?? 0) - 128;
        pixels[p] = lumaValue + (CB_RED * crValue) / 65536;
        pixels[p + 1] = lumaValue - (CR_GREEN * cbValue + CB_GREEN * crValue) / 65536;
        pixels[p + 2] = lumaValue + (CR_BLUE * cbValue) / 65536;
        pixels[p + 3] = 255;
        p += 4;
      }
      continue;
    }

    const keyRow = Math.min(height - 1, Math.floor(((y + 0.5) * keySampler.targetHeight) / height));
    const key = keySampler.sample(keyRow);
    for (let x = 0; x < width; x += 1) {
      let r: number;
      let g: number;
      let b: number;
      if (isYcck) {
        // YCCK stores the CMY channels as YCbCr on top of an inverted K plane.
        const lumaValue = luma.weight * (luma.row[x] ?? 0) + (1 - luma.weight) * (luma.other[x] ?? 0);
        const cbValue = cb.weight * (cb.row[x] ?? 0) + (1 - cb.weight) * (cb.other[x] ?? 0) - 128;
        const crValue = cr.weight * (cr.row[x] ?? 0) + (1 - cr.weight) * (cr.other[x] ?? 0) - 128;
        r = lumaValue + (CB_RED * crValue) / 65536;
        g = lumaValue - (CR_GREEN * cbValue + CB_GREEN * crValue) / 65536;
        b = lumaValue + (CR_BLUE * cbValue) / 65536;
      } else {
        r = luma.weight * (luma.row[x] ?? 0) + (1 - luma.weight) * (luma.other[x] ?? 0);
        g = cb.weight * (cb.row[x] ?? 0) + (1 - cb.weight) * (cb.other[x] ?? 0);
        b = cr.weight * (cr.row[x] ?? 0) + (1 - cr.weight) * (cr.other[x] ?? 0);
      }
      const keyValue = key.weight * (key.row[x] ?? 0) + (1 - key.weight) * (key.other[x] ?? 0);
      const converted = convertCmyk(r, g, b, keyValue);
      pixels[p] = converted[0];
      pixels[p + 1] = converted[1];
      pixels[p + 2] = converted[2];
      pixels[p + 3] = 255;
      p += 4;
    }
  }

  return { pixels, width, height, format: "jpeg" };
}

/**
 * Approximate CMYK -> RGB.
 *
 * Adobe writes CMYK JPEGs inverted (255 means no ink), and the convention is
 * only signalled by an optional APP14 marker, so we cannot be certain. The
 * approximation treats the channels as inverted CMY and K as an inverted
 * multiplicative key, which is what the majority of Adobe-produced files need
 * and degrades gracefully on the rest. This path exists so a CMYK master does
 * not fail the upload outright; the archival master stays untouched and only a
 * derivative is affected.
 */
function convertCmyk(c: number, m: number, y: number, k: number): [number, number, number] {
  const cyan = (255 - c) / 255;
  const magenta = (255 - m) / 255;
  const yellow = (255 - y) / 255;
  const black = (255 - k) / 255;
  return [
    clampByte(255 * cyan * black),
    clampByte(255 * magenta * black),
    clampByte(255 * yellow * black),
  ];
}

// ---------------------------------------------------------------------------
// JPEG encoding (baseline, JFIF, 4:4:4)
// ---------------------------------------------------------------------------

/** Annex K luminance quantization table, in raster (natural) order. */
const ANNEX_K_LUMINANCE = new Uint8Array([
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
]);

/** Annex K chrominance quantization table (raster order). */
const ANNEX_K_CHROMINANCE = new Uint8Array([
  17, 18, 24, 47, 99, 99, 99, 99,
  18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
]);

/** Annex K Table K.3: DC code lengths (bits 1..16) for luminance. */
const DC_LENGTHS_LUMA = new Uint8Array([0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
/** Annex K Table K.3: DC values for luminance. */
const DC_VALUES_LUMA = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
/** Annex K Table K.4: DC code lengths for chrominance. */
const DC_LENGTHS_CHROMA = new Uint8Array([0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
const DC_VALUES_CHROMA = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
/** Annex K Table K.5: AC code lengths for luminance. */
const AC_LENGTHS_LUMA = new Uint8Array([0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d]);
/** Annex K Table K.5: AC values for luminance. */
const AC_VALUES_LUMA = new Uint8Array([
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
]);
/** Annex K Table K.6: AC code lengths for chrominance. */
const AC_LENGTHS_CHROMA = new Uint8Array([0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77]);
/** Annex K Table K.6: AC values for chrominance. */
const AC_VALUES_CHROMA = new Uint8Array([
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
]);

/** Forward DCT basis: `SCALE[u][x] = 0.5 * C(u) * cos((2x+1) * u * pi / 16)`. */
const FDCT_SCALE = IDCT_SCALE;

type EncoderHuffmanTable = {
  readonly codes: Uint16Array;
  readonly lengths: Uint8Array;
};

/** Derive canonical encoder codes from the Annex K lengths/values tables. */
function buildEncoderTable(lengths: Uint8Array, values: Uint8Array): EncoderHuffmanTable {
  const codes = new Uint16Array(256);
  const codeLengths = new Uint8Array(256);
  let code = 0;
  let index = 0;
  for (let bits = 1; bits <= 16; bits += 1) {
    const count = lengths[bits - 1] ?? 0;
    for (let i = 0; i < count; i += 1) {
      const symbol = values[index];
      index += 1;
      if (symbol === undefined) {
        throw new ImageCodecError("Internal error: Annex K Huffman table is inconsistent");
      }
      codes[symbol] = code;
      codeLengths[symbol] = bits;
      code += 1;
    }
    code <<= 1;
  }
  return { codes, lengths: codeLengths };
}

/** Bit writer for the entropy-coded segment; escapes 0xFF as 0xFF00. */
class JpegBitWriter {
  private chunks: Uint8Array[] = [];
  private current = new Uint8Array(65536);
  private currentLength = 0;
  private bitBuffer = 0;
  private bitCount = 0;

  private pushByte(value: number): void {
    if (this.currentLength === this.current.length) {
      this.chunks.push(this.current);
      this.current = new Uint8Array(65536);
      this.currentLength = 0;
    }
    this.current[this.currentLength] = value;
    this.currentLength += 1;
  }

  writeBits(value: number, count: number): void {
    if (count === 0) {
      return;
    }
    this.bitBuffer = ((this.bitBuffer << count) | (value & ((1 << count) - 1))) & 0xffffff;
    this.bitCount += count;
    while (this.bitCount >= 8) {
      const byte = (this.bitBuffer >>> (this.bitCount - 8)) & 0xff;
      this.pushByte(byte);
      // Byte stuffing: a 0xFF in the entropy stream would otherwise look like
      // the start of a marker.
      if (byte === 0xff) {
        this.pushByte(0x00);
      }
      this.bitCount -= 8;
    }
    this.bitBuffer &= (1 << this.bitCount) - 1;
  }

  /** Flush remaining bits padded with 1-bits, as the standard requires. */
  flush(): Uint8Array {
    if (this.bitCount > 0) {
      const padded = (this.bitBuffer << (8 - this.bitCount)) | ((1 << (8 - this.bitCount)) - 1);
      this.pushByte(padded & 0xff);
      if ((padded & 0xff) === 0xff) {
        this.pushByte(0x00);
      }
      this.bitCount = 0;
      this.bitBuffer = 0;
    }
    const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0) + this.currentLength;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    out.set(this.current.subarray(0, this.currentLength), offset);
    this.chunks = [];
    this.current = new Uint8Array(0);
    this.currentLength = 0;
    return out;
  }
}

/** Number of additional bits needed to represent `value` (JPEG "category"). */
function magnitudeCategory(value: number): number {
  let magnitude = value < 0 ? -value : value;
  let category = 0;
  while (magnitude > 0) {
    category += 1;
    magnitude >>= 1;
  }
  return category;
}

/** JPEG additional-bits encoding: negatives are stored as `value - 1` in `size` bits. */
function encodeMagnitude(value: number, size: number): number {
  return value < 0 ? value - 1 + (1 << size) : value;
}

/**
 * Separable forward DCT. `destination[raster]` receives `F(u,v)` for the
 * natural-order coefficient at that raster index, matching ZIGZAG.
 */
function forwardDct(source: Float32Array, destination: Float32Array, scratch: Float32Array): void {
  for (let y = 0; y < 8; y += 1) {
    const rowBase = y * 8;
    for (let u = 0; u < 8; u += 1) {
      let sum = 0;
      for (let x = 0; x < 8; x += 1) {
        sum += (source[rowBase + x] ?? 0) * (FDCT_SCALE[u * 8 + x] ?? 0);
      }
      scratch[rowBase + u] = sum;
    }
  }
  for (let u = 0; u < 8; u += 1) {
    for (let v = 0; v < 8; v += 1) {
      let sum = 0;
      for (let y = 0; y < 8; y += 1) {
        sum += (scratch[y * 8 + u] ?? 0) * (FDCT_SCALE[v * 8 + y] ?? 0);
      }
      destination[v * 8 + u] = sum;
    }
  }
}

/**
 * Encode RGBA8 pixels as a baseline JPEG at the given quality (1-100).
 *
 * Layout is fixed at JFIF 4:4:4 with the Annex K tables. 4:4:4 is deliberate:
 * the derivatives are already downscaled, so chroma subsampling would throw away
 * the colour detail a portfolio image is judged on for a small size win.
 */
export function encodeJpeg(image: RawImage, quality: number): Uint8Array {
  const { pixels, width, height } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new ImageCodecError("encodeJpeg requires positive integer dimensions");
  }
  if (pixels.length !== width * height * 4) {
    throw new ImageCodecError("encodeJpeg requires pixels.length === width * height * 4");
  }
  if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
    throw new ImageCodecError("encodeJpeg requires a quality between 1 and 100");
  }

  const qualityScale = quality < 50 ? Math.floor(5000 / quality) : 200 - quality * 2;
  const luminanceQuant = new Uint8Array(64);
  const chrominanceQuant = new Uint8Array(64);
  for (let i = 0; i < 64; i += 1) {
    const base = ANNEX_K_LUMINANCE[i] ?? 1;
    const chromaBase = ANNEX_K_CHROMINANCE[i] ?? 1;
    luminanceQuant[i] = Math.min(255, Math.max(1, Math.floor((base * qualityScale + 50) / 100)));
    chrominanceQuant[i] = Math.min(255, Math.max(1, Math.floor((chromaBase * qualityScale + 50) / 100)));
  }

  const dcLuma = buildEncoderTable(DC_LENGTHS_LUMA, DC_VALUES_LUMA);
  const dcChroma = buildEncoderTable(DC_LENGTHS_CHROMA, DC_VALUES_CHROMA);
  const acLuma = buildEncoderTable(AC_LENGTHS_LUMA, AC_VALUES_LUMA);
  const acChroma = buildEncoderTable(AC_LENGTHS_CHROMA, AC_VALUES_CHROMA);

  const segments: Uint8Array[] = [];
  const pushSegment = (marker: number, payloadBytes: readonly number[]): void => {
    const length = payloadBytes.length + 2;
    const segment = new Uint8Array(length + 2);
    segment[0] = 0xff;
    segment[1] = marker;
    segment[2] = (length >> 8) & 0xff;
    segment[3] = length & 0xff;
    for (let i = 0; i < payloadBytes.length; i += 1) {
      segment[4 + i] = payloadBytes[i] ?? 0;
    }
    segments.push(segment);
  };

  // SOI
  segments.push(new Uint8Array([0xff, 0xd8]));
  // APP0 / JFIF
  pushSegment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  // DQT (both tables, 8-bit precision, payload is zig-zag order)
  const dqtPayload: number[] = [0x00];
  for (let i = 0; i < 64; i += 1) {
    dqtPayload.push(luminanceQuant[ZIGZAG[i] ?? 0] ?? 1);
  }
  dqtPayload.push(0x01);
  for (let i = 0; i < 64; i += 1) {
    dqtPayload.push(chrominanceQuant[ZIGZAG[i] ?? 0] ?? 1);
  }
  pushSegment(0xdb, dqtPayload);
  // SOF0: 8-bit, 3 components, 1x1 sampling each (4:4:4)
  pushSegment(0xc0, [
    0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
  ]);
  // DHT: DC/AC luminance then DC/AC chrominance
  const dhtPayload: number[] = [];
  const appendTable = (tableClass: number, tableId: number, lengths: Uint8Array, values: Uint8Array): void => {
    dhtPayload.push((tableClass << 4) | tableId);
    for (let i = 0; i < 16; i += 1) {
      dhtPayload.push(lengths[i] ?? 0);
    }
    for (let i = 0; i < values.length; i += 1) {
      dhtPayload.push(values[i] ?? 0);
    }
  };
  appendTable(0, 0, DC_LENGTHS_LUMA, DC_VALUES_LUMA);
  appendTable(1, 0, AC_LENGTHS_LUMA, AC_VALUES_LUMA);
  appendTable(0, 1, DC_LENGTHS_CHROMA, DC_VALUES_CHROMA);
  appendTable(1, 1, AC_LENGTHS_CHROMA, AC_VALUES_CHROMA);
  pushSegment(0xc4, dhtPayload);
  // SOS: all three components, tables 0/0 for Y and 1/1 for Cb/Cr
  pushSegment(0xda, [0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);

  const writer = new JpegBitWriter();
  const samples = new Float32Array(64);
  const coefficients = new Float32Array(64);
  const scratch = new Float32Array(64);
  const quantized = new Int32Array(64);
  const predictors = new Int32Array(3);

  const encodeBlock = (
    plane: Float32Array,
    stride: number,
    originX: number,
    originY: number,
    quant: Uint8Array,
    dcTable: EncoderHuffmanTable,
    acTable: EncoderHuffmanTable,
    componentIndex: number,
  ): void => {
    for (let y = 0; y < 8; y += 1) {
      const sourceBase = (originY + y) * stride + originX;
      const targetBase = y * 8;
      for (let x = 0; x < 8; x += 1) {
        // Level shift: JPEG DCT input is signed around zero.
        samples[targetBase + x] = (plane[sourceBase + x] ?? 0) - 128;
      }
    }
    forwardDct(samples, coefficients, scratch);
    for (let i = 0; i < 64; i += 1) {
      quantized[i] = Math.round((coefficients[i] ?? 0) / (quant[i] ?? 1));
    }

    const dc = quantized[0] ?? 0;
    const differential = dc - (predictors[componentIndex] ?? 0);
    predictors[componentIndex] = dc;
    const dcSize = magnitudeCategory(differential);
    writer.writeBits(dcTable.codes[dcSize] ?? 0, dcTable.lengths[dcSize] ?? 0);
    if (dcSize > 0) {
      writer.writeBits(encodeMagnitude(differential, dcSize), dcSize);
    }

    let zeroRun = 0;
    for (let zigzag = 1; zigzag < 64; zigzag += 1) {
      const raster = ZIGZAG[zigzag] ?? 0;
      const value = quantized[raster] ?? 0;
      if (value === 0) {
        zeroRun += 1;
        continue;
      }
      while (zeroRun > 15) {
        // ZRL: one symbol covers sixteen zeros.
        writer.writeBits(acTable.codes[0xf0] ?? 0, acTable.lengths[0xf0] ?? 0);
        zeroRun -= 16;
      }
      const size = magnitudeCategory(value);
      const symbol = (zeroRun << 4) | size;
      writer.writeBits(acTable.codes[symbol] ?? 0, acTable.lengths[symbol] ?? 0);
      writer.writeBits(encodeMagnitude(value, size), size);
      zeroRun = 0;
    }
    if (zeroRun > 0) {
      writer.writeBits(acTable.codes[0x00] ?? 0, acTable.lengths[0x00] ?? 0); // EOB
    }
  };

  const lumaStride = Math.ceil(width / 8) * 8;
  const lumaHeight = Math.ceil(height / 8) * 8;
  const luma = new Float32Array(lumaStride * lumaHeight);
  const cb = new Float32Array(lumaStride * lumaHeight);
  const cr = new Float32Array(lumaStride * lumaHeight);

  for (let y = 0; y < height; y += 1) {
    const rowBase = y * lumaStride;
    const pixelBase = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const p = pixelBase + x * 4;
      const r = pixels[p] ?? 0;
      const g = pixels[p + 1] ?? 0;
      const b = pixels[p + 2] ?? 0;
      luma[rowBase + x] = 0.299 * r + 0.587 * g + 0.114 * b;
      cb[rowBase + x] = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
      cr[rowBase + x] = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
    }
  }

  const blocksWide = lumaStride / 8;
  const blocksHigh = lumaHeight / 8;
  for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      const originX = blockX * 8;
      const originY = blockY * 8;
      // Interleaved MCU order: Y, Cb, Cr for every block. With 1x1 sampling on
      // all three components the MCU is exactly one block each.
      encodeBlock(luma, lumaStride, originX, originY, luminanceQuant, dcLuma, acLuma, 0);
      encodeBlock(cb, lumaStride, originX, originY, chrominanceQuant, dcChroma, acChroma, 1);
      encodeBlock(cr, lumaStride, originX, originY, chrominanceQuant, dcChroma, acChroma, 2);
    }
  }

  const entropy = writer.flush();
  const total = segments.reduce((sum, segment) => sum + segment.length, 0) + entropy.length + 2;
  const output = new Uint8Array(total);
  let offset = 0;
  for (const segment of segments) {
    output.set(segment, offset);
    offset += segment.length;
  }
  output.set(entropy, offset);
  offset += entropy.length;
  output[offset] = 0xff;
  output[offset + 1] = 0xd9;
  return output;
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

/** CRC-32 (IEEE 802.3) table, built once from the reflected polynomial. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 over `bytes`, as PNG defines it for chunk type + data. */
function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i += 1) {
    crc = (CRC_TABLE[(crc ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Adler-32, the checksum that closes a zlib stream (RFC 1950).
 *
 * The PNG encoder builds the zlib wrapper by hand rather than calling
 * `CompressionStream`, because the worker's upload path decodes in one
 * synchronous pass and the encoder is kept symmetric with the decoder.
 */
function adler32(bytes: Uint8Array): number {
  const MOD = 65521;
  let a = 1;
  let b = 0;
  // 5552 is the largest block whose accumulators cannot overflow 32 bits.
  for (let start = 0; start < bytes.length; start += 5552) {
    const end = Math.min(start + 5552, bytes.length);
    for (let i = start; i < end; i += 1) {
      a += bytes[i] ?? 0;
      b += a;
    }
    a %= MOD;
    b %= MOD;
  }
  return ((b << 16) | a) >>> 0;
}

// --- DEFLATE (RFC 1951) ----------------------------------------------------
//
// WHY THIS IS HAND-ROLLED
// `CompressionStream` / `DecompressionStream("deflate")` are the obvious tools
// for PNG's zlib payload and they do work (verified on Node 24: `"deflate"`
// consumes and emits zlib framing, `"deflate-raw"` does not). They are
// stream-only, though, which forces every decoder built on them to be async.
// The upload path decodes and resamples in one synchronous pass, so this module
// carries a synchronous inflate/deflate pair instead. Both directions live here
// because `encodePng` has to produce a stream this decoder — and every other PNG
// reader — accepts, and the pair is proven by a byte-identical round trip.
//
// Supported subset: the zlib wrapper plus stored, fixed-Huffman and
// dynamic-Huffman DEFLATE blocks, which is everything a general PNG can carry.
// The encoder emits only fixed-Huffman blocks: a dynamic block costs header
// bytes that small derivatives never earn back, and PNG's per-scanline filters
// have already removed most of the entropy a dynamic table would exploit.

/** DEFLATE bit reader: bits arrive least-significant-bit first within each byte. */
class DeflateBitReader {
  private bytes: Uint8Array;
  private cursor: number;
  private buffer = 0;
  private count = 0;
  /** Bytes handed back by the Huffman decoder, newest last. */
  private unread: number[] = [];

  constructor(bytes: Uint8Array, start: number) {
    this.bytes = bytes;
    this.cursor = start;
  }

  /** Byte offset of the next unconsumed byte, rounded up to the byte boundary. */
  get position(): number {
    return this.cursor - (this.count >> 3) - this.unread.length;
  }

  /** Read `n` bits (n <= 16) LSB-first. Throws rather than reading past the end. */
  bits(n: number): number {
    while (this.count < n) {
      let byte: number;
      if (this.unread.length > 0) {
        byte = this.unread.pop() ?? 0;
      } else if (this.cursor < this.bytes.length) {
        byte = this.bytes[this.cursor] ?? 0;
        this.cursor += 1;
      } else {
        throw new ImageCodecError("Corrupt PNG: compressed data ended mid-symbol");
      }
      this.buffer |= byte << this.count;
      this.count += 8;
    }
    const value = this.buffer & ((1 << n) - 1);
    this.buffer >>>= n;
    this.count -= n;
    return value;
  }

  /** Give back one whole byte that the last symbol did not consume. */
  unreadByte(value: number): void {
    this.unread.push(value);
  }

  /**
   * Look at the next `n` bits (n <= 16) without consuming them.
   *
   * Huffman decoding needs to test several candidate code lengths against the
   * same window; consuming and then trying to push bits back loses the position
   * of each buffered byte, so the reader exposes a non-destructive peek instead.
   */
  peekBits(n: number): number {
    while (this.count < n) {
      let byte: number;
      if (this.unread.length > 0) {
        byte = this.unread.pop() ?? 0;
      } else if (this.cursor < this.bytes.length) {
        byte = this.bytes[this.cursor] ?? 0;
        this.cursor += 1;
      } else {
        throw new ImageCodecError("Corrupt PNG: compressed data ended mid-symbol");
      }
      this.buffer |= byte << this.count;
      this.count += 8;
    }
    return this.buffer & ((1 << n) - 1);
  }

  /** Consume `n` bits previously inspected with `peekBits`. */
  dropBits(n: number): void {
    this.buffer >>>= n;
    this.count -= n;
  }

  /** Discard the remainder of the current byte, as a stored block requires. */
  alignToByte(): void {
    const drop = this.count & 7;
    this.buffer >>>= drop;
    this.count -= drop;
  }

  /** Copy `length` whole bytes (used for stored blocks). */
  readBytes(target: Uint8Array, targetOffset: number, length: number): void {
    this.alignToByte();
    const start = this.position;
    if (length > this.bytes.length - start) {
      throw new ImageCodecError("Corrupt PNG: stored block runs past the compressed data");
    }
    this.buffer = 0;
    this.count = 0;
    this.unread = [];
    this.cursor = start + length;
    target.set(this.bytes.subarray(start, start + length), targetOffset);
  }
}

/**
 * Canonical Huffman decoder in the shape DEFLATE wants.
 *
 * Codes are resolved by accumulating a 16-bit window and comparing against the
 * first canonical code of each length. The loop is bounded by the longest code
 * length, so a corrupt stream errors out instead of spinning.
 */
type InflateHuffman = {
  /** First canonical code of each length, pre-shifted into a 16-bit window. */
  readonly firstCode: Int32Array;
  /** Symbols grouped by code length, in canonical order. */
  readonly symbols: Int32Array;
  /** Offset into `symbols` for each code length. */
  readonly offsets: Int32Array;
  /** How many codes exist at each length. */
  readonly counts: Int32Array;
  readonly maxBits: number;
};

function buildInflateHuffman(lengths: Uint8Array, symbolCount: number): InflateHuffman {
  const counts = new Int32Array(16);
  let maxBits = 0;
  for (let i = 0; i < symbolCount; i += 1) {
    const length = lengths[i] ?? 0;
    if (length > 15) {
      throw new ImageCodecError("Corrupt PNG: Huffman code length above 15");
    }
    if (length > 0) {
      counts[length] = (counts[length] ?? 0) + 1;
      if (length > maxBits) {
        maxBits = length;
      }
    }
  }
  if (PNG_TRACE) {
    PNG_TRACE_LOG.push(`buildHuff symbols=${symbolCount} maxBits=${maxBits} nonzero=${Array.from(lengths.subarray(0, symbolCount)).filter((l) => l > 0).length} lengths=[${Array.from(lengths.subarray(0, symbolCount)).join(",")}]`);
  }
  const offsets = new Int32Array(maxBits + 2);
  let total = 0;
  for (let length = 1; length <= maxBits; length += 1) {
    offsets[length] = total;
    total += counts[length] ?? 0;
  }
  const symbols = new Int32Array(total);
  const next = new Int32Array(maxBits + 2);
  for (let length = 1; length <= maxBits; length += 1) {
    next[length] = offsets[length] ?? 0;
  }
  for (let symbol = 0; symbol < symbolCount; symbol += 1) {
    const length = lengths[symbol] ?? 0;
    if (length > 0) {
      const at = next[length] ?? 0;
      symbols[at] = symbol;
      next[length] = at + 1;
    }
  }

  const firstCode = new Int32Array(maxBits + 2);
  let code = 0;
  // Canonical code assignment, exactly as RFC 1951 section 3.2.2 states it:
  //
  //     code = 0
  //     for bits = 1..MAX_BITS:
  //         code = (code + bl_count[bits - 1]) << 1
  //         next_code[bits] = code
  //
  // `counts` here is indexed by length, so counts[length - 1] is the number of
  // codes of the PREVIOUS length, which is the operand the recurrence wants.
  // With the fixture PNG's code-length table (counts = [0,0,1,3,4,4] for lengths
  // 1..6) the first codes are 0, 0, 2, 6, 14, i.e. 0, 0, 8192, 24576, 57344 once
  // pre-shifted into a 16-bit window. Adding counts[length] (this length's count)
  // instead shifts every code by one length and rejects every real stream.
  for (let length = 1; length <= maxBits; length += 1) {
    // `code` is now the first canonical code of this length, already shifted for
    // the values assigned at shorter lengths.
    //
    // Over-subscription means the table claims more codes than the bit space can
    // hold; accepting it would let a corrupt stream alias symbols. Note this must
    // compare against THIS length's count (`counts[length - 1]`), not the next
    // length's: reading `counts[length]` one step ahead rejected valid tables
    // (the fixed literal table has no 10-bit codes, so the extra count at index 9
    // pushed a legal table over the limit).
    if (code + (counts[length - 1] ?? 0) > 1 << length) {
      throw new ImageCodecError("Corrupt PNG: over-subscribed Huffman code lengths");
    }
    // RIGHT-aligned: the canonical code as an ordinary `length`-bit number.
    // It must be right-aligned because `decodeInflateSymbol` peeks exactly
    // `length` bits, and a peek of `length` bits is also right-aligned. Shifting
    // the code into a 16-bit window while comparing a `length`-bit value makes
    // every dynamic block fail to match any code.
    firstCode[length] = code;
    code = (code + (counts[length - 1] ?? 0)) << 1;
  }
  return { firstCode, symbols, offsets, counts, maxBits };
}

/**
 * Bit-reversal of every 16-bit value, built once.
 *
 * WHY THIS IS NEEDED: RFC 1951 section 3.1.1 packs bits into bytes
 * least-significant-bit first, but section 3.2.2 defines Huffman codes as
 * ordinary binary numbers whose MOST significant bit arrives first. A raw peek
 * therefore returns the next bits in the opposite order to the one the canonical
 * table is written in: the same seven stream bits `0001100` are read by
 * `peekBits(7)` as 12 and must be compared as 24. Skipping this reversal is
 * silent for codes whose bit pattern is a palindrome and wrong for the rest,
 * which is exactly why a stream can look fine for literals and then decode a
 * bogus length/distance pair.
 */
const REVERSED_16 = (() => {
  const table = new Uint16Array(65536);
  for (let value = 0; value < 65536; value += 1) {
    let reversed = 0;
    let source = value;
    for (let bit = 0; bit < 16; bit += 1) {
      reversed = (reversed << 1) | (source & 1);
      source >>>= 1;
    }
    table[value] = reversed;
  }
  return table;
})();

function decodeInflateSymbol(reader: DeflateBitReader, table: InflateHuffman): number {
  // Take the next 16 bits once, reverse them into canonical (MSB-first) order,
  // then test each candidate length by shifting the top `length` bits down.
  //
  // Testing a shared window is what makes this correct as well as fast: reading
  // `length` bits per candidate and pushing back the ones a failed candidate
  // consumed is where the position bookkeeping goes wrong.
  const raw16 = reader.peekBits(16);
  const reversed = REVERSED_16[raw16] ?? 0;
  const detail: string[] = [];
  for (let length = 1; length <= table.maxBits; length += 1) {
    const count = table.counts[length] ?? 0;
    if (count === 0) {
      continue;
    }
    const code = reversed >>> (16 - length);
    const delta = code - (table.firstCode[length] ?? 0);
    if (PNG_TRACE) {
      detail.push(`L${length}:code=${code},first=${table.firstCode[length] ?? 0},count=${count},delta=${delta}`);
    }
    if (delta >= 0 && delta < count) {
      const symbolIndex = (table.offsets[length] ?? 0) + delta;
      const symbol = table.symbols[symbolIndex];
      if (symbol === undefined) {
        throw new ImageCodecError("Corrupt PNG: Huffman symbol out of range");
      }
      reader.dropBits(length);
      return symbol;
    }
  }
  if (PNG_TRACE) {
    PNG_TRACE_LOG.push(
      `  FAIL raw16=${raw16} reversed=${reversed} maxBits=${table.maxBits} counts=[${Array.from(table.counts).join(",")}] firstCodes=[${Array.from(table.firstCode).join(",")}]`,
    );
  }
  throw new ImageCodecError("Corrupt PNG: invalid Huffman code");
}

/** RFC 1951 length codes 257..285. */
const LENGTH_BASE = new Int32Array([3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]);
const LENGTH_EXTRA = new Int32Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]);
/** RFC 1951 distance codes 0..29. */
const DISTANCE_BASE = new Int32Array([1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]);
const DISTANCE_EXTRA = new Int32Array([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]);
/** Order in which dynamic-block code lengths are transmitted. */
const CODE_LENGTH_ORDER = new Int32Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);

/** RFC 1951 fixed literal/length table: 288 symbols, known lengths. */
const FIXED_LITERAL_TABLE = (() => {
  const lengths = new Uint8Array(288);
  for (let i = 0; i < 144; i += 1) {
    lengths[i] = 8;
  }
  for (let i = 144; i < 256; i += 1) {
    lengths[i] = 9;
  }
  for (let i = 256; i < 280; i += 1) {
    lengths[i] = 7;
  }
  for (let i = 280; i < 288; i += 1) {
    lengths[i] = 8;
  }
  return buildInflateHuffman(lengths, 288);
})();

/** RFC 1951 fixed distance table: 32 codes, all five bits. */
const FIXED_DISTANCE_TABLE = (() => {
  const lengths = new Uint8Array(32);
  lengths.fill(5);
  return buildInflateHuffman(lengths, 32);
})();

/**
 * Inflate one DEFLATE stream into a buffer of exactly `expectedLength` bytes.
 *
 * PNG scanlines have a known size, so the output is allocated once and a stream
 * that decodes to the wrong length is reported rather than silently truncated.
 */
function inflateRaw(bytes: Uint8Array, start: number, expectedLength: number): { readonly data: Uint8Array; readonly end: number } {
  const reader = new DeflateBitReader(bytes, start);
  const out = new Uint8Array(expectedLength);
  let written = 0;
  let sawFinal = false;

  while (!sawFinal) {
    sawFinal = reader.bits(1) === 1;
    const type = reader.bits(2);
    if (type === 0) {
      reader.alignToByte();
      const length = reader.bits(16);
      const complement = reader.bits(16);
      if (((length ^ 0xffff) & 0xffff) !== complement) {
        throw new ImageCodecError("Corrupt PNG: stored block length check failed");
      }
      if (written + length > out.length) {
        throw new ImageCodecError("Corrupt PNG: decompressed data is larger than the image");
      }
      reader.readBytes(out, written, length);
      written += length;
      continue;
    }
    if (type === 3) {
      throw new ImageCodecError("Corrupt PNG: reserved DEFLATE block type");
    }

    let literalTable: InflateHuffman;
    let distanceTable: InflateHuffman;
    if (type === 1) {
      literalTable = FIXED_LITERAL_TABLE;
      distanceTable = FIXED_DISTANCE_TABLE;
    } else {
      const literalCount = reader.bits(5) + 257;
      const distanceCount = reader.bits(5) + 1;
      const codeLengthCount = reader.bits(4) + 4;
      if (PNG_TRACE) {
        PNG_TRACE_LOG.push(`block type=2 HLIT=${literalCount} HDIST=${distanceCount} HCLEN=${codeLengthCount} readerPosition=${reader.position}`);
      }
      if (literalCount > 288 || distanceCount > 32) {
        throw new ImageCodecError("Corrupt PNG: invalid dynamic Huffman table sizes");
      }
      const codeLengths = new Uint8Array(19);
      for (let i = 0; i < codeLengthCount; i += 1) {
        const value = reader.bits(3);
        codeLengths[CODE_LENGTH_ORDER[i] ?? 0] = value;
        if (PNG_TRACE) {
          PNG_TRACE_LOG.push(`  cl[${i}] order=${CODE_LENGTH_ORDER[i] ?? 0} value=${value} readerByte=${reader.position}`);
        }
      }
      const codeLengthTable = buildInflateHuffman(codeLengths, 19);
      const lengths = new Uint8Array(literalCount + distanceCount);
      let index = 0;
      while (index < lengths.length) {
        const symbol = decodeInflateSymbol(reader, codeLengthTable);
        if (symbol < 16) {
          lengths[index] = symbol;
          index += 1;
        } else if (symbol === 16) {
          if (index === 0) {
            throw new ImageCodecError("Corrupt PNG: repeat code with no previous length");
          }
          const previous = lengths[index - 1] ?? 0;
          const repeat = 3 + reader.bits(2);
          for (let i = 0; i < repeat && index < lengths.length; i += 1) {
            lengths[index] = previous;
            index += 1;
          }
        } else if (symbol === 17) {
          const repeat = 3 + reader.bits(3);
          if (index + repeat > lengths.length) {
            throw new ImageCodecError("Corrupt PNG: code-length repeat ran past the table");
          }
          index += repeat;
        } else {
          const repeat = 11 + reader.bits(7);
          if (index + repeat > lengths.length) {
            throw new ImageCodecError("Corrupt PNG: code-length repeat ran past the table");
          }
          index += repeat;
        }
      }
      literalTable = buildInflateHuffman(lengths.subarray(0, literalCount), literalCount);
      distanceTable = buildInflateHuffman(lengths.subarray(literalCount), distanceCount);
    }

    for (;;) {
      const symbol = decodeInflateSymbol(reader, literalTable);
      if (symbol < 256) {
        if (written >= out.length) {
          throw new ImageCodecError("Corrupt PNG: decompressed data is larger than the image");
        }
        out[written] = symbol;
        written += 1;
        continue;
      }
      if (symbol === 256) {
        break;
      }
      const lengthIndex = symbol - 257;
      if (lengthIndex >= LENGTH_BASE.length) {
        throw new ImageCodecError("Corrupt PNG: invalid length code");
      }
      const length = (LENGTH_BASE[lengthIndex] ?? 0) + reader.bits(LENGTH_EXTRA[lengthIndex] ?? 0);
      const distanceSymbol = decodeInflateSymbol(reader, distanceTable);
      if (distanceSymbol >= DISTANCE_BASE.length) {
        throw new ImageCodecError("Corrupt PNG: invalid distance code");
      }
      const distance = (DISTANCE_BASE[distanceSymbol] ?? 0) + reader.bits(DISTANCE_EXTRA[distanceSymbol] ?? 0);
      if (PNG_TRACE && written < 1200) {
        PNG_TRACE_LOG.push(`  match symbol=${symbol} length=${length} distSymbol=${distanceSymbol} distance=${distance} written=${written}`);
      }
      if (distance > written) {
        throw new ImageCodecError("Corrupt PNG: back-reference points before the start of the data");
      }
      if (written + length > out.length) {
        throw new ImageCodecError("Corrupt PNG: decompressed data is larger than the image");
      }
      for (let i = 0; i < length; i += 1) {
        // Overlapping copies are legal and are how DEFLATE encodes runs, so this
        // must copy byte by byte; `copyWithin` would read already-written bytes.
        out[written + i] = out[written - distance + i] ?? 0;
      }
      written += length;
    }
  }

  if (written !== expectedLength) {
    throw new ImageCodecError(`Corrupt PNG: expected ${expectedLength} bytes of scanline data but decompressed ${written}`);
  }
  return { data: out, end: reader.position };
}

/**
 * Inflate a complete zlib stream (RFC 1950) and verify its Adler-32 trailer.
 *
 * The trailer check is what catches a corrupted IDAT that happens to still
 * inflate: without it a flipped bit in the compressed data can silently change
 * pixels that the CRC-32 of the chunk would have caught only in the compressed
 * bytes, not in the decoded image.
 */
function inflateZlib(bytes: Uint8Array, expectedLength: number): Uint8Array {
  if (bytes.length < 6) {
    throw new ImageCodecError("Corrupt PNG: image data is too short to be a zlib stream");
  }
  const cmf = bytes[0] ?? 0;
  const flg = bytes[1] ?? 0;
  if ((cmf & 0x0f) !== 8) {
    throw new ImageCodecError("Corrupt PNG: image data is not deflate-compressed");
  }
  if (((cmf << 8) | flg) % 31 !== 0) {
    throw new ImageCodecError("Corrupt PNG: bad zlib header check value");
  }
  if ((flg & 0x20) !== 0) {
    throw new ImageCodecError("Unsupported PNG: zlib preset dictionaries are not supported");
  }
  const { data, end } = inflateRaw(bytes, 2, expectedLength);
  if (end + 4 > bytes.length) {
    throw new ImageCodecError("Corrupt PNG: zlib stream is missing its checksum");
  }
  const expected = ((bytes[end] ?? 0) << 24 | (bytes[end + 1] ?? 0) << 16 | (bytes[end + 2] ?? 0) << 8 | (bytes[end + 3] ?? 0)) >>> 0;
  if (adler32(data) !== expected) {
    throw new ImageCodecError("Corrupt PNG: image data failed its checksum");
  }
  return data;
}

/** Number of extra bits and the base length for length codes 257..285. */
const MAX_MATCH = 258;
const MIN_MATCH = 3;
/** Chain-walk limit: bounds encoder work per byte without hurting ratio much. */
const MAX_CHAIN = 64;

/** DEFLATE bit writer, LSB-first within each byte. */
class DeflateBitWriter {
  private chunks: Uint8Array[] = [];
  private current = new Uint8Array(1 << 16);
  private length = 0;
  private buffer = 0;
  private count = 0;

  /** True when nothing has been written yet, so `length` is the total size. */
  get totalLength(): number {
    return this.chunks.reduce((sum, chunk) => sum + chunk.length, 0) + this.length;
  }

  private push(value: number): void {
    if (this.length === this.current.length) {
      this.chunks.push(this.current);
      this.current = new Uint8Array(1 << 16);
      this.length = 0;
    }
    this.current[this.length] = value;
    this.length += 1;
  }

  writeBits(value: number, count: number): void {
    this.buffer |= value << this.count;
    this.count += count;
    while (this.count >= 8) {
      this.push(this.buffer & 0xff);
      this.buffer >>>= 8;
      this.count -= 8;
    }
  }

  /** Huffman codes travel most-significant bit first, so they need reversing. */
  writeCode(code: number, length: number): void {
    let reversed = 0;
    let value = code;
    for (let i = 0; i < length; i += 1) {
      reversed = (reversed << 1) | (value & 1);
      value >>>= 1;
    }
    this.writeBits(reversed, length);
  }

  flush(): Uint8Array {
    if (this.count > 0) {
      this.push(this.buffer & 0xff);
      this.buffer = 0;
      this.count = 0;
    }
    const out = new Uint8Array(this.totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    out.set(this.current.subarray(0, this.length), offset);
    return out;
  }
}

/** Fixed literal/length code for a symbol, per RFC 1951 3.2.6. */
function fixedLiteralCode(symbol: number): { readonly code: number; readonly length: number } {
  if (symbol < 144) {
    return { code: 0x30 + symbol, length: 8 };
  }
  if (symbol < 256) {
    return { code: 0x190 + (symbol - 144), length: 9 };
  }
  if (symbol < 280) {
    return { code: symbol - 256, length: 7 };
  }
  return { code: 0xc0 + (symbol - 280), length: 8 };
}

/** Length code (257..285) plus extra bits for a match length. */
function lengthCodeFor(length: number): { readonly symbol: number; readonly extraBits: number; readonly extraValue: number } {
  for (let index = LENGTH_BASE.length - 1; index >= 0; index -= 1) {
    const base = LENGTH_BASE[index] ?? 0;
    if (length >= base) {
      return { symbol: 257 + index, extraBits: LENGTH_EXTRA[index] ?? 0, extraValue: length - base };
    }
  }
  throw new ImageCodecError("Internal error: match length below the DEFLATE minimum");
}

/** Distance code (0..29) plus extra bits for a match distance. */
function distanceCodeFor(distance: number): { readonly symbol: number; readonly extraBits: number; readonly extraValue: number } {
  for (let index = DISTANCE_BASE.length - 1; index >= 0; index -= 1) {
    const base = DISTANCE_BASE[index] ?? 0;
    if (distance >= base) {
      return { symbol: index, extraBits: DISTANCE_EXTRA[index] ?? 0, extraValue: distance - base };
    }
  }
  throw new ImageCodecError("Internal error: match distance below the DEFLATE minimum");
}

/**
 * Compress `data` as a single fixed-Huffman DEFLATE block.
 *
 * Greedy LZ77 with a hash chain over three-byte prefixes. PNG scanline data is
 * already filter-decorrelated, so the matches are short and a deeper search (or
 * a dynamic Huffman table) would spend more time than it saves bytes.
 */
function deflateFixed(data: Uint8Array): Uint8Array {
  const writer = new DeflateBitWriter();
  writer.writeBits(1, 1); // BFINAL
  writer.writeBits(1, 2); // BTYPE = fixed Huffman

  const HASH_BITS = 15;
  const HASH_SIZE = 1 << HASH_BITS;
  const head = new Int32Array(HASH_SIZE).fill(-1);
  const previous = new Int32Array(data.length).fill(-1);
  const hashAt = (position: number): number => {
    const a = data[position] ?? 0;
    const b = data[position + 1] ?? 0;
    const c = data[position + 2] ?? 0;
    return ((a << 8) ^ (b << 4) ^ c) & (HASH_SIZE - 1);
  };

  let position = 0;
  while (position < data.length) {
    let bestLength = 0;
    let bestDistance = 0;
    if (position + MIN_MATCH <= data.length) {
      const hash = hashAt(position);
      let candidate = head[hash] ?? -1;
      let chain = 0;
      const limit = position - 32506 > 0 ? position - 32506 : 0;
      const maxLength = Math.min(MAX_MATCH, data.length - position);
      while (candidate >= limit && candidate >= 0 && chain < MAX_CHAIN) {
        if ((data[candidate + bestLength] ?? 0) === (data[position + bestLength] ?? 0)) {
          let length = 0;
          while (length < maxLength && (data[candidate + length] ?? 0) === (data[position + length] ?? 0)) {
            length += 1;
          }
          if (length > bestLength) {
            bestLength = length;
            bestDistance = position - candidate;
            if (length >= maxLength) {
              break;
            }
          }
        }
        candidate = previous[candidate] ?? -1;
        chain += 1;
      }
      previous[position] = head[hash] ?? -1;
      head[hash] = position;
    }

    // A length-3 match costs 17 bits of fixed Huffman against 24 bits of
    // literals, so below four bytes the literals win on size.
    if (bestLength >= 4) {
      const lengthCode = lengthCodeFor(bestLength);
      const code = fixedLiteralCode(lengthCode.symbol);
      writer.writeCode(code.code, code.length);
      if (lengthCode.extraBits > 0) {
        writer.writeBits(lengthCode.extraValue, lengthCode.extraBits);
      }
      const distanceCode = distanceCodeFor(bestDistance);
      writer.writeCode(distanceCode.symbol, 5);
      if (distanceCode.extraBits > 0) {
        writer.writeBits(distanceCode.extraValue, distanceCode.extraBits);
      }
      // Register the skipped positions so later matches can still find them.
      for (let i = 1; i < bestLength; i += 1) {
        const skipped = position + i;
        if (skipped + MIN_MATCH <= data.length) {
          const hash = hashAt(skipped);
          previous[skipped] = head[hash] ?? -1;
          head[hash] = skipped;
        }
      }
      position += bestLength;
    } else {
      const code = fixedLiteralCode(data[position] ?? 0);
      writer.writeCode(code.code, code.length);
      position += 1;
    }
  }

  const end = fixedLiteralCode(256);
  writer.writeCode(end.code, end.length);
  return writer.flush();
}

/** Wrap a DEFLATE stream in the zlib container (RFC 1950) that PNG requires. */
function deflateZlib(data: Uint8Array): Uint8Array {
  const body = deflateFixed(data);
  const out = new Uint8Array(2 + body.length + 4);
  // 0x78 = CM 8 (deflate) with a 32K window. 0x9C = no preset dictionary, and
  // FLEVEL 2, which is the level zlib itself emits. The two bytes must satisfy
  // (0x78 << 8 | FLG) % 31 === 0; 0x01 would pass that check but sets the FDICT
  // bit, which every decoder (including this one) then rejects.
  out[0] = 0x78;
  out[1] = 0x9c;
  out.set(body, 2);
  const checksum = adler32(data);
  out[2 + body.length] = (checksum >>> 24) & 0xff;
  out[3 + body.length] = (checksum >>> 16) & 0xff;
  out[4 + body.length] = (checksum >>> 8) & 0xff;
  out[5 + body.length] = checksum & 0xff;
  return out;
}


type PngChunkHeader = {
  readonly length: number;
  readonly type: Uint8Array;
  readonly dataOffset: number;
};

/**
 * Encode RGBA8 pixels as an 8-bit RGBA PNG.
 *
 * Filter type 0 (None) is used for every row. Adaptive filtering would compress
 * better, but the derivative pipeline re-encodes at a target size and the
 * simplicity is worth more than the bytes here; PNG is not on the hot path and
 * the web derivative is what visitors download.
 */
/** Read the next chunk header, validating that its payload is present. */
function readPngChunkHeader(bytes: Uint8Array, offset: number): PngChunkHeader | undefined {
  if (offset + 8 > bytes.length) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(offset, false);
  // A declared length beyond the buffer is treated as "no more usable chunks"
  // rather than being trusted, so a truncated file cannot provoke a huge read.
  if (length > 0x7fffffff || offset + 12 + length > bytes.length) {
    return undefined;
  }
  return { length, type: bytes.subarray(offset + 4, offset + 8), dataOffset: offset + 8 };
}

function chunkTypeIs(type: Uint8Array, name: string): boolean {
  return (
    type[0] === name.charCodeAt(0) &&
    type[1] === name.charCodeAt(1) &&
    type[2] === name.charCodeAt(2) &&
    type[3] === name.charCodeAt(3)
  );
}

/** Channel count per supported PNG colour type. */
const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** PNG filter types, named so the cumulative sums below read as the spec does. */
const FILTER_NONE = 0;
const FILTER_SUB = 1;
const FILTER_UP = 2;
const FILTER_AVERAGE = 3;
const FILTER_PAETH = 4;

/** Paeth predictor: the neighbour closest to `left + up - upLeft`. */
function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) {
    return left;
  }
  return distanceUp <= distanceUpLeft ? up : upLeft;
}

/**
 * The five PNG filter functions (PNG spec 9.2). Each writes the filtered byte
 * into `target` at `targetBase + i` while reading the reconstructed bytes around
 * it; `previous` is the row above, already reconstructed.
 */
function filterRowInto(
  filter: number,
  source: Uint8Array,
  sourceBase: number,
  target: Uint8Array,
  targetBase: number,
  rowBytes: number,
  bpp: number,
  previous: Uint8Array | undefined,
): void {
  for (let i = 0; i < rowBytes; i += 1) {
    const value = source[sourceBase + i] ?? 0;
    const left = i >= bpp ? (source[sourceBase + i - bpp] ?? 0) : 0;
    const up = previous === undefined ? 0 : (previous[i] ?? 0);
    const upLeft = previous === undefined || i < bpp ? 0 : (previous[i - bpp] ?? 0);
    let filtered: number;
    switch (filter) {
      case FILTER_SUB:
        filtered = value - left;
        break;
      case FILTER_UP:
        filtered = value - up;
        break;
      case FILTER_AVERAGE:
        filtered = value - ((left + up) >> 1);
        break;
      case FILTER_PAETH:
        filtered = value - paethPredictor(left, up, upLeft);
        break;
      default:
        filtered = value;
        break;
    }
    target[targetBase + i] = filtered & 0xff;
  }
}

/**
 * Choose the filter whose output has the smallest sum of absolute signed
 * deviations, a cheap proxy for entropy that libpng and friends use too. Trying
 * all five costs one pass over the row each and is worth it: filter choice is
 * the single biggest lever on PNG size, and JPEG is unavailable for images that
 * carry transparency.
 */
function chooseFilterAndEncode(
  raw: Uint8Array,
  cursor: number,
  rowBytes: number,
  bpp: number,
  previous: Uint8Array | undefined,
  scratch: Uint8Array,
): number {
  let bestFilter = FILTER_NONE;
  let bestScore = Number.POSITIVE_INFINITY;
  const candidate = new Uint8Array(rowBytes);
  for (let filter = FILTER_NONE; filter <= FILTER_PAETH; filter += 1) {
    filterRowInto(filter, raw, cursor, candidate, 0, rowBytes, bpp, previous);
    let score = 0;
    for (let i = 0; i < rowBytes; i += 1) {
      const byte = candidate[i] ?? 0;
      score += byte < 128 ? byte : 256 - byte;
    }
    if (score < bestScore) {
      bestScore = score;
      bestFilter = filter;
    }
  }
  filterRowInto(bestFilter, raw, cursor, scratch, 0, rowBytes, bpp, previous);
  return bestFilter;
}

/**
 * Encode RGBA8 pixels as an 8-bit RGBA PNG (colour type 6, non-interlaced).
 *
 * Each row picks the filter with the lowest estimated entropy, the zlib wrapper
 * is built by hand around `deflateZlib`, and CRCs are computed over the chunk
 * type plus payload as the spec requires. The output is fully deterministic for
 * a given input, which is what makes a byte-identical decode/encode round trip a
 * meaningful assertion rather than a lucky one.
 */
export function encodePng(image: RawImage): Uint8Array {
  const { pixels, width, height } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new ImageCodecError("encodePng requires positive integer dimensions");
  }
  if (pixels.length !== width * height * 4) {
    throw new ImageCodecError("encodePng requires pixels.length === width * height * 4");
  }
  if (width > 0x7fffffff || height > 0x7fffffff) {
    throw new ImageCodecError("encodePng dimensions exceed the PNG limit");
  }

  const rowBytes = width * 4;
  const bpp = 4;
  const raw = new Uint8Array((rowBytes + 1) * height);
  const scratch = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const cursor = y * rowBytes;
    const target = y * (rowBytes + 1);
    const previous = y === 0 ? undefined : raw.subarray((y - 1) * (rowBytes + 1) + 1, (y - 1) * (rowBytes + 1) + 1 + rowBytes);
    raw[target] = chooseFilterAndEncode(raw, cursor, rowBytes, bpp, previous, scratch);
    raw.set(scratch, target + 1);
  }

  const compressed = deflateZlib(raw);

  // Exact layout: signature (8) + IHDR chunk (4 + 4 + 13 + 4) + one IDAT chunk
  // (4 + 4 + payload + 4) + IEND chunk (4 + 4 + 0 + 4). Sizing it exactly means
  // any arithmetic slip here throws instead of corrupting a neighbour.
  const total = PNG_SIGNATURE.length + 12 + 13 + (compressed.length + 12) + 12;
  const output = new Uint8Array(total);
  let offset = 0;
  output.set(PNG_SIGNATURE, offset);
  offset += PNG_SIGNATURE.length;

  const writeChunk = (type: string, data: Uint8Array): void => {
    const length = data.length;
    output[offset] = (length >>> 24) & 0xff;
    output[offset + 1] = (length >>> 16) & 0xff;
    output[offset + 2] = (length >>> 8) & 0xff;
    output[offset + 3] = length & 0xff;
    offset += 4;
    for (let i = 0; i < 4; i += 1) {
      output[offset + i] = type.charCodeAt(i);
    }
    output.set(data, offset + 4);
    // The CRC covers the chunk type and the payload, but not the length field.
    const crc = crc32(output, offset, offset + 4 + length);
    offset += 4 + length;
    output[offset] = (crc >>> 24) & 0xff;
    output[offset + 1] = (crc >>> 16) & 0xff;
    output[offset + 2] = (crc >>> 8) & 0xff;
    output[offset + 3] = crc & 0xff;
    offset += 4;
  };

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
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // compression method: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none
  writeChunk("IHDR", ihdr);
  writeChunk("IDAT", compressed);
  writeChunk("IEND", new Uint8Array(0));
  if (offset !== total) {
    throw new ImageCodecError("Internal error: PNG chunk framing did not fill its buffer");
  }
  return output;
}


/**
 * Decode an 8-bit PNG to RGBA8.
 *
 * Synchronous on purpose: the upload path decodes and resamples in one pass, so
 * a promise here would push `await` into code that has nothing else to await.
 * The zlib payload is inflated by this module's own synchronous inflate, which
 * also verifies the stream's Adler-32 — a flipped bit in compressed data that
 * still inflates is caught instead of silently altering pixels.
 */
export function decodePng(bytes: Uint8Array, options?: DecodeOptions): DecodedImage {
  const maxPixels = options?.maxPixels ?? DEFAULT_MAX_PIXELS;
  if (!(bytes instanceof Uint8Array)) {
    throw new ImageCodecError("decodePng requires a Uint8Array");
  }
  if (!hasPngSignature(bytes)) {
    throw new ImageCodecError("Not a PNG file (bad signature)");
  }

  const first = readPngChunkHeader(bytes, PNG_SIGNATURE.length);
  if (first === undefined || !chunkTypeIs(first.type, "IHDR") || first.length !== 13) {
    throw new ImageCodecError("Unsupported PNG: missing or malformed IHDR chunk");
  }
  const ihdr = new ByteReader(bytes.subarray(first.dataOffset, first.dataOffset + 13));
  const width = ihdr.u32be();
  const height = ihdr.u32be();
  const bitDepth = ihdr.u8();
  const colorType = ihdr.u8();
  const compression = ihdr.u8();
  const filterMethod = ihdr.u8();
  const interlace = ihdr.u8();
  if (width === 0 || height === 0) {
    throw new ImageCodecError("Unsupported PNG: zero-sized image");
  }
  if (bitDepth !== 8) {
    throw new ImageCodecError(`Unsupported PNG: ${bitDepth}-bit depth (only 8-bit is supported)`);
  }
  if (colorType === 3) {
    throw new ImageCodecError("Unsupported PNG: palette (colour type 3) images are not supported");
  }
  const channels = PNG_CHANNELS[colorType];
  if (channels === undefined) {
    throw new ImageCodecError(`Unsupported PNG: colour type ${colorType}`);
  }
  if (compression !== 0 || filterMethod !== 0) {
    throw new ImageCodecError("Unsupported PNG: unknown compression or filter method");
  }
  if (interlace !== 0) {
    throw new ImageCodecError("Unsupported PNG: interlaced (Adam7) images are not supported");
  }
  // Checked before anything is allocated, so a header claiming a huge frame
  // fails here rather than at `new Uint8ClampedArray`.
  if (width * height > maxPixels) {
    throw new ImageCodecError(`Unsupported PNG: ${width}x${height} exceeds the maxPixels limit`);
  }

  const idatParts: Uint8Array[] = [];
  let idatLength = 0;
  let offset = first.dataOffset + 13 + 4; // IHDR payload + its CRC
  let sawIend = false;
  for (;;) {
    const header = readPngChunkHeader(bytes, offset);
    if (header === undefined) {
      break;
    }
    if (chunkTypeIs(header.type, "IEND")) {
      sawIend = true;
      break;
    }
    if (chunkTypeIs(header.type, "IDAT")) {
      idatParts.push(bytes.subarray(header.dataOffset, header.dataOffset + header.length));
      idatLength += header.length;
      if (idatLength > 0x7fffffff) {
        throw new ImageCodecError("Unsupported PNG: image data is too large");
      }
    } else if (chunkTypeIs(header.type, "PLTE")) {
      throw new ImageCodecError("Unsupported PNG: palette (PLTE chunk) images are not supported");
    }
    offset = header.dataOffset + header.length + 4;
  }
  if (!sawIend) {
    throw new ImageCodecError("Truncated PNG: ran out of chunks before IEND");
  }
  if (idatParts.length === 0) {
    throw new ImageCodecError("Unsupported PNG: no IDAT image data found");
  }

  const compressed = new Uint8Array(idatLength);
  let cursor = 0;
  for (const part of idatParts) {
    compressed.set(part, cursor);
    cursor += part.length;
  }

  const stride = width * channels;
  const raw = inflateZlib(compressed, (stride + 1) * height);

  // Unfilter in place, one row at a time: the row just reconstructed becomes the
  // "up" reference for the next one, so only the raw buffer is needed.
  const bpp = channels;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart] ?? 0;
    const dataStart = rowStart + 1;
    // The previous row is a view into the same array and has already been
    // reconstructed by the time this row is processed.
    const previous = y === 0 ? undefined : raw.subarray((y - 1) * (stride + 1) + 1, (y - 1) * (stride + 1) + 1 + stride);
    switch (filter) {
      case FILTER_NONE:
        break;
      case FILTER_SUB:
        for (let i = bpp; i < stride; i += 1) {
          raw[dataStart + i] = (raw[dataStart + i] ?? 0) + (raw[dataStart + i - bpp] ?? 0);
        }
        break;
      case FILTER_UP:
        if (previous !== undefined) {
          for (let i = 0; i < stride; i += 1) {
            raw[dataStart + i] = (raw[dataStart + i] ?? 0) + (previous[i] ?? 0);
          }
        }
        break;
      case FILTER_AVERAGE:
        for (let i = 0; i < stride; i += 1) {
          const left = i >= bpp ? (raw[dataStart + i - bpp] ?? 0) : 0;
          const up = previous === undefined ? 0 : (previous[i] ?? 0);
          raw[dataStart + i] = (raw[dataStart + i] ?? 0) + ((left + up) >> 1);
        }
        break;
      case FILTER_PAETH:
        for (let i = 0; i < stride; i += 1) {
          const left = i >= bpp ? (raw[dataStart + i - bpp] ?? 0) : 0;
          const up = previous === undefined ? 0 : (previous[i] ?? 0);
          const upLeft = previous === undefined || i < bpp ? 0 : (previous[i - bpp] ?? 0);
          raw[dataStart + i] = (raw[dataStart + i] ?? 0) + paethPredictor(left, up, upLeft);
        }
        break;
      default:
        throw new ImageCodecError(`Unsupported PNG scanline filter type ${filter}`);
    }
  }

  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const source = y * (stride + 1) + 1;
    const target = y * width * 4;
    switch (colorType) {
      case 0: {
        for (let x = 0; x < width; x += 1) {
          const grey = raw[source + x] ?? 0;
          const p = target + x * 4;
          pixels[p] = grey;
          pixels[p + 1] = grey;
          pixels[p + 2] = grey;
          pixels[p + 3] = 255;
        }
        break;
      }
      case 2: {
        for (let x = 0; x < width; x += 1) {
          const s = source + x * 3;
          const p = target + x * 4;
          pixels[p] = raw[s] ?? 0;
          pixels[p + 1] = raw[s + 1] ?? 0;
          pixels[p + 2] = raw[s + 2] ?? 0;
          pixels[p + 3] = 255;
        }
        break;
      }
      case 4: {
        for (let x = 0; x < width; x += 1) {
          const s = source + x * 2;
          const p = target + x * 4;
          const grey = raw[s] ?? 0;
          pixels[p] = grey;
          pixels[p + 1] = grey;
          pixels[p + 2] = grey;
          pixels[p + 3] = raw[s + 1] ?? 0;
        }
        break;
      }
      default: {
        for (let i = 0; i < stride; i += 4) {
          const p = target + i;
          pixels[p] = raw[source + i] ?? 0;
          pixels[p + 1] = raw[source + i + 1] ?? 0;
          pixels[p + 2] = raw[source + i + 2] ?? 0;
          pixels[p + 3] = raw[source + i + 3] ?? 0;
        }
        break;
      }
    }
  }

  return { pixels, width, height, format: "png" };
}


// ---------------------------------------------------------------------------
// Unified entry point
// ---------------------------------------------------------------------------

/**
 * Decode a whole image to RGBA8.
 *
 * Returns a promise for every format. The PNG path must await an inflate
 * stream, and making the JPEG path synchronous would force callers to branch on
 * the format for no benefit — one `await` covers both.
 *
 * Rejects with `ImageCodecError` when the input is unsupported, truncated,
 * corrupt, progressive, 12-bit, or exceeds `maxPixels`.
 */
export async function decodeImage(
  bytes: Uint8Array,
  format: ImageFormat,
  options?: DecodeOptions,
): Promise<DecodedImage> {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new ImageCodecError("decodeImage requires a non-empty Uint8Array");
  }
  if (format === "png") {
    return decodePng(bytes, options);
  }
  if (format === "jpeg") {
    // Trust the declared format only as far as it matches the bytes; decoding a
    // PNG as JPEG would otherwise surface as a confusing segment error.
    if (detectImageFormat(bytes) !== "jpeg") {
      throw new ImageCodecError("Bytes are not a JPEG file");
    }
    return decodeJpegInternal(bytes, options?.maxPixels ?? DEFAULT_MAX_PIXELS);
  }
  throw new ImageCodecError(`Unsupported image format: ${String(format)}`);
}
