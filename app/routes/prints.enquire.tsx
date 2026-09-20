import { data, redirect, type MetaFunction } from "react-router";
import { Link, useActionData, useLoaderData, useNavigation } from "react-router";

import { EnquiryForm } from "../components/EnquiryForm";
import { siteOriginFrom } from "../data/canonical-origin";
import { appEnvironmentFrom } from "../data/context.server";
import { getPublishedPhoto } from "../data/queries";
import { site } from "../data/site";
import { abuseEvidenceFrom, screenEnquirySubmission } from "../enquiries/abuse-guard";
import { ENQUIRY_COPY } from "../enquiries/enquiry";
import { submitEnquiry } from "../enquiries/enquiries.server";
import { formValuesFrom, type EnquiryFieldErrors, type EnquiryFormValues } from "../enquiries/validation";
import { metadataTags, pageMetadataFor } from "../engagement/metadata";
import { isSameOriginRequest } from "../lib/same-origin";
import { checkRequestSize } from "../lib/request-bound";
import { photoPath, printsEnquirePath, printsEnquireReceivedPath, printsPath } from "../lib/paths";

/**
 * The largest body this form will parse (REPAIR-09D).
 *
 * Generous for the fields this form has and small enough that an oversized body is
 * refused from its headers before `request.formData()` buffers it.
 */
const MAX_ENQUIRY_REQUEST_BYTES = 16 * 1024;

const SITE_NAME = `${site.name} ${site.secondary}`;

const FORM_TITLE = "Print enquiry";

/**
 * The print enquiry form (Slice 08).
 *
 * THE PHOTOGRAPH IS RESOLVED, NOT BELIEVED. `?photo=<slug>` is looked up through
 * the public projection, and the page distinguishes three cases deliberately:
 *
 *   * unknown or unpublished  → 404, the same answer every public route gives, so
 *     publication state cannot be inferred from this page's behaviour;
 *   * published, not eligible → the general print-interest form, with an honest
 *     notice that the photograph is not currently offered. A dead end would be
 *     worse than a truthful alternative;
 *   * published and eligible  → the form names the photograph.
 *
 * The slug is then re-resolved on submit by the service, so a page that was
 * rendered while a photograph was eligible cannot be replayed after it stops
 * being so.
 *
 * `cache-control: no-store` is required rather than cosmetic: this response
 * carries a single-use submission token, and a cached copy would hand the same
 * token to several visitors, whose second and later enquiries would then be
 * collapsed by the duplicate guard and silently lost.
 */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  const env = appEnvironmentFrom(context);
  const origin = siteOriginFrom(env);
  const requestedSlug = new URL(request.url).searchParams.get("photo");

  let photo: { readonly slug: string; readonly title: string } | null = null;
  let photoNotOffered = false;

  if (requestedSlug !== null && requestedSlug.length > 0) {
    const published = await getPublishedPhoto(requestedSlug, env);
    if (!published) {
      // Unknown and unpublished are indistinguishable publicly: no metadata for a
      // draft is produced, because there is no loader data to produce it from.
      throw new Response("Photograph not found", { status: 404, statusText: "Not Found" });
    }
    if (published.printAvailable) {
      photo = { slug: published.slug, title: published.title };
    } else {
      photoNotOffered = true;
    }
  }

  const metadata = pageMetadataFor(origin, {
    path: printsEnquirePath,
    title: photo ? `${FORM_TITLE} — ${photo.title}` : FORM_TITLE,
    description:
      "Register interest in a print, or ask about availability, format, size and price. " +
      "Enquiries are answered personally; there is no checkout and no payment on this site.",
    siteName: SITE_NAME,
  });

  return data(
    {
      metadata,
      photo,
      photoNotOffered,
      // Issued per render and never reused across visitors. It is an idempotency
      // key for the retry case, not an identifier for the visitor.
      submissionToken: crypto.randomUUID(),
      // The timing half of the abuse guard: the moment this form was rendered.
      formIssuedAt: String(Date.now()),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData) {
    return [{ title: `${FORM_TITLE} — ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
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
 * The same-origin guard runs FIRST, before `request.formData()`, so a cross-site
 * submission cannot even cause this route to parse a body. It reuses the rule the
 * engagement endpoint already applies rather than inventing a second one.
 *
 * The service is then handed the form's VALUES and the environment — never the
 * request. That is what makes "no IP address, no user agent, no referrer and no
 * engagement token is stored" a property of the code rather than a promise: the
 * module that writes the row has no way to read any of them.
 *
 * Success REDIRECTS (303) to an acknowledgement that carries none of the
 * submission, so a refresh cannot resubmit and the result page holds no customer
 * detail to leak or index.
 *
 * REPAIR-09D adds two gates ahead of the service, in this order: a header-only size
 * bound before the body is parsed, and a non-identifying abuse screen over the form
 * VALUES. Neither touches the authority chain above — the photograph is still
 * resolved against the database, so an unpublished, hidden-gallery or ineligible
 * photograph remains impossible to enquire about whatever the abuse state is, and a
 * refused submission writes no row.
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
        photoSlug: form.get("photoSlug"),
        printFormat: form.get("printFormat"),
        printSize: form.get("printSize"),
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
    photoSlug: form.get("photoSlug"),
    printFormat: form.get("printFormat"),
    printSize: form.get("printSize"),
    submissionToken: form.get("submissionToken"),
  };

  const result = await submitEnquiry(raw, env);
  if (result.status === "recorded") {
    // A fresh token is issued by the next form render, so this one is spent.
    return redirect(printsEnquireReceivedPath, { status: 303 });
  }
  if (result.status === "invalid") {
    return rejected(result.errors, result.values);
  }
  return data(
    { errors: {}, values: formValuesFrom(raw), unavailable: ENQUIRY_COPY.unavailable },
    { status: 503, headers: { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } },
  );
}

export default function PrintEnquiryRoute() {
  const { photo, photoNotOffered, submissionToken, formIssuedAt } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <section className="page container">
      <p className="eyebrow">
        <Link to={printsPath}>Prints</Link>
      </p>
      <header className="page__header">
        <h1>{photo ? `Enquire about “${photo.title}”` : FORM_TITLE}</h1>
        <p className="lede">
          {photo
            ? "Send an enquiry about a print of this photograph."
            : "Register interest in prints, or ask about a particular photograph."}{" "}
          Anya replies personally to confirm availability, format, size and price.
        </p>
      </header>

      <div className="split">
        <div className="split__copy">
          <EnquiryForm
            mode="print"
            values={
              result?.values ?? {
                name: "",
                email: "",
                message: "",
                category: "",
                photoSlug: photo?.slug ?? "",
                printFormat: "",
                printSize: "",
                submissionToken,
              }
            }
            errors={result?.errors ?? {}}
            // Always the loader's token: a refused submission must be re-sent with
            // a token the server has not already seen.
            submissionToken={submissionToken}
            formIssuedAt={formIssuedAt}
            photo={photo}
            photoNotOffered={photoNotOffered}
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
            <h2>What happens next</h2>
            <ul className="plain-list">
              <li>Anya reads the enquiry and replies to the email address you give.</li>
              <li>Availability, format, size and price are confirmed in that reply.</li>
              <li>Nothing is charged here, and no print is promised until she confirms it.</li>
            </ul>
            <p className="muted">
              Only the details on this form are stored: your name, email address, what the enquiry
              is about and your message. No address, browser details or tracking identifiers are
              recorded.
            </p>
            {photo ? (
              <p>
                <Link className="text-link" to={photoPath(photo.slug)}>
                  Back to the photograph
                </Link>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
