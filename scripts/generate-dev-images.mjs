#!/usr/bin/env node
/**
 * Generates the development-only placeholder imagery used by the Slice 02
 * homepage: abstract, dark, atmospheric SVG stand-ins with a fixed intrinsic
 * aspect ratio per slot.
 *
 * These assets are NOT photographs and never pretend to be final content: every
 * placement is labelled as a provisional development image in the UI. Real
 * photography arrives through the upload pipeline in Slice 06 and replaces the
 * files referenced by `app/data/home.ts`.
 *
 * The output is deterministic — rerunning the script produces identical files.
 *
 * Usage:
 *   node scripts/generate-dev-images.mjs          # write assets
 *   node scripts/generate-dev-images.mjs --check  # verify assets exist without writing
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "images", "dev");
const checkOnly = process.argv.includes("--check");

/** Each slot keeps a stable ratio so real photographs can replace it cleanly. */
const photos = [
  {
    name: "hero-night-boulevard",
    width: 1600,
    height: 1067,
    theme: "urban",
    base: "#0b0e13",
    glow: "#e0543c",
    accents: ["#6fb6ff", "#f2a03d", "#e0543c"],
    blur: 80,
  },
  {
    name: "night-boulevard",
    width: 1080,
    height: 720,
    theme: "urban",
    base: "#0c1015",
    glow: "#ff5a3c",
    accents: ["#5fb0ff", "#ffb347", "#ff5a3c"],
    blur: 60,
  },
  {
    name: "stage-figure",
    width: 1080,
    height: 1350,
    theme: "stage",
    base: "#120c18",
    glow: "#b44cff",
    accents: ["#ff4d9d", "#7d5cff", "#ffb347"],
    blur: 70,
  },
  {
    name: "neon-alley",
    width: 1080,
    height: 1350,
    theme: "urban",
    base: "#140a0c",
    glow: "#ff2d4a",
    accents: ["#ff2d4a", "#ff8a3d", "#ff4d9d"],
    blur: 64,
  },
  {
    name: "night-traffic",
    width: 1080,
    height: 720,
    theme: "urban",
    base: "#0e0c12",
    glow: "#ff9a3d",
    accents: ["#ffcc66", "#ff7043", "#ff9a3d"],
    blur: 56,
  },
  {
    name: "blue-hour",
    width: 1080,
    height: 608,
    theme: "mono",
    base: "#0a0c10",
    glow: "#9fb6cc",
    accents: ["#c9d6e2", "#8fa6bd", "#5f7a94"],
    blur: 72,
  },
  {
    name: "street-portrait",
    width: 1080,
    height: 1350,
    theme: "portrait",
    base: "#100e12",
    glow: "#ffb37a",
    accents: ["#ffb37a", "#e0543c", "#8fa6bd"],
    blur: 68,
  },
  {
    name: "rain-street",
    width: 1080,
    height: 810,
    theme: "mono",
    base: "#0d0f12",
    glow: "#aebfd2",
    accents: ["#e6edf3", "#9fb0c2", "#6c7f93"],
    blur: 60,
  },
  {
    name: "red-glow",
    width: 1080,
    height: 810,
    theme: "urban",
    base: "#120b0d",
    glow: "#ff3d5a",
    accents: ["#ff3d5a", "#ff8a5c", "#ffd08a"],
    blur: 70,
  },
  {
    name: "tunnel-evening",
    width: 1080,
    height: 1350,
    theme: "urban",
    base: "#0a0d12",
    glow: "#7fd0ff",
    accents: ["#7fd0ff", "#b9e2ff", "#ffb347"],
    blur: 76,
  },
  {
    name: "amber-traffic",
    width: 1080,
    height: 720,
    theme: "urban",
    base: "#0f0c0a",
    glow: "#ffb347",
    accents: ["#ffb347", "#ff7043", "#ffe0a3"],
    blur: 58,
  },
  {
    name: "crowd-lights",
    width: 1080,
    height: 1350,
    theme: "stage",
    base: "#0e0a14",
    glow: "#ff4d6d",
    accents: ["#ff4d6d", "#7d5cff", "#ffd08a"],
    blur: 72,
  },
  {
    name: "mono-figures",
    width: 1080,
    height: 720,
    theme: "mono",
    base: "#0b0c0e",
    glow: "#c9d6e2",
    accents: ["#e6edf3", "#9fb0c2", "#5f7a94"],
    blur: 64,
  },
];

/**
 * Builds one deterministic SVG. The composition is intentionally abstract:
 * a dark base, a broad coloured glow, a few soft light pools and grain.
 */
