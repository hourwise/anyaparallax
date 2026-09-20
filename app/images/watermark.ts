/**
 * Development watermark asset and RGBA compositor (Slice 06).
 *
 * Watermarking is a PUBLIC-DERIVATIVE concern only. The private archival/print
 * master in R2 is never watermarked, never resized and never rewritten: the mark
 * is composited onto web/thumbnail derivatives after they are decoded and before
 * they are encoded, so a derivative can always be regenerated from an untouched
 * master. Nothing in this module reads or writes storage, so it cannot break that
 * boundary — it only knows about a decoded RGBA raster.
 *
 * The asset returned by `developmentWatermark()` is a REPLACEABLE DEVELOPMENT
 * PLACEHOLDER. Slice 06 ships before the operator has supplied the final
 * logo/signature, and the pipeline must still be exercisable end to end, so this
 * module draws its own two-line wordmark ("ANYAPARALLAX" / "PHOTOGRAPHY") from a
 * small built-in 5x7 bitmap font instead of loading artwork. When the real asset
 * arrives, only the builder should change: everything downstream consumes a
 * `WatermarkAsset` (coverage mask + ink colour + provenance label) and does not
 * care how the mask was produced.
 *
 * Deliberately free of Node, DOM, canvas, filesystem and dependency imports so it
 * runs unchanged inside a Cloudflare Worker on Web-standard APIs only
 * (`Uint8ClampedArray`, `Math`) and can be imported directly by the local check
 * scripts under Node's type stripping.
 */

// --- Positions -------------------------------------------------------------

/** Where the watermark sits on the image. `none` leaves the pixels untouched. */
export type WatermarkPosition = "none" | "bottom-right" | "bottom-left" | "bottom-center" | "center";

/**
 * The three positions the V1 admin form offers; `bottom-right` is the default.
 *
 * `center` and `none` are intentionally absent. A centred mark sits on top of
 * the subject, and "no mark at all" is a separate operator decision (the photo's
 * `watermarkEnabled` flag) rather than a placement. NOTE: both remain valid
 * *stored* values — the `photos.watermark_position` CHECK constraint accepts all
 * five — so a stored value is normalised by the data layer, while this list is
 * only what the admin radio group may submit.
 */
export const WATERMARK_POSITIONS: readonly WatermarkPosition[] = Object.freeze([
  "bottom-right",
  "bottom-left",
  "bottom-center",
]);

/** Placement assumed whenever the operator has not chosen one. */
export const DEFAULT_WATERMARK_POSITION: WatermarkPosition = "bottom-right";

/**
 * True for the positions the operator may select.
 *
 * This is the form-boundary guard, so it accepts exactly `WATERMARK_POSITIONS`
 * and therefore returns false for `center` and `none`: those are internal
 * variants the V1 form never offers, and a submitted value naming one of them is
 * a request the form did not make. The predicate stays sound because every
 * accepted string is a member of `WatermarkPosition`.
 */
export function isWatermarkPosition(value: unknown): value is WatermarkPosition {
  return typeof value === "string" && (WATERMARK_POSITIONS as readonly string[]).includes(value);
}

// --- Asset model -----------------------------------------------------------

/**
 * An 8-bit greyscale coverage mask, row-major, length === width * height.
 *
 * 0 means fully transparent (the photograph shows through unchanged) and 255
 * means fully opaque ink. Values in between are anti-aliased glyph edges.
 */
export type WatermarkMask = {
  readonly width: number;
  readonly height: number;
  readonly coverage: Uint8ClampedArray;
};

/** Ink colour of a mark, 0-255 per channel. */
export type WatermarkInk = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
};

/**
 * A decoded watermark sample: the coverage mask plus the colour to lay down.
 *
 * A development asset is generated here; a production asset would be decoded
 * from the operator's PNG/SVG into the same three fields, which is why the
 * compositor takes this type rather than a file or a URL.
 */
export type WatermarkAsset = {
  readonly mask: WatermarkMask;
  /** Ink colour of the mark, 0-255 per channel. */
  readonly ink: WatermarkInk;
  /** Human-readable provenance, surfaced in operator UI and checks. */
  readonly label: string;
};

