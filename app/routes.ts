import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // Platform verification surface (Slice 06): inert unless the development
  // switch is on, and it calls the same production pipeline as the admin form.
  route("dev-verification", "routes/dev-verification.ts"),

  // Public derivative serving (Slice 06): a resource route outside every layout,
  // so `/media/...` returns image bytes and never an HTML document.
  route("media/*", "routes/media.ts"),

  // Crawler policy (REPAIR-09D): also resource routes outside every layout, because
  // neither is an HTML document. The sitemap's entries come from the public query
  // boundary, so it follows the site's own publication state rather than restating it.
  route("robots.txt", "routes/robots.txt.ts"),
  route("sitemap.xml", "routes/sitemap.xml.ts"),

  // Engagement endpoint (Slice 07): also a resource route outside every layout.
  // It is public because likes need no account, but it is POST-only and
  // same-origin, and it returns JSON rather than a document.
  route("engagement/:slug", "routes/engagement.$slug.tsx"),

  // Public site: shared header, footer and mobile navigation.
  layout("layouts/public.tsx", [
    index("routes/home.tsx"),
    route("galleries", "routes/galleries.tsx"),
    route("gallery/:slug", "routes/gallery.tsx"),
    route("photo/:slug", "routes/photo.tsx"),
    route("about", "routes/about.tsx"),
    route("prints", "routes/prints.tsx"),
    // Slice 08 print enquiry path. The form and its acknowledgement are separate
    // routes so a successful submission can REDIRECT (303) to a page that holds
    // none of the submission: a refresh cannot resend the enquiry, and the result
    // page carries no customer detail to leak or index.
    route("prints/enquire", "routes/prints.enquire.tsx"),
    route("prints/enquire/received", "routes/prints.enquire.received.tsx"),
    route("contact", "routes/contact.tsx"),
    route("contact/received", "routes/contact.received.tsx"),
    route("*", "routes/not-found.tsx"),
  ]),

  // Operator areas (Slice 05). Every entry below sits behind its layout guard,
  // and each route module repeats the guard in its own loader: React Router may
  // run nested loaders in parallel, so no route may rely on its parent having
  // denied first. The `admin/*` and `manager/*` splats exist so unknown paths
  // under a protected prefix are denied before anything else happens.
  layout("layouts/admin.tsx", [
    route("admin", "routes/admin/dashboard.tsx"),
    route("admin/photos", "routes/admin/photos.tsx"),
    // REPAIR-09B: the per-photograph editor. Metadata, tags, gallery and both
    // state fields are corrected here after upload, and unpublishing from the
    // library or from this screen is how a published photograph is withdrawn.
    route("admin/photos/:photoId", "routes/admin/photos.$photoId.tsx"),
    route("admin/upload", "routes/admin/upload.tsx"),
    route("admin/galleries", "routes/admin/galleries.tsx"),
    // Slice 08: the two operator surfaces the print/enquiry feature needs.
    route("admin/enquiries", "routes/admin/enquiries.tsx"),
    route("admin/prints", "routes/admin/prints.tsx"),
    route("admin/settings", "routes/admin/settings.tsx"),
    route("admin/*", "routes/admin/not-found.tsx"),
  ]),

  layout("layouts/manager.tsx", [
    route("manager", "routes/manager/dashboard.tsx"),
    route("manager/diagnostics", "routes/manager/diagnostics.tsx"),
    route("manager/settings", "routes/manager/settings.tsx"),
    route("manager/maintenance", "routes/manager/maintenance.tsx"),
    route("manager/*", "routes/manager/not-found.tsx"),
  ]),
] satisfies RouteConfig;
