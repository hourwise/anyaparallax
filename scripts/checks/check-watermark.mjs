import { register, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
register("../ts-extension-hooks.mjs", import.meta.url);
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("wrangler/package.json"))("sharp");
const { finalWatermarkOverlay } = await import("../../app/images/watermark-asset.ts");
const { DEFAULT_WATERMARK_POSITION, drawRequestFor } = await import("../../app/images/image-processor.ts");
const { check, report } = await import("./report.mjs");
const first = finalWatermarkOverlay(), second = finalWatermarkOverlay();
const bytes = Buffer.from(first.bytes);
check(first.contentType === "image/png", "watermark content type must be image/png");
check(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "watermark must have PNG signature");
check(bytes.equals(Buffer.from(second.bytes)), "watermark must return deterministic bytes");
check(bytes.equals(readFileSync(new URL("../../app/images/anyaparallax-watermark.png", import.meta.url))), "embedded bytes must equal the committed PNG");
check(createHash("sha256").update(bytes).digest("hex") === "f866b1a7509a261d5b25b4e0018e55537b654449744f0538c6b0911de56ba711", "approved production artwork hash changed");
check(first.label === "final anyaparallax watermark" && !/development|placeholder/i.test(first.label), "label must identify final artwork");
const metadata = await sharp(bytes).metadata();
check(metadata.format === "png" && metadata.hasAlpha && metadata.channels === 4, "watermark must decode as RGBA PNG");
check(metadata.width === 267 && metadata.height === 89, "watermark must retain its approved 3:1 canvas at restrained dimensions");
const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
let transparent = 0, ink = 0, partial = 0;
for (let i = 3; i < data.length; i += 4) {
  if (data[i] === 0) transparent++;
  else { ink++; if (data[i] < 255) partial++; }
}
check(transparent > info.width * info.height / 2, "watermark must have mostly transparent background, without an opaque box");
check(ink > 100 && partial > 100, "watermark must contain visible antialiased artwork");
const edgeAlpha = [];
for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
  if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) {
    edgeAlpha.push(data[(y * info.width + x) * 4 + 3]);
  }
}
check(edgeAlpha.every((alpha) => alpha === 0), "artwork must have a transparent border without clipped lettering");
const source = await sharp(readFileSync(new URL("../../DOCS/White Cooper-Style Anyaparallax Wordmark.png", import.meta.url)))
  .resize({ width: 267 }).raw().toBuffer();
check(source.equals(data), "production pixels must exactly match proportional resampling of supplied artwork, with no crop/recolour");
check(DEFAULT_WATERMARK_POSITION === "bottom-right", "default watermark placement must remain bottom-right");
check(drawRequestFor(DEFAULT_WATERMARK_POSITION, { width: 1600, height: 1200 }).opacity === 0.75, "accepted draw opacity must remain 0.75");
report("Final watermark check passed: approved PNG, deterministic bytes, dimensions, alpha, artwork fidelity and defaults verified.");