/** Provenance string for the placeholder asset; also asserted by the checks. */
export const DEVELOPMENT_WATERMARK_LABEL = "development wordmark (replace with the final SVG/PNG asset)";

// --- Built-in 5x7 bitmap font ----------------------------------------------

/** Glyph grid width in cells. */
export const GLYPH_WIDTH = 5;
/** Glyph grid height in cells. 5x7 is the smallest grid on which A-Z stay legible. */
export const GLYPH_HEIGHT = 7;

/** Cell characters used by the font source: `#` is ink, `.` is background. */
const INK_CELL = "#";
const BACKGROUND_CELL = ".";

/**
 * Uppercase 5x7 font, one entry per character, declared as 7 rows of 5 cells
 * separated by `/`.
 *
 * The grid is written out rather than derived because the shapes ARE the asset:
 * they are hand-tuned to stay readable when the mask is scaled down onto a
 * thumbnail. Only the characters the wordmark and the operator-facing strings
 * need are defined; an undefined character throws while the table is parsed, so
 * a typo in the wordmark fails loudly instead of silently dropping a letter from
 * every watermarked derivative.
 */
const FONT_SOURCE: Readonly<Record<string, string>> = {
  " ": "...../...../...../...../...../...../.....",
  A: ".###./#...#/#...#/#####/#...#/#...#/#...#",
  B: "####./#...#/#...#/####./#...#/#...#/####.",
  C: ".###./#...#/#..../#..../#..../#...#/.###.",
  D: "####./#...#/#...#/#...#/#...#/#...#/####.",
  E: "#####/#..../#..../####./#..../#..../#####",
  F: "#####/#..../#..../####./#..../#..../#....",
  G: ".###./#...#/#..../#.###/#...#/#...#/.###.",
  H: "#...#/#...#/#...#/#####/#...#/#...#/#...#",
  I: "#####/..#../..#../..#../..#../..#../#####",
  J: "..###/...#./...#./...#./...#./#..#./.##..",
  K: "#...#/#..#./#.#../##.../#.#../#..#./#...#",
  L: "#..../#..../#..../#..../#..../#..../#####",
  M: "#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#",
  N: "#...#/##..#/#.#.#/#.#.#/#..##/#...#/#...#",
  O: ".###./#...#/#...#/#...#/#...#/#...#/.###.",
  P: "####./#...#/#...#/####./#..../#..../#....",
  Q: ".###./#...#/#...#/#...#/#.#.#/#..#./.##.#",
  R: "####./#...#/#...#/####./#.#../#..#./#...#",
  S: ".####/#..../#..../.###./....#/....#/####.",
  T: "#####/..#../..#../..#../..#../..#../..#..",
  U: "#...#/#...#/#...#/#...#/#...#/#...#/.###.",
  V: "#...#/#...#/#...#/#...#/#...#/.#.#./..#..",
  W: "#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#",
  X: "#...#/#...#/.#.#./..#../.#.#./#...#/#...#",
  Y: "#...#/#...#/.#.#./..#../..#../..#../..#..",
  Z: "#####/....#/...#./..#../.#.../#..../#####",
  "0": ".###./#...#/#..##/#.#.#/##..#/#...#/.###.",
  "1": "..#../.##../..#../..#../..#../..#../.###.",
  "2": ".###./#...#/....#/...#./..#../.#.../#####",
  "3": "####./....#/....#/.###./....#/....#/####.",
  "4": "...#./..##./.#.#./#..#./#####/...#./...#.",
  "5": "#####/#..../####./....#/....#/#...#/.###.",
  "6": "..##./.#.../#..../####./#...#/#...#/.###.",
  "7": "#####/....#/...#./..#../.#.../.#.../.#...",
  "8": ".###./#...#/#...#/.###./#...#/#...#/.###.",
  "9": ".###./#...#/#...#/.####/....#/...#./.##..",
  ".": "...../...../...../...../...../.##../.##..",
  "-": "...../...../...../#####/...../...../.....",
  "&": ".##../#..#./#.#../.#.../#.#.#/#..#./.##.#",
  "'": "..#../..#../...../...../...../...../.....",
  "!": "..#../..#../..#../..#../..#../...../..#..",
};

