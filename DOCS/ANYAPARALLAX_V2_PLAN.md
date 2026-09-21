# Anyaparallax V2 plan

V2 exists to make Anyaparallax runnable by one photographer without a developer, and to protect an
archive that has exactly one copy. It starts from the finished V1 architecture: public galleries and
photograph pages, an operator area managing galleries, photographs, tags and settings, a read-only
manager area, print enquiries with no commerce, and Cloudflare Access as the authentication authority.
V2 adds capability; it does not reopen V1's decisions about publication, privacy or authority.

## What V1 already provides

- Public routes in `app/routes.ts`: `/`, `/galleries`, `/gallery/:slug`, `/photo/:slug`, `/about`,
  `/prints`, `/prints/enquire`, `/contact`, `/privacy`, `/robots.txt`, `/sitemap.xml`, `/media/*`,
  `/engagement/:slug` — three layout groups plus resource routes outside every layout.
- Publication as the single visibility authority for photograph AND gallery: `app/data/queries.ts`
  and the `published = 1` predicates in `app/data/repository.d1.server.ts`;
  `app/images/media-publication.server.ts` refuses an unpublished derivative; `sitemap.xml.ts` reads
  that boundary rather than its own SQL.
- A public projection that cannot carry the private master: `PublicPhoto` in `app/data/model.ts`, built
  field by field by `app/data/project.ts`, with `scripts/check-served-payload.mjs` failing if a master
  key reaches served HTML.
- Two storage domains by construction: `MASTERS` (private, `r2://masters/...`) and `IMAGES` (public,
  `r2://images/web|thumbs/...`) in `wrangler.jsonc`, with the key scheme and the only reference-to-URL
  function (`publicRefUrl`, null for a master) in `app/data/storage.ts`.
- Upload and derivatives through `/admin/upload`, `app/images/upload.server.ts` and
  `app/images/process.ts` over the `IMAGE_TRANSFORMS` binding: 10 files / 64 MB enforced from declared
  sizes before any body is read, files processed one at a time, commit-or-nothing.
- Photograph management at `/admin/photos(/:photoId)` over `app/data/photo-management.ts` and
  `.server.ts` — metadata, tags, gallery, publish/unpublish, feature — with a read-back that refuses a
  success claim unless the stored row matches, and refusal of any submission naming a storage field.
- Gallery management at `/admin/galleries` over `app/data/gallery-management.ts` and `.server.ts` —
  create, edit, publish/unpublish, cover, display order. No delete exists: withdrawal is unpublishing,
  an edit never re-derives a slug, and a cover must already belong to that gallery.
- Workspace settings and taxonomy behind `/admin/settings`: `app/data/site-settings.ts` and `.server.ts`
  (watermark default and position, four bounded intro fields, seven social URLs each checked against a
  host allow-list) and `app/data/taxonomy.ts` and `.server.ts` (create, rename, delete tags).
- Print eligibility as an editorial decision: `/admin/prints` over
  `app/enquiries/print-eligibility.ts` and `.server.ts`, changing exactly `photos.print_available` and
  listing drafts on purpose.
- Print enquiries and contact messages with no commerce: `/prints/enquire`, `/contact`, their
  acknowledgement routes and `/admin/enquiries`, over `app/enquiries/enquiry.ts`, `enquiries.server.ts`,
  `store.server.ts` and migration `0003_enquiry_preferences.sql`.
- Engagement: `POST /engagement/:slug` over `app/engagement/*` records likes (a generated v4 browser
  identifier, validated by `isEngagementIdentifier`, stored as a digest) and share actions initiated,
  with controls in `app/components/EngagementControls.tsx`; the operator summary in
  `app/engagement/insights.server.ts` returns aggregates only.
- Operator diagnostics and integrity reporting at `/manager/diagnostics` and `/manager/maintenance`
  over `app/data/diagnostics.server.ts` and `app/data/maintenance.server.ts` — counts, broken
  relationships, publication disagreements and a bounded 25-row object probe that counts missing
  objects and never lists a key. No destructive control exists.
- The authentication/authorisation split including user management: `app/auth/identity.server.ts`
  verifies the Cloudflare Access RS256 assertion with a loopback-only development identity;
  `accounts.server.ts` resolves the verified email to an ACTIVE `users` row; `authorization.server.ts`
  provides `requireAdminAccess` and `requireManagerAccess`, called by every protected layout and
  loader; `/manager/settings` over `user-management.ts` and `.server.ts` manages accounts, including
  the refusal that would leave no active manager. Denials are 401/403.
