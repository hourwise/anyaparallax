/**
 * Cloudflare Images adapter (Slice 06 repair 01) — the production processor.
 *
 * Server-only. Everything expensive happens in the platform service:
 *
 *   1. `info()`        — the image must actually decode, and the dimensions it
 *                        reports are the TRUSTED geometry recorded on the row.
 *                        The upload's own header bytes are never believed.
 *   2. `input()`       — the source stream, straight into the binding.
 *   3. `transform()`   — resize to the derivative's edge, `fit: "scale-down"` so
 *                        the platform refuses to enlarge.
 *   4. `draw()`        — the watermark overlay, and ONLY when a watermark was
 *                        requested. `none` performs no draw at all.
 *   5. `output()`      — WebP encode.
 *
 * What this module deliberately never does: allocate a pixel buffer. The only
 * bytes it holds are the ENCODED derivative it is about to store, which is a few
 * hundred kilobytes rather than the ~200 MB a decoded 50-megapixel RGBA raster
 * would need — the difference between fitting in a 128 MB isolate and not.
 *
 * The binding is injectable (`CloudflareImagesBinding`) so a check can supply a
 * fake without a network call, and the overlay is a separate argument so the
 * watermark asset stays replaceable.
 */
import {
  DERIVATIVE_CONTENT_TYPE,
  DERIVATIVE_OUTPUT_FORMAT,
  DERIVATIVE_QUALITY,
  THUMBNAIL_EDGE,
  WEB_DERIVATIVE_EDGE,
  derivativeSize,
  drawRequestFor,
  ImageProcessingError,
  type ImageProcessor,
  type PreparedDerivative,
  type PreparedDerivatives,
  type PrepareRequest,
  type SourceFormat,
  type WatermarkOverlay,
} from "./image-processor";

/** The slice of the Images binding this adapter uses. */
export type CloudflareImagesBinding = {
  info(stream: ReadableStream<Uint8Array>): Promise<{ format?: string; width: number; height: number }>;
  input(stream: ReadableStream<Uint8Array>): CloudflareImageTransformer;
};

export type CloudflareImageTransformer = {
  transform(options: {
    width?: number;
    height?: number;
    fit?: "scale-down" | "contain" | "cover" | "crop" | "pad";
  }): CloudflareImageTransformer;
  draw(
    image: ReadableStream<Uint8Array>,
    options?: { bottom?: number; right?: number; opacity?: number },
  ): CloudflareImageTransformer;
  output(options: { format: string; quality?: number }): Promise<{
    response(): Response;
    contentType(): string;
  }>;
};

/**
 * A fresh stream per call: a ReadableStream can only be consumed once.
 *
 * The bytes are copied into a fresh `Uint8Array` before becoming a Blob part.
 * `BlobPart` requires a view over a plain `ArrayBuffer`, while the incoming
 * `Uint8Array` is typed over `ArrayBufferLike` (which includes
 * `SharedArrayBuffer`); copying both satisfies the type and guarantees the
 * binding receives a buffer nothing else can mutate while it is being read.
 */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new Blob([new Uint8Array(bytes)]).stream();
}

/** Narrow the platform's reported format to one this application accepts. */
function sourceFormatOf(reported: string | undefined): SourceFormat | null {
  if (reported === "image/jpeg" || reported === "image/jpg") {
    return "image/jpeg";
  }
  if (reported === "image/png") {
    return "image/png";
  }
  return null;
}

export type CloudflareImageProcessorOptions = {
  readonly binding: CloudflareImagesBinding;
  readonly watermark: WatermarkOverlay;
};

export function createCloudflareImageProcessor(
  options: CloudflareImageProcessorOptions,
): ImageProcessor {
  const { binding, watermark } = options;
  return {
    /** See the module header for the order and why each step is where it is. */
    async prepare(request: PrepareRequest): Promise<PreparedDerivatives> {
      // 1. The platform must be able to decode the bytes, and it — not the
      //    upload — reports the geometry. A file that merely LOOKS like an image
      //    (right magic bytes, truncated body) fails here, before any write.
      let inspected: { format?: string; width: number; height: number };
      try {
        inspected = await binding.info(streamOf(request.bytes));
      } catch (error) {
        throw new ImageProcessingError(
          "not-an-image",
          `The upload could not be decoded as an image: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      const format = sourceFormatOf(inspected.format);
      if (format === null) {
        throw new ImageProcessingError(
          "unsupported-format",
          `The upload decoded as ${inspected.format ?? "an unknown format"}; use JPEG or PNG.`,
        );
      }
      const source = { width: inspected.width, height: inspected.height, format };
      if (!Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width <= 0 || source.height <= 0) {
        throw new ImageProcessingError(
          "inspection-failed",
          `The image service reported no usable dimensions (${source.width}x${source.height}).`,
        );
      }

      // 2-5. Each derivative is produced independently from the SOURCE, so the
      //      thumbnail is never a re-scaling of an already-compressed web image.
      const wantsWatermark = request.watermark.enabled && request.watermark.position !== "none";
      const web = await derive(binding, watermark, request, source, WEB_DERIVATIVE_EDGE, wantsWatermark);
      const thumbnail = await derive(
        binding,
        watermark,
        request,
        source,
        THUMBNAIL_EDGE,
        wantsWatermark,
      );

      return { source, web, thumbnail, watermarked: wantsWatermark };
    },
  };
}

/**
 * Produce one derivative.
 *
 * The requested size comes from the TRUSTED source geometry, and `scale-down` is
 * always passed as well. Two independent mechanisms therefore prevent an
 * upscale: the arithmetic here, and the platform's own fit mode.
 */
async function derive(
  binding: CloudflareImagesBinding,
  watermark: WatermarkOverlay,
  request: PrepareRequest,
  source: { readonly width: number; readonly height: number },
  maxEdge: number,
  wantsWatermark: boolean,
): Promise<PreparedDerivative> {
  const target = derivativeSize(source.width, source.height, maxEdge);
  try {
    let chain = binding.input(streamOf(request.bytes)).transform({
      width: target.width,
      height: target.height,
      // Never enlarge. The platform enforces the ceiling this application asked
      // for, so a rounding difference cannot produce an oversized derivative.
      fit: "scale-down",
    });

    const draw = wantsWatermark ? drawRequestFor(request.watermark.position, target) : null;
    if (draw) {
      chain = chain.draw(streamOf(watermark.bytes), {
        ...draw.position,
        opacity: draw.opacity,
      });
    }

    const result = await chain.output({
      format: DERIVATIVE_OUTPUT_FORMAT,
      quality: DERIVATIVE_QUALITY,
    });
    const bytes = new Uint8Array(await result.response().arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new Error("the image service returned no bytes");
    }

    // Measure what actually came back rather than trusting the request. A
    // derivative that is not the size asked for is a processing failure, not
    // something to record as if it were.
    const produced = await binding.info(streamOf(bytes));
    if (produced.width > maxEdge || produced.height > maxEdge) {
      throw new Error(
        `the image service returned ${produced.width}x${produced.height}, above the ${maxEdge}px limit`,
      );
    }

    return {
      bytes,
      width: produced.width,
      height: produced.height,
      contentType: result.contentType() || DERIVATIVE_CONTENT_TYPE,
    };
  } catch (error) {
    throw new ImageProcessingError(
      "derivative-failed",
      `A ${maxEdge}px derivative could not be produced: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