/**
 * Split the compact font source into rows, verifying the declared cell grid.
 *
 * Runs once at import. The table is a few hundred bytes, so parsing it eagerly
 * costs nothing and turns a mistyped glyph into an import-time failure rather
 * than a gap in a published photograph.
 */
function parseFontTable(): Readonly<Record<string, readonly string[]>> {
  const table: Record<string, readonly string[]> = {};
  for (const [character, source] of Object.entries(FONT_SOURCE)) {
    const rows = source.split("/");
    if (rows.length !== GLYPH_HEIGHT) {
      throw new Error(
        `watermark font: glyph "${character}" has ${rows.length} rows, expected ${GLYPH_HEIGHT}`,
      );
    }
    for (const row of rows) {
      if (row.length !== GLYPH_WIDTH) {
        throw new Error(
          `watermark font: glyph "${character}" has a row of ${row.length} cells, expected ${GLYPH_WIDTH}`,
        );
      }
      for (const cell of row) {
        if (cell !== INK_CELL && cell !== BACKGROUND_CELL) {
          throw new Error(`watermark font: glyph "${character}" uses unknown cell "${cell}"`);
        }
      }
    }
    table[character] = Object.freeze(rows);
  }
  return Object.freeze(table);
}

const GLYPHS: Readonly<Record<string, readonly string[]>> = parseFontTable();

/** Every character the built-in font can draw, sorted; useful for checks. */
export const FONT_CHARACTERS: readonly string[] = Object.freeze(Object.keys(GLYPHS).sort());

/** Font cells for one character, or null when the font has no glyph for it. */
export function glyphRows(character: string): readonly string[] | null {
  return GLYPHS[character] ?? null;
}

// --- Development wordmark --------------------------------------------------

/** One line of the wordmark: its text and how many base pixels one font cell covers. */
type WordmarkLine = {
  readonly text: string;
  /** Base pixels per font cell; also the cap height divided by `GLYPH_HEIGHT`. */
  readonly pixel: number;
  /** Extra cells inserted between glyphs, in font cells. */
  readonly tracking: number;
};

/**
 * Base (pre-supersample) geometry of the development wordmark, in mask pixels.
 *
 * The cell sizes are deliberately FRACTIONAL. A glyph cell is an axis-aligned
 * rectangle, so if a cell were a whole number of pixels every glyph edge would
 * land exactly on a mask pixel boundary and box-downsampling could only ever
 * produce 0 or 255 — no anti-aliasing at all, however many subsamples are taken.
 * A fractional cell size puts edges inside pixels, which is what turns the
 * supersampled buffer into a real coverage gradient.
 */
const WORDMARK = {
  /** Line 1: the name. 7 rows x 4.1 px ≈ 29 px cap height — the "around 28 px" base size. */
  name: { text: "ANYAPARALLAX", pixel: 4.1, tracking: 1 },
  /** Line 2: the discipline. Half the cap height (≈ 15 px) and tracked wider, as a subtitle. */
  discipline: { text: "PHOTOGRAPHY", pixel: 2.1, tracking: 2 },
  /** Vertical gap between the two lines, in base pixels. */
  lineGap: 8,
} as const;

const WORDMARK_LINES: readonly WordmarkLine[] = [WORDMARK.name, WORDMARK.discipline];

/**
 * Supersampling factor: the glyph grid is rasterised on a 4x finer lattice and
 * box-downsampled, giving 17 coverage levels per mask pixel (0..255 in steps of
 * ~16). 4x removes visible stair-stepping at the sizes this mark is drawn at; the
 * transient buffer is ~240 KB for the default wordmark and is released as soon as
 * the mask is built.
 */
export const SUPERSAMPLE = 4;

/** A line placed on the mask canvas. */
type PlacedLine = {
  readonly line: WordmarkLine;
  /** Left edge in base pixels (fractional: the line is centred on the mask). */
  readonly x: number;
  /** Top edge in base pixels. */
  readonly y: number;
};