- One mutation order everywhere: authorise, then same-origin screening (`app/lib/same-origin.ts`), then
  size, then parse, then validate, then mutate — see `app/routes/admin/settings.tsx` and
  `app/routes/admin/prints.tsx`.
- Non-identifying abuse protection on public writes: honeypot, minimum fill interval, maximum age and
  link count in `app/enquiries/abuse-guard.ts`, which takes form values rather than a `Request`.
- Crawler and metadata plumbing: canonical URLs from `PUBLIC_SITE_ORIGIN` via
  `app/data/canonical-origin.ts`, page/OpenGraph/Twitter tags from `app/engagement/metadata.ts`, and
  `app/routes/robots.txt.ts`.
- Verification infrastructure: `scripts/run-checks.mjs` plus `scripts/checks/*`, driving the real
  modules against a throwaway local D1 database — schema behaviour, publication readiness,
  served-payload leaks, metadata, privacy, CSRF ordering, enquiry and management behaviour.

## V2.0 candidate priorities

Ordered by recommended value for a single-photographer portfolio whose archive has one copy and whose
operator is not a developer. Size is S (days), M (a slice), L (multi-slice or architecture-changing).
Each candidate below names the modules, routes and schema it touches; nothing here is authorised by
this document.

- 1. Backup, export and recovery — M. No dependencies.
- 2. Enquiry notifications (email) — S/M. Needs a destination address and sending domain.
- 3. Richer site-copy CMS — M. Needs the copy glossary.
- 4. Advanced gallery management and bulk operations — M. No dependencies.
- 5. Improved mobile operator experience — M. No dependencies.
- 6. Media lifecycle and storage cleanup — M for the report, L with removal. Needs item 1 first.
- 7. Richer private analytics without surveillance — M. No dependencies.
- 8. Accessibility refinements — S/M. Needs a written conformance target.
- 9. Richer SEO controls — S/M. No dependencies.
- 10. Richer About/profile editing — S. Needs item 3.
- 11. Scheduled publication — M. No dependencies.
- 12. Public tag browsing and discovery — S. No dependencies.
- 13. Abuse protection hardening — S/M. Needs a rate-limit rule and a secret.
- 14. Social profile/feed integrations — M. Needs the operator's platform accounts.
- 15. Mobile-friendly large-batch ingestion — M/L. No dependencies.
- 16. Optional multiple photographers/contributors — L. Recommended against in V2.0.
- 17. Image collections/series beyond galleries — M/L. Recommended against until a real need.

### 1. Backup, export and recovery tools

- **What it would do.** Export the row set for every table in `migrations/` plus an inventory of the R2
  keys those rows reference, so rows and objects can be reconciled; recovery is a documented procedure
  and a comparison against live state, not an in-place restore.
- **Why it matters.** `MASTERS` holds the print-quality originals and often the only copy.
  `app/data/maintenance.server.ts` has no reset, purge or bucket operation,
  `app/images/upload.server.ts` cleans up only when its own commit fails, and no cron trigger exists.
- **Touches.** New `app/data/export.server.ts`; a manager route in `app/routes.ts` and
  `app/routes/manager/`; a link from `manager/maintenance.tsx`; a `scripts/checks/` entry. No schema
  change.
- **Main risk.** It is a bulk egress path for personal data (enquiry addresses, operator emails):
  manager-only, same-origin, no-store, bounded, never in a public bucket or served from `/media/*`.
  Recovery must not overwrite live rows.
- **Size.** M.

### 2. Enquiry notifications (email)

- **What it would do.** Send the operator one notification after an enquiry row commits, through a
  provider the operator chooses. The stored enquiry stays the record of truth and a send failure never
  changes what the visitor was shown.
- **Why it matters.** An enquiry reaches `enquiries` silently and is found only by opening
  `/admin/enquiries`. A missed enquiry is a missed job, and this is the site's only commercial path.
- **Touches.** New `app/enquiries/notification.server.ts`; a post-commit call in
  `app/enquiries/enquiries.server.ts`; the destination as a validated `site_settings` row in
  `app/data/site-settings.ts`; the credential and sender as deployment configuration in
  `wrangler.jsonc`. No schema change.
- **Main risk.** Treating notification as part of the write: it must run after commit, swallow its own
  errors, and never let the response claim an email was sent. Deliverability (SPF/DKIM) is an operator
  task, and no visitor data beyond the enquiry leaves the system.
- **Size.** S/M.

### 3. Richer site-copy CMS

