# Anyaparallax

<!-- pcgsoft:overview:start -->
Anyaparallax is a live photography portfolio for live music, automotive, travel, nature,
portrait and event photography, with a dark monochrome presentation and privately
controlled administration.
<!-- pcgsoft:overview:end -->

| | |
| --- | --- |
| **Status** | **LIVE** |
| **URL** | https://anyaparallax.co.uk |
| **Public identity** | `anyaparallax` |

<!-- pcgsoft:status-notes:start -->
Live since 2026-10-18. The public portfolio is anonymously reachable at
https://anyaparallax.co.uk; only the operator areas (`/admin`, `/manager`) are behind
Cloudflare Access. Galleries and photographs continue to be added through the admin
area as normal editorial work.
<!-- pcgsoft:status-notes:end -->

The public site reads gallery and photograph data through a single query boundary that
runs against Cloudflare D1. `/admin` and `/manager` are behind a server-side identity and
role boundary: Cloudflare Access authenticates a person, and the `users` table authorises
what that person may do.

## Stack

- **Cloudflare Workers** (not Pages) as the runtime, configured in `wrangler.jsonc`
- **React Router v8** in framework mode with server rendering
- **Cloudflare D1** for portfolio data, **Cloudflare R2** for image objects
- **Vite 8** with `@cloudflare/vite-plugin` and `@react-router/dev`
- **TypeScript** in strict mode
- **pnpm** as the package manager

## V1 features (implemented and live)

- **Public photography portfolio**: an image-first homepage ("A shift in focus") led by
  manually featured work, plus `/galleries`, `/gallery/:slug`, `/photo/:slug`, `/about`,
  `/prints`, `/contact` and `/privacy`, with not-found and error handling
- **Galleries** created, ordered and given covers by the photographer, with optional
  ordered **series (subsections)** inside each gallery and title-free clickable thumbnails
- **Individual photograph pages** with metadata, tags and social preview metadata on the
  canonical origin `https://anyaparallax.co.uk`
- **Curated / featured work** chosen by the photographer for the homepage
- **Sharing**: a copyable canonical link and share targets on each photograph
- **Contact and bookings** ("Work with me") with a public contact address
- **Print enquiries**: per-photograph print eligibility and an enquiry form; enquiries are
  reviewed in `/admin/enquiries`
- **About / profile editor**: display name, role, location, strapline, biography and
  optional **About portrait** upload, change and removal
- **Watermark processing** of public derivatives at upload time (see "Final V1
  photograph watermark")
- **Photographer admin** (`/admin`): upload, metadata editing, tags, publish and withdraw,
  gallery and series management, print eligibility, enquiries and site settings
- **Manager diagnostics** (`/manager`): binding, storage and identity state, the
  authorised-user directory and a read-only integrity report
- **Privacy controls**: a public privacy notice, six-month enquiry retention with
  confirmed individual deletion, `noindex`/`no-store` on every operator response, and no
  like cookie while likes are disabled

### Access model

| Surface | Paths | Who |
| --- | --- | --- |
| Public | the portfolio routes above, `/media/...`, `/robots.txt`, `/sitemap.xml` | anonymous |
| Protected | `/admin`, `/admin/*`, `/manager`, `/manager/*` | Cloudflare Access, then D1 role |

Authentication is Cloudflare Access. Application authorisation is the D1 `users` table:
`/admin` needs the photographer or manager role, `/manager` needs the manager role, and
every protected layout and loader denies by default. The Access application also covers
React Router's client data requests for the two area roots (`/admin.data`,
`/manager.data`), because neither matches `/admin` nor `/admin/*`.

### Image boundary

- Private masters live in a separate private bucket and are never served to visitors.
- Public derivatives (web image and thumbnail) live in a separate public bucket and are
  served through `/media/...` only.
- Publication is controlled by application state: a photograph is public only while both
  it and its gallery are published.

### Print boundary

V1 prints are **enquiry-only**. There is no basket, checkout, online payment, order
processing or shipping engine.

### Likes

Public likes are **disabled for launch**. The control is settings-gated at the UI and the
endpoint; sharing stays available.

### Watermark

The final lowercase `anyaparallax` watermark is applied bottom-right to new photograph
derivatives.

## V2 (not implemented)

V2 is planned separately in `DOCS/ANYAPARALLAX_V2_PLAN.md` and none of it is live:

- **Print purchasing and any ecommerce**, marked `DEFERRED — NOT V1 IMPLEMENTATION`
- A richer site-copy CMS, scheduled publication, enquiry email notifications, backup and
  export tooling and multi-photographer support