/** Advance width of one line in base pixels, tracking included. */
function lineWidth(line: WordmarkLine): number {
  const glyphs = line.text.length;
  if (glyphs === 0) {
    return 0;
  }
  const cells = glyphs * GLYPH_WIDTH + (glyphs - 1) * line.tracking;
  return cells * line.pixel;
}

/**
 * Centre the two lines against each other on a canvas wide enough for the wider
 * one, and stack them with the configured gap.
 *
 * The offsets are kept fractional on purpose: rounding a line's left edge to a
 * whole pixel would put that line's glyph edges back onto the pixel grid, and the
 * half-pixel offsets that centring produces also keep the two lines from sharing
 * one vertical edge phase.
 */
function layoutWordmark(): { width: number; height: number; lines: readonly PlacedLine[] } {
  const contentWidth = WORDMARK_LINES.reduce((widest, line) => Math.max(widest, lineWidth(line)), 0);
  const contentHeight = WORDMARK_LINES.reduce(
    (tallest, line, index) =>
      tallest + GLYPH_HEIGHT * line.pixel + (index > 0 ? WORDMARK.lineGap : 0),
    0,
  );
  const width = Math.max(1, Math.ceil(contentWidth));
  const height = Math.max(1, Math.ceil(contentHeight));

  const lines: PlacedLine[] = [];
  let cursor = 0;
  for (const line of WORDMARK_LINES) {
    const lineHeight = GLYPH_HEIGHT * line.pixel;
    lines.push({
      line,
      x: (width - lineWidth(line)) / 2,
      y: cursor,
    });
    cursor += lineHeight + WORDMARK.lineGap;
  }
  return { width, height, lines };
}

/**
 * Set every supersample cell whose CENTRE falls inside one glyph cell.
 *
 * Centre sampling is what box-downsampling assumes: each subsample stands for the
 * area it covers, so a partially covered cell contributes 0 or 1 and never a
 * fractional weight, which would double-count the same edge in the average.
 */
function stampGlyphCell(
  samples: Uint8Array,
  stride: number,
  rows: number,
  x: number,
  y: number,
  size: number,
): void {
  const left = Math.max(0, Math.floor(x));
  const right = Math.min(stride, Math.ceil(x + size));
  const top = Math.max(0, Math.floor(y));
  const bottom = Math.min(rows, Math.ceil(y + size));
  const edgeRight = x + size;
  const edgeBottom = y + size;
  for (let row = top; row < bottom; row += 1) {
    const centreY = row + 0.5;
    if (centreY < y || centreY >= edgeBottom) {
      continue;
    }
    const rowStart = row * stride;
    for (let column = left; column < right; column += 1) {
      const centreX = column + 0.5;
      if (centreX < x || centreX >= edgeRight) {
        continue;
      }
      samples[rowStart + column] = 1;
    }
  }
}

/** Box-downsample the supersampled ink flags into 8-bit coverage. */
function downsampleCoverage(
  samples: Uint8Array,
  superWidth: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  const coverage = new Uint8ClampedArray(width * height);
  const cells = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let ink = 0;
      for (let subY = 0; subY < SUPERSAMPLE; subY += 1) {
        const rowStart = (y * SUPERSAMPLE + subY) * superWidth;
        for (let subX = 0; subX < SUPERSAMPLE; subX += 1) {
          ink += samples[rowStart + x * SUPERSAMPLE + subX] ?? 0;
        }
      }
      coverage[y * width + x] = Math.round((ink / cells) * 255);
    }
  }
  return coverage;
}

