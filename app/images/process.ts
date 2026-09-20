/**
 * Upload processing pipeline (Slice 06).
 *
 * One function turns accepted upload bytes into the three objects a photograph
 * owns, in a fixed order that is the whole security story of this slice:
 *
 *   1. VALIDATE   — size, declared type, magic bytes, filename, then the frame
 *                   geometry read from the header. Refusals happen here, before
 *                   anything is decoded or stored.
 *   2. PRESERVE   — the uploaded bytes are written to the PRIVATE masters bucket
 *                   EXACTLY as received. No re-encode, no strip, no watermark,
 *                   ever: this object is the archival/print master.
 *   3. DERIVE     — the master bytes are decoded and turned into a public web
 *                   image and a public gallery thumbnail, scaled to fit and
 *                   watermarked if requested. Only these objects are public.
 *
 * Storage keys are derived from the photo id, never from operator input, so a
 * hostile filename cannot influence where anything lands. The operator's
 * filename is kept only as the final key segment for legibility.
 *
 * Pure except for the two bucket writes it is handed: no cloud APIs are called
 * directly, so the same code path runs in a Worker, in `pnpm dev`, and under the
 * checks with an in-memory bucket.
 */
import {
  decodeImage,
  encodeJpeg,
  encodePng,
  readImageHeader,
  type ImageFormat,
} from "./codecs";
import { applyWatermark, developmentWatermark, type WatermarkPosition } from "./watermark";
import {
  assertUsableDimensions,
  MAX_UPLOAD_PIXELS,
  UploadError,
  validateUpload,
} from "./upload-validation";
import { masterKey, thumbnailKey, webKey } from "../data/storage";

/** Longest edge of the public web derivative, in pixels. */
export const WEB_DERIVATIVE_EDGE = 1600;

/** Longest edge of the public gallery thumbnail, in pixels. */
export const THUMBNAIL_EDGE = 480;

/**
 * JPEG quality for both derivatives.
 *
 * Chosen deliberately high: the brief asks for strong visual quality and warns
 * against destructive compression, and these images are the portfolio itself.
 * The bandwidth saving comes from the dimension reduction, not from starving
 * the encoder.
 */
export const DERIVATIVE_JPEG_QUALITY = 86;

/** An RGBA raster in memory. */
export type Raster = {
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
};