function buildSvg(photo) {
  const { width: w, height: h, theme } = photo;
  const min = Math.min(w, h);
  const blur = Math.max(24, Math.round((photo.blur * min) / 900));
  const grain = Math.max(48, Math.round(min / 12));
  const glyph = (photo.name.match(/[a-z]/g) ?? []).length;

  const first = heroLayout(photo, glyph);
  const second = poolLayout(photo, glyph);

  const silhouette =
    theme === "stage" || theme === "portrait"
      ? `<path d="M ${Math.round(w * (theme === "stage" ? 0.34 : 0.38))} ${h}
           L ${Math.round(w * (theme === "stage" ? 0.4 : 0.43))} ${Math.round(h * 0.52)}
           Q ${Math.round(w * 0.5)} ${Math.round(h * 0.44)} ${Math.round(w * (theme === "stage" ? 0.6 : 0.57))} ${Math.round(h * 0.52)}
           L ${Math.round(w * (theme === "stage" ? 0.66 : 0.62))} ${h} Z"
           fill="#03040580"/>`
      : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-hidden="true">
  <defs>
    <linearGradient id="b" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${photo.base}"/>
      <stop offset="0.55" stop-color="#05060a"/>
      <stop offset="1" stop-color="#010102"/>
    </linearGradient>
    <radialGradient id="g" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${photo.glow}" stop-opacity="0.55"/>
      <stop offset="0.55" stop-color="${photo.glow}" stop-opacity="0.14"/>
      <stop offset="1" stop-color="${photo.glow}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="s" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffffff" stop-opacity="${theme === "mono" ? 0.26 : 0.2}"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="v" cx="0.5" cy="0.45" r="0.75">
      <stop offset="0.4" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.55"/>
    </radialGradient>
    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="${blur}"/>
    </filter>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="${glyph % 7}" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#b)"/>
  ${first}
  <g filter="url(#blur)">
    ${second}
  </g>
  ${silhouette}
  <rect width="${w}" height="${h}" fill="url(#v)"/>
  <rect width="${w}" height="${h}" filter="url(#grain)" opacity="0.07" style="mix-blend-mode:overlay"/>
</svg>
`;
}

/** A broad light source placed relative to the slot's theme. */
function heroLayout(photo, glyph) {
  const { width: w, height: h, theme } = photo;
  const cx = theme === "mono" ? 0.62 : 0.56 + ((glyph % 4) - 2) * 0.04;
  const cy = theme === "stage" ? 0.3 : 0.42;
  const radius = Math.round((Math.min(w, h) * (theme === "stage" ? 1.05 : 0.95)) / 2);
  return `<ellipse cx="${Math.round(w * cx)}" cy="${Math.round(h * cy)}" rx="${radius}" ry="${radius}" fill="url(#g)" filter="url(#blur)"/>`;
}

/** A small cluster of soft light pools (bokeh-ish). */
function poolLayout(photo, glyph) {
  const { width: w, height: h, accents } = photo;
  const pools = [];
  const count = 6;
  for (let i = 0; i < count; i += 1) {
    const seed = (glyph + i * 7) % 11;
    const cx = Math.round(w * (0.16 + ((seed * 0.09 + i * 0.13) % 0.72)));
    const cy = Math.round(h * (0.2 + ((seed * 0.13 + i * 0.17) % 0.62)));
    const r = Math.round(Math.min(w, h) * (0.03 + ((seed % 5) * 0.012)));
    const fill = accents[i % accents.length];
    const opacity = (0.12 + ((seed % 4) * 0.05)).toFixed(2);
    pools.push(
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="${opacity}"/>`,
    );
  }
  const lightR = Math.round(Math.min(w, h) * 0.16);
  return pools.join("\n    ") +
    `\n    <ellipse cx="${Math.round(w * 0.3)}" cy="${Math.round(h * 0.66)}" rx="${lightR}" ry="${Math.round(lightR * 0.55)}" fill="url(#s)"/>`;
}

if (checkOnly) {
  const missing = photos.filter(
    (photo) => !existsSync(join(outDir, `${photo.name}.svg`)),
  );
  if (missing.length > 0) {
    console.error(
      `Missing development placeholder assets: ${missing.map((m) => m.name).join(", ")}`,
    );
    process.exitCode = 1;
  } else {
    console.log(`Development placeholder check passed: ${photos.length} assets present.`);
  }
} else {
  mkdirSync(outDir, { recursive: true });
  for (const photo of photos) {
    writeFileSync(join(outDir, `${photo.name}.svg`), buildSvg(photo), "utf8");
  }
  console.log(`Wrote ${photos.length} development placeholder assets to public/images/dev.`);
}
