# @runpoint-partners/versioning (`rpv`)

Deterministic, git-derived **version + commit-SHA provenance** plus **parameterized deploys** —
one installable, dependency-free toolkit shared across repos. There is **no human-edited version
file**: `MAJOR.MINOR.PATCH` is derived from git tags + commits, and a generated certificate served
at `GET /version` lets you prove what's actually live (`verify` re-derives the SHA, so a hand-edit to
a box shows up as a `MISMATCH`).

Distributed as a private npm package consumed via git-tag — no vendored copy to drift.

## Install

```jsonc
// consumer package.json
"devDependencies": {
  "@runpoint-partners/versioning": "github:GitSmart86/git-versioning-tool#v1.0.0"
}
```

```bash
npx rpv init --preset server-ssh   # scaffold a "versioning" config block, then edit it
npx rpv config print               # validate config + see which $ENV refs are set
```

## The two surfaces

**Developer (local):**
```
rpv init --preset <server-ssh|static-s3|library|custom>   # scaffold config
rpv config print | get <dotpath>                          # inspect resolved config
rpv push  [--staging | --production [--major]]            # trigger a deploy via the workflow
rpv rollback <version> (--staging | --production)         # re-deploy an existing release
rpv verify (--staging | --production) [version]           # is the live env on the version it claims?
```

**Workflow (CI — called by the reusable workflow):** `resolve-release`, `rollback-target`,
`stamp --channel=`, `deploy --channel=`.

## Configuration (the part that makes it portable)

A consumer declares one config block (in `package.json` under `"versioning"`, or a
`versioning.config.js`). Resolution precedence is **CLI flag > env var > project config > preset
default**; `"$NAME"` strings resolve from the environment (secrets are referenced, never stored).

```jsonc
"versioning": {
  "appName": "editor",
  "preset": "server-ssh",
  "channels": { "production": { "url": "$PRODUCTION_URL", "stampPath": "src/build-stamp.json" } },
  "deploy": {
    "strategy": "server-ssh", "host": "$DEPLOY_HOST", "appRoot": "/home/ec2-user/app",
    "sshKey": "$DEPLOY_SSH_KEY_PATH", "processes": [{ "name": "editor", "script": "src/server.js" }]
  }
}
```

The **version core** (resolve / stamp / verify) is uniform; the **deploy strategy** is pluggable:

| Preset | Strategy | For |
|---|---|---|
| `server-ssh` | rsync `--delete` + pm2 restart over SSH | long-running Node hosts (editor, analytics) |
| `static-s3` | `aws s3 sync` (+ optional CloudFront invalidation) | static artifacts (player) |
| `library` | none — the git tag is the release | libs consumed via git-tag (adapters, SCORM-Builder) |
| `custom` | runs a repo-declared command | bespoke pipelines (migrator) |

Bring your own by pointing `deploy.strategy` at a module path implementing
`{ name, validate(cfg), async deploy(ctx) }`. Monorepos declare `packages: [...]` and select with
`--package=<name>`.

## Runtime `/version`

A running app imports only the tiny reader (never the deploy CLI):

```js
const { readVersion } = require('@runpoint-partners/versioning/runtime');
app.get('/version', (_req, res) => res.json(readVersion({
  name: 'editor', stampPath: path.join(__dirname, 'build-stamp.json'), packageJson: '../package.json',
})));
```

New repo? → **[SETUP.md](SETUP.md)**.