- **What it would do.** Extend workspace settings from four intro fields to the copy the public pages
  render: hero headline and supporting line, homepage headings, the About body as bounded paragraphs,
  prints page copy, the footer line and the not-found wording — plain text, per-field bounds, and a
  short revision history so a bad edit can be undone.
- **Why it matters.** `app/routes/home.tsx`, `about.tsx`, `prints.tsx`, `app/components/SiteFooter.tsx`
  and `app/routes/not-found.tsx` carry hardcoded strings, so changing a sentence needs a developer — the
  dependency the gallery and tag managers removed, and it bites hardest when final copy arrives.
- **Touches.** `app/data/site-settings.ts` (keys, bounds, validation), `site-settings.server.ts`,
  `/admin/settings`, the public readers above, and a migration for a revisions table. Input is
  `DOCS/ANYAPARALLAX_V1_COPY_GLOSSARY.md`.
- **Main risk.** Any field accepting markup is an XSS and layout-injection path: values stay plain text
  rendered as text, never `dangerouslySetInnerHTML`. Too many free-text fields also fragment the
  editorial voice, so the set must be bounded and deliberate.
- **Size.** M.

### 4. Advanced gallery management and bulk operations

- **What it would do.** Operate on a selected set: bulk publish, unpublish, feature, unfeature, gallery
  reassignment and tag add/remove, plus gallery reordering and cover selection from the list, each
  reporting per-row outcome and reading affected rows back.
- **Why it matters.** `app/routes/admin/photos.tsx` changes one photograph per submission (the
  `PHOTO_INTENTS` in `app/data/photo-management.ts` are single-row) and the list is bounded at
  `MANAGED_PHOTO_LIST_LIMIT` = 500. With a real archive, assembling a collection becomes hours of
  clicking.
- **Touches.** `admin/photos.tsx` (selection, new intents), `app/data/photo-management.ts` (intents,
  bounds, target-state mapping), `photo-management.server.ts` (batched statements),
  `admin/galleries.tsx`, `gallery-management.server.ts`. No schema change.
- **Main risk.** Bulk actions multiply mistakes: one mis-scoped selection can unpublish a collection.
  Required: an explicit target list, affected-count confirmation, a bounded batch size, per-row results,
  and no success claim unless the read-back matched.
- **Size.** M.

### 5. Improved mobile operator experience

- **What it would do.** A mobile-first pass over the operator areas: single-column lists, touch-sized
  controls, a sticky primary action, camera/library capture on `/admin/upload`, and per-file progress
  and failure reporting readable on a phone.
- **Why it matters.** A photographer curates from a phone after a shoot. The screens are dense desktop
  forms (`app/components/AreaShell.tsx`, `app/app.css`, `app/routes/admin/*`), and the upload form is
  the one that most needs to work one-handed.
- **Touches.** `app/app.css`, `app/components/AreaShell.tsx`, `app/layouts/admin.tsx`,
  `app/routes/admin/*.tsx`, and a check in `scripts/check-routes.mjs` or a new served check.
- **Main risk.** Operator chrome and the public visual language share `app.css`, so a change here can
  regress public pages, and any real-device usability claim must come from a manual pass rather than a
  viewport test.
- **Size.** M.

### 6. Media lifecycle and storage cleanup

- **What it would do.** Inventory every `photos` row against the three objects it should have and report
  three classes: objects with no referencing row, rows with a missing object, and derivatives larger
  than expected. Removing unreferenced objects is a separate, explicitly authorised step.
- **Why it matters.** `app/images/upload.server.ts` cleans up only when its own commit fails, so other
  interrupted paths leave objects nothing references. There is also no way to remove a photograph from
  the archive at all: neither `photo-management.server.ts` nor `gallery-management.server.ts` has a
  delete.
- **Touches.** `app/data/maintenance.server.ts` (paginated inventory beyond the 25-row probe),
  `manager/maintenance.tsx`, a new `app/data/media-lifecycle.server.ts`, `scripts/checks/`. No schema
  change.
- **Main risk.** The only candidate that deletes archival objects. V2.0 should ship the report alone;
  removal needs the separately authorised design under "Constraints carried forward", per-object
  confirmation, and item 1 in place first.
- **Size.** M for the inventory; L with removal.

### 7. Richer private analytics without surveillance

- **What it would do.** Extend `app/engagement/insights.server.ts` into a bounded operator view over data
  already stored: likes and share actions per photograph and per gallery, enquiry counts by category and
  month, and publication dates set against engagement. Aggregates only.
- **Why it matters.** A portfolio is judged by which work people respond to. The current summary answers
  "is anybody engaging" but not "with what", and no other measurement exists because the project refuses
  analytics by default.
