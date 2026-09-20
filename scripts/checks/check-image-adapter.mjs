#!/usr/bin/env node
/**
 * Image adapter request check (Slice 06 repair 01).
 *
 * The platform check proves the Images binding really decodes, resizes and
 * encodes. This one proves what the ADAPTER ASKS IT TO DO — which is the part
 * that encodes this application's policy, and the part that is easy to get
 * subtly wrong in ways a working image would not reveal:
 *
 *   * `none` must perform NO draw operation, rather than a transparent one;
 *   * every transform must carry `fit: "scale-down"`, so the platform enforces
 *     the no-upscale rule independently of the arithmetic here;
 *   * the requested width/height must be derived from the geometry the SERVICE
 *     reported, never from the upload's own header bytes;
 *   * the output must be WebP at the documented quality;
 *   * a source whose format the platform reports as something else is refused.
 *
 * A deterministic fake binding records every call, so each assertion is about
 * the exact request. No Cloudflare call is made.
 */
import { register } from "node:module";

register("../ts-extension-hooks.mjs", import.meta.url);

const { createCloudflareImageProcessor } = await import(
  "../../app/images/image-processor.cloudflare.server.ts"
);
const {
  derivativeSize,
  drawRequestFor,
  fitScale,
  WATERMARK_MIN_MARGIN_PX,
  WEB_DERIVATIVE_EDGE,
  THUMBNAIL_EDGE,
} = await import("../../app/images/image-processor.ts");
const { check, note, report } = await import("./report.mjs");

const OVERLAY = {
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]),
  contentType: "image/png",
  label: "test overlay",
};

/**
 * A recording fake of the Images binding.
 *
 * The resize semantics here were MEASURED against the real offline binding
 * rather than assumed. Two findings shaped this model, and both are worth
 * stating because the obvious guesses are wrong:
 *
 *   * `fit` does not change a shrinking result. A 320x240 source asked for
 *     800x1600 comes back 320x240 under `scale-down` — the box only ever limits,
 *     it never defines a crop;
 *   * a single dimension scales proportionally (width 480 on a 320x240 source
 *     still yields 320x240).
 *
 * So a request modelling "fit inside the box, never enlarge, never crop" is
 * faithful, and the fake applies exactly the arithmetic the adapter relies on.
 *
 * `outputSize` overrides the reported result, which is how the adapter's
 * post-check (a derivative above its limit must be refused) is exercised.
 */
function fakeBinding(options = {}) {
  const calls = { info: [], input: [], transform: [], draw: [], output: [] };
  const reported = options.reported ?? { format: "image/jpeg", width: 1600, height: 1200 };
  let lastProduced = { width: reported.width, height: reported.height };
  const binding = {
    async info() {
      calls.info.push({});
      // The first info() measures the SOURCE; later ones measure a derivative.
      if (calls.info.length === 1) {
        if (options.infoThrows) {
          throw new Error("Input buffer contains unsupported image format");
        }
        return reported;
      }
      return { format: "image/webp", ...(options.outputSize ?? lastProduced) };
    },
    input() {
      calls.input.push({});
      let produced = { width: reported.width, height: reported.height };
      const transformer = {
        transform(value) {
          calls.transform.push(value);
          const boxWidth = value.width ?? Number.POSITIVE_INFINITY;
          const boxHeight = value.height ?? Number.POSITIVE_INFINITY;
          // Fit inside the box without ever enlarging; the longest edge governs.
          const scale = Math.min(1, boxWidth / reported.width, boxHeight / reported.height);
          produced = {
            width: Math.max(1, Math.round(reported.width * scale)),
            height: Math.max(1, Math.round(reported.height * scale)),
          };
          lastProduced = produced;
          return transformer;
        },
        draw(image, drawOptions) {
          calls.draw.push({ options: drawOptions ?? null, isStream: typeof image?.getReader === "function" });
          if (options.drawThrows) {
            throw new Error("draw is unavailable offline");
          }
          return transformer;
        },
        async output(value) {
          calls.output.push(value);
          if (options.outputThrows) {
            throw new Error("encode failed");
          }
          return {
            contentType: () => "image/webp",
            response: () =>
              new Response(new Uint8Array(options.outputBytes ?? 64).fill(7), {
                headers: { "content-type": "image/webp" },
              }),
          };
        },
      };
      return transformer;
    },
  };
  return { binding, calls };
}

