import type { MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

import { requireAdminAccess } from "../../auth/authorization.server";
import { appEnvironmentFrom } from "../../data/context.server";
import { listPublishedGalleries, listPublishedPhotos } from "../../data/queries";

export const meta: MetaFunction = () => [
  { title: "Admin dashboard — Anyaparallax Photography" },
  { name: "robots", content: "noindex, nofollow" },
];

/**
 * The route guard runs HERE, not only in the layout: React Router may run
 * nested loaders in parallel, so a protected endpoint must be able to deny on
 * its own. The public counts below come from the public query boundary.
 */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  const user = await requireAdminAccess(request, context);
  const env = appEnvironmentFrom(context);
  const [galleries, photos] = await Promise.all([
    listPublishedGalleries(env),
    listPublishedPhotos(env),
  ]);
  return { user, galleryCount: galleries.length, photoCount: photos.length };
}

const plannedAreas = [
  {
    to: "/admin/photos",
    label: "Photos",
    description: "Photo metadata, tags, publishing state and featured work (Slice 06).",
  },
  {
    to: "/admin/upload",
    label: "Upload photos",
    description: "Upload originals, generate derivatives and watermarks (Slice 06).",
  },
  {
    to: "/admin/galleries",
    label: "Galleries",
    description: "Create and order collections, choose covers (later slice).",
  },
  {
    to: "/admin/settings",
    label: "Settings",
    description: "Watermark defaults and site content for Anya's workspace (later slice).",
  },
] as const;

export default function AdminDashboardRoute() {
  const { user, galleryCount, photoCount } = useLoaderData<typeof loader>();

  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Signed in as {user.role}</p>
        <h1>Photography workspace</h1>
        <p className="lede">
          This dashboard is real: the identity above was verified server-side and looked up
          in the authorised-user directory on this request. The editing tools arrive in the
          upload slice.
        </p>
      </header>

      <div className="status-grid">
        <article className="status-card">
          <p className="status-card__label">Published galleries</p>
          <p className="status-card__value">{galleryCount}</p>
        </article>
        <article className="status-card">
          <p className="status-card__label">Published photographs</p>
          <p className="status-card__value">{photoCount}</p>
        </article>
      </div>

      <h2>Planned areas</h2>
      <ul className="plain-list">
        {plannedAreas.map((area) => (
          <li key={area.to}>
            <Link className="text-link" to={area.to}>
              {area.label}
            </Link>{" "}
            <span className="muted">— {area.description}</span>
          </li>
        ))}
      </ul>

      <p className="muted">
        Unpublished photographs and galleries stay hidden from the public site; this area
        does not change that until the publishing tools arrive.
      </p>
    </section>
  );
}