- **Touches.** `app/engagement/insights.server.ts` and `store.server.ts` (read-only aggregate SQL),
  `app/routes/admin/dashboard.tsx`. No schema change, and explicitly no column identifying a visitor.
- **Main risk.** The boundary is thin: the first metric needing a per-visitor row (session, dwell time,
  path, repeat visit) is tracking and would breach `app/routes/privacy.tsx`. The permitted aggregate list
  must be written down and enforced by `scripts/checks/check-privacy.mjs`.
- **Size.** M.

### 8. Accessibility refinements

- **What it would do.** Work to a stated conformance target across public pages and operator screens:
  focus order and visible focus, landmark and heading structure, alt text derived from
  `title`/`description`, contrast, form error announcement, keyboard operation of every control, and
  reduced-motion handling.
- **Why it matters.** It is correctness rather than polish and is cheapest while the surface is small.
  `app/components/*` and `app/routes/*` already carry `aria-*`/`role` attributes in around 81 places with
  no written target and no check, which is how accessibility drifts.
- **Touches.** `app/components/PhotoFigure.tsx`, `EngagementControls.tsx`, `EnquiryForm.tsx`,
  `SiteHeader.tsx`; `app/app.css`; the public routes; a new `scripts/checks/check-accessibility.mjs`.
- **Main risk.** Markup-level checks cannot prove accessibility: the deliverable is a small set of
  machine-checkable invariants plus a documented manual review, and no conformance claim not tested with
  assistive technology.
- **Size.** S/M.

### 9. Richer SEO controls (structured data, image sitemaps)

- **What it would do.** Add structured data to `/photo/:slug`, `/gallery/:slug` and `/galleries`
  generated only from stored fields, and extend `/sitemap.xml` with image entries for published
  photographs. Editorial control stays limited to existing photograph and gallery descriptions.
- **Why it matters.** A portfolio is found largely through image search. `app/engagement/metadata.ts`
  already produces canonical, OpenGraph and Twitter tags from `PUBLIC_SITE_ORIGIN`, but no JSON-LD
  appears anywhere in `app/`, and `sitemapXml()` in `app/routes/sitemap.xml.ts` emits URL-only entries
  with no image namespace.
- **Touches.** `app/routes/sitemap.xml.ts`, `app/engagement/metadata.ts`, `app/routes/photo.tsx`,
  `gallery.tsx`, `galleries.tsx`, `scripts/checks/check-served-metadata.mjs`. No schema change.
- **Main risk.** Structured data that overstates a page (ratings, availability, price, `offers`) is
  dishonest and a search-policy risk. `app/enquiries/enquiry.ts` already encodes a forbidden-claim rule
  for commerce wording; structured data needs the same treatment.
- **Size.** S/M.

### 10. Richer About/profile editing

- **What it would do.** Make the operator-owned parts of `/about` editable: the portrait (through the
  existing image pipeline but flagged as the profile image rather than gallery work), the biography
  paragraphs, the working-together section and the copyright line.
- **Why it matters.** `app/routes/about.tsx` renders a `PlaceholderFrame` labelled "Portrait placeholder"
  while development notices are on, states that the biography and portrait are supplied before
  publication, and says nothing about Anya. There is no product path to supply that content.
- **Touches.** `app/routes/about.tsx`, `app/data/site-settings.ts` (a profile group) and
  `site-settings.server.ts`, `/admin/settings`, and a migration decision on where the portrait lives — a
  `site_settings` reference to a photograph id, or a dedicated profile image row.
- **Main risk.** A portrait identifies a person and is personal data: it must become public only when the
  operator publishes it, and `app/images/upload.server.ts` currently requires a `galleryId`, so this is a
  small model change, not only a form.
- **Size.** S.

### 11. Scheduled publication

- **What it would do.** Let a photograph or gallery carry a future `publish_at` time, with the public
  boundary treating it as published only once that time has passed, plus a visible list of scheduled
  items in `/admin`.
- **Why it matters.** A night's work is often uploaded once and released gradually, and a series launch
  or embargo currently means logging in at a specific hour.
- **Touches.** A migration (`photos.publish_at` and the gallery equivalent, with an index),
  `app/data/repository.d1.server.ts` (publication predicates), `app/images/media-publication.server.ts`,
  `app/routes/sitemap.xml.ts`, `admin/photos.$photoId.tsx`, `admin/galleries.tsx`,
  `app/data/maintenance.server.ts`.
