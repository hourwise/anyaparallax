/**
 * Workspace settings vocabulary and validation — pure.
 *
 * The operator-editable settings live in the existing `site_settings` key/value table.
 * Everything here is a pure function over plain values so the admin screen and the
 * public loaders share ONE definition of each key, bound and valid rule.
 *
 * WHAT IS DELIBERATELY NOT HERE: infrastructure configuration. Cloudflare account
 * details, Access audiences, bucket names and bindings are deployment state, not
 * workspace content, and no screen may treat them as editable.
 */
import { WATERMARK_POSITIONS, type WatermarkPosition } from "../images/image-processor";

/** Every setting key this application reads or writes. */
export const SITE_SETTING_KEYS = {
  watermarkEnabled: "watermark.default_enabled",
  watermarkPosition: "watermark.default_position",
  strapline: "site.strapline",
  galleriesIntro: "site.galleries_intro",
  aboutIntro: "site.about_intro",
  contactIntro: "site.contact_intro",
  socialInstagram: "social.instagram",
  socialFacebook: "social.facebook",
  socialTiktok: "social.tiktok",
  socialThreads: "social.threads",
  socialBluesky: "social.bluesky",
  socialX: "social.x",
  socialYoutube: "social.youtube",
} as const;

export type SiteSettingKey = (typeof SITE_SETTING_KEYS)[keyof typeof SITE_SETTING_KEYS];

/** Text bounds for the operator-editable copy, in code points. */
export const SITE_SETTING_LIMITS = {
  strapline: 120,
  galleriesIntro: 300,
  aboutIntro: 300,
  contactIntro: 300,
} as const;

/**
 * The social profiles the site may link to.
 *
 * `hosts` is an allow-list per network: a submitted URL must be `https` and its host
 * must be one of these (or a subdomain of one). That is what stops a setting from
 * becoming an arbitrary outbound redirect while still accepting the real profile URLs
 * an operator pastes.
 */
export const SOCIAL_NETWORKS = [
  { id: "instagram", label: "Instagram", key: SITE_SETTING_KEYS.socialInstagram, hosts: ["instagram.com"] },
  { id: "facebook", label: "Facebook", key: SITE_SETTING_KEYS.socialFacebook, hosts: ["facebook.com", "fb.com"] },
  { id: "tiktok", label: "TikTok", key: SITE_SETTING_KEYS.socialTiktok, hosts: ["tiktok.com"] },
  { id: "threads", label: "Threads", key: SITE_SETTING_KEYS.socialThreads, hosts: ["threads.net", "threads.com"] },
  { id: "bluesky", label: "Bluesky", key: SITE_SETTING_KEYS.socialBluesky, hosts: ["bsky.app"] },
  { id: "x", label: "X", key: SITE_SETTING_KEYS.socialX, hosts: ["x.com", "twitter.com"] },
  { id: "youtube", label: "YouTube", key: SITE_SETTING_KEYS.socialYoutube, hosts: ["youtube.com", "youtu.be"] },
] as const;

export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
export type SocialNetworkId = SocialNetwork["id"];

/** Text settings, as the workspace form renders them. */
export const TEXT_SETTING_FIELDS = [
  { key: SITE_SETTING_KEYS.strapline, label: "Short strapline", limit: SITE_SETTING_LIMITS.strapline },
  {
    key: SITE_SETTING_KEYS.galleriesIntro,
    label: "Galleries page introduction",
    limit: SITE_SETTING_LIMITS.galleriesIntro,
  },
  { key: SITE_SETTING_KEYS.aboutIntro, label: "About introduction", limit: SITE_SETTING_LIMITS.aboutIntro },
  {
    key: SITE_SETTING_KEYS.contactIntro,
    label: "Contact page introduction",
    limit: SITE_SETTING_LIMITS.contactIntro,
  },
] as const;

export const WATERMARK_DEFAULT_STATES = ["enabled", "disabled"] as const;
export const WATERMARK_DEFAULT_LABELS: Record<(typeof WATERMARK_DEFAULT_STATES)[number], string> = {
  enabled: "Watermark new uploads by default",
  disabled: "Do not watermark new uploads by default",
};

