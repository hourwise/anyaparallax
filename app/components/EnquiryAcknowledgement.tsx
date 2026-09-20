import { Link } from "react-router";

import { ENQUIRY_COPY } from "../enquiries/enquiry";

/**
 * The acknowledgement shown after an enquiry is stored (Slice 08).
 *
 * It deliberately contains NOTHING ABOUT THE SUBMISSION: no name, no email
 * address, no message and no photograph title. Two consequences follow, and both
 * are wanted:
 *
 *   * the page cannot leak a customer's details into a document title, a meta
 *     description, an OpenGraph tag, a URL or a client bundle, because it never
 *     receives them; and
 *   * a reload, a bookmark or a shared link re-renders the same true sentence
 *     rather than replaying someone's message back at whoever opens it.
 *
 * The wording claims exactly what happened — the enquiry was received — and
 * nothing more. It does not claim an order exists, that payment was taken, that a
 * print is available, or that an email was sent: this application performs none of
 * those, and no mail provider is configured.
 */
export function EnquiryAcknowledgement({
  kind,
  backTo,
  backLabel,
}: {
  readonly kind: "print" | "contact";
  readonly backTo: string;
  readonly backLabel: string;
}) {
  return (
    <section className="page container">
      <header className="page__header">
        <p className="eyebrow">{kind === "print" ? "Print enquiry" : "Contact"}</p>
        <h1>
          {kind === "print"
            ? ENQUIRY_COPY.acknowledgementHeading
            : ENQUIRY_COPY.acknowledgementHeadingContact}
        </h1>
      </header>

      <div className="prose">
        <p className="lede">
          {kind === "print"
            ? ENQUIRY_COPY.acknowledgementBody
            : ENQUIRY_COPY.acknowledgementBodyContact}
        </p>
        {kind === "print" ? (
          <p>
            Print enquiries are answered personally, so a reply may take a few days. Nothing is
            reserved or charged while you wait.
          </p>
        ) : (
          <p>
            Messages are read in Anya&rsquo;s enquiry list and answered from her own email, so a
            reply may take a few days.
          </p>
        )}
      </div>

      <p className="section-actions">
        <Link className="button" to={backTo}>
          {backLabel}
        </Link>
      </p>
    </section>
  );
}
