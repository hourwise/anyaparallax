import type { MetaFunction } from "react-router";

import { site } from "../data/site";

export const meta: MetaFunction = () => [
  { title: `Privacy — ${site.name} ${site.secondary}` },
  {
    name: "description",
    content:
      "What this site keeps when you send an enquiry or like a photo, the one small cookie it uses, and what it never collects.",
  },
];

/**
 * Privacy notice.
 *
 * WHY IT EXISTS: the site needed a Privacy destination before any anonymous launch, and a
 * footer link to nothing would be worse than no link at all.
 *
 * WHAT IT MAY AND MAY NOT SAY. Every statement below describes the ACTUAL code: the
 * enquiry rows and the columns they do not have, the anonymous per-browser identifier
 * used to count a like once, the absence of any IP/user-agent/referrer/fingerprint
 * storage, the absence of third-party analytics, and Cloudflare Access for operator
 * sign-in. Nothing here is a legal claim, and the three facts this application cannot know
 * — who the data controller is, how long enquiries are kept, and which address to write to
 * — are shown as still to be confirmed rather than invented.
 *
 * OWNER TASK: replace the "Details still to be confirmed" block with those three facts
 * before public launch. The served completion check looks for that heading, so update
 * `scripts/checks/check-v1-completion-served.mjs` in the same change.
 */
export default function PrivacyRoute() {
  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Privacy</p>
        <h1>Privacy</h1>
        <p className="lede">
          This is a photography site, not a data business. Here is what it keeps, why, and
          what it never collects.
        </p>
      </header>

      <section className="workspace-block" aria-labelledby="operator-tasks-heading">
        <h2 id="operator-tasks-heading">Details still to be confirmed</h2>
        <p className="notice notice--warning">
          Before the site opens to the public, this page will also say who is responsible for
          your information, how long enquiries are kept, and where to write about your data.
          Until then, you can reach us through the{" "}
          <a className="text-link" href="/contact">contact form</a>.
        </p>
      </section>

      <section className="workspace-block" aria-labelledby="enquiries-heading">
        <h2 id="enquiries-heading">When you send an enquiry</h2>
        <p>
          The contact form and the print enquiry form ask for your name, your email address
          and your message, and what the enquiry is about. For a print enquiry we also note
          the photo, and the format and size you're interested in. We keep these details so we
          can reply to you.
        </p>
        <p>
          We don't keep your IP address, your browser or device details, the page you came
          from, or anything that identifies your browser alongside an enquiry. Each form also
          carries a one-off code so that pressing send twice doesn't send the same enquiry
          twice.
        </p>
        <p>
          Enquiries can only be read in the site's private management area, which is protected
          by Cloudflare Access.
        </p>
      </section>

      <section className="workspace-block" aria-labelledby="engagement-heading">
        <h2 id="engagement-heading">Likes and shares</h2>
        <h3>The one cookie we use</h3>
        <p>
          The first time you like a photo, the site sets a single cookie called{" "}
          <code>anyaparallax_browser</code>. It holds a random value, and its only job is to
          make sure the same browser can't like the same photo twice. It belongs to this site
          alone and isn't shared with anyone.
        </p>
        <p>
          The value is not derived from your IP address, your device, the page you came from or
          anything you type. We don't even store the value itself: the database keeps a
          scrambled, one-way version of it (a SHA-256 digest), which is enough to spot a repeat
          like and can't be turned back into the cookie.
        </p>
        <p>
          For the technically curious: the cookie is HttpOnly (scripts on the page can't read
          it), SameSite=Lax, Secure on encrypted connections, and it lasts up to 400 days. If
          you clear your cookies it's gone, and a new one is only created if you like a photo
          again.
        </p>
        <h3>Sharing</h3>
        <p>
          When you use one of the share buttons, the site notes which photo and which option
          you picked, and nothing about you. It can't see whether you went on to post or send
          anything, and it never posts anything on your behalf.
        </p>
      </section>

      <section className="workspace-block" aria-labelledby="not-collected-heading">
        <h2 id="not-collected-heading">What we don't do</h2>
        <ul className="plain-list">
          <li>No third-party analytics, advertising or tracking scripts.</li>
          <li>No record of your IP address, browser or the page you came from.</li>
          <li>No fingerprinting, and no following you from site to site.</li>
          <li>No account needed to browse, like or share.</li>
          <li>
            No analytics, advertising or profiling cookies. You don't need to accept any
            cookie to browse the site.
          </li>
        </ul>
      </section>

      <section className="workspace-block" aria-labelledby="operators-heading">
        <h2 id="operators-heading">The management area</h2>
        <p>
          The parts of the site used to manage photos and enquiries are protected by Cloudflare
          Access, so only people the site owner has approved can get in. This site never sees
          or stores their passwords. None of this affects visitors.
        </p>
      </section>

      <section className="workspace-block" aria-labelledby="questions-heading">
        <h2 id="questions-heading">Questions or requests</h2>
        <p>
          If you'd like to ask about an enquiry you've sent, or have it corrected or deleted,
          just send a message through the{" "}
          <a className="text-link" href="/contact">contact form</a> and let us know. There's no
          public email address on the site.
        </p>
      </section>
    </section>
  );
}
