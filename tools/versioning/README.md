# Versioning

Deterministic, git-derived version + SHA provenance. There is **no human-edited version file** —
a developer uses four commands and GitHub generates everything else.

**New repo?** See **[SETUP.md](SETUP.md)** — wires up GitHub (one workflow + a little config) in ~15 min.

## 1. CLI usage (three commands)

Environment is always an **explicit flag** — nothing defaults silently. Add `--dry-run` to preview.

```
# push — deploy
node tools/versioning push                        # git push → STAGING auto-deploys (PATCH)  [= push --staging]
node tools/versioning push --production           # ship main to PRODUCTION → next MINOR
node tools/versioning push --production --major   # ship main to PRODUCTION → next MAJOR (breaking)

# rollback — re-deploy an existing release (env required)
node tools/versioning rollback 1.3.0 --production # roll production back to 1.3.0
node tools/versioning rollback 1.3.0 --staging    # roll staging back (temporary; next push restores latest)

# verify — is a live env on the version it claims? (env required)
node tools/versioning verify --production                 # URL from $PRODUCTION_URL (or --url=)
node tools/versioning verify --staging --url=https://staging.example.com
```

`push` (bare or `--staging`) runs `git push`; staging is always on, so it auto-deploys + stamps the
PATCH. `push --production` triggers the **production** workflow (cuts the MINOR/MAJOR tag, deploys).
Both workflows ship complete in `templates/` — see [SETUP.md](SETUP.md). Engine/CI plumbing lives in
`lib/` and is **not** part of this interface.

## 2. Version guide (what the numbers mean)

`MAJOR.MINOR.PATCH` — each field marks an **event**, not SemVer compatibility:

- **PATCH** = a commit (auto — commits since the last release).
- **MINOR** = a production release (auto — one `vMAJOR.MINOR.0` git tag per `production`).
- **MAJOR** = a breaking change (only `breaking-change` bumps it).

It's all derived from git tags + commits; nothing is hand-edited. The one artifact is a **generated**
certificate served at `/version` (`{ version, channel, gitCommit, builtAt }`) — a commit can't store
its own SHA, which is exactly what makes it tamper-proof and human-proof.

## 3. SHA verify guide (`verify`)

"Is production really on the version it claims?" `verify` reads the env's `/version` and re-derives the
SHA from git — if someone edited production outside git, the running commit won't match the release
tag (a `MISMATCH`):

```
node tools/versioning verify --production                # vs the latest in GitHub (URL from $PRODUCTION_URL or --url=)
node tools/versioning verify --staging --url=https://staging-url   # any env — flag + URL
node tools/versioning verify --production 1.3.0          # vs a specific version
```

Exit codes: `0` verified · `1` inconsistent (tamper / wrong version) · `2` usage · `3` can't verify
(environment unstamped, or the running commit isn't in your local clone — `git fetch`).
