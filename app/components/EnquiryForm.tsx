import { Form } from "react-router";

import {
  CONTACT_CATEGORIES,
  ENQUIRY_CATEGORY_LABELS,
  ENQUIRY_COPY,
  ENQUIRY_LIMITS,
  PRINT_ENQUIRY_CATEGORY,
  PRINT_FORMAT_LABELS,
  PRINT_FORMATS,
} from "../enquiries/enquiry";
import { FORM_ISSUED_AT_FIELD, FORM_TRAP_FIELD } from "../enquiries/abuse-guard";
import type { EnquiryFieldErrors, EnquiryFormValues } from "../enquiries/validation";

/**
 * The one enquiry form (Slice 08), used by both public enquiry paths.
 *
 * Print enquiries and general contact messages share this form because they share
 * one store, but they are not the same journey and the form does not pretend they
 * are. The difference is structural rather than cosmetic:
 *
 *   * a PRINT enquiry has no category selector — it IS the print category, sent as
 *     a hidden value — and it may carry a photograph, a format preference and a
 *     size preference;
 *   * a CONTACT message chooses from the general categories and carries none of
 *     the print-only fields.
 *
 * The server enforces the same split (`validateEnquiry` refuses a print-only field
 * on a general message), so the distinction does not depend on this component
 * having rendered the right inputs.
 *
 * `values` are echoed back only when a submission was refused, so a visitor does
 * not lose what they typed. They are never placed in the document metadata, and
 * the response that carries them is marked `no-store`.
 */
export type EnquiryFormProps = {
  readonly mode: "print" | "contact";
  readonly values: EnquiryFormValues;
  readonly errors: EnquiryFieldErrors;
  /** A fresh single-use token issued by the loader for this render. */
  readonly submissionToken: string;
  /**
   * When the loader rendered this form, in epoch milliseconds (REPAIR-09D).
   *
   * Always the LOADER's value, never one echoed back from a refused submission: a
   * refusal re-renders immediately, and reusing the original time would make an
   * honest second attempt fail the same interval check that the first one did.
   */
  readonly formIssuedAt: string;
  /** The photograph the server has accepted for this enquiry, or null. */
  readonly photo: { readonly slug: string; readonly title: string } | null;
  /** True when a photograph was asked for and the server will not offer it. */
  readonly photoNotOffered: boolean;
  /** Set when the submission could not be stored at all. */
  readonly unavailableMessage: string | null;
};

