/**
 * Public route URL helpers. Centralised so slugs render identically wherever a
 * photograph or gallery is linked (homepage, gallery grid, photo page, 404).
 */
export function photoPath(slug: string): string {
  return `/photo/${slug}`;
}

export function galleryPath(slug: string): string {
  return `/gallery/${slug}`;
}

export const galleriesPath = "/galleries";

/** The print information page (Slice 08). */
export const printsPath = "/prints";

/** The print enquiry form, with an optional photograph to enquire about. */
export const printsEnquirePath = "/prints/enquire";

/**
 * The enquiry form for one photograph.
 *
 * The photograph is carried as a query parameter rather than in the path so the
 * form has ONE address: a link that names a photograph the server will not offer
 * still resolves, and the page can then say so plainly instead of 404-ing at a
 * visitor who followed a real link.
 */
export function printEnquiryPathForPhoto(slug: string): string {
  return `${printsEnquirePath}?photo=${encodeURIComponent(slug)}`;
}

/** The acknowledgement shown after a print enquiry is stored. Carries no customer data. */
export const printsEnquireReceivedPath = "/prints/enquire/received";

/** The general contact page (Slice 08). */
export const contactPath = "/contact";

/** The acknowledgement shown after a contact message is stored. Carries no customer data. */
export const contactReceivedPath = "/contact/received";

/** Resolve a stored web asset path against the request origin for social metadata. */
export function absoluteUrl(origin: string, path: string): string {
  return new URL(path, origin).toString();
}
