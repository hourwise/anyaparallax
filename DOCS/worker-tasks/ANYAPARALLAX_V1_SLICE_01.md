# Anyaparallax V1 — Slice 01 worker task

## Authority and starting state

You are the DeepSeek implementation worker. Codex is the supervisor and sole acceptance authority. Work only in `D:\Users\fleur\AnyaParallax` on branch `codex/anyaparallax-v1`, starting at protected governed baseline HEAD `bae6ee8422dce67c38cd488c3828f118fcb91726` (tree `ab8d416d6dd759a8b22e07be9160000760a84559`). The supervisor created this task file after the baseline; preserve it and any pre-existing worktree changes. Verify the actual branch, HEAD and status before editing. Stop and report if they differ unexpectedly.

Phil has explicitly approved bounded repository-derived disclosure to this configured worker for the V1 mission. Read only the relevant repository files. The governing build sheet is `DOCS/ANYAPARALLAX — V1 GOAL, IMPLEMENTATION.md`, especially sections 5–10, 11–14, 25–27, 42–47, and 50–56. The `DOCS/worker-runs/01-project-shell.md` plan and this task define the slice boundary. Do not transmit secrets, credentials, `.env` contents, tokens, private keys, personal/customer data, unrelated machine/repository information, or private photographs.

## Exact objective

Create the local V1 application foundation for **Cloudflare Workers** using **React Router v8 full-stack, Vite, the Cloudflare Vite plugin, TypeScript and pnpm**. Cloudflare Pages is not the primary runtime. Do not switch architecture without supervisor escalation. Current Cloudflare guidance: https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/ and https://developers.cloudflare.com/workers/vite-plugin/reference/vite-environments/ .

Implement a coherent, photography-first application shell with:

- Public route skeletons for `/`, `/galleries`, `/gallery/:slug`, `/photo/:slug`, `/about`, `/prints`, and `/contact`.
- Separate placeholder route skeletons for `/admin` and `/manager`. These contain no sensitive data or real functionality. Mark them clearly as awaiting the authentication/authorization slice; do not represent them as secured by UI visibility alone.
- Shared header, concise public navigation (Home, Galleries, Prints, About, Contact), usable mobile navigation, footer, layout primitives, typography, dark/near-black/charcoal palette, restrained accents, and strong visible focus states.
- Minimal loading, not-found and error treatment where appropriate for the framework.
- A root README update with local pnpm setup, dev/build/type/lint/check instructions and an honest note that authentication, data, media and deployment are later slices.

Use development placeholder content only. Do not hard-code a final domain, actual email addresses, private images, or the suggested gallery list as permanent data. The look should be cinematic, editorial, minimal and image-led, with the photography visually dominant once real assets arrive. Avoid heavy glow, gradients, animation and a gaming/cyberpunk treatment. Mobile is first-class; the design must work at narrow phone, Galaxy S24 Ultra-class, tablet and desktop widths. Use semantic HTML, keyboard-operable navigation, labelled controls, adequate contrast and reduced-motion handling where relevant.

## Allowed changes

Create or modify only the application scaffold and ordinary configuration required for this selected stack: package manifests and pnpm lockfile, TypeScript/Vite/React Router/Workers/Wrangler config, Worker entry, app routes/components/styles, static placeholder assets if needed, minimal meaningful tests/checks, `.gitignore` for generated/local files, and the root `README.md`. Choose compatible current versions and document any non-obvious setup choice. It is acceptable for the framework scaffold to create its normal files. Keep dependencies lean.

Do not edit the governing build sheet, any `DOCS/worker-runs/**` evidence file, this task file, other worker tasks, Git history/refs, or unrelated files. Do not create secrets or real `.env` files. Do not initialize a second Git repository or nest the application in a new top-level project folder. Do not create Cloudflare resources or use any scaffold option that automatically deploys or links a remote account.

## Explicitly out of scope

No real Cloudflare credentials, hosted resources, Access policies, authentication, D1/R2 bindings or production data. No gallery/database logic, upload/image pipeline, engagement, contact submission, checkout, payment or commerce logic. No fetch, push, commit, merge, rebase, cherry-pick, tag, deploy, publish, promotion, Cloudflare mutation or GitHub mutation. No protected ref/history changes. No scope expansion.

## Worker checks and completion evidence

1. Install with pnpm locally and produce a lockfile. Do not use the broken npm CLI unless a dependency truly requires it.
2. Run the production build, TypeScript checks and lint/check script. Run any relevant tests you add. Report exact commands, exit codes and unresolved failures.
3. Inspect the final diff and full changed-file list. Confirm route skeletons, public/admin/manager separation, mobile navigation and basic accessibility. If local manual/browser checks are feasible, report exactly what was checked.
4. Confirm HEAD is unchanged, no secrets/credentials or deploy settings were introduced, and no remote or Cloudflare mutation occurred.
5. Report files changed, dependency choices, implementation performed, final Git status, and any blockers or uncertainty. Do not claim final acceptance.

If the chosen architecture has a concrete technical blocker or safe completion requires exceeding this scope, stop and report the evidence to Codex. Do not substitute another framework.
