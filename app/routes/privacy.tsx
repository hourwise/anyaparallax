import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { site } from "../data/site";
import { appEnvironmentFrom } from "../data/context.server";
import { readPublicSiteSettings } from "../data/site-settings.server";

export async function loader({ context }: { context: unknown }) {
  return { likesEnabled: (await readPublicSiteSettings(appEnvironmentFrom(context))).likesEnabled };
}

export const meta: MetaFunction = () => [
  { title: `Privacy — ${site.name} ${site.secondary}` },
  {
    name: "description",
    content:
      "What this site keeps when you send an enquiry or share a photo, how long it is kept, and who handles it.",
  },
];

/**
 * Privacy notice.
 *
 * WHY IT EXISTS: the site needed a Privacy destination before any anonymous launch, and a
 * footer link to nothing would be worse than no link at all.
 *
 * WHAT IT MAY AND MAY NOT SAY. Every statement below describes the ACTUAL code: the
 * enquiry rows and the columns they do not have, conditional like behaviour, the
 * absence of IP/user-agent/referrer/fingerprint storage and third-party analytics,
 * the approved controller/contact/retention facts, and Cloudflare Access for
 * operator sign-in. Nothing here claims more than the implementation proves.
 */
export default function PrivacyRoute() {
  const { likesEnabled } = useLoaderData<typeof loader>();
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

      <section className="workspace-block" aria-labelledby="controller-heading">
        <h2 id="controller-heading">Who handles your information</h2>
        <p>The personal information submitted through this site is handled by Phil at PCGSoft on behalf of anyaparallax.</p>
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
        <p>We keep enquiry information for up to six months unless it is still needed to deal with an ongoing enquiry. Older enquiries are then deleted.</p>
      </section>

      <section className="workspace-block" aria-labelledby="engagement-heading">
        <h2 id="engagement-heading">Likes and shares</h2>
        {likesEnabled ? <><h3>Likes</h3><p>
          The first time you like a photo, the site sets a single cookie called{" "}
          <code>anyaparallax_browser</code>. It holds a random value, and its only job is to
          make sure the same browser can't like the same photo twice. It belongs to this site
          alone and isn't shared with anyone.
        </p><p>
          The value is not derived from your IP address, your device, the page you came from or
          anything you type. We don't even store the value itself: the database keeps a
          scrambled, one-way version of it (a SHA-256 digest), which is enough to spot a repeat
          like and can't be turned back into the cookie.
        </p><p>
          For the technically curious: the cookie is HttpOnly (scripts on the page can't read
          it), SameSite=Lax, Secure on encrypted connections, and it lasts up to 400 days. If
          you clear your cookies it's gone, and a new one is only created if you like a photo
          again.
        </p></> : <><h3>Likes</h3><p>Likes are currently disabled. The site does not offer a Like action, show like counts or create the like cookie while this setting is off.</p></>}
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
          <li>No account needed to browse or share.</li>
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
          email <a className="text-link" href="mailto:phil@pcgsoft.co.uk">phil@pcgsoft.co.uk</a>.
          Use this address for access, correction, deletion or any other privacy enquiry.
        </p>
      </section>
    </section>
  );
}
