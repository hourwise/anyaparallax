# Anyaparallax V1 — Slice 01 type and Worker-entry repair

You are the DeepSeek implementation worker; Codex remains the verifier and acceptance authority. Work only in `D:\Users\fleur\AnyaParallax` on `codex/anyaparallax-v1` with HEAD `bae6ee8422dce67c38cd488c3828f118fcb91726`. All existing application files are the Slice 01 candidate. Preserve all `DOCS/**` files, the pnpm lockfile, pnpm-workspace.yaml, package manifest and unrelated worktree changes. Do not inspect or disclose anything outside this repository. Do not query the network, package registry, environment, sibling repositories or external caches.

## Defect diagnosed by Codex

Codex independently installed dependencies, approved only `esbuild` and `workerd` build scripts, and ran `pnpm run build` successfully. `pnpm run check` failed in TypeScript with:

`workers/app.ts(21,38): error TS2353: Object literal may only specify known properties, and 'cloudflare' does not exist in type 'RouterContextProvider'.`

Installed React Router 8.4.0 declares the request handler as `(request: Request, loadContext?: RouterContextProvider) => Promise<Response>`. The plain `{ cloudflare: { env, ctx } }` object in `workers/app.ts` is invalid. Slice 01 has no bindings or loaders that need Cloudflare context, so omit the second argument for now. Later slices may add typed context through React Router's actual context API. Do not paper over this with `any`, `as unknown as`, or another unchecked cast.

Codex also ran `pnpm run cf-typegen`; Wrangler refused to generate types because the worker's hand-written `worker-configuration.d.ts` already exists. Replace that placeholder with Wrangler-generated types. Do not hand-write Workers platform types. If a virtual-module declaration is needed, type it narrowly against installed React Router's `ServerBuild` rather than `unknown` plus a double-cast. Keep the source clear and compatible with future D1/R2 bindings.

## Allowed changes and checks

Edit only `workers/app.ts`, `vite-env.d.ts`, and `worker-configuration.d.ts` as needed for this defect. You may run local `pnpm run cf-typegen`, `pnpm run typecheck`, `pnpm run check:routes`, and `pnpm run build`; dependencies are already installed. Do not run install or touch package versions. Do not change route content, design, layout, application features, task files or evidence files.

Before finishing, report exact changes and commands with exit codes, confirm HEAD unchanged and no out-of-scope files changed. Keep inspection output concise: use `git status --short` and `git diff --stat` or focused diffs; do not print a full repository diff. No commit, push, fetch, deployment, Cloudflare resource mutation or final acceptance claim.
