import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // Public site: shared header, footer and mobile navigation.
  layout("layouts/public.tsx", [
    index("routes/home.tsx"),
    route("galleries", "routes/galleries.tsx"),
    route("gallery/:slug", "routes/gallery.tsx"),
    route("photo/:slug", "routes/photo.tsx"),
    route("about", "routes/about.tsx"),
    route("prints", "routes/prints.tsx"),
    route("contact", "routes/contact.tsx"),
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
    route("admin/upload", "routes/admin/upload.tsx"),
    route("admin/galleries", "routes/admin/galleries.tsx"),
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
