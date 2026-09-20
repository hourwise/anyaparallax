import type { MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

import { PhotoFigure } from "../components/PhotoFigure";
import { siteOriginFrom } from "../data/canonical-origin";
import { appEnvironmentFrom } from "../data/context.server";
import { listPrintEligiblePhotos } from "../data/queries";
import { site } from "../data/site";
import { ENQUIRY_COPY } from "../enquiries/enquiry";
import { metadataTags, pageMetadataFor } from "../engagement/metadata";
import {
  photoPath,
  printEnquiryPathForPhoto,
  printsEnquirePath,
  printsPath,
} from "../lib/paths";

const SITE_NAME = `${site.name} ${site.secondary}`;

/**
 * How many eligible photographs the page presents.
 *
 * A bound rather than a promise: the page says "selected", and a visitor who wants
 * to enquire about something not shown here can still register interest on the
 * form. Nothing is hidden by the limit — the full set is available from the
 * galleries.
 */
const PRINT_PAGE_LIMIT = 12;

/**
 * Print information (Slice 08).
 *
 * The page's whole job is to describe an ENQUIRY journey truthfully. It reads its
 * photographs through `listPrintEligiblePhotos`, which is the public projection
 * with the editorial print flag added to the existing publication rules — so a
 * draft marked print-eligible cannot appear here, and a photograph that is
 * published but not offered cannot appear either.
 *
 * Every image is rendered from `thumbnailImagePath`, the browser-facing public
 * path the projection produces. No storage reference reaches this page.
 */
export async function loader({ context }: { context: unknown }) {
  const env = appEnvironmentFrom(context);
  const origin = siteOriginFrom(env);
  const photos = await listPrintEligiblePhotos(PRINT_PAGE_LIMIT, env);

  return {
    photos,
    metadata: pageMetadataFor(origin, {
      path: printsPath,
      title: "Prints",
      description:
        "Selected Anyaparallax photographs may be available as prints. Register interest or " +
        "enquire about a photograph, a format and a size; availability and price are confirmed " +
        "personally. There is no checkout or payment on this site.",
      siteName: SITE_NAME,
    }),
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData) {
    return [{ title: `Prints — ${SITE_NAME}` }];
  }
  return metadataTags(loaderData.metadata);
};

export default function PrintsRoute() {
  const { photos } = useLoaderData<typeof loader>();

  return (
    <section className="page container">
      <header className="page__header">
        <p className="eyebrow">Prints</p>
        <h1>Fine art prints</h1>
        <p className="lede">
          Bring the city to your walls. Selected photographs are offered as prints, and every
          enquiry is handled personally by Anya.
        </p>
      </header>

      {/*
        The honest boundary, stated before anything that could be mistaken for an
        offer. It is the same sentence the enquiry form shows, so the site cannot
        describe its own capability two different ways.
      */}
      <p className="notice">{ENQUIRY_COPY.noCheckoutNotice}</p>

      <div className="prose">
        <h2>How it works</h2>
        <ol className="plain-list">
          <li>Find a photograph marked as available for prints.</li>
          <li>Send an enquiry, saying which format and size you have in mind.</li>
          <li>Anya replies to confirm availability, dimensions, format and price.</li>
        </ol>
        <p>
          Because each print is prepared to order, nothing on this site is a live product: there
          is no basket to fill, no price to pay here and no delivery date promised by a machine.
        </p>
      </div>

      {photos.length > 0 ? (
        <section className="section" aria-labelledby="print-photographs">
          <header className="section-header">
            <p className="eyebrow">Available to enquire about</p>
            <h2 id="print-photographs">Photographs offered as prints</h2>
          </header>
          <div className="gallery-grid">
            {photos
              .filter(
                (photo): photo is typeof photo & { thumbnailImagePath: string } =>
                  photo.thumbnailImagePath !== null,
              )
              .map((photo) => (
                <PhotoFigure
                  className="gallery-grid__item"
                  key={photo.id}
                  src={photo.thumbnailImagePath}
                  // The photograph's own words (REPAIR-09A), exactly as every other
                  // public grid derives them.
                  alt={photo.description || photo.title}
                  ratio={`${photo.width} / ${photo.height}`}
                  sizes="(min-width: 56.25rem) 33vw, (min-width: 34rem) 50vw, 100vw"
                  caption={
                    <Link className="text-link" to={printEnquiryPathForPhoto(photo.slug)}>
                      Enquire about a print
                    </Link>
                  }
                  titleLink={{
                    to: photoPath(photo.slug),
                    label: photo.title,
                    title: `${photo.title} — photograph page`,
                  }}
                />
              ))}
          </div>
        </section>
      ) : (
        <p className="muted">
          No photographs are currently marked as available for prints. You can still register
          interest, and Anya will let you know when prints open.
        </p>
      )}

      <p className="section-actions">
        <Link className="button button--accent" to={printsEnquirePath}>
          Register print interest
        </Link>
        <Link className="button" to="/galleries">
          Browse the galleries
        </Link>
      </p>
    </section>
  );
}
