import { Link } from "react-router";

import { primaryNav } from "../data/site";

/**
 * The 404 body, shared by the public catch-all and the operator areas.
 *
 * REPAIR-09A: the sentence used to read "That address does not exist in this
 * development preview", which described the whole site as a development preview
 * on every 404 a visitor could reach. The default copy now says nothing about the
 * site's stage; only a caller that knows development notices are enabled asks for
 * the preview wording.
 */
export function NotFoundContent({
  developmentPreview = false,
}: {
  developmentPreview?: boolean;
}) {
  return (
    <section className="page container">
      <p className="eyebrow">404</p>
      <h1>Page not found</h1>
      <p className="lede">
        {developmentPreview
          ? "That address does not exist in this development preview. Try one of these instead:"
          : "That address does not exist. Try one of these instead:"}
      </p>
      <ul className="plain-list">
        {primaryNav.map((item) => (
          <li key={item.to}>
            <Link to={item.to}>{item.label}</Link>
          </li>
        ))}
      </ul>
      <p>
        <Link className="button" to="/">
          Back to home
        </Link>
      </p>
    </section>
  );
}
