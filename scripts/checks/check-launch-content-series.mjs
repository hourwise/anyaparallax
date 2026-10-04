#!/usr/bin/env node
/** Targeted V1 launch checks: series integrity, profile settings and retention deletion. */
import { register } from "node:module";
import { File } from "node:buffer";
import { readFileSync } from "node:fs";
register("../ts-extension-hooks.mjs", import.meta.url);

const { createD1TestDatabase } = await import("./d1-harness.mjs");
const { check, note, report } = await import("./report.mjs");
const { seed } = await import("../../app/data/seed.ts");
const { D1PortfolioRepository } = await import("../../app/data/repository.d1.server.ts");
const { groupGalleryPhotos } = await import("../../app/data/gallery-series.ts");
const { SeriesManager } = await import("../../app/data/series-management.server.ts");
const { photoManagerFor } = await import("../../app/data/photo-management.server.ts");
const { validateSiteSettings, SITE_SETTING_KEYS, APPROVED_ABOUT_BIO } = await import("../../app/data/site-settings.ts");
const { readPublicSiteSettings, writeSiteSettings } = await import("../../app/data/site-settings.server.ts");
const { deleteEnquiry } = await import("../../app/enquiries/enquiries.server.ts");
const { isEnquiryOlderThanSixMonths } = await import("../../app/enquiries/enquiry.ts");
const { createMemoryBuckets } = await import("../../app/data/storage.server.ts");
const { replaceAboutPhoto, removeAboutPhoto } = await import("../../app/images/about-photo.server.ts");
const { serveMedia } = await import("../../app/images/media.server.ts");
const { action: engagementAction } = await import("../../app/routes/engagement.$slug.tsx");
const { RouterContextProvider } = await import("react-router");
const { appContext } = await import("../../app/data/context.ts");

const database = await createD1TestDatabase({ seed, label: "launch-series" });
const env = { DB: database.binding };
const repository = new D1PortfolioRepository(database.binding);
const seriesManager = new SeriesManager(database.binding);
const photoManager = photoManagerFor(env);
check(Boolean(photoManager), "photo manager unavailable");

const originalCount = Number(database.query("SELECT COUNT(*) AS total FROM photos")[0]?.total ?? -1);
check(originalCount === seed.photos.length, "migration did not preserve existing photographs");
check(database.query("SELECT COUNT(*) AS total FROM photos WHERE series_id IS NULL")[0]?.total === originalCount, "existing photos did not migrate as valid unassigned rows");

const created = await seriesManager.create("gallery-live-music", "The Vito", "2");
check(created.status === "ok" && created.series?.slug === "the-vito", "series creation failed");
const seriesId = created.status === "ok" ? created.series?.id : null;
check(Boolean(seriesId), "series id missing after creation");
const renamed = await seriesManager.update(seriesId, "The Vito — Manchester", "1");
check(renamed.status === "ok" && renamed.series?.displayOrder === 1, "series rename/reorder failed");

const photo = database.query("SELECT * FROM photos WHERE slug = 'stage-haze'")[0];
const tags = database.query("SELECT tag_id FROM photo_tags WHERE photo_id = ?1 ORDER BY tag_id", photo.id).map((row) => row.tag_id);
const galleryIds = database.query("SELECT id FROM galleries").map((row) => row.id);
const tagIds = database.query("SELECT id FROM tags").map((row) => row.id);
const seriesOptions = (await seriesManager.list()).map((item) => ({ id: item.id, galleryId: item.galleryId }));
const edit = (galleryId, chosenSeries) => ({
  title: photo.title, description: photo.description, location: photo.location ?? "",
  captureDate: photo.capture_date ?? "", galleryId, seriesId: chosenSeries, tags,
  published: photo.published === 1, featured: photo.featured === 1,
});
let result = await photoManager.updatePhoto(photo.id, edit("gallery-live-music", seriesId), { galleryIds, tagIds, series: seriesOptions });
check(result.status === "ok", "assigning a photo to its gallery series failed");
check(database.query("SELECT series_id FROM photos WHERE id = ?1", photo.id)[0]?.series_id === seriesId, "series assignment did not persist");
check((await seriesManager.deleteEmpty(seriesId)).status === "in-use", "an in-use series was silently deleted");

