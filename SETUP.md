# SETUP — adopting `rpv` in a repo

Adoption is: install → configure → wire one workflow. ~10 lines, no vendored folder.

## 1. Install

```jsonc
// package.json
"devDependencies": {
  "@runpoint-partners/versioning": "github:Runpoint-Partners/git-versioning-tool#v1.0.0"
}
```
```bash
npm install
```

## 2. Configure

```bash
npx rpv init --preset server-ssh   # or static-s3 | library | custom
```
Edit the scaffolded `"versioning"` block in `package.json` — set `appName`, the channel `url`(s) and
`stampPath`, and the strategy specifics. Use `"$NAME"` for anything secret/host-specific; those
resolve from env at deploy time. Then validate:
```bash
npx rpv config print   # shows resolved config + flags any unset $ENV refs + validation errors
```

## 3. Serve `/version`

```js
const { readVersion } = require('@runpoint-partners/versioning/runtime');
app.get('/version', (_req, res) => res.json(readVersion({
  name: '<appName>', stampPath: '<your stampPath>', packageJson: './package.json',
})));
```
(Libraries skip this.)

## 4. Wire the reusable workflow

Add `.github/workflows/deploy.yml` — a thin caller:

```yaml
name: Promote
on:
  workflow_dispatch:
    inputs:
      channel:  { type: choice, options: [production, staging], default: production }
      release:  { type: choice, options: [minor, major], default: minor }
      rollback: { type: string, default: "" }
jobs:
  deploy:
    uses: Runpoint-Partners/git-versioning-tool/.github/workflows/versioned-deploy.yml@v1.0.0
    with:
      channel:  ${{ inputs.channel }}
      release:  ${{ inputs.release }}
      rollback: ${{ inputs.rollback }}
    secrets: inherit
```

## 5. Secrets & variables

The reusable workflow maps these into the env your config references:

| Name | Kind | Used by |
|---|---|---|
| `PRODUCTION_URL` / `STAGING_URL` | repo **variable** | `verify`, `channels.<c>.url` |
| `DEPLOY_HOST` | variable or secret | `server-ssh` |
| `DEPLOY_SSH_KEY` | **secret** (private key contents) | `server-ssh` (written to `$DEPLOY_SSH_KEY_PATH`) |
| `AWS_ROLE_ARN` + `AWS_REGION` | secret + variable | `static-s3` |

Set them with `gh secret set` / `gh variable set` — no GUI needed.

## Deploy

```bash
npx rpv push --production        # local trigger (needs the gh CLI), or use the Actions UI
npx rpv verify --production      # confirm the live box matches the release tag
```

## Versioning scheme

`MAJOR.MINOR.PATCH`, all git-derived — **PATCH** = commits since last release, **MINOR** = one
`vMAJOR.MINOR.0` tag per production release, **MAJOR** = a breaking release (`--major`). Roll back by
re-deploying an earlier tag. Monorepos: declare `packages: [...]` and pass `--package=<name>`
(per-package independent tags are the default `versionMode`).
