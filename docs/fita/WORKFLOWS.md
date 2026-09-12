# Fita Harness — workflows

Every pipeline in this fork reads `fita/channels.yml`. A channel that is not in the
registry cannot be built, installed or updated, which is what keeps the four documents in
this directory honest.

## Pipelines

| workflow | trigger | does | publishes |
| --- | --- | --- | --- |
| `ci.yml` | PRs and pushes on `master`, `beta`, `dev` | path classification, docs-only gate, Windows installer + macOS smoke per desktop edition | nothing |
| `desktop-release.yml` | tag per lane (`v*`, `beta-v*`, `dev-v*`, `pr-<n>-v*`) or manual dispatch | package gate, unsigned macOS universal DMG, checksums | GitHub release with DMG, `.blockmap`, feed and `SHA256SUMS.txt` |
| `github-packages.yml` (planned) | tag on the plugin repos | build and publish our scoped plugin packages | GitHub Packages (`@aleffita/…`) |
| upstream reconciliation (planned) | schedule + manual | merge upstream `master` into `dev`, resolve the patches we own, keep `beta` rebased | nothing |

## Release rules

- The version is owned by the repository: a release is a version bump commit on a lane
  followed by the lane's tag. The workflow verifies tag against `package.json` instead of
  rewriting either.
- A tag whose version carries a pre-release suffix produces a GitHub pre-release and the
  channel's `prerelease` flag is taken from the registry.
- The shippable asset name comes from the registry: `artifactSlug` feeds
  `--config.artifactName`, so the DMG file, the blockmap and the feed's `path:` are the
  same string produced in one place. electron-builder otherwise sanitises spaces in the
  feed while the file on disk keeps them, and the updater then asks for an asset that was
  never uploaded — the channel verifier fails the build when that drifts.
- Nothing is published to npm. Installable builds are GitHub release assets; plugin
  packages go to GitHub Packages; CI artifacts exist for inspection only.

## Scheduled, not improvised

Upstream reconciliation is repetitive but not deterministic: it is a dated, logged
operation with a fixed recipe (fetch upstream, merge into `dev`, re-apply our patches,
run the same gates, record what conflicted and why). It gets a workflow and a log entry
per run, so a future agent can see when it last happened and what it cost, instead of
guessing whether the fork is current.

## Gates a change must pass before it is a release

1. `yarn check` on the workspace it touches (layout, variants, vendored runtime, bilingual
   docs, market dependency direction, package and runtime gates).
2. `yarn workspace dsh-plugin-desktop check:mac-package` for anything that reaches the app.
3. `yarn fita list` sanity when the change touches `fita/channels.yml`.
4. The evidence recorded in the commit or the release notes — a build that cannot say what
   it proved is not a release candidate.

## Known upstream failure in the gate

`yarn check` ends with exactly one failure, and it is not ours:

```
FAIL tests/windows-nsis-ab.spec.ts > Windows NSIS A/B packaging
     > really reverses only the extract template from below the outer worktree
```

Reproduced unchanged on a pristine `dev`, and the spec, the script and
`patches/app-builder-lib@26.15.7.patch` are all identical to `master` — the defect is
upstream's, in the Windows-only NSIS A/B lab. Root cause, isolated on this machine's
`git 2.50.1`:

```sh
git apply --reverse --unsafe-paths --directory=. \
  --include=templates/nsis/include/extractAppPackage.nsh patches/app-builder-lib@26.15.7.patch
```

`--include` is matched against the path *after* the `--directory` prefix is applied, so
`templates/…` never matches `./templates/…`: git selects no file, changes nothing, and still
exits 0. Measured: dropping `--directory=.` restores the template, and
`--include=./templates/…` with `--directory=.` restores it too. The same flag pair is in the
production script (`scripts/build-windows-nsis-ab.ts:251`), where the guard at line 283 turns
the silent no-op into a hard failure.

It is a cherry-pick candidate for `beta`, not something to work around here: the fix belongs
to the upstream-bound lane, and until it lands, a green `yarn check` means "everything except
this one".