- Any destructive maintenance console: `/manager/maintenance` reports integrity and
  deliberately wires nothing destructive

## Requirements

- Node.js 20 or newer
- pnpm (the project was scaffolded against pnpm 11)
- Network access to the npm registry for the first install

## Setup

```bash
pnpm install
```

The lockfile is generated from `package.json` during supervisor verification; do not
hand-edit it.

## Local development

```bash
pnpm dev
```

`pnpm dev` runs the Vite dev server with the Cloudflare plugin, so routes render through
the Worker in the local `workerd` runtime with local D1 and R2 emulation.

The homepage, galleries and photograph pages read from D1. Two ways to run locally:

```bash
# 1. Real D1: migrate and load the development seed set once, then develop normally.
pnpm db:migrate:local
pnpm db:seed:local
pnpm dev

# 2. No binding at all: allow the documented seed fallback.
pnpm dev   # with ALLOW_DEVELOPMENT_SEED="true" in a gitignored .dev.vars (see below)
```

With a D1 binding present it always wins. Without one, the seed repository is used only
while `ALLOW_DEVELOPMENT_SEED` is `"true"`; otherwise the data layer throws so a
misconfigured deployment fails loudly instead of serving stale development data.
`wrangler.jsonc` ships it as `"false"` so a deployment is publication-safe by accident;
to use the seed fallback locally, enable it in a gitignored `.dev.vars` (below) rather
than by editing shipped configuration.

### Local operator sign-in

In a deployment, Cloudflare Access admits the operator and this application then decides
what they may do; in a local checkout neither exists, so `/admin` and `/manager` would deny
every request. For local work only, enable `ALLOW_DEVELOPMENT_IDENTITY` in a gitignored
`.dev.vars` (below); the application then accepts this header **on loopback hosts only**:

```bash
curl -H 'x-anyaparallax-development-identity: photographer@anyaparallax.test' \
  http://localhost:5173/admin

curl -H 'x-anyaparallax-development-identity: manager@anyaparallax.test' \
  http://localhost:5173/manager
```

Those two addresses are the seeded placeholder accounts (reserved `.test` domain, see
`app/data/seed.ts`): the first is a photographer and reaches `/admin` only, the second is
a manager and reaches both areas. `deactivated@anyaparallax.test` exists to prove that a
known but inactive account is refused. The header grants nothing off loopback; it is
ignored entirely once Cloudflare Access is configured, and — so a half-finished Access
deployment cannot be downgraded — ignored even when Access is only _partially_ configured
(one of `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` set): a broken Access configuration fails
closed rather than falling back to the development header.

### Enabling the development valves locally (`.dev.vars`)

`wrangler.jsonc` ships `ALLOW_DEVELOPMENT_SEED` and `ALLOW_DEVELOPMENT_IDENTITY` as
`"false"` so the publication-safe state is the one a deployment gets by accident. To turn
either on for local development, create a gitignored `.dev.vars` beside `wrangler.jsonc`
(the same file the served checks write for themselves), which `pnpm dev` loads and which
overrides the shipped `vars`:

```text
ALLOW_DEVELOPMENT_SEED="true"
ALLOW_DEVELOPMENT_IDENTITY="true"
```

Nothing shipped in the repository changes, and no deployment inherits the valves.

## Checks

```bash
pnpm typecheck       # tsc --noEmit
pnpm check:routes    # route-shell, data-boundary and structure checks
pnpm check:data      # seed integrity, repository visibility, storage boundary, D1
pnpm check:images    # development placeholder assets present
pnpm check:served    # served HTML carries no private-master identifiers
pnpm check           # build + typecheck + all of the above
pnpm build           # production build (client + Worker/SSR bundles)
```

`pnpm check:data` runs against the application's own TypeScript source under Node's type
stripping. It covers:

- seed fixture integrity (unique slugs, valid relationships, key namespaces)
- the public projection contract on the seed repository **and** on real D1 queries
- the storage boundary (master keys never resolve to public URLs, never enter the public
  bucket, and are refused by public reads)
- D1 schema behaviour (tables, indexes, CHECK and UNIQUE constraints, foreign keys)
- the authentication boundary: Access JWT verification with a locally generated RSA key
  set, refusal of forged identity headers, the development header's flag and loopback
  requirements, account lookup (active, inactive, unknown, case-insensitive) and the
  deny-by-default role guards for both areas