/** The bucket surface this pipeline needs — the private bucket and the public one. */
export type UploadStorage = {
  putMaster(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  putPublicImage(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
};

/** A processed upload: what to record on the photograph row, and nothing private. */
export type ProcessedUpload = {
  readonly originalStorageKey: string;
  readonly webStorageKey: string;
  readonly thumbnailStorageKey: string;
  /** Dimensions of the ORIGINAL, recorded as the photograph's real geometry. */
  readonly width: number;
  readonly height: number;
  /** Dimensions of the public web derivative. */
  readonly webWidth: number;
  readonly webHeight: number;
  readonly medium: "image/jpeg" | "image/png";
  /** True when the derivative carries the watermark. */
  readonly watermarked: boolean;
  readonly bytes: {
    readonly master: number;
    readonly web: number;
    readonly thumbnail: number;
  };
};

export type ProcessUploadInput = {
  readonly photoId: string;
  readonly bytes: Uint8Array;
  readonly declaredType?: unknown;
  readonly filename?: unknown;
  readonly watermarkEnabled: boolean;
  readonly watermarkPosition: WatermarkPosition;
  /** Buckets to write to. */
  readonly storage: UploadStorage;
};

/**
 * Scale an RGBA raster so its longest edge is at most `maxEdge`, preserving
 * aspect ratio. Never enlarges: a small original keeps its own size.
 *
 * Uses a box filter (each destination pixel averages the source rectangle it
 * covers), which is the right choice for downscaling: it samples every source
 * pixel, so detail is averaged rather than skipped, and it cannot alias the way
 * nearest-neighbour or a bare bilinear tap can.
 */
export function resizeToFit(image: Raster, maxEdge: number): Raster {
  if (!Number.isInteger(maxEdge) || maxEdge <= 0) {
    throw new Error(`resizeToFit requires a positive integer edge, received ${maxEdge}`);
  }
  const { pixels, width, height } = image;
  if (pixels.length !== width * height * 4) {
    throw new Error(
      `resizeToFit received ${pixels.length} bytes for a ${width}x${height} image`,
    );
  }
  const longest = Math.max(width, height);
  if (longest <= maxEdge) {
    // Already small enough: return the same raster rather than a lossy copy.
    return image;
  }

  // Round rather than floor so the longest edge lands exactly on maxEdge where
  // the aspect ratio allows, and never exceeds it.
  const scale = maxEdge / longest;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const target = new Uint8ClampedArray(targetWidth * targetHeight * 4);

  for (let y = 0; y < targetHeight; y += 1) {
    // Source rows covered by this destination row.
    const sourceTop = (y * height) / targetHeight;
    const sourceBottom = ((y + 1) * height) / targetHeight;
    const rowStart = Math.floor(sourceTop);
    const rowEnd = Math.min(height, Math.max(rowStart + 1, Math.ceil(sourceBottom)));

    for (let x = 0; x < targetWidth; x += 1) {
      const sourceLeft = (x * width) / targetWidth;
      const sourceRight = ((x + 1) * width) / targetWidth;
      const columnStart = Math.floor(sourceLeft);
      const columnEnd = Math.min(width, Math.max(columnStart + 1, Math.ceil(sourceRight)));

      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let samples = 0;

      for (let sourceY = rowStart; sourceY < rowEnd; sourceY += 1) {
        let index = (sourceY * width + columnStart) * 4;
        for (let sourceX = columnStart; sourceX < columnEnd; sourceX += 1) {
          red += pixels[index] ?? 0;
          green += pixels[index + 1] ?? 0;
          blue += pixels[index + 2] ?? 0;
          alpha += pixels[index + 3] ?? 0;
          samples += 1;
          index += 4;
        }
      }

      const targetIndex = (y * targetWidth + x) * 4;
      target[targetIndex] = Math.round(red / samples);
      target[targetIndex + 1] = Math.round(green / samples);
      target[targetIndex + 2] = Math.round(blue / samples);
      target[targetIndex + 3] = Math.round(alpha / samples);
    }
  }

  return { pixels: target, width: targetWidth, height: targetHeight };
}

/** True when any pixel is not fully opaque, so the image needs an alpha format. */
export function hasTransparency(image: Raster): boolean {
  const { pixels } = image;
  for (let index = 3; index < pixels.length; index += 4) {
    if ((pixels[index] ?? 255) !== 255) {
      return true;
    }
  }
  return false;
}

/**
 * Encode a derivative.
 *
 * JPEG for photographs, because that is what the format is for and it keeps the
 * derivative small; PNG only when the pixels actually carry transparency, which
 * JPEG cannot represent. Choosing per image rather than per upload means a
 * transparent PNG logo does not silently acquire a black background.
 */
export async function encodeDerivative(image: Raster): Promise<{
  readonly bytes: Uint8Array;
  readonly medium: "image/jpeg" | "image/png";
}> {
  if (hasTransparency(image)) {
    return { bytes: await encodePng(image), medium: "image/png" };
  }
  return { bytes: encodeJpeg(image, DERIVATIVE_JPEG_QUALITY), medium: "image/jpeg" };
}

/**
 * Process one accepted upload end to end.
 *
 * The master is written BEFORE any decoding happens, so the archival object is
 * preserved even if derivative generation later fails — the operator can retry
 * generation without re-uploading, and the original is never at risk from a
 * decoder bug.
 */
export async function processUpload(input: ProcessUploadInput): Promise<ProcessedUpload> {
  const { type, filename } = validateUpload({
    bytes: input.bytes,
    declaredType: input.declaredType,
    filename: input.filename,
  });

  const header = readImageHeader(input.bytes);
  if (header === null) {
    // The magic bytes matched but the frame header did not parse: the file is
    // truncated or corrupt. Refused before the master is written, so a file
    // that cannot ever produce a derivative does not enter the archive.
    throw new UploadError(
      "unsupported-image",
      "The image header could not be read; the file looks truncated or corrupt.",
    );
  }
  assertUsableDimensions({ width: header.width, height: header.height });

  // 1. Preserve the original, byte for byte, in the private bucket.
  const originalStorageKey = masterKey(input.photoId, filename);
  await input.storage.putMaster(originalStorageKey, input.bytes, type);

  // 2. Decode the SAME bytes that were just preserved. PNG decoding goes through
  //    `DecompressionStream`, so decoding is asynchronous for both formats — the
  //    codec keeps one shape rather than two.
  const decoded = await decodeImage(input.bytes, header.format as ImageFormat, {
    maxPixels: MAX_UPLOAD_PIXELS,
  });

  // 3. Web derivative, then thumbnail, both from the decoded original so the
  //    thumbnail is not a re-scaling of an already-lossy derivative.
  const webRaster = resizeToFit(
    { pixels: decoded.pixels, width: decoded.width, height: decoded.height },
    WEB_DERIVATIVE_EDGE,
  );
  const thumbnailRaster = resizeToFit(
    { pixels: decoded.pixels, width: decoded.width, height: decoded.height },
    THUMBNAIL_EDGE,
  );

  const watermarked = input.watermarkEnabled && input.watermarkPosition !== "none";
  if (watermarked) {
    // The SAME asset instance for both derivatives, so the mark is identical.
    const asset = developmentWatermark();
    applyWatermark(webRaster, asset, input.watermarkPosition);
    applyWatermark(thumbnailRaster, asset, input.watermarkPosition);
  }

  const web = await encodeDerivative(webRaster);
  const thumbnail = await encodeDerivative(thumbnailRaster);

  const webStorageKey = webKey(input.photoId, `web.${extensionOf(web.medium)}`);
  const thumbnailStorageKey = thumbnailKey(
    input.photoId,
    `thumb.${extensionOf(thumbnail.medium)}`,
  );
  await input.storage.putPublicImage(webStorageKey, web.bytes, web.medium);
  await input.storage.putPublicImage(thumbnailStorageKey, thumbnail.bytes, thumbnail.medium);

  return {
    originalStorageKey,
    webStorageKey,
    thumbnailStorageKey,
    width: header.width,
    height: header.height,
    webWidth: webRaster.width,
    webHeight: webRaster.height,
    medium: web.medium,
    watermarked,
    bytes: {
      master: input.bytes.byteLength,
      web: web.bytes.byteLength,
      thumbnail: thumbnail.bytes.byteLength,
    },
  };
}

/** Public filename extension for a media type this application produces. */
export function extensionOf(medium: "image/jpeg" | "image/png"): string {
  return medium === "image/png" ? "png" : "jpg";
}