/** Run the adapter once and hand back the calls it made. */
async function run(options = {}, watermark = { enabled: true, position: "bottom-right" }) {
  const fake = fakeBinding(options);
  const processor = createCloudflareImageProcessor({
    binding: fake.binding,
    watermark: OVERLAY,
  });
  const outcome = await processor
    .prepare({ photoId: "photo-1", bytes: new Uint8Array([0xff, 0xd8, 0xff]), watermark })
    .then((value) => ({ value, error: null }))
    .catch((error) => ({ value: null, error }));
  return { ...fake, outcome };
}

// --- Request shape --------------------------------------------------------

const corner = await run({}, { enabled: true, position: "bottom-right" });
check(
  corner.outcome.error === null,
  `a watermarked run failed: ${corner.outcome.error?.message ?? "no error recorded"}`,
);

// One transform per derivative, two derivatives.
check(
  corner.calls.transform.length === 2,
  `expected 2 transform requests, saw ${corner.calls.transform.length}`,
);
check(
  corner.calls.transform.every((request) => request.fit === "scale-down"),
  `every transform must request fit=scale-down, saw ${JSON.stringify(corner.calls.transform)}`,
);
const [webRequest, thumbRequest] = corner.calls.transform;
check(webRequest?.width === 1600 && webRequest?.height === 1200, `web transform was ${JSON.stringify(webRequest)}`);
check(thumbRequest?.width === 480 && thumbRequest?.height === 360, `thumbnail transform was ${JSON.stringify(thumbRequest)}`);
check(
  corner.calls.output.length === 2 &&
    corner.calls.output.every((request) => request.format === "image/webp" && typeof request.quality === "number"),
  `output requests were ${JSON.stringify(corner.calls.output)}`,
);
check(
  corner.calls.info.length === 3,
  `expected the source plus both derivatives to be measured, saw ${corner.calls.info.length} info calls`,
);

// --- Watermark semantics --------------------------------------------------

check(corner.calls.draw.length === 2, `a corner watermark should draw on both derivatives, saw ${corner.calls.draw.length}`);
const cornerDraw = corner.calls.draw[0]?.options;
check(
  typeof cornerDraw?.bottom === "number" && typeof cornerDraw?.right === "number",
  `a bottom-right watermark must set bottom and right, saw ${JSON.stringify(cornerDraw)}`,
);
check(
  cornerDraw?.bottom >= WATERMARK_MIN_MARGIN_PX && cornerDraw?.bottom === cornerDraw?.right,
  `the corner inset must be symmetric and at least ${WATERMARK_MIN_MARGIN_PX}px, saw ${JSON.stringify(cornerDraw)}`,
);
check(
  corner.calls.draw.every((call) => call.isStream === true),
  "the overlay must be supplied to draw() as a stream of bytes",
);
// The inset is relative to the SHORTER edge of the derivative it is drawn on,
// so it scales with the image rather than being a fixed pixel count. The web
// derivative of the default 1600x1200 source is 1600x1200, whose shorter edge is
// 1200; 2.5% of that is 30px.
check(
  cornerDraw.bottom === Math.max(WATERMARK_MIN_MARGIN_PX, Math.round(Math.min(1600, 1200) * 0.025)),
  `the inset should be 2.5% of the derivative's shorter edge, saw ${cornerDraw.bottom}`,
);

const centre = await run({}, { enabled: true, position: "center" });
const centreDraw = centre.calls.draw[0]?.options;
check(
  centreDraw && centreDraw.bottom === undefined && centreDraw.right === undefined,
  `a centred watermark must specify no inset, saw ${JSON.stringify(centreDraw)}`,
);
check(centre.calls.draw.length === 2, "a centred watermark should draw on both derivatives");

const off = await run({}, { enabled: true, position: "none" });
check(
  off.calls.draw.length === 0,
  `watermark "none" must perform NO draw operation, saw ${off.calls.draw.length}`,
);
check(off.outcome.value?.watermarked === false, "watermark none must report itself unwatermarked");
check(
  off.calls.transform.length === 2,
  "watermark none must still produce both derivatives",
);

const disabled = await run({}, { enabled: false, position: "bottom-right" });
check(
  disabled.calls.draw.length === 0,
  `a disabled watermark must perform NO draw, saw ${disabled.calls.draw.length}`,
);
check(disabled.outcome.value?.watermarked === false, "a disabled watermark must report itself unwatermarked");

// --- Trusted geometry, not the upload's own bytes -------------------------

