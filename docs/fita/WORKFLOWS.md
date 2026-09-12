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
- The shippable asset name is whatever the updater feed records in its `path:` entry, so
  the DMG, its blockmap and the feed always ship under one name. Renaming an asset any
  other way silently breaks auto-update.
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
