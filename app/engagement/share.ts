/**
 * Share action links (Slice 07) — pure, so both the controls and the checks use
 * one definition of how a share URL is built.
 *
 * Two properties matter and both are tested:
 *
 *   1. ENCODING. Titles and URLs are percent-encoded through `URLSearchParams`,
 *      never concatenated. A photograph called "Rain & Neon" or a description
 *      containing `#` must not be able to break out of a query parameter or
 *      truncate the URL at a fragment.
 *   2. TRUTHFULNESS. These are outbound links a visitor may or may not follow.
 *      Building one is an initiated interaction and nothing more, which is why
 *      every function here returns a URL and none returns a promise about an
 *      outcome. There is no posting API and no claim of delivery.
 */
import type { ShareChannel } from "./engagement";

/**
 * Channels delivered by opening an outbound URL.
 *
 * `native` is excluded: it is the Web Share API, handled by the browser.
 * `copy_link` is excluded: it writes to the clipboard and opens nothing.
 */
export const OUTBOUND_SHARE_CHANNELS = [
  "whatsapp",
  "facebook",
  "x",
  "pinterest",
  "email",
] as const;

export type OutboundShareChannel = (typeof OUTBOUND_SHARE_CHANNELS)[number];

export function isOutboundShareChannel(value: unknown): value is OutboundShareChannel {
  return (
    typeof value === "string" && (OUTBOUND_SHARE_CHANNELS as readonly string[]).includes(value)
  );
}

/** What a share action needs to describe the photograph. */
export type ShareTarget = {
  /** The canonical, absolute public URL of the photograph page. */
  readonly url: string;
  readonly title: string;
  readonly description: string;
  /** Absolute URL of the PUBLIC preview derivative. Never a private master. */
  readonly imageUrl: string;
};

/**
 * The outbound URL for a channel, or null when the channel is not outbound.
 *
 * `email` returns a `mailto:` URL, which the browser opens in the visitor's own
 * mail client: this application still learns nothing about whether it was sent.
 */
export function shareUrlFor(channel: ShareChannel, target: ShareTarget): string | null {
  const url = target.url;
  const title = target.title;
  switch (channel) {
    case "whatsapp":
      return `https://wa.me/?${new URLSearchParams({ text: `${title} ${url}` }).toString()}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?${new URLSearchParams({ u: url }).toString()}`;
    case "x":
      return `https://twitter.com/intent/tweet?${new URLSearchParams({ url, text: title }).toString()}`;
    case "pinterest": {
      // Pinterest requires an absolute image URL as well as the page.
      return `https://pinterest.com/pin/create/button/?${new URLSearchParams({
        url,
        media: target.imageUrl,
        description: title,
      }).toString()}`;
    }
    case "email": {
      // The body carries the description and the link; the subject is the title.
      return `mailto:?${new URLSearchParams({
        subject: title,
        body: `${target.description}\n\n${url}`,
      }).toString()}`;
    }
    case "native":
    case "copy_link":
      return null;
    default:
      return null;
  }
}
