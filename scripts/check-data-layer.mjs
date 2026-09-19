#!/usr/bin/env node
/**
 * Data-layer invariant check for the Slice 03 portfolio model.
 *
 * Verifies the seed integrity, slug stability and — most importantly — that the
 * public query boundary never exposes unpublished galleries or photographs.
 * Runs with Node's native TypeScript stripping, so it needs no extra test
 * framework. Slice 04 keeps this script valid when the source becomes D1.
 */
import {
  galleryCover,
  getPhotoDetail,
  getPublishedGallery,
  getPublishedPhoto,
  listFeaturedWithGallery,
  listPublishedGalleries,
  listPublishedPhotos,
  listPublishedTags,
  listRecentWithGallery,
  publishedPhotoCounts,
} from "../app/data/queries.ts";
import { seed } from "../app/data/seed.ts";

const failures = [];
const notes = [];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// --- Seed integrity ------------------------------------------------------

const galleryIds = new Set();
for (const gallery of seed.galleries) {
  check(!galleryIds.has(gallery.id), `duplicate gallery id ${gallery.id}`);
  galleryIds.add(gallery.id);
  check(slugPattern.test(gallery.slug), `gallery slug not canonical: ${gallery.slug}`);
  check(gallery.name.length > 0, `gallery ${gallery.id} has no name`);
}

const photoIds = new Set();
const photoSlugs = new Set();
for (const photo of seed.photos) {
  check(!photoIds.has(photo.id), `duplicate photo id ${photo.id}`);
  photoIds.add(photo.id);
  check(!photoSlugs.has(photo.slug), `duplicate photo slug ${photo.slug}`);
  photoSlugs.add(photo.slug);
  check(slugPattern.test(photo.slug), `photo slug not canonical: ${photo.slug}`);
  check(galleryIds.has(photo.galleryId), `photo ${photo.id} references unknown gallery`);
  check(photo.width > 0 && photo.height > 0, `photo ${photo.id} has invalid dimensions`);
  for (const tagId of photo.tags) {
    check(
      seed.tags.some((tag) => tag.id === tagId),
      `photo ${photo.id} references unknown tag ${tagId}`,
    );
  }
  check(
    photo.published || photo.publishedAt === null,
    `unpublished photo ${photo.id} must not carry publishedAt`,
  );
}

const tagIds = new Set();
for (const tag of seed.tags) {
  check(!tagIds.has(tag.id), `duplicate tag id ${tag.id}`);
  tagIds.add(tag.id);
  check(slugPattern.test(tag.slug), `tag slug not canonical: ${tag.slug}`);
}

for (const gallery of seed.galleries) {
  if (gallery.coverPhotoId === null) {
    continue;
  }
  const cover = seed.photos.find((photo) => photo.id === gallery.coverPhotoId);
  check(Boolean(cover), `gallery ${gallery.id} cover photo does not exist`);
  if (cover) {
    check(
      cover.galleryId === gallery.id,
      `gallery ${gallery.id} cover belongs to gallery ${cover.galleryId}`,
    );
    check(cover.published, `gallery ${gallery.id} cover photo is unpublished`);
  }
}

// A published gallery with published photographs must expose a resolvable cover.
for (const gallery of seed.galleries.filter((candidate) => candidate.published)) {
  const members = seed.photos.filter(
    (photo) => photo.published && photo.galleryId === gallery.id,
  );
  if (members.length > 0) {
    check(
      galleryCover(gallery) !== null,
      `published gallery ${gallery.slug} has members but no resolvable cover`,
    );
  }
}

// --- Visibility contract -------------------------------------------------

const published = listPublishedPhotos();
const publishedIds = new Set(published.map((photo) => photo.id));
check(published.length > 0, "no published photographs in the seed");

for (const photo of seed.photos) {
  if (!photo.published) {
    check(
      !publishedIds.has(photo.id),
      `unpublished photo ${photo.id} appears in published listings`,
    );
    check(
      getPublishedPhoto(photo.slug) === null,
      `unpublished photo ${photo.slug} resolves through getPublishedPhoto`,
    );
    check(
      getPhotoDetail(photo.slug) === null,
      `unpublished photo ${photo.slug} resolves through getPhotoDetail`,
    );
  }
}

const publishedGalleries = listPublishedGalleries();
const gallerySlugs = new Set(
  seed.galleries.map((gallery) => gallery.slug),
);
check(
  publishedGalleries.length === seed.galleries.filter((gallery) => gallery.published).length,
  "published gallery count does not match seed flags",
);

