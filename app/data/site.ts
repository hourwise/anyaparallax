/**
 * Small amount of shared, non-permanent site data for the Slice 01 shell.
 *
 * Only brand naming and primary navigation live here. Gallery lists, photos,
 * social accounts, contact addresses and the final domain are deliberately
 * absent: they arrive with the relevant later slices and operator input.
 *
 * REPAIR-09A: this module also owns the ONE switch that decides whether the
 * site's development/preview notices are rendered. See below.
 */

/**
 * The single development-notice switch.
 *
 * WHAT IT CONTROLS: the provisional/preview notices and placeholder labels the
 * site shows while its content is not yet approved — the footer note, the
 * gallery and homepage notices, the hero note, the About portrait label and the
 * meta-description suffixes.
 *
 * WHY IT EXISTS AS ITS OWN SETTING. The site previously described every
 * photograph and the whole site as a development placeholder unconditionally:
 * the wording was baked into rendered markup, so removing it at publication time
 * meant editing source. It now depends on this one value, so the production
 * state is a configuration change rather than a code change.
 *
 * WHY IT IS NOT ONE OF THE EXISTING FLAGS. `ALLOW_DEVELOPMENT_SEED` and
 * `ALLOW_DEVELOPMENT_IDENTITY` are development FACILITIES — a seed data source
 * and a local sign-in header. Neither answers the question this one answers, and
 * a real deployment could legitimately have both off while still needing to
 * label genuinely provisional content (or, as here, still be running on seed
 * data). Overloading either would make the value mean two unrelated things.
 *
 * DEFAULT IS OFF. Only the exact string "true" enables the notices — the same
 * rule the two development flags use — so an absent, misspelled or differently
 * cased value leaves them hidden. The publication-safe state is therefore the
 * one a deployment gets by accident, which is what makes this a repair rather
 * than a reminder.
 */
export const DEVELOPMENT_NOTICES_VARIABLE = "SHOW_DEVELOPMENT_NOTICES";

/** The environment shape this module needs, structurally narrowed. */
export type DevelopmentNoticeEnvironment = {
  readonly SHOW_DEVELOPMENT_NOTICES?: string;
};

/** Should the development/preview notices be rendered for this environment? */
export function developmentNoticesEnabled(
  env: DevelopmentNoticeEnvironment | undefined,
): boolean {
  return env?.SHOW_DEVELOPMENT_NOTICES === "true";
}

export const site = {
  name: "Anyaparallax",
  secondary: "Photography",
  /**
   * The site description, TRUE AT EVERY STAGE.
   *
   * It deliberately says what the site is rather than what stage it is at: this
   * value is also the fallback description a real photograph's social metadata
   * inherits, so a development-phase sentence here would put preview wording into
   * the metadata of every published photograph.
   */
  description:
    "Night cities, live music and the moments after dark. Anyaparallax photography.",
  /**
   * A development notice. Rendered ONLY while {@link developmentNoticesEnabled} is
   * true, and never part of the default public output.
   */
  provisionalNote:
    "Provisional placeholder content: wording, imagery and links are not approved final content.",
  /** The footer's second development notice, likewise gated. */
  provisionalFooterNote: "Development preview. Not approved final content.",
} as const;

export type PrimaryNavItem = {
  readonly label: string;
  readonly to: string;
};

export const primaryNav: readonly PrimaryNavItem[] = [
  { label: "Home", to: "/" },
  { label: "Galleries", to: "/galleries" },
  { label: "Prints", to: "/prints" },
  { label: "About", to: "/about" },
  { label: "Contact", to: "/contact" },
] as const;
