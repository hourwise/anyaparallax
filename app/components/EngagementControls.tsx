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
 * component never adds one to a number, and while a request is in flight it says
 * it is working rather than showing a total that storage has not confirmed. That
 * is why the only local state is the share disclosure and its message.
 *
 * NOTHING CLAIMS AN OUTCOME. Opening the Web Share sheet or an outbound link is an
 * interaction; whether anything was posted is unknowable from here, and the copy
 * says so. The single confirmed success is a completed clipboard write, because
 * the application performs that itself and can see it succeed.
 *
 * The controls stay small: a button, a number and a disclosure. The photograph
 * remains the subject of the page.
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
   * every visitor. It starts false — the safe assumption, because the fallbacks
   * are always truthful — and is corrected once the component is live.
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
  // the loader's value is shown unchanged. `submitting` disables the button, so a
  // double submit cannot race itself.
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

  /** Submit a like or unlike. The body names only the action. */
  function submitLike(action: "like" | "unlike") {
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
   * The Web Share API path.
   *
   * The sheet resolving means the visitor finished with the sheet, not that
   * anything was posted, so the message says the panel opened and stops there.
   */
  async function shareNatively() {
    recordInitiation("native");
    if (!nativeShareAvailable || typeof navigator === "undefined" || !navigator.share) {
      setStatus("nativeUnavailable");
      setShareOpen(true);
      return;
    }
    try {
      await navigator.share({
        title: shareTarget.title,
        text: shareTarget.description,
        url: canonicalUrl,
      });
      setStatus("nativeOpened");
    } catch {
      // A dismissed sheet is not an error worth alarming anyone about, but the
      // fallbacks are offered either way so nobody is left with no option.
      setStatus("nativeUnavailable");
      setShareOpen(true);
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
      setStatus("linkCopied");
    } catch {
      // Honest failure: no claim of success, and the link is shown for manual use.
      setStatus("copyFailed");
      setShareOpen(true);
    }
  }

  /** Open an outbound share URL. The application learns nothing about the result. */
  function openOutbound(channel: ShareChannel) {
    const url = shareUrlFor(channel, shareTarget);
    if (url === null) {
      return;
    }
    recordInitiation(channel);
    setStatus("outboundOpened");
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="engagement" aria-label="Photograph engagement">
      <div className="engagement__row">
        <button
          type="button"
          className="button engagement__like"
          aria-pressed={liked}
          disabled={!available || submitting}
          aria-disabled={!available || submitting}
          onClick={() => submitLike(liked ? "unlike" : "like")}
        >
          {submitting ? "Working…" : liked ? "Unlike" : "Like"}
        </button>

        <p className="engagement__count" aria-live="polite">
          {available ? (
            <>
              <span className="engagement__count-value">{likeCount}</span>{" "}
              <span className="engagement__count-label">
                {likeCount === 1 ? "like" : "likes"}
              </span>
            </>
          ) : (
            <span className="engagement__count-label">Likes unavailable</span>
          )}
        </p>

        <button
          type="button"
          className="button engagement__share"
          onClick={shareNatively}
          aria-expanded={shareOpen}
        >
          {SHARE_CHANNEL_LABELS.native}
        </button>

        <button
          type="button"
          className="button engagement__toggle"
          onClick={() => setShareOpen((open) => !open)}
          aria-expanded={shareOpen}
        >
          {shareOpen ? "Hide sharing options" : "More sharing options"}
        </button>
      </div>

      {!available && availabilityReason ? (
        <p className="engagement__note" role="status">
          {availabilityReason}
        </p>
      ) : null}

      {status ? (
        <p className="engagement__note" role="status">
          {shareStatusMessage(status)}
        </p>
      ) : null}

      {shareOpen ? (
        <div className="engagement__fallbacks">
          {/*
            The link is also shown as selectable text, so a visitor whose clipboard
            is unavailable still has an honest way to share it by hand.
          */}
          <p className="engagement__link">
            <label htmlFor="engagement-canonical">Link</label>
            <input id="engagement-canonical" type="text" readOnly value={canonicalUrl} />
          </p>
          <ul className="engagement__channels">
            {SHARE_CHANNELS.filter((channel) => channel !== "native").map((channel) => (
              <li key={channel}>
                {channel === "copy_link" ? (
                  <button type="button" className="text-link" onClick={copyLink}>
                    {SHARE_CHANNEL_LABELS[channel]}
                  </button>
                ) : isOutboundShareChannel(channel) ? (
                  <button type="button" className="text-link" onClick={() => openOutbound(channel)}>
                    {SHARE_CHANNEL_LABELS[channel]}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="engagement__caveat">
            These open the service in a new tab. Nothing here confirms that a share was
            completed, and no count of shares is shown.
          </p>
        </div>
      ) : null}
    </div>
  );
}