/** Rasterise the placed wordmark at `SUPERSAMPLE`x and box-downsample it to the mask. */
function buildDevelopmentMask(): WatermarkMask {
  const { width, height, lines } = layoutWordmark();
  const superWidth = width * SUPERSAMPLE;
  const superHeight = height * SUPERSAMPLE;
  const samples = new Uint8Array(superWidth * superHeight);

  for (const placed of lines) {
    const { text, pixel, tracking } = placed.line;
    for (let index = 0; index < text.length; index += 1) {
      const rows = glyphRows(text.charAt(index));
      if (rows === null) {
        throw new Error(`watermark font: no glyph for "${text.charAt(index)}" in "${text}"`);
      }
      const glyphX = placed.x + index * (GLYPH_WIDTH + tracking) * pixel;
      for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
        const cells = rows[row];
        if (cells === undefined) {
          continue;
        }
        for (let column = 0; column < GLYPH_WIDTH; column += 1) {
          if (cells.charAt(column) !== INK_CELL) {
            continue;
          }
          stampGlyphCell(
            samples,
            superWidth,
            superHeight,
            (glyphX + column * pixel) * SUPERSAMPLE,
            (placed.y + row * pixel) * SUPERSAMPLE,
            pixel * SUPERSAMPLE,
          );
        }
      }
    }
  }

  const coverage = downsampleCoverage(samples, superWidth, width, height);
  return { width, height, coverage };
}

/** Built once per isolate; `null` until the first caller asks for it. */
let cachedDevelopmentWatermark: WatermarkAsset | null = null;

/**
 * The development watermark asset, built once per process.
 *
 * The mask is cached because rasterising it costs a few hundred thousand array
 * writes and the result never changes; a Worker would otherwise pay that on every
 * upload. The asset object is frozen so a caller cannot mutate the shared ink or
 * label — rebuilds are deliberately not offered, since replacing the placeholder
 * means replacing the builder, not tweaking the returned value.
 */
export function developmentWatermark(): WatermarkAsset {
  if (cachedDevelopmentWatermark === null) {
    const mask = Object.freeze(buildDevelopmentMask());
    const ink = Object.freeze({ r: 255, g: 255, b: 255 });
    cachedDevelopmentWatermark = Object.freeze({
      mask,
      ink,
      label: DEVELOPMENT_WATERMARK_LABEL,
    });
  }
  return cachedDevelopmentWatermark;
}

// --- Compositor ------------------------------------------------------------

/**
 * The RGBA raster the compositor draws on: one `Uint8ClampedArray` of
 * `width * height * 4` bytes in row-major order. This is the shape an ImageScript
 * / `createImageBitmap` decode hands back, so no adapter is needed at the call
 * site.
 */
export type WatermarkImage = {
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
};

/** Fraction of the image width the mark aims to occupy. */
export const WATERMARK_WIDTH_FRACTION = 0.3;

/** Inset from the image edge, as a fraction of the shorter image dimension. */
export const WATERMARK_MARGIN_FRACTION = 0.025;

/** Inset floor in pixels, so the mark never touches the edge on small derivatives. */
export const WATERMARK_MIN_MARGIN_PX = 8;

/**
 * Narrowest drawn mark that is still legible, in image pixels.
 *
 * Below this the wordmark is an unreadable smear, so a derivative that small is
 * served unmarked instead. "Ownership is unclear" is a better failure than
 * "the photograph has been vandalised", and a thumbnail this small is not a
 * reproduction anyone can reuse.
 */
export const WATERMARK_MIN_LEGIBLE_WIDTH_PX = 96;

/** Where the mark lands, and how it was scaled to get there. */
export type WatermarkPlacement = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Integer nearest-neighbour magnification of the mask (always >= 1). */
  readonly scale: number;
  /** Fraction of the mask actually drawn; 1 unless it had to shrink to fit. */
  readonly shrink: number;
  /** Inset used by the corner positions, in image pixels. */
  readonly margin: number;
};

/** Reject declared dimensions that cannot describe a raster. */
function assertDimensions(width: number, height: number, what: string): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(
      `watermark: ${what} dimensions must be positive integers, received ${width}x${height}`,
    );
  }
}

/**
 * Both integrity checks below exist because a typed array read past its end
 * yields `undefined` and a write past its end is SILENTLY DISCARDED. A mismatch
 * between declared dimensions and buffer length therefore produces a corrupt or
 * half-drawn derivative with no error anywhere, which is the worst possible
 * failure mode for an asset that is published.
 */
