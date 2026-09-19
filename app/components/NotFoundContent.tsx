import { Link } from "react-router";

import { primaryNav } from "../data/site";

export function NotFoundContent() {
  return (
    <section className="page container">
      <p className="eyebrow">404</p>
      <h1>Page not found</h1>
      <p className="lede">
        That address does not exist in this development preview. Try one of these
        instead:
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
