import type { MetaFunction } from "react-router";

import { EnquiryAcknowledgement } from "../components/EnquiryAcknowledgement";
import { site } from "../data/site";
import { printsPath } from "../lib/paths";

const SITE_NAME = `${site.name} ${site.secondary}`;

/**
 * Static title only. Nothing about the submission reaches this route: the action
 * redirects here after storing the enquiry, and the page holds no name, address,
 * message or photograph title to put in a document title, a meta description, an
 * OpenGraph tag or a URL.
 */
export const meta: MetaFunction = () => [
  { title: `Enquiry received — ${SITE_NAME}` },
  { name: "description", content: "Acknowledgement that a print enquiry has been received." },
  // A submission result is not content: it must not become indexable, and it must
  // not be followed into the rest of the site by a crawler working from it.
  { name: "robots", content: "noindex, nofollow" },
];

export default function PrintEnquiryReceivedRoute() {
  return (
    <EnquiryAcknowledgement
      kind="print"
      backTo={printsPath}
      backLabel="Back to prints"
    />
  );
}