function assertImageIntegrity(image: WatermarkImage): void {
  assertDimensions(image.width, image.height, "image");
  const expected = image.width * image.height * 4;
  if (image.pixels.length !== expected) {
    throw new Error(
      `watermark: image buffer holds ${image.pixels.length} bytes but ${image.width}x${image.height} RGBA needs ${expected}`,
    );
  }
}

function assertMaskIntegrity(mask: WatermarkMask): void {
  assertDimensions(mask.width, mask.height, "mask");
  const expected = mask.width * mask.height;
  if (mask.coverage.length !== expected) {
    throw new Error(
      `watermark: mask coverage holds ${mask.coverage.length} bytes but ${mask.width}x${mask.height} needs ${expected}`,
    );
  }
}

/** Inset from the image edge: ~2.5% of the shorter side, never below the 8 px floor. */
function marginFor(width: number, height: number): number {
  const shorterSide = Math.min(width, height);
  return Math.max(WATERMARK_MIN_MARGIN_PX, Math.round(shorterSide * WATERMARK_MARGIN_FRACTION));
}

/** True when the mask magnified by `scale` fits inside the available box. */
function fitsWithin(mask: WatermarkMask, scale: number, availableWidth: number, availableHeight: number): boolean {
  return mask.width * scale <= availableWidth && mask.height * scale <= availableHeight;
}

/** Top-left corner for a position, or null for `none`. */
function originFor(
  position: WatermarkPosition,
  imageWidth: number,
  imageHeight: number,
  width: number,
  height: number,
  margin: number,
): { x: number; y: number } | null {
  const centredX = Math.round((imageWidth - width) / 2);
  const centredY = Math.round((imageHeight - height) / 2);
  const rightX = imageWidth - margin - width;
  const bottomY = imageHeight - margin - height;
  switch (position) {
    case "bottom-right":
      return { x: rightX, y: bottomY };
    case "bottom-left":
      return { x: margin, y: bottomY };
    case "bottom-center":
      return { x: centredX, y: bottomY };
    case "center":
      return { x: centredX, y: centredY };
    case "none":
      return null;
  }
}

/**
 * Work out where a mark lands, or null when this image must be left unmarked.
 *
 * The size is decided in three steps, in this order, because each one can only
 * make the mark smaller:
 *
 * 1. Aim at `WATERMARK_WIDTH_FRACTION` of the image width, expressed as an
 *    INTEGER magnification of the mask. Integral scaling preserves the mask's own
 *    anti-aliasing; a fractional factor would resample that gradient a second
 *    time and soften the glyph edges into grey mush.
 * 2. Clamp so the mark still fits inside the image minus its margin. A mark
 *    hanging off the edge reads as a rendering bug, so the mark shrinks instead.
 * 3. If even 1:1 does not fit (a small derivative), shrink continuously — but
 *    never past `WATERMARK_MIN_LEGIBLE_WIDTH_PX`, where the wordmark stops being
 *    readable and the caller must serve the image unmarked.
 *
 * The returned rectangle is always inside the image; the guard at the end proves
 * it rather than leaving it to the reader, because an out-of-bounds compositor
 * write would be discarded silently instead of throwing.
 */
export function watermarkPlacementFor(
  image: { readonly width: number; readonly height: number },
  asset: WatermarkAsset,
  position: WatermarkPosition,
): WatermarkPlacement | null {
  if (position === "none") {
    return null;
  }
  assertDimensions(image.width, image.height, "image");
  const { mask } = asset;
  assertMaskIntegrity(mask);

  const margin = marginFor(image.width, image.height);
  const availableWidth = image.width - margin * 2;
  const availableHeight = image.height - margin * 2;
  if (availableWidth < 1 || availableHeight < 1) {
    return null;
  }

  const targetWidth = image.width * WATERMARK_WIDTH_FRACTION;
  let scale = Math.max(1, Math.floor(targetWidth / mask.width));
  while (scale > 1 && !fitsWithin(mask, scale, availableWidth, availableHeight)) {
    scale -= 1;
  }

  let shrink = 1;
  if (!fitsWithin(mask, scale, availableWidth, availableHeight)) {
    shrink = Math.min(availableWidth / mask.width, availableHeight / mask.height);
    if (Math.round(mask.width * shrink) < WATERMARK_MIN_LEGIBLE_WIDTH_PX) {
      return null;
    }
  }

  const width = Math.max(1, Math.round(mask.width * scale * shrink));
  const height = Math.max(1, Math.round(mask.height * scale * shrink));
  const origin = originFor(position, image.width, image.height, width, height, margin);
  if (origin === null) {
    return null;
  }
  if (
    origin.x < 0 ||
    origin.y < 0 ||
    origin.x + width > image.width ||
    origin.y + height > image.height
  ) {
    throw new Error(
      `watermark: placement ${origin.x},${origin.y} ${width}x${height} escapes ${image.width}x${image.height}`,
    );
  }
  return { x: origin.x, y: origin.y, width, height, scale, shrink, margin };
}

