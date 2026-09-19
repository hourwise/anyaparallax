/**
 * Small amount of shared, non-permanent site data for the Slice 01 shell.
 *
 * Only brand naming and primary navigation live here. Gallery lists, photos,
 * social accounts, contact addresses and the final domain are deliberately
 * absent: they arrive with the relevant later slices and operator input.
 */

export const site = {
  name: "Anyaparallax",
  secondary: "Photography",
  description:
    "Night cities, live music and the moments after dark. Anyaparallax photography — development preview.",
  provisionalNote:
    "Provisional placeholder content: wording, imagery and links are not approved final content.",
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
