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
   docs, market dependency direction, package and runtime gates). The variants gate covers
   `tests/` and `scripts/` too, where the two editions legitimately differ: it declares those
   differences and fails when one *disappears*, which is what copying a file from one edition
   over the other looks like.
2. `yarn workspace dsh-plugin-desktop check:mac-package` for anything that reaches the app.
3. `yarn fita list` sanity when the change touches `fita/channels.yml`.
4. `yarn check:diff` before pushing: the CI `changes` job runs the same whitespace check over
   the diff, and it rejects a file ending in a blank line. It is deliberately not part of
   `check:layout` — a pull-request checkout has no local `dev` to compare against — so it is a
   pre-push step, and the one time it was skipped the pipeline failed in twenty seconds.
5. The evidence recorded in the commit or the release notes — a build that cannot say what
   it proved is not a release candidate.

## A gate failure that was not ours, and how it was fixed

`yarn check` once ended with exactly one failure:

```
FAIL tests/windows-nsis-ab.spec.ts > Windows NSIS A/B packaging
     > really reverses only the extract template from below the outer worktree
```

Reproduced unchanged on a pristine `dev`, and the spec, the script and
`patches/app-builder-lib@26.15.7.patch` are all identical to `master` — the defect was
upstream's, in the Windows-only NSIS A/B lab. Root cause, isolated on this machine's
`git 2.50.1`:

```sh
git apply --reverse --unsafe-paths --directory=. \
  --include=templates/nsis/include/extractAppPackage.nsh patches/app-builder-lib@26.15.7.patch
```

`--include` is matched against the path *after* the `--directory` prefix is applied, so
`templates/…` never matches `./templates/…`: git selected no file, changed nothing, and still
exited 0. Measured:

| invocation | exit | template restored |
| --- | --- | --- |
| `--directory=. --include=templates/…` | 0 | no |
| no `--directory` | 0 | yes |
| `--directory=. --include=./templates/…` | 0 | yes |

Patch paths are already package-relative and `-C <isolated copy>` anchors them, so
`--directory=.` was never needed. It is gone from the production script and from the spec,
and the spec now asserts that no `--directory` argument is present — that is the property
that keeps the reversal real. The guard that turned the silent no-op into a hard failure
stays where it was.

Lane record: fixed on `dev` in `9b0f37655a`, cherry-picked to `beta` as `c97e8e0cd3`. The
generalizable fix leaves the fork from `beta` when we decide to, like any other.