- **Main risk.** It introduces a second authority for visibility, which V1 refused. Visibility must stay
  derived — `published = 1 AND (publish_at IS NULL OR publish_at <= now)` — in the same predicates, never
  a stored "went live" flag, and the media gate must use the same expression or a scheduled photograph's
  derivative becomes readable early. No cron trigger is needed for a query-time rule.
- **Size.** M.

### 12. Public tag browsing and discovery

- **What it would do.** Add a tag index and per-tag listing, link the tag names already shown on
  `/photo/:slug`, and optionally search titles, descriptions, locations and tags — all through the
  existing published-only boundary.
- **Why it matters.** Tags are modelled, bounded and operable today (`app/data/taxonomy.ts`,
  `/admin/settings`), but `app/routes/photo.tsx` renders them as unlinked spans and `listPublishedTags`
  in `app/data/queries.ts` is called by no route, so most of the work is a route and one query.
- **Touches.** `app/routes.ts` (two public routes), `app/routes/tags.tsx` and `tag.tsx`,
  `app/data/queries.ts` (`listPublishedPhotosByTag`), `app/routes/sitemap.xml.ts`, `app/routes/photo.tsx`,
  `app/app.css`.
- **Main risk.** Low: a new query restating the publication rule instead of reusing the projected
  predicates, and thin tag pages diluting the sitemap — bounded by emitting only tags with at least one
  published photograph.
- **Size.** S.

### 13. Abuse protection hardening for public writes

- **What it would do.** Replace client-supplied timing evidence with a server-issued signed form token
  (HMAC over the issue time, keyed by a deployment secret), and place a rate-limiting rule in front of
  `/prints/enquire`, `/contact` and `/engagement/:slug`.
- **Why it matters.** `app/enquiries/abuse-guard.ts` documents its own limitation: editing the hidden
  `formIssuedAt` value defeats the interval and age checks, and the module states it is not rate limiting.
  These are the site's only unauthenticated writes.
- **Touches.** `app/enquiries/abuse-guard.ts` (issue and verify), `app/routes/prints.enquire.tsx`,
  `contact.tsx`, `engagement.$slug.tsx`, `wrangler.jsonc` (a secret binding),
  `scripts/checks/check-enquiries.mjs`. The rate-limit half is Cloudflare configuration, not code.
- **Main risk.** A signed token needs a secret, and secrets are deployment configuration the UI must never
  edit. A stricter guard also risks refusing real visitors, so refusals must stay retryable and must not
  name the rule.
- **Size.** S/M.

### 14. Social profile/feed integrations (outward, manual-first)

- **What it would do.** Tell the networks Anya already uses when something is published. The defensible
  version is an operator-confirmed announcement the site prepares and the operator posts, or an explicit
  "announce this" action calling one platform API with a stored token.
- **Why it matters.** A solo photographer's reach comes from those networks. The site links out through
  `SOCIAL_NETWORKS` in `app/data/site-settings.ts` but never signals that new work is up.
- **Touches.** `app/data/site-settings.server.ts`, `gallery-management.server.ts` or
  `photo-management.server.ts` (post-publication hook), a new `app/social/*` server module, deployment
  configuration for tokens, `admin/settings.tsx` (presence only), `admin/galleries.tsx`.
- **Main risk.** Every platform is an outbound dependency with a token, a rate limit and a silent-failure
  mode; inbound feed display would put third-party images and scripts on a site whose privacy notice
  promises none. Automatic posting from a publish action is not recommended.
- **Size.** M.

### 15. Mobile-friendly large-batch ingestion

- **What it would do.** Raise the practical ceiling on phone uploads: direct-to-R2 upload through a
  short-lived signed URL, or a per-file resumable endpoint, so the Worker never holds a whole batch,
  followed by a second step turning each stored master into derivatives.
- **Why it matters.** `app/images/upload-validation.ts` caps a submission at 10 files and 64 MB, enforced
  from declared sizes before any body is read, and `app/images/upload.server.ts` must read each body into
  the isolate before processing. That is a hard wall for a night's photographs over mobile data.
- **Touches.** `admin/upload.tsx`, `app/images/upload.server.ts`, `upload-request.server.ts`, `process.ts`,
  `app/data/storage.server.ts` (signed PUT/GET), `wrangler.jsonc` (the `r2_buckets` binding exists;
  `queues` is declared empty in the build configuration).
- **Main risk.** A direct-upload path places untrusted bytes in a bucket before validation, so validation
  must run on the stored object before any derivative is produced and rejected objects must be removed. A
  queue adds asynchronous state the current commit-or-nothing upload avoids.
- **Size.** M/L.

### 16. Optional multiple photographers/contributors

