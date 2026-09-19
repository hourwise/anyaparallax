import type { MetaFunction } from "react-router";
import { Link } from "react-router";

import { PlaceholderNotice } from "../components/PlaceholderNotice";

export const meta: MetaFunction = () => [
  { title: "Contact — Anyaparallax Photography" },
  {
    name: "description",
    content:
      "Contact placeholder for Anyaparallax photography. The enquiry form and destination address arrive in a later slice.",
  },
];

export default function ContactRoute() {
  return (
    <section className="page container">
      <header className="page__header">
        <p className="eyebrow">Contact</p>
        <h1>Contact</h1>
        <p className="lede">
          Band, gig, event, car and print enquiries will be handled here.
        </p>
      </header>

      <PlaceholderNotice>
        Provisional. No enquiry form is present yet and no contact address has been
        supplied, so nothing on this page can send a message. The form and abuse
        protection arrive in Slice 08.
      </PlaceholderNotice>

      <div className="prose">
        <p>
          The final enquiry categories, destination address and spam protection are
          operator decisions and are deliberately not invented in code.
        </p>
      </div>

      <p className="section-actions">
        <Link className="button" to="/prints">
          Print information
        </Link>
      </p>
    </section>
  );
}
