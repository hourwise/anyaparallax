import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import {
  SHARE_CHANNELS,
  SHARE_CHANNEL_LABELS,
  shareStatusMessage,
  type PhotoEngagement,
  type ShareChannel,
  type ShareStatus,
} from "../engagement/engagement";
import { isOutboundShareChannel, shareUrlFor, type ShareTarget } from "../engagement/share";

/**
 * Compact like and share controls for a photograph page (Slice 07).
 *
 * Two principles decide everything here.
 *
 * THE SERVER IS AUTHORITATIVE. The count and "this browser liked it" come from
 * the loader and from the endpoint's JSON response. There is no local counter: the
 * component never adds one to a number, and while a request is in flight the heart
 * keeps showing the last confirmed state rather than a total that storage has not
 * confirmed. That is why the only local state is the share disclosure and its note.
 *
 * NOTHING CLAIMS AN OUTCOME. Opening the Web Share sheet or an outbound link is an
 * interaction; whether anything was posted is unknowable from here, and the copy
 * never pretends otherwise. The single confirmed success is a completed clipboard
 * write, because the application performs that itself and can see it succeed.
 *
 * The controls stay small: a heart, a number and a share disclosure. The photograph
 * remains the subject of the page.
 *
 * The heart's accessible name carries its state ("Like this photo" / "Unlike this
 * photo") and the shape changes as well as the colour (outline versus filled), so the
 * state never depends on colour alone. It deliberately has no `aria-pressed`: a label
 * that already names the next action plus a pressed state reads as a contradiction
 * ("Unlike this photo, pressed").
 */

export type EngagementControlsProps = {
  readonly slug: string;
  /** Null when engagement could not be read; the UI then says so plainly. */
  readonly engagement: PhotoEngagement | null;
  readonly availabilityReason: string | null;
  /** Canonical public URL of this photograph, from the configured origin. */
  readonly canonicalUrl: string;
  readonly shareTarget: ShareTarget;
};

type ActionPayload =
  | { likeCount: number; likedByThisBrowser: boolean }
  | { recorded: boolean; channel: ShareChannel }
  | { error: string };

/** The like state the endpoint returned, or null when it has not answered. */
function likeResult(data: ActionPayload | undefined): {
  likeCount: number;
  likedByThisBrowser: boolean;
} | null {
  return data && "likeCount" in data ? data : null;
}

/** Heart glyph: an outline when not liked, filled when liked. Decorative only. */
function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      className="engagement__heart"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 20.5l-1.35-1.23C5.9 14.95 3 12.3 3 9.05 3 6.4 5.07 4.5 7.6 4.5c1.6 0 3.1.78 4.4 2.28 1.3-1.5 2.8-2.28 4.4-2.28 2.53 0 4.6 1.9 4.6 4.55 0 3.25-2.9 5.9-7.65 10.22L12 20.5z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The share panel's order: copy first, the named services, the device sheet last. */
const PANEL_ORDER: readonly ShareChannel[] = [
  ...SHARE_CHANNELS.filter((channel) => channel !== "native"),
  "native",
];

/** How long "Link copied." stays on screen before the note clears itself. */
const COPIED_NOTE_MS = 3000;

