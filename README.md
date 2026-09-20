# Anyaparallax

Photography portfolio for Anya — night cities, live music and the moments after dark.

Current state: **Slice 05 — authentication, admin and manager roles**. The public site
reads gallery and photograph data through a single query boundary that runs against
Cloudflare D1, with a development-only seed fallback for local work. `/admin` and
`/manager` are now behind a real server-side identity and role boundary. It remains a
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
- Cloudflare Access-compatible authentication boundary: server-side verification of the
  Access assertion JWT (or a loopback-only development identity), an authorised-user
  lookup in D1, and deny-by-default guards on every `/admin` and `/manager` route
- Functional operator foundations: Anya's `/admin` dashboard with the photographer or
  manager role, and the manager-only `/manager` surface with live binding, storage,
  identity state and the authorised-user directory

Deliberately **not** implemented yet:

- The editing tools themselves (upload, metadata, galleries, settings) inside `/admin`
  and `/manager`; those routes exist, are protected, and say so.
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

### Local operator sign-in

Cloudflare Access is not configured yet, so `/admin` and `/manager` would deny every
request. For local work only, `wrangler.jsonc` sets `ALLOW_DEVELOPMENT_IDENTITY` and the
application accepts this header **on loopback hosts only**:

```bash
curl -H 'x-anyaparallax-development-identity: photographer@anyaparallax.test' \
  http://localhost:5173/admin

curl -H 'x-anyaparallax-development-identity: manager@anyaparallax.test' \
  http://localhost:5173/manager
```

Those two addresses are the seeded placeholder accounts (reserved `.test` domain, see
`app/data/seed.ts`): the first is a photographer and reaches `/admin` only, the second is
a manager and reaches both areas. `deactivated@anyaparallax.test` exists to prove that a
known but inactive account is refused. The header grants nothing off loopback, and it is
ignored entirely once Cloudflare Access is configured.

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
Cloudflare Access            (not configured yet — operator input required)
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

### Setting up Cloudflare Access (operator step, not yet performed)

1. Create a Cloudflare Access application covering the operator paths (`/admin`, `/manager`).
2. Add one policy per person, matching that person's email address. Access authenticates
   each identity independently; no shared logins or passwords are used anywhere.
3. Copy the team domain and the application's AUD tag into the deployment configuration
   as `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. Neither is a secret; both are deployment
   configuration and are intentionally absent from this repository.
4. Insert the real operator addresses into the `users` table — never into source code:

   ```sql
   INSERT INTO users (id, email, role, active, created_at, updated_at)
   VALUES ('user-anya', 'replace-with-operator-email', 'photographer', 1,
           '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z');
   ```

5. Set `ALLOW_DEVELOPMENT_IDENTITY` to `"false"` so only verified Access identities count.

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
5. Create the Cloudflare Access application, set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`,
   add one policy per operator, and insert their addresses into `users` (see
   "Authentication and roles"). Set `ALLOW_DEVELOPMENT_IDENTITY` to `"false"`.
6. Do not seed production with development placeholder rows; real content arrives
   through the admin upload flow.
