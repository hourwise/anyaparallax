import type { MetaFunction } from "react-router";
import { Link } from "react-router";

import { PlaceholderNotice } from "../components/PlaceholderNotice";

export const meta: MetaFunction = () => [
  { title: "Prints — Anyaparallax Photography" },
  {
    name: "description",
    content:
      "Print enquiries for Anyaparallax photography. V1 is enquiry-only: there is no checkout, basket or payment in this release.",
  },
];

export default function PrintsRoute() {
  return (
    <section className="page container">
      <header className="page__header">
        <p className="eyebrow">Prints</p>
        <h1>Fine art prints</h1>
        <p className="lede">
          V1 presents print interest without live ecommerce.
        </p>
      </header>

      <PlaceholderNotice tone="warning">
        There is no checkout, basket, cart or payment on this site. Print eligibility,
        formats and the enquiry route are added in Slice 08; nothing shown here is a
        purchasable product.
      </PlaceholderNotice>

      <div className="prose">
        <p>
          When prints open, selected photographs will be offered as limited editions with
          format and size information, and enquiries will be handled personally. Until
          then this page exists only to reserve the route.
        </p>
      </div>

      <p className="section-actions">
        <Link className="button" to="/contact">
          Contact placeholder
        </Link>
      </p>
    </section>
  );
}