- **What it would do.** Let more than one person contribute work, with attribution and per-record
  permissions (who may edit whose photographs) rather than two roles over one shared catalogue.
- **Why it matters.** Not needed for a single-photographer portfolio. It is assessed because `users.role`
  already exists and the temptation is to treat `manager` as a second contributor, which it is not:
  `app/auth/user-management.ts` describes manager as everything a photographer can do plus users,
  maintenance and diagnostics.
- **Touches.** A migration (an owner column on `photos`, or a join table), `app/data/model.ts`,
  `app/auth/authorization.server.ts` (per-record authority instead of per-area), every operator mutation
  in `app/data/*-management.server.ts`, every `app/routes/admin/*` module.
- **Main risk.** Per-record authority is a different security model from the two area guards proved by
  `scripts/checks/check-auth.mjs`, and it multiplies the review surface of every mutation. A shared
  catalogue with one owner is a decision to take deliberately.
- **Size.** L. Recommended against in V2.0.

### 17. Image collections/series beyond galleries

- **What it would do.** Add a second grouping axis — series, projects or books holding photographs from
  more than one gallery — or allow many-to-many gallery membership so one master can appear in several
  collections without duplication.
- **Why it matters.** `app/data/model.ts` records that multi-gallery membership is deliberately not
  modelled and that the junction table is reserved for a later, justified need. In practice tags already
  cover most of that reach: one photograph, one gallery, many tags.
- **Touches.** A migration (a `photo_galleries` junction or a series table), `app/data/model.ts`,
  `repository.d1.server.ts`, `project.ts`, `queries.ts`, the `/admin` editors, `gallery.tsx`, the cover
  rule in `gallery-management.server.ts`, `sitemap.xml.ts`.
- **Main risk.** It changes what "the gallery" means everywhere, including the cover rule, the media gate
  (which joins the single `gallery_id`) and the operator's mental model. Whether a photograph in several
  galleries is public when any gallery is published or only when all are has no obvious answer.
- **Size.** M/L. Recommended against until a real need appears.

## V2.x and future

Larger or riskier work, kept out of the V2.0 tranche. Same assessment format, shorter.

### Derivative ladder and modern formats

- **Would do.** Replace the fixed web/thumbnail pair with a small responsive set and modern encodings.
- **Why.** `app/images/process.ts` produces one web derivative and one thumbnail and `PublicPhoto` carries
  one `webImagePath`, so every screen gets the same bytes.
- **Touches.** `process.ts`, `image-processor.cloudflare.server.ts`, `app/data/model.ts`, `project.ts`,
  `PhotoFigure.tsx`, plus a storage/cost review.
- **Risk.** More objects per photograph, a larger bill, and a publication gate that must cover every new
  key rather than the two it checks today.
- **Size.** M/L.

### Client proofing: private, expiring sets

- **Would do.** Share a private selection with a client — a band, a venue, a car owner — through a link
  that expires, with no account for the client.
- **Why.** A real photography workflow, and the honest use of "private" in this codebase.
- **Touches.** A new table and migration, a new public-but-unlisted route, the media gate, and a
  visibility concept distinct from `published`.
- **Risk.** It is the first feature serving unpublished work outside the operator area, so it needs an
  unguessable token, an expiry, revocation, and a rule that a proofed photograph is never crawlable,
  without weakening `isPublishedDerivative` for ordinary media.
- **Size.** L.

### Video and motion work

- **Would do.** Accept short clips alongside photographs for live-music coverage.
- **Why.** The subject matter invites it.
- **Touches.** `app/images/upload-validation.ts` (a different pipeline), storage buckets and lifecycle,
  `PhotoFigure.tsx`, the media route's content types, the publication gate.
- **Risk.** Different processing, far larger objects, streaming range requests, a much larger storage and
  egress bill, and a poster problem the current processor does not solve.
- **Size.** L.

### Feed and public API surface

- **Would do.** Publish an RSS or JSON feed of newly published work.
- **Why.** Some audiences follow a photographer that way.
- **Touches.** `robots.txt.ts` and `sitemap.xml.ts` as resource-route precedents, plus one route reading
  the public boundary.
- **Risk.** Low; the main risk is a second, weaker publication rule written for the feed instead of
  reusing `listPublishedPhotos`.
- **Size.** S.

### Search at archive scale

- **Would do.** Full-text search across titles, descriptions, locations and tags once the archive outgrows
  `LIKE` queries.
- **Why.** Item 12's search is adequate until the catalogue is large.
- **Touches.** D1 schema (an FTS or token table), `repository.d1.server.ts`, `queries.ts`.
- **Risk.** Keeping an index consistent with the published boundary, and a rebuild path that needs no
  developer.
