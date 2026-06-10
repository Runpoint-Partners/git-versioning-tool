# git-versioning-tool

Canonical home of the Runpoint **versioning toolkit** — deterministic, git-derived
`MAJOR.MINOR.PATCH` + commit-SHA provenance, with a three-command CLI (`push` / `rollback` /
`verify`) and complete **staging + production** GitHub Actions workflow templates. Dependency-free
(Node built-ins + git); no build step.

## Install (vendored copy)

Copy the **`tools/versioning/`** folder from this repo into your project at the **same path**
(`tools/versioning/` — the workflows and commands assume it). Then:

1. Drop the two workflows from `tools/versioning/templates/` into your repo's `.github/workflows/`.
2. Configure the `staging` + `production` GitHub Environments (secrets + variables).
3. Serve `GET /version` from the generated certificate.

Full install guide → **[`tools/versioning/SETUP.md`](tools/versioning/SETUP.md)**
Usage + design → **[`tools/versioning/README.md`](tools/versioning/README.md)**

## The interface

```
node tools/versioning push                       # git push → staging auto-deploys (PATCH)
node tools/versioning push --production           # → next MINOR release (deploy + tag)
node tools/versioning push --production --major   # → next MAJOR (breaking)
node tools/versioning rollback <ver> --production|--staging   # re-deploy an existing release
node tools/versioning verify  --production|--staging          # is the env really on that version?
```

The version + SHA are generated from git (nothing hand-edited). `verify` re-derives the SHA from
git/GitHub, so a hand-edit to a live box shows up as a `MISMATCH`.