- served protected routes: 401 without identity, 403 for the wrong role, 200 for the
  right one, forged role headers/query parameters ignored

D1 checks apply the real migrations to a throwaway local database, so they never touch
Cloudflare. There is no dedicated lint tool yet: this slice keeps the dependency set to
the supervisor-verified framework packages.

## Authentication and roles

Two people, two identities, one architecture. Cloudflare Access authenticates a person;
the application decides what that person may do. Neither operator needs the other's
email account or credentials.

```text
Cloudflare Access            (configured per environment; see Deployment state)
      ↓ signed JWT on `cf-access-jwt-assertion`
app/auth/identity.server.ts  verify signature, issuer, audience and expiry
      ↓ verified email
app/auth/accounts.server.ts  look up an ACTIVE account row → role
      ↓
app/auth/authorization.server.ts   deny unless the role is allowed
      ↓
/admin   photographer or manager      /manager   manager only
```

- `app/auth/identity.ts` — roles-agnostic vocabulary: identity sources, email
  normalisation, Access configuration parsing, identity mode.
- `app/auth/identity.server.ts` — RS256 verification against the Access key set
  (`https://<team-domain>/cdn-cgi/access/certs`, cached 15 minutes), plus the
  loopback-only development identity. Failure is never an identity.
- `app/auth/accounts.server.ts` — the `users` table (or the seed users locally).
  Roles are read from the database; a request can never declare its own role.
- `app/auth/authorization.server.ts` — `requireAdminAccess` / `requireManagerAccess`,
  called by every protected layout **and** every protected route loader.

Denials are deliberately plain: **401** when no identity is proven, **403** when a proven
identity is unknown, deactivated or lacks the role. Nothing about the account is echoed,
and every `/admin` and `/manager` response carries `Cache-Control: no-store` and
`X-Robots-Tag: noindex, nofollow`, so operator pages and denials are never cached or
indexed.

### Setting up Cloudflare Access (per environment)

1. Create a Cloudflare Access application covering the operator paths: `/admin`, `/admin/*`,
   `/admin.data`, `/manager`, `/manager/*` and `/manager.data`.
2. Add one policy per person, matching that person's email address. Access authenticates
   each identity independently; no shared logins or passwords are used anywhere.
3. Copy the team domain and the application's AUD tag into the deployment configuration
   as `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. Neither is a secret, and both belong to one
   environment's Access application, so neither is committed here: Access applications already
   exist for both environments and their values live in the deployment-derived configuration.
4. Insert the real operator addresses into the `users` table — never into source code:

   ```sql
   INSERT INTO users (id, email, role, active, created_at, updated_at)
   VALUES ('user-anya', 'replace-with-operator-email', 'photographer', 1,
           '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z');
   ```

5. Confirm `ALLOW_DEVELOPMENT_IDENTITY` is `"false"` (the shipped default) so only
   verified Access identities count, and set BOTH `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`:
   a half-configured Access deployment fails closed rather than accepting the header.

While Access is configured, the development identity header is ignored even on loopback.
`Log out` links to the Access logout endpoint once a team domain is configured.

No password, token, key or account credential is stored, logged or committed by this
application: Access owns authentication completely.

## Storage and data

### Bindings (`wrangler.jsonc`)

| Binding | Type | Purpose |
| --- | --- | --- |
| `DB` | D1 | galleries, photographs, tags, users, likes, shares, enquiries, settings |
| `MASTERS` | R2 (private) | archival/print originals — never served to visitors |
| `IMAGES` | R2 (public) | web derivatives and gallery thumbnails |

This file is the repository-safe BASE configuration, and it deliberately omits
`database_id`: a database identifier belongs to one account, so it is deployment state
rather than repository content. The real deployment configuration is derived from the
generated build payload at deploy time, and the D1 databases in both environments described
under "Deployment state" **already exist and are already migrated**. Local development uses
Wrangler's local simulation, which needs only the database name and migrations directory.

### Migrations

Schema changes are migration files in `migrations/`, applied with:

```bash
pnpm db:migrate:local     # local database
pnpm db:migrate:remote    # only for a NEW environment, once its resources exist
```

Do not edit the production schema by hand; add a migration.

### Object key strategy

Two buckets, two key namespaces:

```text
r2://masters/originals/<photo-id>/<filename>   private archival/print master
r2://images/web/<photo-id>/<filename>          public web derivative
r2://images/thumbs/<photo-id>/<filename>       public gallery thumbnail
```

`app/data/storage.ts` defines the scheme and the only function that turns a reference
into a browser URL (`publicRefUrl`) — it returns `null` for any master key.
`app/data/storage.server.ts` adds the R2-backed implementation and refuses, by
construction, to read a master through a public path or write a derivative into the
private bucket. Slices 06+ generate the real derivatives, and `/media/...` serves them once a photograph
and its gallery are published.

### Public data boundary

Public routes never touch D1 or R2 directly:

- `app/data/queries.ts` selects the repository (D1, or the seed fallback) and is the only
  module routes import.
- `app/data/repository.ts` defines the contract; `repository.d1.server.ts` implements it
  against D1; `repository.seed.server.ts` is the local development implementation.
- `app/data/project.ts` maps persistence records to public DTOs. Persistence-only fields
  (notably `originalStorageKey`, the private master) cannot reach a loader payload.

Unpublished galleries and photographs are indistinguishable from absent ones publicly:
the same 404, with no metadata leak.

## Project structure

```text
app/
  root.tsx                 document shell, global metadata, error boundary
  entry.server.tsx         streaming server entry
  routes.ts                route manifest
  app.css                  visual foundation and editorial layout
  components/              header, footer, photo figure, operator chrome
  auth/
    identity.ts            identity vocabulary, Access config, email normalisation
    identity.server.ts     Access JWT verification + development identity (server only)
    accounts.server.ts     authorised-user directory lookup (server only)
    authorization.server.ts deny-by-default request guards (server only)
  data/
    model.ts               persistence records, roles and public DTO types
    project.ts             persistence → public projection mappers
    storage.ts             object key strategy and private/public boundary
    storage.server.ts      R2-backed storage implementation (server only)
    diagnostics.server.ts  manager-only status snapshot (server only)
    repository.ts          portfolio repository contract
    repository.d1.server.ts    Cloudflare D1 implementation
    repository.seed.server.ts  local development seed implementation
    queries.ts             the single public data boundary
    context.ts             request context (bindings)
    context.server.ts      loader access to the request context
    seed.ts                development seed rows (local only)
  layouts/                 public chrome, admin chrome, manager chrome
  routes/                  route modules (public, admin/, manager/)