- **Size.** M.

### Multi-domain and locale

- **Would do.** Attach further domain names, or serve more than one language, from one deployment.
- **Why.** A decision the operator has not made; nothing in the code requires it.
- **Touches.** `PUBLIC_SITE_ORIGIN` and `app/data/canonical-origin.ts`, redirects, `sitemap.xml.ts`, and
  copy for a second locale.
- **Risk.** Canonical URLs, commerce tax position and the copy glossary all become per-locale concerns.
- **Size.** M/L. Blocked on the operator gates below.

### PRINT PURCHASING / ECOMMERCE

DEFERRED — NOT V1 IMPLEMENTATION

V1's print-enquiry flow stays exactly as it is: `/prints` presents print-eligible photography,
`/prints/enquire` takes a format preference, a bounded size preference and a message, the enquiry is
stored in `enquiries`, and an operator answers it personally. Nothing about that journey changes in V2.0.

There is no commerce in this repository today, and this is checkable. `migrations/` contains only
`0001_initial_schema.sql` (users, photos, galleries, tags, photo_tags, likes, share_events, enquiries,
site_settings), `0002_user_email_identity_uniqueness.sql` (a case-insensitive unique index on
`users.email`) and `0003_enquiry_preferences.sql` (which adds `print_format`, `print_size` and an
idempotency `submission_token` to `enquiries`). None of those tables or columns is a basket, an order, a
line item, a price, a payment, a shipment, a refund or a tax record. `package.json` has three runtime
dependencies (`react`, `react-dom`, `react-router`) and no payment SDK. `app/enquiries/enquiry.ts`
carries `FORBIDDEN_COMMERCE_CLAIMS`, a machine-checked list of positive commerce affordances the site
must never show, and `scripts/checks/check-enquiries.mjs` fails if checkout, basket, order, payment or
shipping wording appears. `photos.print_available` is an editorial flag for enquiries, not stock.

If purchasing is ever built, these are the concerns that would have to be solved. This is a list of
problems, not a design, and it specifies no schema.

| Concern | The question that has to be answered |
| --- | --- |
| Print variants | Which sizes, papers, finishes and framing are offered, and are they the operator's stock or a lab's catalogue? |
| Pricing | Per-variant prices, currency, whether shipping is included, and who may change a price after an order exists |
| Payment provider | Which provider, which account, which payout entity, and whether the site ever handles card data (it must not) |
| Fulfilment | Printed and shipped by the operator, by a lab through an API, or by a lab through manual order entry |
| Shipping | Destinations, rates, carriers, tracking, and what happens when a destination is not served |
| Refunds and returns | The policy, who authorises a refund, and how the money and the order state move together |
| Tax | VAT or sales tax registration, where it is owed, how it is calculated per destination, and who is liable |
| Order lifecycle | The states an order passes through, which transitions are operator-driven, and which must be irreversible |
| Transactional email | Order confirmation, dispatch notification and refund receipts, each needing a provider and a sending domain |
| Customer accounts | Whether buyers need accounts; if not, order lookup must work without one, and if so it adds passwords, resets and another personal-data store |
| Legal and policy | Terms of sale, distance-selling cancellation rights, and the consumer-law position for the operator's jurisdiction |

Prerequisites before any commerce work starts — all operator decisions, none of them code:

1. Fulfilment method: who prints and who ships, and whether that is an API integration or a manual
   process.
2. Pricing model: variants, prices, currency and whether shipping is charged separately.
3. Tax and legal position: registration, where tax is owed, and the terms of sale the operator will be
   bound by.
4. Payment provider: which provider, under which legal entity, with which payout account.
5. Refund and cancellation policy, and who may issue one.
6. A transactional email provider and a verified sending domain.
7. An explicit decision that the enquiry flow is replaced, kept alongside purchasing, or converted into a
   quote step.

Why this is deferred. Commerce brings money, tax, consumer law and personal data into a codebase whose
stated design stores as little as possible: the privacy notice in `app/routes/privacy.tsx` describes the one
first-party engagement cookie it does set (and says no analytics or profiling cookie), and
is set for visitors and no address is stored with any visitor action, and the enquiry schema was built so
it cannot pretend to be an order. It also creates a legally binding obligation to fulfil, which is a
different commitment from answering an email. Doing it properly needs the operator's decisions on all
seven prerequisites before a line is written; doing it partially would put a checkout on a site whose own
checks refuse to display one, which is the outcome V1 was most careful to avoid.

## Constraints carried forward from V1

