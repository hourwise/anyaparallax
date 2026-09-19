# Anyaparallax V1 worker evidence ledger

This directory records the first real Codex-supervisor / DeepSeek-worker implementation experiment. It is a preflight plan and evidence framework; no worker run or implementation has happened yet. The authoritative requirements remain `../ANYAPARALLAX — V1 GOAL, IMPLEMENTATION.md`. Its section 51 defines the nine-slice sequence used here. These files do not amend that specification.

## Starting and protected state (preflight, 2026-09-19)

- Repository: `D:\Users\fleur\AnyaParallax`
- Branch: `main`; HEAD: `6b47225d019f549878c3638dba4350db344856a3` (`first commit`). A commit exists; this is a minimal repository, not an empty repository.
- Initial worktree: untracked authoritative build sheet at `DOCS/ANYAPARALLAX — V1 GOAL, IMPLEMENTATION.md`; no other initial changes observed. Tracked file: `README.md` only.
- Origin: `https://github.com/hourwise/anyaparallax.git`; `main` tracks `origin/main` at the same observed SHA. `origin/HEAD` is not set locally; remote default branch was not queried over the network.
- Scaffold: README only; no application, package manifest, Cloudflare configuration, or migrations yet. Node `v24.12.0`, pnpm `11.19.0`; npm invocation fails because its configured `npm-cli.js` is missing.
- Protected during preflight: existing HEAD/refs and remote, authoritative build sheet, README, all application/configuration state. Only files in `DOCS/worker-runs/` may be created or changed. No commits or remote/infrastructure mutations.

## Run index

`NOT STARTED`, `WORKER RUNNING`, `REPAIR REQUIRED`, `SUPERVISOR ESCALATED`, `ACCEPTED`, `REJECTED`, and `BLOCKED` are the only slice statuses. `NOT RUN` means no runtime evidence exists; it is not a zero count. Fill metrics only from actual worker output and Codex verification.

## Operator-supplied experiment baseline

Phil supplied these readings on **2026-09-19**, while **PREFLIGHT-00** was running and before any AnyaParallax implementation slice began:

| Service | Baseline reading | Context |
| --- | --- | --- |
| OpenAI / ChatGPT Codex | Weekly usage remaining: **21%**; reset: **Thursday** | Reserve Codex effort for planning, supervision, independent verification, difficult diagnosis, and acceptance. |
| DeepSeek API | Daily cost: **$0.08 USD**; requests: **91**; tokens: **10,142,532** | Most existing activity predates AnyaParallax and came from Accord/testing work earlier that day. |

**Do not attribute these absolute DeepSeek totals to AnyaParallax.** Measure AnyaParallax with deltas from this baseline and, where practical, record DeepSeek token, request, and cost readings after each accepted slice. Record the before/after readings around each worker run so a slice delta can be checked. Record OpenAI weekly usage remaining after significant Codex supervisor stages. If unrelated usage occurs between readings, or a daily/window counter resets, mark the delta as mixed or unavailable rather than claiming it as AnyaParallax usage. These are operator-provided baseline values, not live account readings taken by Codex.

| Slice | Objective | Worker | Worker exit code | DeepSeek tokens | Repair attempts | Codex independent verification | Status | Evidence file |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01 Project shell | Routes, shared components, responsive dark photographic foundation | DeepSeek planned | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT STARTED | [01-project-shell.md](01-project-shell.md) |
| 02 Homepage | Image-first home and editorial photography presentation | DeepSeek planned | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT STARTED | [02-homepage.md](02-homepage.md) |
| 03 Portfolio data and pages | Gallery/photo model, public pages, tags, publication states | DeepSeek planned | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT STARTED | [03-portfolio-data-and-pages.md](03-portfolio-data-and-pages.md) |
| 04 D1/R2 storage plumbing | Migrations, storage interfaces, private/public image boundary | DeepSeek planned | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT STARTED | [04-d1-r2-storage.md](04-d1-r2-storage.md) |
| 05 Authentication and roles | Separate identities, server-side verification, admin/manager authority | DeepSeek planned, Codex security review | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT STARTED | [05-auth-and-roles.md](05-auth-and-roles.md) |
| 06 Upload and images | Upload, original preservation, derivatives, watermark and metadata | DeepSeek planned | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT STARTED | [06-upload-and-images.md](06-upload-and-images.md) |
| 07 Engagement and sharing | Likes, share actions, social preview metadata | DeepSeek planned | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT STARTED | [07-engagement-and-sharing.md](07-engagement-and-sharing.md) |
| 08 Prints and enquiries | Non-transactional print interest, Contact, About, enquiry management | DeepSeek planned | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT STARTED | [08-prints-and-enquiries.md](08-prints-and-enquiries.md) |
| 09 Final V1 review | Cross-site acceptance and readiness report | Codex only | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT STARTED | [09-final-v1-review.md](09-final-v1-review.md) |

## Operating rules for later slices

- DeepSeek is an implementation worker only. Codex is planner, supervisor, independent verifier, and final acceptance authority. Worker self-reported success is never sufficient for acceptance.
- Before each run, Codex records starting HEAD, branch, status, protected state, exact allowed scope, task file, and checks. The task file must be bounded and secret-free. The build sheet suggests `docs/worker-tasks/`, but any future task-file placement must be decided after this preflight; no task files are created here.
- Before the first repository-derived material is sent to DeepSeek, obtain Phil's explicit disclosure approval under build sheet section 56. Limit external disclosure to what the particular slice needs. Never send secrets, credentials, `.env` contents, tokens, private keys, personal/customer data, or unrelated sensitive material.
- DeepSeek may write locally in a bounded `workspace-write` slice. It may not commit unless explicitly authorised for that slice. No worker may push, merge, rebase, cherry-pick, tag, publish, deploy, promote, mutate Cloudflare or GitHub remote state, alter protected refs, broaden scope, or decide final acceptance.
- For the first real vertical slice, allow local worker writes but **NO COMMIT, NO PUSH, NO DEPLOYMENT, NO CLOUDFLARE MUTATION** until Codex has independently reviewed and passed the complete slice. This preflight itself makes no commits.
- Codex inspects exit code, transcript, Git diff/status/HEAD, and changed files, then executes the applicable checks independently. Record actual results and reasons for acceptance or rejection.
- Permit at most two narrowly scoped DeepSeek repair attempts for one bounded defect. After two failures, stop delegating that defect and diagnose or escalate at supervisor level.
- The experiment tracks first-pass acceptance, repairs, Codex takeover, measured tokens per accepted slice, elapsed time where available, acceptance/repair rates, supervisor effort, and recurring failure modes. Markdown records suffice; do not invent costs or token counts.
- Production publication remains separately authorised under `AUTHORIZATION_ONLY_NO_PUBLICATION`. V2 commerce is outside these slices.

## Planning decisions still open

The build sheet specifies Cloudflare D1, preferred R2, and preferred Cloudflare Access, but leaves the framework/runtime and detailed deployment, image processing, object key, and local testing choices to Codex. Codex must decide and document those before delegating affected implementation. The exact gallery/content copy, final domain, authorised emails, destination email, photographs, social links, and final watermark asset need operator input at the relevant gates. Do not turn placeholders into approved content.