workers/
  app.ts                   Cloudflare Worker entry (sets request context)
migrations/                D1 schema migrations
public/
  images/dev/              development placeholder imagery
scripts/
  run-checks.mjs           data, storage and D1 checks
  check-routes.mjs         structural and data-boundary checks
  check-served-payload.mjs served-HTML leak check
  seed-local-d1.mjs        loads the seed set into local D1
react-router.config.ts     ssr: true
vite.config.ts             Cloudflare plugin (ssr environment) + React Router plugin
wrangler.jsonc             Worker entry, D1/R2 bindings, compatibility settings
worker-configuration.d.ts  generated Cloudflare runtime typings from wrangler types
```

## Configuration notes

- `wrangler.jsonc` names the Worker, points `main` at `./workers/app.ts`, declares the
  `DB`, `MASTERS` and `IMAGES` bindings, and sets `compatibility_date` plus the
  `nodejs_compat` flag. It contains no account ID, no secret and no environment-specific
  resource identifier.
- `pnpm cf-typegen` runs `wrangler types`, which regenerates `worker-configuration.d.ts`
  from the Wrangler configuration. Binding types come from there.
- `PUBLIC_SITE_ORIGIN` **is** committed, deliberately: it is the canonical public origin and
  carries the publication-safe default `https://anyaparallax.co.uk`, because canonical links,
  OpenGraph URLs and share links must point at the real site even when a page is being
  previewed elsewhere. A deployment-derived configuration may override it for another
  environment. The enquiry address is not committed at all.

## Provisioning a NEW environment (operator step)

Both environments described under "Deployment state" were provisioned with these steps and
are already migrated; nothing below is pending for them. This section is the recipe for an
additional environment, and it is the only place those commands belong.

1. `wrangler r2 bucket create anyaparallax-masters` and
   `wrangler r2 bucket create anyaparallax-images`.
2. `wrangler d1 create anyaparallax`, then put the returned `database_id` into
   `wrangler.jsonc`.
3. `pnpm db:migrate:remote` to apply migrations.
4. Confirm `ALLOW_DEVELOPMENT_SEED` is `"false"` (the shipped default) so a missing
   binding fails loudly, and that no `.dev.vars` overriding it reaches the deployment.