result = await photoManager.updatePhoto(photo.id, edit("gallery-nightlife", seriesId), { galleryIds, tagIds, series: seriesOptions });
check(result.status === "invalid", "cross-gallery series assignment was not refused by the application");
check(database.query("SELECT gallery_id FROM photos WHERE id = ?1", photo.id)[0]?.gallery_id === "gallery-live-music", "refused cross-gallery edit changed the row");
let triggerRefused = false;
try { database.exec(`UPDATE photos SET gallery_id = 'gallery-nightlife' WHERE id = '${photo.id}'`); } catch { triggerRefused = true; }
check(triggerRefused, "database trigger accepted a forged cross-gallery series relationship");

result = await photoManager.updatePhoto(photo.id, edit("gallery-nightlife", null), { galleryIds, tagIds, series: seriesOptions });
check(result.status === "ok", "moving gallery while clearing series failed");
check(database.query("SELECT series_id FROM photos WHERE id = ?1", photo.id)[0]?.series_id === null, "gallery move did not clear series");
check((await seriesManager.deleteEmpty(seriesId)).status === "ok", "empty series could not be removed");

const flatGallery = await repository.getGallery("nightlife");
check(Boolean(flatGallery) && flatGallery.series.length === 0 && flatGallery.photos.length > 0, "gallery with zero series no longer renders as a normal photo list");
const flatGroups = groupGalleryPhotos([], [{ id: "flat", seriesId: null }]);
check(flatGroups.length === 1 && flatGroups[0]?.title === null && flatGroups[0]?.photos.length === 1, "zero-series public grouping is not a normal flat grid");
const grouped = groupGalleryPhotos(
  [{ id: "series-a", title: "The Vito" }, { id: "series-b", title: "The Tunnel" }],
  [{ id: "a", seriesId: "series-a" }, { id: "b", seriesId: "series-b" }, { id: "more", seriesId: null }],
);
check(grouped.map((group) => group.title).join("|") === "The Vito|The Tunnel|More", "public series order or unassigned grouping is wrong");
database.exec("UPDATE photos SET published = 0 WHERE slug = 'stage-haze'");
const publicGallery = await repository.getGallery("nightlife");
check(!publicGallery?.photos.some((item) => item.slug === "stage-haze"), "series/gallery work bypassed photo publication");

