# Production-promotion preflight checklist

Run before promoting any app to production through the deploy toolkit (`rpv` + the reusable
workflow). Tailored to the AirAcademy ecosystem; pairs with [ENV-STANDARD.md](ENV-STANDARD.md).

Classify the promotion first — it sets how strict B/D are:
- **Public-facing** (editor → `editor.aircrewacademy.com`, player → S3 `player/v1`): real users hit it.
- **Corporate integration** (writes to Docebo / Ascent): a bad deploy can mutate the client's LMS.

---

## A. Deploy path & provenance
- [ ] App declares a `versioning` config block; **`rpv config print --channel=production` is green** (no unset `$ENV`, no validation errors).
- [ ] `production.yml` is a thin caller of `versioned-deploy.yml@v1.0.0` with the typed **confirm gate**.
- [ ] Commit → push → **then** promote (the box is rsync'd from a real GitHub commit; never hand-edit).
- [ ] `/version` is served from the stamped certificate; **`rpv verify --production` passes** after deploy.
- [ ] Rollback rehearsed: an earlier release tag can be re-promoted (`rollback` input).

## B. Env & secrets  ← the focus
- [ ] Every var the app reads is present on the target (box `.env` / GitHub secrets+vars) under the **canonical name** (ENV-STANDARD.md). `.env.example` lists them all, values empty.
- [ ] **No bare `DOCEBO_*`.** Docebo creds are `DOCEBO_{TARGET}_{ROLE}_*`; the **target matches the channel** and the **role is correct** (editor/migrator = ADMIN).
- [ ] **`DOCEBO_WRITES_ENABLED`** is `true` only on an approved write target; the write-gate script validates the five ADMIN creds and fails closed.
- [ ] Secrets are referenced, not committed; `.env` is gitignored; no secret in the repo, the config block, or the workflow YAML.
- [ ] Deploy-contract names set for the strategy: server-ssh → `DEPLOY_HOST` + `DEPLOY_SSH_KEY`; static-s3 → `AWS_ROLE_ARN` (+ `AWS_REGION`).

## C. Build & dependencies
- [ ] `npm ci` is clean (lockfile resolves; cross-repo git-tag deps fetch).
- [ ] Test suite green, or every remaining failure is **known + explained** (e.g. the editor's pre-existing `feedback route`).
- [ ] Cross-repo deps pinned to **git tags** (`#vX.Y.Z`) — no `file:` or floating refs.
- [ ] (static-s3) the artifact builds and `artifactDir` contains the expected bundle.

## D. Blast radius & safety
- [ ] **Public URL** confirmed; CDN/cache behavior understood (player: S3 + cache-control; editor: no-cache on HTML/JS); rollback plan written.
- [ ] **Corporate integration:** sandbox vs production target is correct; rate-limit/backoff in place (the Docebo adapter chokepoints this); no bulk-enrollment path exposed.
- [ ] **Shared-box awareness:** the editor EC2 box co-locates `telemetry` + `analytics` (pm2). An editor outage also kills analytics ingest/dashboard — schedule accordingly and watch all three after deploy.
- [ ] Concurrency/scale sanity (e.g. editor catalog load does not peg the burstable box).

## E. Post-deploy verification
- [ ] `/version` reports the expected version + commit (`rpv verify --production` = VERIFIED).
- [ ] Smoke the key flows (editor: login → open a course → save; player: launch a SCORM course → completion event lands).
- [ ] Telemetry still ingesting and analytics dashboard renders (shared box).
- [ ] (corporate) one real write round-trips to the correct Docebo target, or writes confirmed disabled.

---

**Sign-off:** app __________ · channel __________ · version __________ · by __________ · date __________
