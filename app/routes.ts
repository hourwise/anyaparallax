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

  // Development placeholders only. These are NOT secured; authentication and
  // role-based authorization arrive in Slice 05.
  layout("layouts/placeholder.tsx", [
    route("admin", "routes/admin.tsx"),
    route("manager", "routes/manager.tsx"),
  ]),
] satisfies RouteConfig;