Invariants, not preferences. Any V2 change that breaks one is out of scope until V1's reasoning is
revisited explicitly.

| Invariant | Enforced today by | What V2 must not do |
| --- | --- | --- |
| Publication is the single authority, for photograph AND gallery | `app/data/queries.ts`, the `published = 1` predicates in `app/data/repository.d1.server.ts`, `app/images/media-publication.server.ts`, `app/routes/sitemap.xml.ts` | Introduce a second visibility flag, a per-surface rule or a "went live" column; scheduled publication must stay a derived comparison |
| Private masters are never publicly retrievable | The two-bucket split in `wrangler.jsonc`, `app/data/storage.ts` (`publicRefUrl` null for a master), `storage.server.ts`, `scripts/check-served-payload.mjs` | Serve a master, derive a public URL from a master key, or use a master as a social preview image |
| No visitor tracking: no IP address, user agent, referrer or fingerprint is stored | `app/engagement/identifier.ts`, `app/engagement/anonymous-browser.server.ts`, `app/enquiries/abuse-guard.ts` (takes values, not a `Request`), `scripts/checks/check-privacy.mjs` | Add a per-visitor row, a session, a dwell time, a path history or a new identifier to answer an analytics or abuse question |
| No third-party analytics by default | `app/routes/privacy.tsx`, the absence of any analytics dependency in `package.json`, `scripts/checks/check-privacy.mjs` | Add a tracking script, tag manager or third-party embed without an explicit operator decision and a matching privacy-notice change |
| Cloudflare Access is the authentication authority; the `users` table only authorises | `app/auth/identity.server.ts`, `accounts.server.ts`, `user-management.ts` | Add a password, a second login system or a stored credential; treat a `users` row as sufficient for access; let a client declare a role |
| Every mutating operator action keeps authorization → same-origin/CSRF → size → parse → validate → mutate | `app/lib/same-origin.ts` and the actions in `app/routes/admin/*` and `app/routes/manager/*`, checked by `scripts/checks/check-admin-csrf-served.mjs` | Reorder the steps, skip origin screening for a new endpoint, or parse the body before authorisation |
| No secret or environment editing in the UI | `app/data/site-settings.ts` (content only), `app/routes/manager/settings.tsx` (reports presence, never values), `app/data/diagnostics.server.ts` | Make a binding, account id, audience tag, token or secret editable from a screen; V2 additions such as an email provider credential follow the same rule |
| No destructive maintenance tool without an explicit, separately-authorised design | `app/data/maintenance.server.ts` (no reset, purge, delete or bucket operation), `manager/maintenance.tsx`, the absence of a delete in both management modules | Add a mass delete, purge, reset, or object-removal step to an existing screen; unpublishing remains the withdrawal mechanism, and object removal needs its own design, authorisation and a backup in place first |

## Open operator and content gates carried into V2

Not code tasks. These are decisions and assets only the operator can supply, and several V2.0 items
cannot complete without them.

| Gate | What is needed | Blocks |
| --- | --- | --- |
| Final About biography and portrait | Approved biography text and a portrait image, supplied through the product or as a file | The About page content; item 10 |
| Final public copy | Approved wording for the homepage, galleries, prints, contact, About and footer, reconciled against `DOCS/ANYAPARALLAX_V1_COPY_GLOSSARY.md` (produced alongside this plan) | Item 3; removal of any remaining provisional wording |
| Social profile URLs | The exact profile addresses for whichever networks are actually used | Footer and contact links; item 14; the `social.*` settings rows |
| Privacy controller and retention wording | Who the data controller is, how long enquiries are kept, and the address for data requests — currently an explicit operator task in `app/routes/privacy.tsx` | Any real publication |
| Final watermark artwork approval | Approval of the watermark asset and of the default position, which `app/data/site-settings.ts` sets for new uploads | Publication of real photography |
| Real production photography | The actual archive, uploaded through `/admin/upload`; production must not be seeded with development rows | Everything public |
| Narrowing Access protection to the operator paths | Today the Access application covers the site broadly; the target is `/admin` and `/manager` only, with both `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` set (a half-configured Access deployment fails closed) | Safe public indexing and ordinary visitor access |
| Further domain names | Whether an additional domain is attached, and which one is canonical in `PUBLIC_SITE_ORIGIN` | Canonical URLs, the sitemap and any redirect work |

Two further gates that specific V2.0 candidates depend on: the enquiry notification address and sending
domain (item 2), and the rate-limiting rule and secret for the public write endpoints (item 13). Both are
operator or infrastructure decisions before code, not afterwards.
