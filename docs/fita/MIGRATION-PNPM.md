# Migrating this repository from Yarn to pnpm

One change, not a series of small ones: the package manager is not a detail that can be swapped
half-way, because a wrong mapping installs a different dependency tree and every gate after it
would be testing the wrong thing.

## What was measured first

| thing | count |
| --- | --- |
| `resolutions` to translate | 539 (502 `file:` tarballs, 36 `patch:`, 1 version pin) |
| patch files | 19 in `patches/`, 1 in `.yarn/patches/` |
| root scripts calling `yarn` | 22 |
| files invoking `yarn workspace`/`run`/`install` | 12 |

`scripts/migrate/yarn-to-pnpm.mjs` is the translator, and running it before changing anything
already found the two things that would have broken the migration silently:

1. **Yarn URL-encodes the descriptor**: `patch:app-builder-lib@npm%3A26.15.7#./patches/…`.
   Reading it without decoding finds no version, so every patch would have been dropped — the
   app would install upstream electron-builder and the NSIS fix would vanish.
2. **30 of the 36 patches target vendored tarballs** (`file:vendor/…tgz`), which pin no npm
   version. pnpm keys `patchedDependencies` by `name@version`, so each of those versions has to
   be read from inside its tarball (`tar -xzOf <tgz> package/package.json`) — the mapping cannot
   be derived from `package.json` alone.

Current dry run: 509 overrides, 5 patched dependencies, 30 still needing the tarball lookup.

## The migration, in the order it has to happen

1. **Translate** (the script): `resolutions` → `pnpm.overrides`, `patch:` → `pnpm.patchedDependencies`,
   with the tarball versions resolved from the vendored packages. `packageManager: pnpm@10.18.0`,
   plus a `pnpm-workspace.yaml`.
2. **Install**: delete `yarn.lock`, add `pnpm-lock.yaml`, `pnpm install`. This is the step that
   proves or disproves the translation — the dependency tree has to match what Yarn produced,
   including the 36 patched packages.
3. **Rewrite the commands**: `yarn workspace X <cmd>` → `pnpm --filter X <cmd>`, `yarn install
   --immutable` → `pnpm install --frozen-lockfile`, `yarn run` → `pnpm run`, in the 22 root
   scripts and the 12 files that invoke them (scripts, workflows, packaging).
4. **Workflows**: `corepack enable` + `pnpm/action-setup`, the pnpm store cached, every install
   `--frozen-lockfile`. No npm anywhere.
5. **Gates that do not depend on Actions** (see below), and required status checks so a red
   pipeline blocks the merge.
6. **Docs**: this file, `WORKFLOWS.md`, `GITFLOW.md`, `README.md`; and `PACKAGES.md` for the
   registry rules that mention Yarn today.

## Gates and guardrails that run locally

The point is that a push is already known to pass, because the same checks ran before it left
the machine:

| where | what runs | why there |
| --- | --- | --- |
| `pre-commit` | `check:diff`, `check:desktop-variants`, `check:fita-channels`, typecheck of the touched workspace | seconds, and it catches the class of mistake that has actually happened here: edition files copied over each other, stale generated registry, whitespace the CI rejects |
| `pre-push` | `pnpm run check` (the whole gate) | the pipeline's gate, run before the pipeline sees it |
| CI `check` job | the same `pnpm run check` | identical by construction, and required for merge |

Hooks live in the repository (`core.hooksPath=.githooks`) so they travel with a clone, and each
hook calls the same node scripts CI calls — not a copy of them, so the two cannot drift.

## Blocking merges

Required status checks on `dev` (`gh api` against the branch protection endpoint, scripted so it
is reproducible): the `check` job, the two edition gates, and the macOS packaging gate. With
those required, a merge is impossible while any of them is red — which is what makes "gates"
mean something rather than being advisory.
