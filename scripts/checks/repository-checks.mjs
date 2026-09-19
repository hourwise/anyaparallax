#!/usr/bin/env node
/**
 * Visibility and projection checks against a repository implementation.
 *
 * Runs the same suite against both implementations — the development seed
 * repository and, separately, real D1 queries (see `check-d1.mjs`) — so the
 * public rules cannot drift between local development and production.
 */
import {
  editorialSlotForIndex,
} from "../../app/data/project.ts";
import { MASTERS_SCHEME } from "../../app/data/storage.ts";
import { check, note, report, walk } from "./report.mjs";

const forbiddenFields = [
  "originalStorageKey",
  "watermarkEnabled",
  "watermarkPosition",
  "createdAt",
  "updatedAt",
  "published",
  "publishedAt",
];

const editorialSlots = ["a", "b", "c", "d", "e"];

/**
 * @param {string} label
 * @param {object} context
 * @param {import("../../app/data/repository.ts").PortfolioRepository} context.repository
 * @param {object} context.expectations
 * @param {number} context.expectations.publishedGalleries
 * @param {number} context.expectations.publishedPhotos
 * @param {readonly string[]} context.expectations.gallerySlugs
 * @param {readonly string[]} context.expectations.photoSlugs
 * @param {readonly string[]} context.expectations.hiddenSlugs
 */