for (const gallery of seed.galleries) {
  const visible = getPublishedGallery(gallery.slug);
  if (gallery.published) {
    check(Boolean(visible), `published gallery ${gallery.slug} does not resolve`);
    if (visible) {
      for (const photo of visible.photos) {
        check(photo.published, `gallery ${gallery.slug} exposes unpublished photo ${photo.id}`);
        check(
          photo.galleryId === gallery.id,
          `gallery ${gallery.slug} exposes photo ${photo.id} from another gallery`,
        );
      }
    }
  } else {
    check(visible === null, `unpublished gallery ${gallery.slug} resolves publicly`);
  }
  check(gallerySlugs.has(gallery.slug), `gallery slug ${gallery.slug} is not unique`);
}

const counts = publishedPhotoCounts();
for (const gallery of publishedGalleries) {
  const expected = seed.photos.filter(
    (photo) => photo.published && photo.galleryId === gallery.id,
  ).length;
  const actual = counts.get(gallery.id) ?? 0;
  check(actual === expected, `count mismatch for ${gallery.slug}: ${actual} vs ${expected}`);
}

// --- Derived views -------------------------------------------------------

const featured = listFeaturedWithGallery(5);
check(featured.length > 0, "no featured published photographs available");
check(featured.length <= 5, "featured limit not respected");
for (const photo of featured) {
  check(photo.published, `featured photo ${photo.id} is unpublished`);
  check(photo.featured, `featured list contains non-featured photo ${photo.id}`);
  check(Boolean(photo.gallery), `featured photo ${photo.id} has no gallery context`);
  check(photo.gallery.published, `featured photo ${photo.id} sits in an unpublished gallery`);
}

// Editorial slots must not collide while slots remain: colliding variants give
// two featured photographs the same grid placement.
const editorialSlots = ["a", "b", "c", "d", "e"];
const usedSlots = new Map();
for (const photo of featured) {
  check(
    editorialSlots.includes(photo.featuredVariant),
    `featured photo ${photo.id} has unknown editorial slot ${photo.featuredVariant}`,
  );
  if (usedSlots.has(photo.featuredVariant)) {
    check(
      featured.length > editorialSlots.length,
      `featured photos ${usedSlots.get(photo.featuredVariant)} and ${photo.id} share slot ${photo.featuredVariant}`,
    );
  }
  usedSlots.set(photo.featuredVariant, photo.id);
}

const recent = listRecentWithGallery(4);
check(recent.length <= 4, "recent limit not respected");
for (let index = 1; index < recent.length; index += 1) {
  const previous = recent[index - 1];
  const current = recent[index];
  check(
    (previous.publishedAt ?? "") >= (current.publishedAt ?? ""),
    `recent list is not newest-first at index ${index}`,
  );
}

// Previous/next navigation must stay published and inside one gallery.
let navigationChecked = 0;
for (const photo of published) {
  const detail = getPhotoDetail(photo.slug);
  check(Boolean(detail), `published photo ${photo.slug} does not resolve its detail`);
  if (!detail) {
    continue;
  }
  for (const neighbour of [detail.previous, detail.next]) {
    if (!neighbour) {
      continue;
    }
    navigationChecked += 1;
    check(neighbour.published, `navigation reaches unpublished photo ${neighbour.id}`);
    check(
      neighbour.galleryId === photo.galleryId,
      `navigation crosses galleries: ${photo.slug} -> ${neighbour.slug}`,
    );
    check(
      neighbour.slug !== photo.slug,
      `navigation points at itself for ${photo.slug}`,
    );
  }
}
notes.push(`navigation links checked: ${navigationChecked}`);

const tags = listPublishedTags();
check(tags.length > 0, "no public tags derived from published photographs");
const tagSlugSet = new Set(tags.map((tag) => tag.slug));
check(tagSlugSet.size === tags.length, "duplicate tag slugs in public tag list");

// --- Report --------------------------------------------------------------

if (failures.length > 0) {
  console.error(`Data layer check FAILED with ${failures.length} problem(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Data layer check passed: ${seed.galleries.length} galleries ` +
      `(${publishedGalleries.length} published), ${seed.photos.length} photographs ` +
      `(${published.length} published), ${seed.tags.length} tags (${tags.length} public).`,
  );
  for (const note of notes) {
    console.log(`Note: ${note}`);
  }
}