export function EngagementControls(props: EngagementControlsProps) {
  const { engagement, availabilityReason, shareTarget, canonicalUrl } = props;
  const likeFetcher = useFetcher<ActionPayload>();
  const shareFetcher = useFetcher<ActionPayload>();
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  /**
   * Whether this browser exposes the Web Share API.
   *
   * Discovered on the client rather than passed in: `navigator` does not exist
   * during server rendering, so a prop computed on the server would be wrong for
   * every visitor. It starts false — the safe assumption, because the listed
   * options always work — and is corrected once the component is live. When true,
   * the panel gains one extra entry that opens the device's own share sheet.
   */
  const [nativeShareAvailable, setNativeShareAvailable] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setNativeShareAvailable(
      typeof navigator !== "undefined" && typeof navigator.share === "function",
    );
  }, []);

  const available = engagement !== null;
  const submitting = likeFetcher.state !== "idle";

  // The endpoint's answer supersedes the page's snapshot, and until it arrives
  // the loader's value is shown unchanged. A click while a request is in flight is
  // ignored, so a double submit cannot race itself. The button is NOT disabled for
  // that interval, because disabling a focused button drops keyboard focus.
  const answered = likeResult(likeFetcher.data);
  const likeCount = answered?.likeCount ?? engagement?.likeCount ?? 0;
  const liked = answered?.likedByThisBrowser ?? engagement?.likedByThisBrowser ?? false;

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) {
        clearTimeout(copiedTimer.current);
      }
    };
  }, []);

  /** Show a share note. "Link copied." clears itself; everything else stays. */
  function showStatus(next: ShareStatus | null) {
    if (copiedTimer.current !== null) {
      clearTimeout(copiedTimer.current);
      copiedTimer.current = null;
    }
    setStatus(next);
    if (next === "linkCopied") {
      copiedTimer.current = setTimeout(() => setStatus(null), COPIED_NOTE_MS);
    }
  }

  /** Submit a like or unlike. The body names only the action. */
  function submitLike(action: "like" | "unlike") {
    if (submitting) {
      return;
    }
    const body = new FormData();
    body.set("action", action);
    likeFetcher.submit(body, { method: "post", action: `/engagement/${props.slug}` });
  }

  /** Record that a share interaction was INITIATED. Never claims a result. */
  function recordInitiation(channel: ShareChannel) {
    const body = new FormData();
    body.set("action", "share");
    body.set("channel", channel);
    shareFetcher.submit(body, { method: "post", action: `/engagement/${props.slug}` });
  }

  /**
   * The Web Share API path, offered only where the browser supports it.
   *
   * The device's own sheet is its feedback, so a completed or dismissed sheet adds
   * no note of ours: the application cannot know whether anything was sent.
   */
  async function shareNatively() {
    if (typeof navigator === "undefined" || !navigator.share) {
      showStatus("nativeUnavailable");
      return;
    }
    recordInitiation("native");
    try {
      await navigator.share({
        title: shareTarget.title,
        text: shareTarget.description,
        url: canonicalUrl,
      });
      showStatus(null);
    } catch (error) {
      // Dismissing the sheet is not a failure worth mentioning.
      const dismissed = error instanceof Error && error.name === "AbortError";
      showStatus(dismissed ? null : "nativeUnavailable");
    }
  }

  /** Copy the canonical link. "Link copied" appears only after a real success. */
  async function copyLink() {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        throw new Error("no clipboard available");
      }
      await navigator.clipboard.writeText(canonicalUrl);
      recordInitiation("copy_link");
      showStatus("linkCopied");
    } catch {
      // Honest failure: no claim of success, and the link is shown for manual use.
      showStatus("copyFailed");
    }
  }

  /** Open an outbound share URL. The application learns nothing about the result. */
  function openOutbound(channel: ShareChannel) {
    const url = shareUrlFor(channel, shareTarget);
    if (url === null) {
      return;
    }
    recordInitiation(channel);
    showStatus("outboundOpened");
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="engagement" role="group" aria-label="Like and share">
      <div className="engagement__row">
        <div className="engagement__like-group">
          <button
            type="button"
            className="engagement__like"
            data-liked={liked ? "true" : "false"}
            aria-label={liked ? "Unlike this photo" : "Like this photo"}
            aria-busy={submitting}
            disabled={!available}
            onClick={() => submitLike(liked ? "unlike" : "like")}
          >
            <HeartIcon filled={liked} />
          </button>

          {available ? (
            <p className="engagement__count" aria-live="polite">
              <span className="engagement__count-value">{likeCount}</span>
              <span className="visually-hidden">
                {likeCount === 1 ? " like" : " likes"}
                {liked ? ", including yours" : ""}
              </span>
            </p>
          ) : null}
        </div>

        <button
          type="button"
          className="button engagement__share"
          onClick={() => setShareOpen((open) => !open)}
          aria-expanded={shareOpen}
          aria-controls="engagement-share-panel"
        >
          Share
        </button>
      </div>

      {!available && availabilityReason ? (
        <p className="engagement__note" role="status">
          {availabilityReason}
        </p>
      ) : null}

      {shareOpen ? (
        <div className="engagement__fallbacks" id="engagement-share-panel">
          <ul className="engagement__channels">
            {PANEL_ORDER.map((channel) => {
              if (channel === "native") {
                // The device's own share sheet, only where the browser has one.
                return nativeShareAvailable ? (
                  <li key={channel}>
                    <button type="button" className="text-link" onClick={shareNatively}>
                      {SHARE_CHANNEL_LABELS.native}
                    </button>
                  </li>
                ) : null;
              }
              if (channel === "copy_link") {
                return (
                  <li key={channel}>
                    <button type="button" className="text-link" onClick={copyLink}>
                      {SHARE_CHANNEL_LABELS[channel]}
                    </button>
                  </li>
                );
              }
              return isOutboundShareChannel(channel) ? (
                <li key={channel}>
                  <button type="button" className="text-link" onClick={() => openOutbound(channel)}>
                    {SHARE_CHANNEL_LABELS[channel]}
                  </button>
                </li>
              ) : null;
            })}
          </ul>
          {/*
            The link is also shown as selectable text, so a visitor whose clipboard
            is unavailable can still copy it by hand.
          */}
          <p className="engagement__link">
            <label htmlFor="engagement-canonical">Link to this photo</label>
            <input
              id="engagement-canonical"
              type="text"
              readOnly
              value={canonicalUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
          </p>
        </div>
      ) : null}

      {/* Always mounted, so screen readers announce a note when one appears. */}
      <p className="engagement__note" role="status">
        {status ? shareStatusMessage(status) : null}
      </p>
    </div>
  );
}
