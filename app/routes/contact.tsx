import { data, redirect, type MetaFunction } from "react-router";
import { Link, useActionData, useLoaderData, useNavigation } from "react-router";

import { EnquiryForm } from "../components/EnquiryForm";
import { siteOriginFrom } from "../data/canonical-origin";
import { appEnvironmentFrom } from "../data/context.server";
import { site } from "../data/site";
import { abuseEvidenceFrom, screenEnquirySubmission } from "../enquiries/abuse-guard";
import { ENQUIRY_COPY } from "../enquiries/enquiry";
import { submitEnquiry } from "../enquiries/enquiries.server";
import { formValuesFrom, type EnquiryFieldErrors, type EnquiryFormValues } from "../enquiries/validation";
import { metadataTags, pageMetadataFor } from "../engagement/metadata";
import { isSameOriginRequest } from "../lib/same-origin";
import { checkRequestSize } from "../lib/request-bound";
import { contactPath, contactReceivedPath, printsEnquirePath } from "../lib/paths";

const SITE_NAME = `${site.name} ${site.secondary}`;

/**
 * The largest body this form will parse (REPAIR-09D).
 *
 * Generous for the fields the form has — a 4,000-character message is the biggest
 * thing a visitor can send — and small enough that an oversized body is refused from
 * its headers before `request.formData()` buffers it.
 */
const MAX_ENQUIRY_REQUEST_BYTES = 16 * 1024;

/**
 * Contact (Slice 08).
 *
 * The page shares the enquiry store with the print path but keeps the two
 * journeys apart, which is enforced in three places rather than by wording:
 *
 *   * the form is rendered in `contact` mode, so it has a category selector and
 *     NO print-only fields;
 *   * the action sends only the general fields, and the validator REFUSES a
 *     photograph, format or size on a general message rather than dropping it;
 *   * the stored row is therefore distinguishable from a print enquiry by its
 *     category and by the print columns being null.
 *
 * NO ADDRESS IS PUBLISHED. The operator has not supplied a destination email, and
 * inventing one — or publishing the operator's own — would be worse than saying
 * plainly that the form is the way to get in touch. Nothing here claims an email
 * is sent by the site: the message is stored and read in Anya's enquiry list.
 *
 * `cache-control: no-store` for the same reason as the print form: this response
 * carries a single-use submission token, and a cached copy would hand one token to
 * several visitors and collapse their later enquiries into one.
 */