5. Create the Cloudflare Access application, set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`,
   add one policy per operator, and insert their addresses into `users` (see
   "Authentication and roles"). Confirm `ALLOW_DEVELOPMENT_IDENTITY` is `"false"` (the
   shipped default). Set BOTH `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, not one: a
   half-configured Access deployment fails closed and denies every operator request.
6. Do not seed production with development placeholder rows; real content arrives
   through the admin upload flow.

## Deployment state

Two isolated sets of Cloudflare resources exist, both provisioned from this repository, each
with its own D1 database and its own private-masters and public-derivatives R2 buckets:

| Environment | Worker | Data and objects | Reachability |
| --- | --- | --- | --- |
| Preview | `anyaparallax-preview` | D1 + masters bucket + derivatives bucket of its own | its own `workers.dev` hostname, protected end to end by Cloudflare Access |
| Production | `anyaparallax` | D1 + masters bucket + derivatives bucket of its own | **live** at https://anyaparallax.co.uk; public routes anonymous, `/admin` and `/manager` protected by Cloudflare Access |

Both environments run the source at `cf34387de7e772c2a6d82c8997c8742c09b5e40a` (final
watermark). Commits after it that touch only documentation or the PCGsoft manifest need no
redeployment. Nothing in this repository deploys automatically: a deployment is an
explicit operator action.

Production is served only on its custom domain: the production Worker's `workers.dev`
and version-preview URLs are disabled, so no alternate hostname exposes the application.

Nothing is shared between the two environments, and no resource identifier, account id,
Access audience or credential is committed here. The deployment configuration is derived at
deploy time from the generated Vite/Cloudflare payload, so the repository stays free of
environment-specific values.

The production Cloudflare Access application covers exactly `/admin`, `/admin/*`,
`/admin.data`, `/manager`, `/manager/*` and `/manager.data` — both each parent and its
descendants. Everything else on the domain is public. Production photography is uploaded
by Anya through `/admin`.

## PCGsoft portfolio manifest

`.pcgsoft/project.yml` is this repository's PCGsoft portfolio manifest (schema version 2):
project-owned proposal data for PCGsoft's governed portfolio reconciliation. It is
evidence for human review, not publication authority; the canonical PCGsoft record changes
only through PCGsoft's own reviewed process.

## Documentation for the operator

- `DOCS/ANYAPARALLAX_V1_COPY_GLOSSARY.md` — every user-visible string with a stable ID, so
  copy can be rewritten by reference (`PUB-HOME-002 → replace with "…"`) without another
  discovery pass. A CSV export of the same table sits beside it.
- `DOCS/ANYAPARALLAX_V2_PLAN.md` — what V2 could do, ordered by value, and what is
  explicitly deferred.
- `DOCS/ANYAPARALLAX — V1 GOAL, IMPLEMENTATION.md` — the governing V1 specification.

## Development variables

`wrangler.jsonc` ships the publication-safe values, so nothing has to be disabled before
a deployment. To enable the two development valves locally, copy `.dev.vars.example` to
`.dev.vars` (gitignored) and adjust it; the served checks write their own values there
and restore whatever they found.

## Final V1 photograph watermark

Final V1 watermark: `anyaparallax`, one lowercase line, using the operator-approved
Cooper BT-style wordmark raster asset. No font file is included or distributed.
The supplied PNG is retained in `DOCS/White Cooper-Style Anyaparallax Wordmark.png`;
`app/images/anyaparallax-watermark.png` is its proportionally reduced 267 x 89 overlay.
The full canvas, original textured edges and alpha are retained, without recolouring
or trimming. The artwork contains baked-in alpha; the existing draw opacity of
0.75 is applied in addition. Default position remains bottom-right, with the
existing 2.5% inset (minimum 8 pixels). Private masters and About portraits are
outside photograph watermarking. Existing photographs are not reprocessed.

`node scripts/prepare-watermark.mjs` regenerates the PNG and its compile-time base64
representation in `watermark-asset.ts`. `--check` checks both against the approved
source. This uses Wrangler's installed Sharp codec only as local tooling; the Worker
receives deterministic PNG bytes without filesystem access or an asset request.
Run `node --experimental-strip-types --no-warnings scripts/checks/check-watermark.mjs`
for the focused asset check; the same check is included in `pnpm run check:data`.

Source: 2172 x 724, SHA-256
`0000494a1d9d15155fc7cab42c3913c9dbcf6cbfb9295480698eabec77e5d5df`.
Production PNG: 267 x 89, SHA-256
`f866b1a7509a261d5b25b4e0018e55537b654449744f0538c6b0911de56ba711`.
