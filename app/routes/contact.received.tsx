import type { MetaFunction } from "react-router";

import { EnquiryAcknowledgement } from "../components/EnquiryAcknowledgement";
import { site } from "../data/site";
import { contactPath } from "../lib/paths";

const SITE_NAME = `${site.name} ${site.secondary}`;

/**
 * Static title only. As with the print acknowledgement, the page receives none of
 * the submission, so there is no customer detail that could reach a document
 * title, a meta description, an OpenGraph tag, a URL or a client bundle.
 */
export const meta: MetaFunction = () => [
  { title: `Message received — ${SITE_NAME}` },
  { name: "description", content: "Acknowledgement that a contact message has been received." },
  { name: "robots", content: "noindex, nofollow" },
];

export default function ContactReceivedRoute() {
  return (
    <EnquiryAcknowledgement kind="contact" backTo={contactPath} backLabel="Back to contact" />
  );
}