const approvedSettingsInput = {
  watermarkEnabled: "enabled", watermarkPosition: "bottom-right", likesEnabled: "disabled",
  text: {
    [SITE_SETTING_KEYS.strapline]: "A shift in focus", [SITE_SETTING_KEYS.galleriesIntro]: "",
    [SITE_SETTING_KEYS.aboutIntro]: "", [SITE_SETTING_KEYS.contactIntro]: "",
  },
  social: Object.fromEntries([
    ["instagram", "https://www.instagram.com/anyaparallax/"], ["facebook", ""], ["tiktok", ""],
    ["threads", ""], ["bluesky", ""], ["x", ""], ["youtube", ""], ["pinterest", ""], ["snapchat", ""], ["whatsapp", ""],
  ].map(([id, value]) => [SITE_SETTING_KEYS[`social${id[0].toUpperCase()}${id.slice(1)}`] ?? `social.${id}`, value])),
  profile: {
    [SITE_SETTING_KEYS.displayName]: "anyaparallax", [SITE_SETTING_KEYS.publicRole]: "Photographer",
    [SITE_SETTING_KEYS.location]: "North West England", [SITE_SETTING_KEYS.biography]: APPROVED_ABOUT_BIO,
    [SITE_SETTING_KEYS.aboutPhotoAlt]: "",
  },
};
const settingsValidation = validateSiteSettings(approvedSettingsInput);
check(settingsValidation.ok, "approved profile settings were refused");
check(
  !validateSiteSettings({
    ...approvedSettingsInput,
    profile: { ...approvedSettingsInput.profile, [SITE_SETTING_KEYS.biography]: "x".repeat(5001) },
  }).ok,
  "an overlong profile biography was accepted",
);
if (settingsValidation.ok) {
  await writeSiteSettings(env, [
    [SITE_SETTING_KEYS.strapline, settingsValidation.values.text[SITE_SETTING_KEYS.strapline]],
    [SITE_SETTING_KEYS.displayName, settingsValidation.values.profile[SITE_SETTING_KEYS.displayName]],
    [SITE_SETTING_KEYS.location, settingsValidation.values.profile[SITE_SETTING_KEYS.location]],
    [SITE_SETTING_KEYS.biography, settingsValidation.values.profile[SITE_SETTING_KEYS.biography]],
    [SITE_SETTING_KEYS.likesEnabled, "disabled"],
  ]);
}
const publicSettings = await readPublicSiteSettings(env);
check(publicSettings.strapline === "A shift in focus" && publicSettings.location === "North West England", "profile settings did not persist publicly");
check(publicSettings.likesEnabled === false, "likes did not remain disabled");
check(!publicSettings.biography.toLowerCase().includes("surname"), "profile default introduced a surname");
check(
  publicSettings.socialLinks.length === 1 &&
    publicSettings.socialLinks[0]?.url === "https://www.instagram.com/anyaparallax/" &&
    !publicSettings.socialLinks[0]?.url.includes("utm_"),
  "the canonical launch Instagram profile was not the only default social link",
);

const now = new Date("2026-10-04T12:00:00.000Z");
check(isEnquiryOlderThanSixMonths("2026-04-04T11:59:59.000Z", now), "six-month age indicator missed an old enquiry");
check(!isEnquiryOlderThanSixMonths("2026-04-05T00:00:00.000Z", now), "six-month age indicator marked a recent enquiry old");
database.exec("INSERT INTO enquiries (id,name,email,category,message,status,created_at,updated_at,submission_token) VALUES ('enquiry-delete','Test','test@example.test','other','Delete me','new','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','00000000-0000-4000-8000-000000000001')");
check(await deleteEnquiry("enquiry-delete", env) === "ok", "individual enquiry deletion failed");
check(database.query("SELECT id FROM enquiries WHERE id = 'enquiry-delete'").length === 0, "deleted enquiry row remains");
check(await deleteEnquiry("missing", env) === "not-found", "unknown enquiry id was not refused");