export async function runRepositoryChecks(label, { repository, expectations }) {
  const galleries = await repository.listGalleries();
  check(
    galleries.length === expectations.publishedGalleries,
    `${label}: expected ${expectations.publishedGalleries} published galleries, got ${galleries.length}`,
  );
  for (const slug of expectations.gallerySlugs) {
    check(
      galleries.some((gallery) => gallery.slug === slug),
      `${label}: published gallery ${slug} is missing`,
    );
  }

  // Unpublished and unknown galleries must be indistinguishable.
  const hiddenGallerySlug = expectations.hiddenGallerySlug;
  if (hiddenGallerySlug) {
    check(
      (await repository.getGallery(hiddenGallerySlug)) === null,
      `${label}: hidden gallery ${hiddenGallerySlug} resolves publicly`,
    );
  }
  check(
    (await repository.getGallery("does-not-exist")) === null,
    `${label}: unknown gallery slug resolves publicly`,
  );

  const photos = await repository.listPhotos();
  check(
    photos.length === expectations.publishedPhotos,
    `${label}: expected ${expectations.publishedPhotos} published photographs, got ${photos.length}`,
  );

  for (const slug of expectations.hiddenSlugs) {
    check(
      (await repository.getPhoto(slug)) === null,
      `${label}: hidden photograph ${slug} resolves publicly`,
    );
    check(
      (await repository.getPhotoDetail(slug)) === null,
      `${label}: hidden photograph ${slug} resolves detail publicly`,
    );
  }
  check(
    (await repository.getPhoto("does-not-exist")) === null,
    `${label}: unknown photo slug resolves publicly`,
  );

  // Newest-first ordering.
  const publishedAt = new Map(expectations.publishedAtBySlug ?? []);
  for (let index = 1; index < photos.length; index += 1) {
    const previous = publishedAt.get(photos[index - 1].slug) ?? "";
    const current = publishedAt.get(photos[index].slug) ?? "";
    check(
      previous >= current,
      `${label}: published list is not newest-first at index ${index}`,
    );
  }

  // Gallery member sets and counts.
  const counts = await repository.photoCounts();
  for (const gallery of galleries) {
    const detail = await repository.getGallery(gallery.slug);
    check(Boolean(detail), `${label}: published gallery ${gallery.slug} does not resolve`);
    if (!detail) {
      continue;
    }
    check(
      counts.get(gallery.id) === detail.photos.length,
      `${label}: count mismatch for ${gallery.slug}`,
    );
    for (const photo of detail.photos) {
      check(
        photo.galleryId === gallery.id,
        `${label}: gallery ${gallery.slug} exposes photo ${photo.id} from another gallery`,
      );
      check(
        photos.some((candidate) => candidate.id === photo.id),
        `${label}: gallery ${gallery.slug} exposes photograph ${photo.id} absent from the published list`,
      );
    }
  }

  // Featured and recent views.
  const featured = await repository.listFeatured(5);
  check(featured.length > 0, `${label}: no featured published photographs`);
  check(featured.length <= 5, `${label}: featured limit not respected`);
  const usedSlots = new Map();
  for (const photo of featured) {
    check(photo.featured, `${label}: featured list contains non-featured photo ${photo.id}`);
    check(
      editorialSlots.includes(photo.featuredVariant),
      `${label}: featured photo ${photo.id} has unknown editorial slot ${photo.featuredVariant}`,
    );
    if (usedSlots.has(photo.featuredVariant) && featured.length <= editorialSlots.length) {
      check(
        false,
        `${label}: featured photos ${usedSlots.get(photo.featuredVariant)} and ${photo.id} share slot ${photo.featuredVariant}`,
      );
    }
    usedSlots.set(photo.featuredVariant, photo.id);
  }
  check(
    editorialSlotForIndex(0) === "a" && editorialSlotForIndex(5) === "a",
    `${label}: editorial slot cycle changed`,
  );

  const recent = await repository.listRecent(4);
  check(recent.length <= 4, `${label}: recent limit not respected`);
  for (const photo of recent) {
    check(Boolean(photo.gallery), `${label}: recent photo ${photo.id} has no gallery context`);
  }

  // Navigation must stay inside one published gallery.
  let navigationChecked = 0;
  for (const photo of photos) {
    const detail = await repository.getPhotoDetail(photo.slug);
    check(Boolean(detail), `${label}: published photo ${photo.slug} does not resolve detail`);
    if (!detail) {
      continue;
    }
    check(
      detail.gallery.id === photo.galleryId,
      `${label}: photo ${photo.slug} resolved the wrong gallery`,
    );
    for (const neighbour of [detail.previous, detail.next]) {
      if (!neighbour) {
        continue;
      }
      navigationChecked += 1;
      check(
        neighbour.galleryId === photo.galleryId,
        `${label}: navigation crosses galleries: ${photo.slug} -> ${neighbour.slug}`,
      );
      check(
        neighbour.slug !== photo.slug,
        `${label}: navigation points at itself for ${photo.slug}`,
      );
      check(
        photos.some((candidate) => candidate.id === neighbour.id),
        `${label}: navigation reaches a non-public photograph from ${photo.slug}`,
      );
    }
  }
  note(`${label}: navigation links checked: ${navigationChecked}`);

  // Covers, tags and payload safety.
  for (const gallery of galleries) {
    const cover = await repository.getGalleryCover(gallery);
    if (!cover) {
      continue;
    }
    check(
      cover.galleryId === gallery.id,
      `${label}: cover for ${gallery.slug} belongs to another gallery`,
    );
  }

  const tags = await repository.listTags();
  check(tags.length > 0, `${label}: no public tags derived from published photographs`);
  const tagSlugs = new Set(tags.map((tag) => tag.slug));
  check(tagSlugs.size === tags.length, `${label}: duplicate tag slugs in public tag list`);

  // Gather every public value this repository can produce and scan it.
  const payloads = [...galleries, ...photos, ...featured, ...recent, tags];
  for (const photo of photos.slice(0, 5)) {
    const resolved = await repository.getPhoto(photo.slug);
    if (resolved) {
      payloads.push(resolved);
      payloads.push(await repository.resolveTags(resolved.tags));
      const detail = await repository.getPhotoDetail(photo.slug);
      if (detail) {
        payloads.push(detail);
      }
    }
  }
  for (const gallery of galleries) {
    const detail = await repository.getGallery(gallery.slug);
    if (detail) {
      payloads.push(detail);
    }
    const cover = await repository.getGalleryCover(gallery);
    if (cover) {
      payloads.push(cover);
    }
  }

  for (const payload of payloads) {
    walk(payload, (value, path) => {
      if (value && typeof value === "object") {
        for (const field of forbiddenFields) {
          if (Object.hasOwn(value, field)) {
            check(false, `${label}: public payload exposes internal field ${field} at ${path}`);
          }
        }
      }
    });
  }

  const serialised = JSON.stringify(payloads);
  check(
    !serialised.includes("originalStorageKey"),
    `${label}: serialised payloads contain the field name originalStorageKey`,
  );
  check(
    !serialised.includes(MASTERS_SCHEME),
    `${label}: serialised payloads contain a private-master key`,
  );
  note(`${label}: ${payloads.length} public payloads scanned`);
}

export { report };
