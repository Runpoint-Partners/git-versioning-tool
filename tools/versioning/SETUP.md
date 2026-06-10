# SETUP — wiring the versioning toolkit into a new GitHub repo

Two workflows, fully implemented (no placeholders): **`staging.yml`** auto-deploys every push to
main and stamps the PATCH version (staging is always on); **`production.yml`** is the manual
production deploy that cuts the MINOR/MAJOR release tag. Both are rsync-over-SSH to a Node host
running pm2, driven entirely by GitHub Environment config. The developer interface is the four
commands (`push` / `production` / `breaking-change` / `change-version`). Budget: ~20 minutes.
No merge requests required.

## Prerequisites (developer machine)

- **Node** and **git**.
- **GitHub CLI `gh`**, authenticated with the `repo` + `workflow` scopes:
  ```bash
  gh auth login          # GitHub.com → HTTPS → with these scopes
  gh auth status         # confirm; or: gh auth refresh -s workflow
  ```

## Step 1 — Copy the toolkit in

Copy the whole `tools/versioning/` folder (including `lib/`) into the new repo. No `VERSION`
file — the version is derived from git tags + commits.

## Step 2 — Add both workflows

```bash
mkdir -p .github/workflows
cp tools/versioning/templates/staging.yml    .github/workflows/staging.yml
cp tools/versioning/templates/production.yml .github/workflows/production.yml
git add .github/workflows && git commit -m "ci: staging + production deploys" && git push
```

They're complete as-is for a Node/pm2 app — you don't edit the YAML; you configure the
parameters in Step 3. (If your app needs a build, add a `npm run build` step before "Sync app
files". If you deploy to S3/containers instead of SSH, replace the Configure-SSH/Sync/Install
steps; the version + verify steps stay.)

## Step 3 — Configure the two GitHub Environments

Create **two** environments (Settings → Environments → New environment): **`staging`** and
**`production`**. Give each the **same variable names with that environment's values** — that's
how one workflow file deploys to the right place per environment.

| Name | Kind | Example (staging / production) | Notes |
|---|---|---|---|
| `DEPLOY_SSH_KEY` | **Secret** | *(the private key)* | SSH key for `DEPLOY_USER@DEPLOY_HOST` |
| `DEPLOY_HOST` | Variable | `10.0.0.5` / `3.13.137.140` | server host or IP |
| `DEPLOY_USER` | Variable | `ec2-user` | SSH user |
| `DEPLOY_PATH` | Variable | `/home/ec2-user/app` | app directory on the server |
| `DEPLOY_ENTRY` | Variable | `src/app/server.js` | node entrypoint pm2 starts |
| `BASE_URL` | Variable | `https://staging.x.com` / `https://x.com` | must serve `GET /version` |
| `DEPLOY_PM2_PROCESS` | Variable *(opt)* | `app` | pm2 process name (default `app`) |
| `STAMP_PATH` | Variable *(opt)* | `src/app/build-stamp.json` | certificate path (default shown) |

Also: Settings → Actions → General → **Workflow permissions → Read and write permissions** (so
the production workflow can push the release tag). Optional: add **required reviewers** on the
`production` environment to gate every production deploy behind a human approval.

## Step 4 — Serve `/version` in your app

Add a `GET /version` endpoint that reads the generated certificate at `STAMP_PATH` and returns:

```json
{ "version": "1.2.0", "channel": "production", "gitCommit": "<sha>", "builtAt": "<iso>" }
```

See this repo's `src/editor/server.js` `/version` handler for a reference. **Gitignore the
certificate** (`STAMP_PATH`) — it's generated at deploy, never committed.

## Step 5 — Point the CLI at the production workflow

`push --production` triggers `production.yml` by default. If you named the workflow file differently:

```bash
export DEPLOY_WORKFLOW=your-production-workflow.yml
```

`verify` resolves its URL per environment from `PRODUCTION_URL` / `STAGING_URL` (or a `--url=`
override). Set them once for convenience:

```bash
export PRODUCTION_URL=https://your-url  STAGING_URL=https://staging.your-url
```

## Step 6 — Go live

- **Staging is automatic.** Your Step 2 push already deployed to staging and stamped a PATCH.
  Check: `node tools/versioning verify --staging`.
- **First production deploy:**
  ```bash
  node tools/versioning push --production --dry-run   # preview
  node tools/versioning push --production             # cuts v1.0.0, deploys, stamps /version
  node tools/versioning verify --production                   # VERIFIED v1.0.0 @ <sha>
  ```

## Do you need PRs / merge requests?

**No.** `push --production` triggers the workflow, which *is* the git-controlled, audited
path (every run is logged with who/what/when, and each release is a git tag). PRs are optional —
use them for code review. For a human gate on production specifically, add required reviewers to
the `production` environment (Step 3).

## The flow, end to end

`push` → staging auto-deploy + PATCH · `push --production` → MINOR (tag + deploy + stamp) ·
`push --production --major` → MAJOR · `rollback <v> --production|--staging` → re-deploy an existing
release. The
version + SHA are generated from git (nothing hand-edited); `verify` proves what's live in any
environment (just point it at the staging or production URL).
