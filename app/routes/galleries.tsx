import type { MetaFunction } from "react-router";
import { Link } from "react-router";

import { PlaceholderFrame } from "../components/PlaceholderFrame";
import { PlaceholderNotice } from "../components/PlaceholderNotice";

export const meta: MetaFunction = () => [
  { title: "Galleries — Anyaparallax Photography" },
  {
    name: "description",
    content:
      "Placeholder gallery index for the Anyaparallax development preview. Gallery data arrives in a later slice.",
  },
];

// Slots exist only to demonstrate the gallery route. The real, database-driven
// gallery list replaces these in Slice 03; nothing here is permanently coded.
const placeholderSlots = [
  { key: "placeholder-1", label: "Gallery slot one" },
  { key: "placeholder-2", label: "Gallery slot two" },
  { key: "placeholder-3", label: "Gallery slot three" },
  { key: "placeholder-4", label: "Gallery slot four" },
] as const;

export default function GalleriesRoute() {
  return (
    <section className="page container">
      <header className="page__header">
        <p className="eyebrow">Galleries</p>
        <h1>Galleries</h1>
        <p className="lede">
          Placeholder overview of the collections that will be published here.
        </p>
      </header>

      <PlaceholderNotice>
        Provisional. Collections become database-driven in Slice 03, so no gallery names,
        covers or metadata are stored in this repository yet. The slots below only
        demonstrate that the gallery route responds.
      </PlaceholderNotice>

      <div className="placeholder-grid">
        {placeholderSlots.map((slot) => (
          <article className="placeholder-card" key={slot.key}>
            <PlaceholderFrame label={slot.label} />
            <h2 className="placeholder-card__title">{slot.label}</h2>
            <p className="muted">
              <Link to={`/gallery/${slot.key}`}>Placeholder gallery route</Link>
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
