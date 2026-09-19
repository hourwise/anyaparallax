# Anyaparallax

Photography portfolio for Anya — night cities, live music and the moments after dark.

Current state: **Slice 04 — D1 schema, migrations and R2 storage plumbing**. The public
site reads gallery and photograph data through a single query boundary that runs against
Cloudflare D1, with a development-only seed fallback for local work. It remains a
development preview, not a published site.

## Stack

- **Cloudflare Workers** (not Pages) as the runtime, configured in `wrangler.jsonc`
- **React Router v8** in framework mode with server rendering
- **Cloudflare D1** for portfolio data, **Cloudflare R2** for image objects
- **Vite 8** with `@cloudflare/vite-plugin` and `@react-router/dev`
- **TypeScript** in strict mode
- **pnpm** as the package manager

## Status

Implemented so far:

- Worker entry that places bindings on React Router's request context
- Route skeleton for `/`, `/galleries`, `/gallery/:slug`, `/photo/:slug`, `/about`,
  `/prints` and `/contact`, plus not-found and error handling
- Image-first homepage and data-driven gallery and photograph pages
- Portfolio domain model, public query boundary and explicit public DTO projections, so
  private-master keys can never reach a browser payload
- D1 schema and migrations for users, galleries, photographs, tags, likes, share events,
  enquiries and settings
- R2 storage abstraction with a private masters bucket, a public images bucket and a key
  strategy that keeps the two apart by construction

Deliberately **not** implemented yet:

- Authentication and authorization. `/admin` and `/manager` are development
  placeholders awaiting Slice 05. They are **not secured** and contain no real
  functionality, data or secrets.
- Image upload, derivative generation and watermarking (Slice 06), likes and sharing
  (Slice 07), print enquiries and the contact form (Slice 08).
- Serving stored R2 objects to visitors. The storage layer is in place and tested; no
  public route serves stored objects yet.
- Deployment. No Cloudflare resources, account IDs, secrets or deployment scripts are
  configured; publishing requires separate authorization.

All copy, imagery and links remain clearly marked provisional placeholders. No
photographs, social accounts, contact addresses or final domain are assumed.

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
pnpm dev   # with ALLOW_DEVELOPMENT_SEED=true in wrangler.jsonc (the default)
```

With a D1 binding present it always wins. Without one, the seed repository is used only
while `ALLOW_DEVELOPMENT_SEED` is `"true"`; otherwise the data layer throws so a
misconfigured deployment fails loudly instead of serving stale development data. Set it
to `"false"` for any real deployment.

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

D1 checks apply the real migrations to a throwaway local database, so they never touch
Cloudflare. There is no dedicated lint tool yet: this slice keeps the dependency set to
the supervisor-verified framework packages.

## Storage and data

### Bindings (`wrangler.jsonc`)

| Binding | Type | Purpose |
| --- | --- | --- |
| `DB` | D1 | galleries, photographs, tags, users, likes, shares, enquiries, settings |
| `MASTERS` | R2 (private) | archival/print originals — never served to visitors |
| `IMAGES` | R2 (public) | web derivatives and gallery thumbnails |

`database_id` is intentionally absent: no Cloudflare resource has been created. Local
development uses Wrangler's local simulation, which needs only the database name and
migrations directory.

### Migrations

Schema changes are migration files in `migrations/`, applied with:

```bash
pnpm db:migrate:local     # local database
pnpm db:migrate:remote    # after resources exist, with explicit authorisation
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
private bucket. Slices 06+ generate the real derivatives; nothing is served from R2 yet.

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
  components/              header, footer, photo figure, homepage sections
  data/
    model.ts               persistence records and public DTO types
    project.ts             persistence → public projection mappers
    storage.ts             object key strategy and private/public boundary
    storage.server.ts      R2-backed storage implementation (server only)
    repository.ts          portfolio repository contract
    repository.d1.server.ts    Cloudflare D1 implementation
    repository.seed.server.ts  local development seed implementation
    queries.ts             the single public data boundary
    context.ts             request context (bindings)
    context.server.ts      loader access to the request context
    seed.ts                development seed rows (local only)
  layouts/                 public chrome and protected-area placeholder chrome
  routes/                  route modules
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
  `nodejs_compat` flag. It contains no account ID, secrets or deployment configuration.
- `pnpm cf-typegen` runs `wrangler types`, which regenerates `worker-configuration.d.ts`
  from the Wrangler configuration. Binding types come from there.
- Environment values such as the final domain and the enquiry address are not
  hard-coded; they are supplied through configuration when the operator provides them.

## Provisioning a real deployment (requires authorization)

Nothing here has been run against Cloudflare. When publishing is authorised:

1. `wrangler r2 bucket create anyaparallax-masters` and
   `wrangler r2 bucket create anyaparallax-images`.
2. `wrangler d1 create anyaparallax`, then put the returned `database_id` into
   `wrangler.jsonc`.
3. `pnpm db:migrate:remote` to apply migrations.
4. Set `ALLOW_DEVELOPMENT_SEED` to `"false"` so a missing binding fails loudly.
5. Do not seed production with development placeholder rows; real content arrives
   through the admin upload flow.
