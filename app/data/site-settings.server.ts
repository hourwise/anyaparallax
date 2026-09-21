/**
 * Workspace settings — storage and the public read — server only.
 *
 * The `site_settings` key/value table already existed for exactly this; nothing here
 * changes the schema. Two rules shape the module:
 *
 *   1. THE FORM IS NOT THE VALIDATION. Values are validated by
 *      `validateSiteSettings` before any write, and every non-blank value must be
 *      valid — a settings screen is not a place to store half a configuration.
 *   2. A MISSING TABLE OR DATABASE IS NOT AN ERROR FOR A VISITOR. Public pages read
 *      settings through `readPublicSiteSettings`, which returns documented defaults
 *      when there is no database or no row: the site then simply shows no optional
 *      copy and no social links, which is the same state as "nothing configured yet".
 *
 * A settings write is an UPSERT per key, batched when the binding supports it so a
 * partial save cannot leave the workspace half-configured.
 */
import { isD1Binding, type D1DatabaseBinding } from "./repository.d1.server";
import {
  SOCIAL_NETWORKS,
  SITE_SETTING_KEYS,
  parseWatermarkDefault,
  parseWatermarkPosition,
  type SiteSettingKey,
  type SocialNetworkId,
} from "./site-settings";
import { DEFAULT_WATERMARK_POSITION, type WatermarkPosition } from "../images/image-processor";

export type SiteSettingsEnvironment = { readonly DB?: unknown };

/** What a public page needs from settings. Blank means "render nothing". */
export type PublicSiteSettings = {
  readonly watermarkDefaultEnabled: boolean;
  readonly watermarkDefaultPosition: WatermarkPosition;
  readonly strapline: string;
  readonly galleriesIntro: string;
  readonly aboutIntro: string;
  readonly contactIntro: string;
  readonly socialLinks: readonly { readonly id: SocialNetworkId; readonly label: string; readonly url: string }[];
};

/** The state a site has when nothing has been configured: safe, empty and truthful. */
export const DEFAULT_PUBLIC_SETTINGS: PublicSiteSettings = {
  watermarkDefaultEnabled: true,
  watermarkDefaultPosition: DEFAULT_WATERMARK_POSITION,
  strapline: "",
  galleriesIntro: "",
  aboutIntro: "",
  contactIntro: "",
  socialLinks: [],
};

/** Every stored key/value pair, untyped. Missing database or table yields an empty map. */
export async function readSiteSettingRows(
  env: SiteSettingsEnvironment | undefined,
): Promise<Readonly<Record<string, string>>> {
  const db = env?.DB;
  if (!isD1Binding(db)) {
    return {};
  }
  try {
    const { results } = await db
      .prepare("SELECT key, value FROM site_settings LIMIT 200")
      .all<{ key: string; value: string }>();
    const rows: Record<string, string> = {};
    for (const row of results ?? []) {
      rows[row.key] = row.value;
    }
    return rows;
  } catch {
    // A missing table (an unmigrated database) is "nothing configured", not a crash:
    // the public site must still render.
    return {};
  }
}

/** Settings as a public page uses them, with defaults filled in. */
export async function readPublicSiteSettings(
  env: SiteSettingsEnvironment | undefined,
): Promise<PublicSiteSettings> {
  const rows = await readSiteSettingRows(env);
  const socialLinks = SOCIAL_NETWORKS.flatMap((network) => {
    const url = (rows[network.key] ?? "").trim();
    return url.length === 0 ? [] : [{ id: network.id, label: network.label, url }];
  });
  return {
    watermarkDefaultEnabled:
      parseWatermarkDefault(rows[SITE_SETTING_KEYS.watermarkEnabled]) ??
      DEFAULT_PUBLIC_SETTINGS.watermarkDefaultEnabled,
    watermarkDefaultPosition:
      parseWatermarkPosition(rows[SITE_SETTING_KEYS.watermarkPosition]) ??
      DEFAULT_PUBLIC_SETTINGS.watermarkDefaultPosition,
    strapline: rows[SITE_SETTING_KEYS.strapline] ?? "",
    galleriesIntro: rows[SITE_SETTING_KEYS.galleriesIntro] ?? "",
    aboutIntro: rows[SITE_SETTING_KEYS.aboutIntro] ?? "",
    contactIntro: rows[SITE_SETTING_KEYS.contactIntro] ?? "",
    socialLinks,
  };
}

/**
 * Write the whole settings submission.
 *
 * Batched when the binding can: `INSERT … ON CONFLICT(key) DO UPDATE` per key, so the
 * workspace moves from one complete state to another rather than through partial ones.
 */
export async function writeSiteSettings(
  env: SiteSettingsEnvironment | undefined,
  entries: readonly (readonly [SiteSettingKey, string])[],
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
  const db = env?.DB;
  if (!isD1Binding(db)) {
    return { ok: false, reason: "No database is configured in this environment." };
  }
  const now = new Date().toISOString();
  const statements = entries.map(([key, value]) =>
    db
      .prepare(
        `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(key, value, now),
  );
  try {
    if (typeof db.batch === "function") {
      await db.batch(statements);
    } else {
      for (const statement of statements) {
        await statement.run();
      }
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "The settings could not be saved." };
  }
}

/** The environment shape a public loader needs for settings. */
export type D1BackedEnvironment = { readonly DB?: D1DatabaseBinding };
