#!/usr/bin/env node
/**
 * Seed fixture and projection safety checks.
 *
 * 1. Seed integrity — unique ids/slugs, canonical slugs, valid relationships,
 *    private master keys in the originals namespace and public derivatives in
 *    the images namespace.
 * 2. Projection safety — no persistence-only field (notably
 *    `originalStorageKey`, the private archival/print master) may appear in any
 *    public value produced by the projection mappers. Loader data is serialised
 *    to the browser, so this is a security property.
 */
import { toPublicGallery, toPublicPhoto } from "../../app/data/project.ts";
import { isAppRole } from "../../app/data/model.ts";
import { seed } from "../../app/data/seed.ts";
import { MASTERS_SCHEME } from "../../app/data/storage.ts";
import { normaliseEmail } from "../../app/auth/identity.ts";
import { check, note, report, walk } from "./report.mjs";

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
  check(
    photo.originalStorageKey.startsWith(MASTERS_SCHEME),
    `photo ${photo.id} master key is not in the private masters domain`,
  );
  check(
    !photo.webStorageKey.includes("masters") && !photo.thumbnailStorageKey.includes("masters"),
    `photo ${photo.id} public derivative key points at the masters domain`,
  );
  check(
    photo.originalStorageKey !== photo.webStorageKey &&
      photo.originalStorageKey !== photo.thumbnailStorageKey,
    `photo ${photo.id} reuses the master key for a public derivative`,
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

// Authorised users (Slice 05): placeholder identities on the reserved `.test`
// domain. Real operator addresses are deployment data and never belong here.
//
// An email address is an IDENTITY, so uniqueness must hold after the SAME
// normalisation the authentication boundary applies (`normaliseEmail`): two
// seed rows that differ only in case are one identity carrying two roles, which
// the database refuses (migration 0002) and the account lookup fails closed on.
const userIds = new Set();
const userEmails = new Set();
const normalisedUserEmails = new Set();
for (const user of seed.users) {
  check(!userIds.has(user.id), `duplicate user id ${user.id}`);
  userIds.add(user.id);
  check(!userEmails.has(user.email), `duplicate user email ${user.email}`);
  userEmails.add(user.email);

  const normalised = normaliseEmail(user.email);
  check(normalised !== null, `user ${user.id} email cannot be normalised for authentication`);
  check(
    normalised === user.email,
    `user ${user.id} email is not stored in the normalised form authentication uses`,
  );
  check(
    normalised === null || !normalisedUserEmails.has(normalised),
    `user ${user.id} duplicates another user's identity after email normalisation`,
  );
  if (normalised !== null) {
    normalisedUserEmails.add(normalised);
  }

  check(isAppRole(user.role), `user ${user.id} has an unsupported role ${String(user.role)}`);
  check(
    user.email.endsWith(".test"),
    `user ${user.id} does not use the reserved .test domain`,
  );
}
check(
  normalisedUserEmails.size === seed.users.length,
  "seed users do not map one-to-one onto authentication identities",
);
note(`seed identities (normalised): ${[...normalisedUserEmails].sort().join(", ")}`);

// --- Projection safety ---------------------------------------------------

/**
 * Fields that exist on the persistence records but must never appear in a
 * public value. `originalStorageKey` is the private archival/print master key.
 */
const forbiddenFields = [
  "originalStorageKey",
  "watermarkEnabled",
  "watermarkPosition",
  "createdAt",
  "updatedAt",
  "published",
  "publishedAt",
];

/** The storage scheme reserved for private masters; it must never appear publicly. */
const privateMarker = MASTERS_SCHEME;

const publicPayloads = [
  ...seed.photos.map(toPublicPhoto),
  ...seed.galleries.map(toPublicGallery),
  { composed: seed.photos.map(toPublicPhoto), galleries: seed.galleries.map(toPublicGallery) },
];

for (const payload of publicPayloads) {
  walk(payload, (value, path) => {
    if (value && typeof value === "object") {
      for (const field of forbiddenFields) {
        if (Object.hasOwn(value, field)) {
          check(false, `public projection exposes internal field ${field} at ${path}`);
        }
      }
    }
  });
}

// The scanner must actually detect a leak, or the checks above prove nothing.
const probe = { nested: { originalStorageKey: "leak" } };
let probeFound = false;
walk(probe, (value) => {
  if (value && typeof value === "object" && Object.hasOwn(value, "originalStorageKey")) {
    probeFound = true;
  }
});
check(probeFound, "leak scanner self-test failed: it cannot detect originalStorageKey");

const serialised = JSON.stringify(publicPayloads);
check(
  !serialised.includes("originalStorageKey"),
  "serialised public projections contain the field name originalStorageKey",
);
check(
  !serialised.includes(privateMarker),
  `serialised public projections contain the private-master marker ${privateMarker}`,
);

const publicKeys = new Set();
walk(publicPayloads, (value) => {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (!/^\d+$/.test(key)) {
        publicKeys.add(key);
      }
    }
  }
});
for (const key of publicKeys) {
  check(!forbiddenFields.includes(key), `public projection exposes forbidden key ${key}`);
}
note(`public projection keys: ${[...publicKeys].sort().join(", ")}`);
note(`private-master marker asserted absent: ${privateMarker}`);

report(
  `Seed/projection check passed: ${seed.galleries.length} galleries, ${seed.photos.length} photographs, ` +
    `${seed.tags.length} tags; no internal fields in public projections.`,
);
