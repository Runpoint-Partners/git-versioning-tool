# Environment-variable standard (AirAcademy ecosystem)

The canonical naming + handling rules for environment variables across the AirAcademy repos
(editor, player, analytics/telemetry, adapters, migrator). Lives with the deploy toolkit because
it is enforced at promotion time — see [PREFLIGHT.md](PREFLIGHT.md).

## Principles

1. **One concept → one name, everywhere.** A credential or endpoint that means the same thing in
   two repos has the **same** variable name in both. No per-app aliases for shared infra.
2. **Secrets are referenced, never stored.** Config files (`versioning` block, `versioning.config.js`)
   hold `"$NAME"` references; real values live in the box `.env` (gitignored), GitHub Actions
   secrets/vars, or SSM — distributed via 1Password. The cross-repo superset of real values is
   `.env.master` (never committed).
3. **No silent defaults for targets.** A variable must never quietly mean "sandbox" or "production."
   The target is explicit in the name (see Docebo) or passed as an argument.
4. **Every repo ships a complete `.env.example`** — every key it reads, with empty/placeholder values
   and a one-line comment. It is the contract; `rpv config print` + this standard verify it.

## 1. Shared infrastructure — identical name in every repo

| Variable | Meaning | Canonical value |
|---|---|---|
| `AWS_REGION` | AWS region | `us-east-2` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS creds (apps/CI) | — (secret) |
| `AWS_PROFILE` | AWS CLI profile (box/SSM deploy scripts; alternative to inline keys) | `default` |
| `S3_BUCKET` | course/content bucket | `aaa-courses` |
| `S3_CONTENT_PREFIX` | course content prefix | `courses` |
| `S3_SCORM_PREFIX` | SCORM package prefix | `courses/scorm` |
| `S3_PLAYER_PREFIX` | deployed player prefix | `player/v1` |

Adapters that today use `AA_MODULE5_CONTENT_PREFIX` / `AA_MODULE4_*` keep an env fallback to the
canonical `S3_CONTENT_PREFIX` / `S3_SCORM_PREFIX`; new code reads the canonical name.

## 2. Docebo — target + role prefixed (the one to get right)

Pattern: **`DOCEBO_{SANDBOX|PRODUCTION}_{ADMIN|LEARNER}_{FIELD}`**, where `FIELD` ∈
`BASE_URL`, `CLIENT_ID`, `CLIENT_SECRET`, `USERNAME`, `PASSWORD`.

```
DOCEBO_PRODUCTION_ADMIN_BASE_URL       DOCEBO_SANDBOX_ADMIN_BASE_URL
DOCEBO_PRODUCTION_ADMIN_CLIENT_ID      DOCEBO_SANDBOX_ADMIN_CLIENT_ID
DOCEBO_PRODUCTION_ADMIN_CLIENT_SECRET  DOCEBO_SANDBOX_ADMIN_CLIENT_SECRET
DOCEBO_PRODUCTION_ADMIN_USERNAME       DOCEBO_SANDBOX_ADMIN_USERNAME
DOCEBO_PRODUCTION_ADMIN_PASSWORD       DOCEBO_SANDBOX_ADMIN_PASSWORD
# LEARNER role mirrors the five fields for read/learner flows.
DOCEBO_WRITES_ENABLED                  # per-deploy gate: true only on an approved write target
```

- **Canonical base URLs:** production `https://aircrewacademy.docebosaas.com`, sandbox
  `https://aircrewacademysandbox.docebosaas.com`.
- **Roles:** the **editor** and **migrator** act as **ADMIN** (create/update courses). Learner flows
  (analytics verification, player E2E) use **LEARNER**.
- **The adapter** (`@runpoint-partners/airacademy-adapter-docebo`) internally wants
  `DOCEBO_{TARGET}_*` (no role) and selects target explicitly — never from env. **Host apps map their
  `DOCEBO_{TARGET}_{ROLE}_*` values into the adapter's expected names at construction.** Recommended:
  inject an `env`-shaped object rather than mutating `process.env`.
- **FORBIDDEN: bare `DOCEBO_BASE_URL` / `DOCEBO_CLIENT_ID` / …** — they silently default to sandbox
  and caused the editor write split-brain. Remove on sight; they are not in this standard.
- **`DOCEBO_TENANT_URL`** (analytics reconcile) is an alias → use
  `DOCEBO_{TARGET}_ADMIN_BASE_URL`.

## 3. Other corporate sources

| Source | Variables | Notes |
|---|---|---|
| Ascent LMS | `ASCENT_URL`, `ASCENT_USERNAME`, `ASCENT_PASSWORD` | dual-host: default `aircrewacademy.aerostudies.com`; backup `ascent.aerostudies.com` via `ASCENT_URL` |
| Jira | `JIRA_BASE_URL`, `JIRA_USERNAME`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`, `JIRA_ISSUE_TYPE` | already consistent |

## 4. App-scoped operational config — keep the app prefix

These are not shared; the prefix scopes them to one app.

| App | Prefix / vars |
|---|---|
| Editor | `EDITOR_ENV`, `EDITOR_PORT`, `EDITOR_SESSION_*`, `EDITOR_*_KEY`, `EDITOR_*_CONCURRENCY` |
| Player | `PLAYER_CHANNEL`, `PLAYER_VERSION` |
| Telemetry | `TELEMETRY_DB_PATH`, `TELEMETRY_TOKEN`, `TELEMETRY_AWS_REGION`, `RESUME_TOKEN_*` |
| Analytics | `ANALYTICS_TABLE`, `ANALYTICS_ENDPOINT`, `AUTH_CHECK_URL`, `LOGIN_*` |
| Reconcile | `RECONCILE_*`, feature flags `LIVE_RECONCILE*`, `FORCE_APPROVE_ENABLED` |

Test-only vars must be unambiguous: standardize the CDP endpoint on **`AAA_CDP`** (retire bare `CDP`).

## 5. Provenance + deploy contract (owned by the toolkit)

| Variable | Meaning |
|---|---|
| `AAA_VERSION` / `AAA_CHANNEL` / `AAA_GIT_COMMIT` / `AAA_BUILT_AT` | deploy-stamped `/version` provenance (set by the deploy; read by the runtime reader) |
| `DEPLOY_HOST` | server-ssh deploy target host |
| `DEPLOY_SSH_KEY` | server-ssh private key contents (CI writes it to `$DEPLOY_SSH_KEY_PATH`) |
| `PRODUCTION_URL` / `STAGING_URL` | channel URLs for `verify` (or set `channels.<c>.url` in config) |
| `AWS_ROLE_ARN` | static-s3 deploy OIDC role |

## Migration notes (current → standard)

- **Editor (P0):** Docebo client, `env-config.js`, `.env.example`, and `scripts/deploy/enable-lms-writes.sh`
  all move from **bare** `DOCEBO_*` to `DOCEBO_{TARGET}_ADMIN_*`; the box `.env` must carry the new keys.
- **Analytics:** `DOCEBO_TENANT_URL` → `DOCEBO_{TARGET}_ADMIN_BASE_URL`.
- **Player:** `CDP` → `AAA_CDP`; ensure no bare `DOCEBO_*` outside test fixtures.
- **Adapters:** prefer the canonical `S3_*` / `ASCENT_*` names; collapse the `AA_MODULE*` duals to a
  single primary with the canonical as fallback.
