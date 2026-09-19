#!/usr/bin/env node
/**
 * Visibility checks against the development seed repository — the local-only
 * implementation used when no D1 binding is present.
 */
import { SeedPortfolioRepository } from "../../app/data/repository.seed.server.ts";
import { seed } from "../../app/data/seed.ts";
import { report } from "./report.mjs";
import { runRepositoryChecks } from "./repository-checks.mjs";

const visibleGalleryIds = new Set(
  seed.galleries.filter((gallery) => gallery.published).map((gallery) => gallery.id),
);
const visiblePhotos = seed.photos.filter(
  (photo) => photo.published && visibleGalleryIds.has(photo.galleryId),
);
const hiddenPhotoSlugs = seed.photos
  .filter((photo) => !visiblePhotos.includes(photo))
  .map((photo) => photo.slug);
const hiddenGallery = seed.galleries.find((gallery) => !gallery.published);

await runRepositoryChecks("seed repository", {
  repository: new SeedPortfolioRepository(),
  expectations: {
    publishedGalleries: seed.galleries.filter((gallery) => gallery.published).length,
    publishedPhotos: visiblePhotos.length,
    gallerySlugs: seed.galleries
      .filter((gallery) => gallery.published)
      .map((gallery) => gallery.slug),
    photoSlugs: visiblePhotos.map((photo) => photo.slug),
    hiddenSlugs: hiddenPhotoSlugs,
    hiddenGallerySlug: hiddenGallery?.slug,
    publishedAtBySlug: visiblePhotos.map((photo) => [photo.slug, photo.publishedAt ?? ""]),
  },
});

report(
  `Seed repository check passed: ${visiblePhotos.length} published photographs across ` +
    `${seed.galleries.filter((gallery) => gallery.published).length} galleries; ` +
    `${hiddenPhotoSlugs.length} hidden photographs stay private.`,
);