/**
 * One channel of `out = ink * coverage + original * (1 - coverage)`.
 *
 * Rounded to nearest and clamped explicitly rather than relying on the
 * `Uint8ClampedArray` store: the typed-array conversion rounds ties to EVEN,
 * which would make published pixels depend on the storage type instead of on the
 * arithmetic written here.
 */
function blendChannel(ink: number, original: number, coverage: number): number {
  const value = Math.round(ink * coverage + original * (1 - coverage));
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

/**
 * Draw the mark over the placement rectangle.
 *
 * The mask is sampled nearest-neighbour. That is acceptable here precisely
 * because the mask is already anti-aliased by supersampling: each mask pixel is
 * a coverage value, so replicating it keeps the glyph edges exactly as sharp as
 * the asset intends, and no second filter is needed.
 */
function compositePlacement(
  image: WatermarkImage,
  asset: WatermarkAsset,
  placement: WatermarkPlacement,
): void {
  const { pixels, width: imageWidth } = image;
  const { mask, ink } = asset;
  const { x, y, width, height } = placement;

  for (let row = 0; row < height; row += 1) {
    const sourceY = Math.min(mask.height - 1, Math.floor((row * mask.height) / height));
    const destinationRow = (y + row) * imageWidth;
    for (let column = 0; column < width; column += 1) {
      const sourceX = Math.min(mask.width - 1, Math.floor((column * mask.width) / width));
      const sample = mask.coverage[sourceY * mask.width + sourceX];
      if (sample === undefined || sample === 0) {
        // Fully transparent mask pixels are skipped outright: the destination
        // bytes stay untouched rather than being rewritten with the same value,
        // which keeps an unmarked region byte-for-byte identical.
        continue;
      }
      const coverage = sample / 255;
      const offset = (destinationRow + x + column) * 4;
      // Only RGB is written. The coverage already modulates the ink against the
      // photograph, so spending it on alpha as well would darken the mark where
      // it crosses a light background; derivatives are opaque anyway and their
      // alpha channel must survive the watermark unchanged.
      pixels[offset] = blendChannel(ink.r, pixels[offset] ?? 0, coverage);
      pixels[offset + 1] = blendChannel(ink.g, pixels[offset + 1] ?? 0, coverage);
      pixels[offset + 2] = blendChannel(ink.b, pixels[offset + 2] ?? 0, coverage);
    }
  }
}

/**
 * Composite a watermark onto RGBA pixels in place, according to `position`.
 *
 * Integrity is checked before the `none` short-circuit: a declared size that
 * disagrees with the buffer is a caller bug worth reporting regardless of
 * placement, and the checks are O(1) so `none` still returns immediately without
 * touching a single pixel.
 *
 * Only the mark's bounding box is visited, so pixels outside it — and alpha
 * everywhere — are untouched by construction.
 */
export function applyWatermark(
  image: { pixels: Uint8ClampedArray; width: number; height: number },
  asset: WatermarkAsset,
  position: WatermarkPosition,
): void {
  assertImageIntegrity(image);
  assertMaskIntegrity(asset.mask);
  if (position === "none") {
    return;
  }
  const placement = watermarkPlacementFor(image, asset, position);
  if (placement === null) {
    // Too small to carry a legible mark; the derivative is served as it is.
    return;
  }
  compositePlacement(image, asset, placement);
}
