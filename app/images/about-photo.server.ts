/** Versioned About portrait upload using the established image validation/processor/storage path. */
import type { AppBindings } from "../data/context";
import { SITE_SETTING_KEYS } from "../data/site-settings";
import { readSiteSettingRows, writeSiteSettings } from "../data/site-settings.server";
import { R2ObjectStorage } from "../data/storage.server";
import { processUpload } from "./process";
import { defaultProcessorFactory, hasUploadStorage, type ProcessorFactory } from "./upload.server";

export type AboutPhotoResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

function fileLike(value: FormDataEntryValue | null): value is File {
  return Boolean(value) && typeof value === "object" &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function" &&
    typeof (value as { name?: unknown }).name === "string" &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { size?: unknown }).size === "number";
}

export async function replaceAboutPhoto(
  env: AppBindings | undefined,
  value: FormDataEntryValue | null,
  options?: { readonly processorFactory?: ProcessorFactory },
): Promise<AboutPhotoResult> {
  if (!fileLike(value) || value.size === 0) return { ok: false, reason: "Choose a JPEG or PNG portrait." };
  if (!hasUploadStorage(env)) return { ok: false, reason: "Image storage is unavailable." };
  const processor = await (options?.processorFactory ?? defaultProcessorFactory)(env);
  if (!processor || !env?.MASTERS || !env.IMAGES) return { ok: false, reason: "Image processing is unavailable." };
  const storage = new R2ObjectStorage({ MASTERS: env.MASTERS, IMAGES: env.IMAGES });
  const previous = await readSiteSettingRows(env);
  let processed: Awaited<ReturnType<typeof processUpload>>;
  try {
    processed = await processUpload({
      photoId: `site-about-${crypto.randomUUID()}`,
      bytes: new Uint8Array(await value.arrayBuffer()),
      declaredType: value.type,
      filename: value.name,
      watermarkEnabled: false,
      watermarkPosition: "none",
      processor,
      storage,
    });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "The portrait was not accepted." };
  }

  const written = await writeSiteSettings(env, [
    [SITE_SETTING_KEYS.aboutPhotoMaster, processed.originalStorageKey],
    [SITE_SETTING_KEYS.aboutPhotoDerivative, processed.webStorageKey],
  ]);
  if (!written.ok) {
    await Promise.allSettled([
      storage.deleteMaster(processed.originalStorageKey),
      storage.deletePublicImage(processed.webStorageKey),
      storage.deletePublicImage(processed.thumbnailStorageKey),
    ]);
    return { ok: false, reason: "The portrait could not be switched, so the existing portrait is unchanged." };
  }

  const cleanup: Promise<unknown>[] = [storage.deletePublicImage(processed.thumbnailStorageKey)];
  const oldMaster = previous[SITE_SETTING_KEYS.aboutPhotoMaster];
  const oldDerivative = previous[SITE_SETTING_KEYS.aboutPhotoDerivative];
  if (oldMaster) cleanup.push(storage.deleteMaster(oldMaster));
  if (oldDerivative) cleanup.push(storage.deletePublicImage(oldDerivative));
  await Promise.allSettled(cleanup);
  return { ok: true };
}

export async function removeAboutPhoto(env: AppBindings | undefined): Promise<AboutPhotoResult> {
  const previous = await readSiteSettingRows(env);
  const written = await writeSiteSettings(env, [
    [SITE_SETTING_KEYS.aboutPhotoMaster, ""],
    [SITE_SETTING_KEYS.aboutPhotoDerivative, ""],
  ]);
  if (!written.ok) return { ok: false, reason: "The portrait could not be removed." };
  if (env?.MASTERS && env.IMAGES) {
    const storage = new R2ObjectStorage({ MASTERS: env.MASTERS, IMAGES: env.IMAGES });
    const cleanup: Promise<unknown>[] = [];
    const oldMaster = previous[SITE_SETTING_KEYS.aboutPhotoMaster];
    const oldDerivative = previous[SITE_SETTING_KEYS.aboutPhotoDerivative];
    if (oldMaster) cleanup.push(storage.deleteMaster(oldMaster));
    if (oldDerivative) cleanup.push(storage.deletePublicImage(oldDerivative));
    await Promise.allSettled(cleanup);
  }
  return { ok: true };
}