/**
 * How each watermark position is described to an operator.
 *
 * The vocabulary itself belongs to the image processor (which owns what the draw
 * operation accepts); this map only names those values in the interface, so a position
 * cannot be offered here that the processor would refuse.
 */
export const WATERMARK_POSITION_LABELS: Record<WatermarkPosition, string> = {
  none: "No watermark",
  center: "Centre",
  "bottom-right": "Bottom right (recommended)",
};

/** Control characters are stripped, then the value is trimmed. */
export function settingText(value: unknown): string {
  return typeof value === "string"
    ? // eslint-disable-next-line no-control-regex
      value.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
    : "";
}

export function parseWatermarkDefault(value: unknown): boolean | null {
  if (value === "enabled") {
    return true;
  }
  if (value === "disabled") {
    return false;
  }
  return null;
}

export function parseWatermarkPosition(value: unknown): WatermarkPosition | null {
  return typeof value === "string" && (WATERMARK_POSITIONS as readonly string[]).includes(value)
    ? (value as WatermarkPosition)
    : null;
}

/**
 * A social profile URL, or an explanation of why it was refused.
 *
 * Blank is valid and means "no link": the site renders only what is configured, so an
 * absent account produces no chrome rather than an empty section.
 */
export function validateSocialUrl(value: unknown, network: SocialNetwork): string | null {
  const text = settingText(value);
  if (text.length === 0) {
    return null;
  }
  if (text.length > 300) {
    return "Keep the address under 300 characters.";
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "Enter a full address beginning with https://";
  }
  if (url.protocol !== "https:") {
    return "Use an https:// address.";
  }
  // A URL with embedded credentials is refused (APV1C-06): `https://user:pass@host/` is
  // how a link can look like a profile while carrying a secret, and no social profile URL
  // legitimately needs one.
  if (url.username !== "" || url.password !== "") {
    return "Remove the username and password from that address.";
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const allowed = network.hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
  if (!allowed) {
    return `That address is not a ${network.label} profile.`;
  }
  return null;
}

/** The validated values a settings save produces. */
export type SiteSettingsSubmission = {
  readonly watermarkEnabled: boolean;
  readonly watermarkPosition: WatermarkPosition;
  readonly text: Readonly<Record<string, string>>;
  /** Keyed by network id; every configured network is present, blank when unset. */
  readonly social: Readonly<Record<string, string>>;
};

export type SettingsValidation =
  | { readonly ok: true; readonly values: SiteSettingsSubmission }
  | { readonly ok: false; readonly errors: Readonly<Record<string, string>> };

/**
 * Validate a whole settings submission.
 *
 * Every field is optional in the sense that a blank value is a legitimate answer
 * ("nothing configured"), but every NON-blank value must be valid: a refused address
 * is reported against its own field rather than silently dropped.
 */
export function validateSiteSettings(input: {
  readonly watermarkEnabled: unknown;
  readonly watermarkPosition: unknown;
  readonly text: Readonly<Record<string, unknown>>;
  readonly social: Readonly<Record<string, unknown>>;
}): SettingsValidation {
  const errors: Record<string, string> = {};

  const enabled = parseWatermarkDefault(input.watermarkEnabled);
  if (enabled === null) {
    errors["watermarkEnabled"] = "Choose whether new uploads are watermarked by default.";
  }
  const position = parseWatermarkPosition(input.watermarkPosition);
  if (position === null) {
    errors["watermarkPosition"] = "Choose a watermark position this application understands.";
  }

  const text: Record<string, string> = {};
  for (const field of TEXT_SETTING_FIELDS) {
    const value = settingText(input.text[field.key]);
    if (value.length > field.limit) {
      errors[field.key] = `Keep this to ${field.limit} characters or fewer.`;
    }
    text[field.key] = value;
  }

  const social: Record<string, string> = {};
  for (const network of SOCIAL_NETWORKS) {
    const value = settingText(input.social[network.key]);
    const problem = validateSocialUrl(value, network);
    if (problem) {
      errors[network.key] = problem;
    }
    social[network.id] = value;
  }

  if (Object.keys(errors).length > 0 || enabled === null || position === null) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    values: { watermarkEnabled: enabled, watermarkPosition: position, text, social },
  };
}
