/**
 * Image processing boundary (Slice 06 repair 01) — the pure contract.
 *
 * The application does not decode, resize, composite or encode images itself.
 * A production deploy hands the source bytes to the Cloudflare Images binding,
 * which performs decode, trusted dimension measurement, resize, watermark draw
 * and output encoding inside the platform service. That is what keeps a
 * full-resolution raster out of the Worker isolate: the only pixel buffer this
 * application ever holds is the ENCODED derivative it is about to store.
 *
 * This module holds the shapes and the derived numbers only, so it is safe to
 * import from a check script and from the client-side compile graph.
 */

/** Formats an operator may upload. Both must be genuinely decodable. */
export const ACCEPTED_SOURCE_FORMATS = ["image/jpeg", "image/png"] as const;

export type SourceFormat = (typeof ACCEPTED_SOURCE_FORMATS)[number];

/** Watermark placement. `none` performs NO draw operation at all. */
export type WatermarkPosition = "none" | "center" | "bottom-right";

/** Where the operator may put the development watermark. */
export const WATERMARK_POSITIONS: readonly WatermarkPosition[] = [
  "none",
  "center",
  "bottom-right",
];

/** Default placement, matching the V1 direction: a corner mark. */
export const DEFAULT_WATERMARK_POSITION: WatermarkPosition = "bottom-right";

export function isWatermarkPosition(value: unknown): value is WatermarkPosition {
  return typeof value === "string" && (WATERMARK_POSITIONS as readonly string[]).includes(value);
}

/** Longest edge of the public web derivative, in pixels. */
export const WEB_DERIVATIVE_EDGE = 1600;

/** Longest edge of the public gallery thumbnail, in pixels. */
export const THUMBNAIL_EDGE = 480;

/**
 * Output encoding for derivatives.
 *
 * WebP, because it carries both photographic quality and an alpha channel, so a
 * transparent PNG source keeps its transparency instead of acquiring a black
 * background the way a JPEG output would. The binding supports it in the offline
 * implementation as well as in production, which matters: a format that only
 * worked remotely could not be verified locally.
 */
export const DERIVATIVE_OUTPUT_FORMAT = "image/webp";

export const DERIVATIVE_CONTENT_TYPE = "image/webp";

/** Encoder quality for derivatives: high, because this is the portfolio itself. */
export const DERIVATIVE_QUALITY = 86;

/** One derivative this application asked the processor to produce. */
export type PreparedDerivative = {
  /** The encoded bytes, exactly as the processor returned them. */
  readonly bytes: Uint8Array;
  /** What the processor says it produced, cross-checked against the request. */
  readonly width: number;
  readonly height: number;
  readonly contentType: string;
};

/**
 * Everything needed to store one upload's derivatives.
 *
 * Deliberately returned only after ALL processing succeeded, so the caller can
 * order its writes as "prepare everything, then commit" rather than interleaving
 * platform calls with persistent writes.
 */
export type PreparedDerivatives = {
  readonly source: { readonly width: number; readonly height: number; readonly format: SourceFormat };
  readonly web: PreparedDerivative;
  readonly thumbnail: PreparedDerivative;
  /** True when a draw operation was actually requested. */
  readonly watermarked: boolean;
};

/** Watermark settings for one upload. */
export type WatermarkSetting = {
  readonly enabled: boolean;
  readonly position: WatermarkPosition;
};

/** The development watermark overlay: a replaceable RGBA asset. */
export type WatermarkOverlay = {
  /** Encoded overlay bytes (PNG with alpha). */
  readonly bytes: Uint8Array;
  readonly contentType: string;
  /** Provenance, surfaced so a placeholder can never pass for the final asset. */
  readonly label: string;
};

/** A refusal the OPERATOR can act on, raised before anything is stored. */
export class ImageProcessingError extends Error {
  readonly reason:
    | "inspection-failed"
    | "not-an-image"
    | "unsupported-format"
    | "derivative-failed";

  constructor(reason: ImageProcessingError["reason"], message: string) {
    super(message);
    this.name = "ImageProcessingError";
    this.reason = reason;
  }
}

/** What the processor is asked to do for one upload. */
export type PrepareRequest = {
  readonly photoId: string;
  readonly bytes: Uint8Array;
  readonly watermark: WatermarkSetting;
};

/** The production boundary: one method, all processing, nothing persistent. */
export type ImageProcessor = {
  prepare(request: PrepareRequest): Promise<PreparedDerivatives>;
};

/**
 * The scale factor for a derivative: the largest factor <= 1 that brings the
 * longest edge within `maxEdge`.
 *
 * Returns 1 (no change) rather than a factor above 1, so a source smaller than
 * the limit is never enlarged — the requirement is a CEILING on the longest
 * edge, not a target to fill. Shared by the adapter and the checks so the
 * expected numbers are computed once.
 */
export function fitScale(width: number, height: number, maxEdge: number): number {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= 0) {
    return 1;
  }
  return longest <= maxEdge ? 1 : maxEdge / longest;
}

/**
 * The exact dimensions to request for a derivative.
 *
 * Dimensions are rounded, clamped to at least one pixel, and never larger than
 * the source. The processor is still asked to `scale-down`, so a rounding
 * mistake here cannot upscale an image.
 */
export function derivativeSize(
  width: number,
  height: number,
  maxEdge: number,
): { readonly width: number; readonly height: number } {
  const scale = fitScale(width, height, maxEdge);
  if (scale === 1) {
    return { width, height };
  }
  return {
    width: Math.max(1, Math.min(width, Math.round(width * scale))),
    height: Math.max(1, Math.min(height, Math.round(height * scale))),
  };
}

/**
 * The draw options for a watermark position, or null when NO draw must happen.
 *
 * `none` returns null so the adapter performs no draw call at all rather than a
 * transparent one: "no watermark" must mean no operation, not an operation that
 * happens to be invisible.
 *
 * The corner inset is a percentage of the shorter edge with a floor, so the mark
 * keeps a consistent visual margin on a thumbnail and on a full-width image. The
 * `bottom`/`right` inset is what the binding's draw options express directly.
 */
export const WATERMARK_MARGIN_FRACTION = 0.025;
export const WATERMARK_MIN_MARGIN_PX = 8;

export type DrawRequest = {
  readonly position: { readonly bottom?: number; readonly right?: number };
  readonly opacity: number;
};

export function drawRequestFor(
  position: WatermarkPosition,
  derivative: { readonly width: number; readonly height: number },
): DrawRequest | null {
  if (position === "none") {
    return null;
  }
  if (position === "center") {
    // No inset: the platform centres an overlay that specifies no side.
    return { position: {}, opacity: 0.75 };
  }
  const shorterEdge = Math.min(derivative.width, derivative.height);
  const inset = Math.max(
    WATERMARK_MIN_MARGIN_PX,
    Math.round(shorterEdge * WATERMARK_MARGIN_FRACTION),
  );
  return { position: { bottom: inset, right: inset }, opacity: 0.75 };
}
