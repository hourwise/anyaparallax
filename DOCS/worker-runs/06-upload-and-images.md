# Slice
- Slice ID: 06
- Slice name: Upload, derivatives and watermarking
- Objective: Let authorised users upload single/multiple photos, retain an unchanged private master, generate web/thumbnail assets, apply selectable watermarking to public derivatives and manage metadata/publication.
- Status: NOT STARTED

# Starting State
- Starting HEAD: NOT RUN
- Starting branch: NOT RUN
- Starting worktree status: NOT RUN
- Protected state: Starting HEAD/refs, authoritative build sheet and unrelated worktree changes preserved; slice-specific boundaries to be recorded at invocation.
- Allowed scope: Validated upload and image pipeline, off/corner/centre watermark with corner default, metadata, galleries/tags and publish/featured controls; no destructive master operations or live infrastructure mutation.
- Key files/areas expected to change: Admin upload/photos UI, upload API, image processor, R2/D1 services, replaceable watermark asset, validation and image tests.
- Expected acceptance checks: Codex verifies private unchanged unwatermarked original, web/thumb outputs, correct watermark positions/off, portrait/landscape/large/corrupt cases, MIME/content/size validation, admin authorization, publication controls and build/tests.
- Dependencies: 03 model/pages, 04 storage, 05 auth/roles; Codex image-processing strategy.
- DeepSeek suitability: YES for a bounded pipeline task after interfaces are fixed; may need narrow sub-tasks within this authored slice.
- Supervisor escalation triggers: Original mutated/exposed, unsafe upload validation, image quality/performance failure, platform processing limits, repeated failed repair or required live R2 mutation.
- Phil input: Initial source photographs for realistic acceptance and final logo/signature if available; development watermark may be used until final asset arrives.

# Worker Invocation
- Worker: NOT RUN
- Model/provider: NOT RUN
- Sandbox mode: NOT RUN
- Task file: NOT RUN
- Worker start time: NOT RUN
- Worker end time: NOT RUN
- Worker exit code: NOT RUN
- DeepSeek tokens used: NOT RUN
- Estimated API cost, if reliably available: NOT RUN
- Run/transcript directory: NOT RUN

# Worker Result
- Files inspected: NOT RUN
- Files changed: NOT RUN
- Implementation performed: NOT RUN
- Worker checks executed: NOT RUN
- Worker-reported result: NOT RUN
- Remaining uncertainty/blockers: NOT RUN

# Supervisor Independent Verification
- Ending HEAD: NOT RUN
- Git diff reviewed: NOT RUN
- Files independently reviewed: NOT RUN
- Build: NOT RUN
- Type check: NOT RUN
- Lint: NOT RUN
- Tests: NOT RUN
- Visual/manual checks: NOT RUN
- Security/auth checks where applicable: NOT RUN
- Scope/protected-state verification: NOT RUN

# Repairs
- Repair attempt count: NOT RUN
- Repair 1: NOT RUN
- Repair 2: NOT RUN
- Escalated to Codex: NOT RUN
- Reason for escalation: NOT RUN

# Acceptance
- Final status: NOT RUN
- Accepted/rejected by: NOT RUN
- Acceptance reason: NOT RUN
- Remaining risks: NOT RUN
- Follow-up required: NOT RUN

# Cost / Prefixity Experiment Data
- Baseline reference: README.md, operator-supplied readings on 2026-09-19 during PREFLIGHT-00
- DeepSeek account reading before slice (tokens / requests / daily cost): NOT RUN
- DeepSeek account reading after accepted slice (tokens / requests / daily cost): NOT RUN
- DeepSeek slice delta (tokens / requests / cost): NOT RUN
- DeepSeek cumulative delta from experiment baseline (tokens / requests / cost): NOT RUN
- Unrelated usage or counter-reset caveat: NOT RUN
- OpenAI weekly usage remaining after significant supervisor stage: NOT RUN
- DeepSeek worker tokens: NOT RUN
- Number of worker calls: NOT RUN
- Number of repair calls: NOT RUN
- OpenAI supervisor work performed: NOT RUN
- First-pass acceptance: NOT RUN
- Worker-only completion possible: NOT RUN
- Notes on cost/quality/latency: NOT RUN