export async function loader({ context }: { context: unknown }) {
  const env = appEnvironmentFrom(context);
  const origin = siteOriginFrom(env);

  return data(
    {
      metadata: pageMetadataFor(origin, {
        path: contactPath,
        title: "Contact",
        description:
          "Contact Anyaparallax about band, gig, event, car or print photography. Messages are " +
          "read by Anya and answered personally; no public email address is published here.",
        siteName: SITE_NAME,
      }),
      submissionToken: crypto.randomUUID(),
      // The timing half of the abuse guard: the moment this form was rendered.
      formIssuedAt: String(Date.now()),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData) {
    return [{ title: `Contact — ${SITE_NAME}` }];
  }
  return metadataTags(loaderData.metadata);
};

/** HTTP 400 with the form re-rendered. Never indexable: it echoes the submission. */
function rejected(
  errors: EnquiryFieldErrors,
  values: EnquiryFormValues | null,
  message: string | null = null,
) {
  return data(
    { errors, values, unavailable: message },
    {
      status: 400,
      headers: { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" },
    },
  );
}

/**
 * The write path.
 *
 * Only the general fields are read from the form. `photoSlug`, `printFormat` and
 * `printSize` are passed through as `undefined` rather than as whatever the body
 * contained, and the validator then refuses them if the body supplied any: a
 * contact POST cannot become a print enquiry, and a print field cannot ride along
 * unnoticed. Success redirects (303) to an acknowledgement that holds none of the
 * submission.
 *
 * REPAIR-09D adds two gates ahead of that, in this order:
 *
 *   1. the request must declare a size this application is willing to parse, checked
 *      from the headers BEFORE `request.formData()` materialises the body;
 *   2. the submission must look like it came from the form rather than from a script
 *      — an empty trap field, a plausible completion interval and an age inside the
 *      window. That guard reads form values only and stores nothing.
 *
 * A refused submission writes no row, sends nothing and reports only that it was not
 * accepted. The existing validation, token and idempotency rules are unchanged and
 * still run after both gates.
 */
export async function action({ request, context }: { request: Request; context: unknown }) {
  if (!isSameOriginRequest(request)) {
    return data(
      { errors: {}, values: null, unavailable: ENQUIRY_COPY.unavailable },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }

  const size = checkRequestSize(request, MAX_ENQUIRY_REQUEST_BYTES);
  if (!size.ok) {
    // Nothing about the rule is echoed: a refusal says only that the message was not
    // accepted.
    return rejected({}, null, ENQUIRY_COPY.submissionNotAccepted);
  }

  const env = appEnvironmentFrom(context);
  const form = await request.formData();
  const verdict = screenEnquirySubmission(abuseEvidenceFrom((name) => form.get(name)), Date.now());
  if (!verdict.accepted) {
    return rejected(
      {},
      formValuesFrom({
        name: form.get("name"),
        email: form.get("email"),
        category: form.get("category"),
        message: form.get("message"),
        // Carried through `formValuesFrom` only because that shape includes it; the
        // form itself always renders the LOADER's fresh token, never this one.
        submissionToken: form.get("submissionToken"),
      }),
      verdict.refusal === "links"
        ? ENQUIRY_COPY.linksNotAccepted
        : ENQUIRY_COPY.submissionNotAccepted,
    );
  }

  const raw = {
    name: form.get("name"),
    email: form.get("email"),
    category: form.get("category"),
    message: form.get("message"),
    // Read deliberately so an unexpected value is REFUSED by validation rather
    // than ignored: silently dropping it would hide that the two journeys were
    // mixed up.
    photoSlug: form.get("photoSlug"),
    printFormat: form.get("printFormat"),
    printSize: form.get("printSize"),
    submissionToken: form.get("submissionToken"),
  };

  const result = await submitEnquiry(raw, env);
  if (result.status === "recorded") {
    return redirect(contactReceivedPath, { status: 303 });
  }
  if (result.status === "invalid") {
    return rejected(result.errors, result.values);
  }
  return data(
    { errors: {}, values: formValuesFrom(raw), unavailable: ENQUIRY_COPY.unavailable },
    { status: 503, headers: { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } },
  );
}

export default function ContactRoute() {
  const { submissionToken, formIssuedAt } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <section className="page container">
      <header className="page__header">
        <p className="eyebrow">Contact</p>
        <h1>Contact</h1>
        <p className="lede">
          Band, gig, event, car and print enquiries all reach Anya through this form, and she
          answers them personally.
        </p>
      </header>

      <div className="prose">
        <p>
          No public email address is published here, and nothing you send is forwarded anywhere
          automatically: your message is stored in Anya&rsquo;s enquiry list, and she replies from
          her own email.
        </p>
      </div>

      <div className="split">
        <div className="split__copy">
          <EnquiryForm
            mode="contact"
            values={
              result?.values ?? {
                name: "",
                email: "",
                message: "",
                category: "",
                photoSlug: "",
                printFormat: "",
                printSize: "",
                submissionToken,
              }
            }
            errors={result?.errors ?? {}}
            submissionToken={submissionToken}
            formIssuedAt={formIssuedAt}
            photo={null}
            photoNotOffered={false}
            unavailableMessage={result?.unavailable ?? null}
          />
          {busy ? (
            <p className="muted" role="status">
              Sending…
            </p>
          ) : null}
        </div>

        <div className="split__media">
          <div className="prose">
            <h2>Print enquiries</h2>
            <p>
              Print interest has its own form, because it asks about a format and a size and can
              name the photograph you are interested in.
            </p>
            <p>
              <Link className="text-link" to={printsEnquirePath}>
                Register interest in a print
              </Link>
            </p>
            <p className="muted">
              Only what you type here is stored: your name, email address, what the enquiry is
              about and your message. No address, browser details or tracking identifiers are
              recorded.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