export function EnquiryForm({
  mode,
  values,
  errors,
  submissionToken,
  formIssuedAt,
  photo,
  photoNotOffered,
  unavailableMessage,
}: EnquiryFormProps) {
  const isPrint = mode === "print";
  const errorEntries = Object.entries(errors);

  return (
    <Form method="post" className="enquiry-form">
      <input type="hidden" name="submissionToken" value={submissionToken} />
      <input type="hidden" name={FORM_ISSUED_AT_FIELD} value={formIssuedAt} />
      {/*
        The bot trap (REPAIR-09D). It is an ordinary text input that people cannot
        see and cannot reach: the wrapper is `aria-hidden`, the input is removed from
        the tab order and autofill is off, so a screen-reader or keyboard user never
        encounters it, while a form-filling script sees a plausible optional field.
        A non-empty value refuses the submission and is never stored. It is not
        `type="hidden"`, because scripts that skip hidden inputs would skip the trap.
      */}
      <div aria-hidden="true" className="enquiry-form__trap">
        <label htmlFor="enquiry-website">
          Website
          <input
            id="enquiry-website"
            name={FORM_TRAP_FIELD}
            type="text"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </label>
      </div>
      {/*
        The print category is a constant of this form rather than a choice: a
        selector here would invite a visitor to file a print enquiry as "gig
        photography" and produce a record this application cannot interpret.
      */}
      {isPrint ? (
        <input type="hidden" name="category" value={PRINT_ENQUIRY_CATEGORY} />
      ) : null}
      {/*
        The photograph is carried as a slug and RE-RESOLVED by the server on
        submit. Nothing about its title, publication state or print eligibility is
        submitted as a fact, because none of those would be trustworthy.
      */}
      {isPrint && photo ? <input type="hidden" name="photoSlug" value={photo.slug} /> : null}

      {unavailableMessage ? (
        <p className="notice notice--warning" role="alert">
          {unavailableMessage}
        </p>
      ) : null}

      {photoNotOffered ? (
        <p className="notice notice--warning" role="status">
          {ENQUIRY_COPY.photoNotOffered}
        </p>
      ) : null}

      {errorEntries.length > 0 ? (
        <div className="notice notice--warning" role="alert">
          <p>Please check the following and send the form again.</p>
          <ul className="plain-list">
            {errorEntries.map(([field, message]) => (
              <li key={field}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="notice">{ENQUIRY_COPY.noCheckoutNotice}</p>

      {isPrint ? (
        <p className="enquiry-form__subject">
          {photo ? (
            <>
              Enquiring about: <strong>{photo.title}</strong>
            </>
          ) : (
            <>Registering interest in prints, without naming a particular photograph.</>
          )}
        </p>
      ) : null}

      <label htmlFor="enquiry-name">
        Your name
        <input
          id="enquiry-name"
          name="name"
          type="text"
          required
          maxLength={ENQUIRY_LIMITS.name}
          autoComplete="name"
          defaultValue={values.name}
          aria-describedby={errors.name ? "enquiry-name-error" : undefined}
        />
      </label>
      {errors.name ? (
        <p className="field-error" id="enquiry-name-error">
          {errors.name}
        </p>
      ) : null}

      <label htmlFor="enquiry-email">
        Your email
        <input
          id="enquiry-email"
          name="email"
          type="email"
          required
          maxLength={ENQUIRY_LIMITS.email}
          autoComplete="email"
          defaultValue={values.email}
          aria-describedby={errors.email ? "enquiry-email-error" : undefined}
        />
      </label>
      {errors.email ? (
        <p className="field-error" id="enquiry-email-error">
          {errors.email}
        </p>
      ) : null}

      {isPrint ? null : (
        <>
          <label htmlFor="enquiry-category">
            What is this about?
            <select
              id="enquiry-category"
              name="category"
              required
              defaultValue={values.category}
              aria-describedby={errors.category ? "enquiry-category-error" : undefined}
            >
              <option value="">Please choose…</option>
              {CONTACT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {ENQUIRY_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </label>
          {errors.category ? (
            <p className="field-error" id="enquiry-category-error">
              {errors.category}
            </p>
          ) : null}
        </>
      )}

      {isPrint ? (
        <>
          <label htmlFor="enquiry-format">
            Print format preference (optional)
            <select id="enquiry-format" name="printFormat" defaultValue={values.printFormat}>
              <option value="">No preference</option>
              {PRINT_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {PRINT_FORMAT_LABELS[format]}
                </option>
              ))}
            </select>
          </label>
          {errors.printFormat ? <p className="field-error">{errors.printFormat}</p> : null}

          <label htmlFor="enquiry-size">
            Preferred size (optional)
            <input
              id="enquiry-size"
              name="printSize"
              type="text"
              maxLength={ENQUIRY_LIMITS.printSize}
              defaultValue={values.printSize}
              placeholder="For example: about 40 × 50 cm"
              aria-describedby="enquiry-size-hint"
            />
          </label>
          <p className="muted" id="enquiry-size-hint">
            Dimensions and prices are confirmed with Anya, so there is no fixed size list here.
          </p>
          {errors.printSize ? <p className="field-error">{errors.printSize}</p> : null}
        </>
      ) : null}

      <label htmlFor="enquiry-message">
        {isPrint ? "Anything else about the print" : "Your message"}
        <textarea
          id="enquiry-message"
          name="message"
          rows={6}
          required
          maxLength={ENQUIRY_LIMITS.message}
          defaultValue={values.message}
          aria-describedby={errors.message ? "enquiry-message-error" : undefined}
        />
      </label>
      {errors.message ? (
        <p className="field-error" id="enquiry-message-error">
          {errors.message}
        </p>
      ) : null}

      {errors.photoSlug ? <p className="field-error">{errors.photoSlug}</p> : null}
      {errors.submissionToken ? (
        <p className="field-error" role="alert">
          {errors.submissionToken}
        </p>
      ) : null}

      <button type="submit">{isPrint ? "Send print enquiry" : "Send message"}</button>

      <p className="muted">
        {ENQUIRY_COPY.responseExpectation} Your details are used only to answer this enquiry.
      </p>
    </Form>
  );
}
