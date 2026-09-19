# Anyaparallax V1 — Slice 01 bounded retry after dependency-access failure

This is the first narrowly scoped worker retry. The initial worker invocation could not reach the npm registry from its sandbox, searched outside the repository for package caches, and was interrupted by Codex before any application file changed. The protected governed baseline remains `bae6ee8422dce67c38cd488c3828f118fcb91726` on `codex/anyaparallax-v1`. The only expected worktree changes before this invocation are Codex-owned evidence and task files under `DOCS/worker-runs/01-project-shell.md` and `DOCS/worker-tasks/`. Stop if branch/HEAD differs or other changes appear.

## Strict context boundary

Inspect and modify **only** `D:\Users\fleur\AnyaParallax` and files inside it. Do not enumerate or read sibling repositories, user directories, system files, pnpm caches outside this repository, environment variables, credential files or network configuration. The task below and the repository build sheet supply enough requirements. Do not relay unrelated machine information to DeepSeek. Preserve all `DOCS/**` files exactly. Do not alter Git refs/history or configuration.

The worker sandbox has no npm-registry access. **Do not attempt package-registry queries or installation.** Codex has separately verified registry access and will perform pnpm install, lockfile generation, build, type, lint and route checks after you produce the scaffold. Report dependency checks as `NOT RUN IN WORKER` rather than claiming they passed. This is a deliberate handoff, not an architecture change.

## Exact implementation

Implement the original Slice 01 objective in the repository root: a Cloudflare **Workers** full-stack **React Router v8** app using **Vite**, **@cloudflare/vite-plugin**, **TypeScript** and **pnpm**. Do not use Pages or another framework. Create a normal framework-compatible `app/` and `workers/` structure, package manifest, React Router/Vite/TypeScript/Wrangler configuration, styles, root README setup guidance, and `.gitignore` for generated/local files. Do not create a lockfile by hand; Codex will generate it from the manifest.

Codex checked these published versions on 2026-09-19: `react` and `react-dom` 19.3.0; `react-router` and `@react-router/dev` 8.4.0; `@cloudflare/vite-plugin` 1.56.0; `vite` 8.3.0; `typescript` 7.0.2; `wrangler` 4.135.0; `@types/react` and `@types/react-dom` 19.3.0. Published peer ranges permit React Router 8.4 with Vite 8, TypeScript 7, Wrangler 4, and the Cloudflare plugin with Vite 8/Wrangler 4.135. Use these or a technically justified compatible set; do not guess unsupported package versions.

Cloudflare's current guide shows `app/routes`, `app/entry.server.ts`, `app/root.tsx`, `app/routes.ts`, `workers/app.ts`, `react-router.config.ts`, `vite.config.ts`, and `wrangler.jsonc`. It sets `ssr: true`, points Wrangler `main` to `./workers/app.ts`, and includes both React Router and Cloudflare Vite plugins. For the SSR environment the Vite configuration uses `cloudflare({ viteEnvironment: { name: "ssr" } })` with `reactRouter()`. Use a current `compatibility_date` and `nodejs_compat` flag. Do not add resource bindings, account IDs, secrets, or deployment commands that run automatically.

Required routes: `/`, `/galleries`, `/gallery/:slug`, `/photo/:slug`, `/about`, `/prints`, `/contact`, `/admin`, `/manager`. Implement route skeletons only, with not-found/error treatment. `/admin` and `/manager` are **development placeholders awaiting Slice 05**; do not claim they are secured and do not add real functionality or sensitive data. Provide shared navigation, responsive mobile menu, footer, semantic layout, typography and restrained dark photographic visual foundation. Use provisional, clearly identified placeholder content and no private images or assumed final domain. Mobile and keyboard usability matter. Avoid permanent gallery hard-coding, excessive glow/animation, full homepage feature content, data backends or commerce.

## Prohibitions and evidence

No commit, push, fetch, merge, rebase, cherry-pick, tag, publish, deploy, Cloudflare/GitHub mutation, real authentication, D1/R2 resources, upload or payment. Do not modify the governing build sheet or evidence ledger. Do not read or transmit secrets, private photographs, personal/customer data or unrelated information.

Before finishing, inspect changed paths and HEAD. Report exact files changed and dependency choices, what you implemented, what static checks you could perform without dependencies, what remains unverified, and any blocker. Do not claim acceptance. Codex will independently install and verify this candidate.
