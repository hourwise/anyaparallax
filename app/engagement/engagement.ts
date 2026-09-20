/**
 * Engagement vocabulary (Slice 07): likes and share channels.
 *
 * Pure module — no bindings, no cookie access, no React — so the same names are
 * used by the server handler, the browser controls and the checks. Keeping the
 * share channel list here in one place is what makes "do not accept arbitrary
 * channel strings from the client" enforceable rather than aspirational.
 */

/**
 * Share channels this application records.
 *
 * `native` is the Web Share API sheet, where the operating system takes over and
 * the application learns nothing about where the content went. The rest are
 * outbound links the visitor may or may not complete. Every value describes an
 * INITIATED interaction, which is why the table that records them is named for
 * share events rather than shares.
 */
export const SHARE_CHANNELS = [
  "native",
  "copy_link",
  "whatsapp",
  "facebook",
  "x",
  "pinterest",
  "email",
] as const;

export type ShareChannel = (typeof SHARE_CHANNELS)[number];

/** Narrow an unknown value to a channel this application accepts. */
export function isShareChannel(value: unknown): value is ShareChannel {
  return typeof value === "string" && (SHARE_CHANNELS as readonly string[]).includes(value);
}

/** Operator-facing labels, used by the controls and by the checks. */
export const SHARE_CHANNEL_LABELS: Record<ShareChannel, string> = {
  native: "Share",
  copy_link: "Copy link",
  whatsapp: "WhatsApp",
  facebook: "Facebook",
  x: "X",
  pinterest: "Pinterest",
  email: "Email",
};

/** The engagement state of one photograph, as the public UI may see it. */
export type PhotoEngagement = {
  /** How many likes are recorded in persistent storage. */
  readonly likeCount: number;
  /** Whether THIS browser has a like recorded. Never anyone else's. */
  readonly likedByThisBrowser: boolean;
};

/** How the engagement source is behaving, so the UI can be honest about it. */
export type EngagementAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

/** What a successful like/unlike returns to the browser. */
export type EngagementMutationResult = {
  readonly likeCount: number;
  readonly likedByThisBrowser: boolean;
};

/** The outcome of attempting to record a share initiation. */
export type ShareRecordResult = {
  readonly recorded: boolean;
  readonly channel: ShareChannel;
};

/**
 * What the UI is allowed to say about a share action.
 *
 * This exists so the copy is decided by shared, testable logic rather than by
 * whichever string a component happens to contain. The rule: opening a share
 * surface is an INITIATED interaction, and the UI must never claim an outcome —
 * no "Posted", no "Shared successfully", no "Tweet sent". The single exception
 * is a completed clipboard write, which the application actually performs and can
 * therefore truthfully confirm.
 */
export const SHARE_STATUS_COPY = {
  /** Web Share resolved. The OS may have gone anywhere; the application does not know. */
  nativeOpened: "Share panel opened.",
  /** The sheet could not be opened at all. */
  nativeUnavailable: "This browser cannot open a share panel. Use one of the options below.",
  /** An outbound share link was opened in a new tab. */
  outboundOpened: "Opened in a new tab. Complete the share there.",
  /** The clipboard write completed; this is the one outcome we can assert. */
  linkCopied: "Link copied.",
  /** The clipboard write failed. */
  copyFailed: "Could not copy automatically. Select the link and copy it manually.",
} as const;

export type ShareStatus = keyof typeof SHARE_STATUS_COPY;

/** The sentence the UI shows for a share status. */
export function shareStatusMessage(status: ShareStatus): string {
  return SHARE_STATUS_COPY[status];
}