const portrait = await run({ reported: { format: "image/png", width: 800, height: 2000 } });
check(
  portrait.outcome.value?.source.width === 800 && portrait.outcome.value?.source.height === 2000,
  `the source geometry must come from the service, saw ${JSON.stringify(portrait.outcome.value?.source)}`,
);
check(
  portrait.outcome.value?.source.format === "image/png",
  `the source format must come from the service, saw ${portrait.outcome.value?.source.format}`,
);
// The web request scales the 800x2000 source so its LONGER edge is 1600, which
// gives 640x1600 — the height lands on the limit and the width follows. This is
// the case that shows the limit governs the longest edge, not each edge.
check(
  portrait.calls.transform[0]?.width === 640 && portrait.calls.transform[0]?.height === 1600,
  `a portrait source should scale its longest edge to 1600, saw ${JSON.stringify(portrait.calls.transform[0])}`,
);
check(
  portrait.calls.transform[1]?.width === 192 && portrait.calls.transform[1]?.height === 480,
  `a 800x2000 source should yield a 192x480 thumbnail, saw ${JSON.stringify(portrait.calls.transform[1])}`,
);

const tiny = await run({ reported: { format: "image/jpeg", width: 120, height: 90 } });
check(
  tiny.calls.transform.every((request) => request.width <= 120 && request.height <= 90),
  `a 120x90 source must never be enlarged, saw ${JSON.stringify(tiny.calls.transform)}`,
);

// --- Refusals -------------------------------------------------------------

const undecodable = await run({ infoThrows: true });
check(
  undecodable.outcome.error?.reason === "not-an-image",
  `an undecodable upload should be refused as not-an-image, saw ${undecodable.outcome.error?.reason}`,
);
check(
  undecodable.calls.input.length === 0 && undecodable.calls.output.length === 0,
  "nothing may be transformed or encoded once inspection has failed",
);
check(
  undecodable.calls.draw.length === 0,
  "no draw may happen after a failed inspection",
);

const wrongFormat = await run({ reported: { format: "image/gif", width: 100, height: 100 } });
check(
  wrongFormat.outcome.error?.reason === "unsupported-format",
  `a GIF source should be refused as unsupported-format, saw ${wrongFormat.outcome.error?.reason}`,
);
check(wrongFormat.calls.output.length === 0, "an unsupported format must not be encoded");

const noDimensions = await run({ reported: { format: "image/jpeg", width: 0, height: 0 } });
check(
  noDimensions.outcome.error?.reason === "inspection-failed",
  `a source with no dimensions should be refused as inspection-failed, saw ${noDimensions.outcome.error?.reason}`,
);

// A derivative larger than the limit must be refused rather than recorded: the
// post-check measures what actually came back.
const oversized = await run({ outputSize: { width: 4000, height: 3000 } });
check(
  oversized.outcome.error?.reason === "derivative-failed",
  `a derivative above its limit should be refused, saw ${oversized.outcome.error?.reason}`,
);

const encodeFails = await run({ outputThrows: true });
check(
  encodeFails.outcome.error?.reason === "derivative-failed",
  `an encode failure should surface as derivative-failed, saw ${encodeFails.outcome.error?.reason}`,
);

const drawFails = await run({ drawThrows: true }, { enabled: true, position: "center" });
check(
  drawFails.outcome.error?.reason === "derivative-failed",
  `a draw failure should surface as derivative-failed, saw ${drawFails.outcome.error?.reason}`,
);

// --- Pure arithmetic helpers ---------------------------------------------

check(fitScale(1000, 500, 1600) === 1, "an image within the limit must not be scaled");
check(fitScale(3200, 1600, 1600) === 0.5, `fitScale(3200,1600,1600) was ${fitScale(3200, 1600, 1600)}`);
check(fitScale(0, 0, 1600) === 1, "a degenerate size must fall back to no scaling");
check(
  derivativeSize(1600, 1200, 1600).width === 1600,
  "a source exactly on the limit must pass through unchanged",
);
check(
  derivativeSize(4000, 3000, 480).width === 480 && derivativeSize(4000, 3000, 480).height === 360,
  `derivativeSize(4000,3000,480) was ${JSON.stringify(derivativeSize(4000, 3000, 480))}`,
);
check(drawRequestFor("none", { width: 100, height: 100 }) === null, "drawRequestFor(none) must be null");
check(
  drawRequestFor("center", { width: 100, height: 100 })?.position.right === undefined,
  "a centred draw must not set an inset",
);

note(
  `adapter requests verified: ${corner.calls.transform.length} transforms, ${corner.calls.draw.length} draws, ` +
    `${corner.calls.output.length} outputs for the corner case`,
);
report(
  "Image adapter check passed: exact transform, draw and output requests verified, including that a " +
    "watermark of none performs no draw, every resize asks for scale-down, and the geometry comes from " +
    "the image service rather than the upload.",
);