// About-photo authority: private master, current derivative only, failure-safe replacement.
const buckets = createMemoryBuckets();
const assetEnv = { DB: database.binding, MASTERS: buckets.masters, IMAGES: buckets.images };
const goodProcessor = async () => ({
  async prepare() {
    return {
      source: { width: 1200, height: 1500, format: "image/jpeg" },
      web: { bytes: new Uint8Array([1, 2, 3]), width: 1200, height: 1500, contentType: "image/webp" },
      thumbnail: { bytes: new Uint8Array([4, 5]), width: 384, height: 480, contentType: "image/webp" },
      watermarked: false,
    };
  },
});
const jpeg = new File([readFileSync(new URL("../fixtures/portrait.jpg", import.meta.url))], "portrait.jpg", { type: "image/jpeg" });
const firstUpload = await replaceAboutPhoto(assetEnv, jpeg, { processorFactory: goodProcessor });
check(firstUpload.ok, `authorised About portrait upload failed${firstUpload.ok ? "" : `: ${firstUpload.reason}`}`);
if (!firstUpload.ok) throw new Error(firstUpload.reason);
let assetRows = await readPublicSiteSettings(assetEnv);
check(Boolean(assetRows.aboutPhotoPath), "About portrait did not become public through its setting");
const firstPath = assetRows.aboutPhotoPath;
const firstResponse = await serveMedia(firstPath.replace(/^\/media\//, ""), assetEnv);
check(firstResponse.status === 200, "current About derivative was not served");
check(buckets.masters.size === 1, "About master was not stored privately");
const invalid = new File([new Uint8Array([1, 2, 3, 4])], "fake.jpg", { type: "image/jpeg" });
check(!(await replaceAboutPhoto(assetEnv, invalid, { processorFactory: goodProcessor })).ok, "invalid portrait content was accepted");
check((await readPublicSiteSettings(assetEnv)).aboutPhotoPath === firstPath, "failed portrait processing changed authority");
const failingProcessor = async () => ({ async prepare() { throw new Error("injected processing failure"); } });
check(!(await replaceAboutPhoto(assetEnv, jpeg, { processorFactory: failingProcessor })).ok, "processing failure reported success");
check((await readPublicSiteSettings(assetEnv)).aboutPhotoPath === firstPath, "failed replacement withdrew the working portrait");
check((await replaceAboutPhoto(assetEnv, jpeg, { processorFactory: goodProcessor })).ok, "successful portrait replacement failed");
assetRows = await readPublicSiteSettings(assetEnv);
check(assetRows.aboutPhotoPath !== firstPath, "portrait replacement did not switch versioned authority");
check((await serveMedia(firstPath.replace(/^\/media\//, ""), assetEnv)).status === 404, "old portrait remained publicly authorised");
check((await serveMedia(assetRows.aboutPhotoPath.replace(/^\/media\//, ""), assetEnv)).status === 200, "replacement portrait is not served");
check((await removeAboutPhoto(assetEnv)).ok, "portrait removal failed");
check((await readPublicSiteSettings(assetEnv)).aboutPhotoPath === null, "portrait setting remained after removal");
check((await serveMedia(assetRows.aboutPhotoPath.replace(/^\/media\//, ""), assetEnv)).status === 404, "removed portrait remains publicly authorised");
check(!JSON.stringify(await readPublicSiteSettings(assetEnv)).includes("r2://masters/"), "master key leaked through public settings");

// Likes-off route gate: direct crafted likes do not write or set a cookie; sharing still records.
await writeSiteSettings(env, [[SITE_SETTING_KEYS.likesEnabled, "disabled"]]);
const context = new RouterContextProvider();
context.set(appContext, { env });
const makeEngagementRequest = (body) => new Request("https://example.test/engagement/closing-time", {
  method: "POST", body,
  headers: { origin: "https://example.test", "content-type": "application/x-www-form-urlencoded", "content-length": String(body.length) },
});
const likesBefore = Number(database.query("SELECT COUNT(*) AS total FROM likes")[0]?.total ?? 0);
const likeResponse = await engagementAction({ request: makeEngagementRequest("action=like"), params: { slug: "closing-time" }, context });
check(likeResponse.status === 403, "crafted like request was not refused while likes are disabled");
check(!likeResponse.headers.has("set-cookie"), "disabled like request created an identity cookie");
check(Number(database.query("SELECT COUNT(*) AS total FROM likes")[0]?.total ?? 0) === likesBefore, "disabled like request changed state");
const sharesBefore = Number(database.query("SELECT COUNT(*) AS total FROM share_events")[0]?.total ?? 0);
const shareBody = "action=share&channel=copy_link";
const shareResponse = await engagementAction({ request: makeEngagementRequest(shareBody), params: { slug: "closing-time" }, context });
check(shareResponse.status === 200, "sharing stopped working when likes were disabled");
check(Number(database.query("SELECT COUNT(*) AS total FROM share_events")[0]?.total ?? 0) === sharesBefore + 1, "share initiation was not recorded");
check(!shareResponse.headers.has("set-cookie"), "sharing created the dormant like cookie");

note("series create/rename/order/assign/clear/delete and both cross-gallery backstops verified");
note("approved profile defaults/validation, canonical social state, likes-off state and six-month individual deletion verified");
note("About portrait authority/replacement/removal and disabled-like direct-request gate verified");
await database.close();
report("Launch content and series check passed");
