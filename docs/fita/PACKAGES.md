# Fita Harness — our packages, and where they are published

Nothing goes to npm. Two channels exist for what we ship, and this file says which one each
thing uses and why.

## The desktop app is a release, not a package

The app is delivered as GitHub Releases per lane (`desktop-release.yml`, one tag per channel),
carrying both update layers. It is not a package: its identity is its bundle, its bundle
identifier and its channels, and `fita install` is what puts it on a machine.

## Why the workspace packages keep their names

GitHub Packages requires a package name scoped to its owner, so publishing means
`@aleffita/…`. Renaming the workspaces to get there was measured before being rejected:

| package | files referencing the name |
| --- | --- |
| `dsh-plugin-desktop` | 269 |
| `dsh-community-market` | 67 |
| `dsh-plugin-desktop-beta` | 55 |
| `dsh-community-fabric` | 24 |

Those names are not labels: they are Cordis plugin ids. `cordis.patch.yml` composes
`dsh-plugin-desktop/terminal`, `dsh-plugin-desktop/updates` and so on, the two-edition gate
normalises `dsh-plugin-desktop-beta` into `dsh-plugin-desktop`, and the packaging scripts pass
the workspace name to Yarn. A rename is a refactor of every one of those references, in both
editions, for a publishing convenience — and it would have to happen while the running app is
the thing being renamed.

So the workspace names stay. What changes is what we *publish*:

## What we publish under `@aleffita/…`

Plugins we author, from now on, get a scoped name from the start — the planning plugin of the
next slice is the first. They are the things a user adds with `dsh plugin add`, so they are the
things a registry has to serve. Their `cordis.patch.yml` names them scope and all, because that
is how the plugin is resolved; nothing has to be renamed after the fact.

`publishConfig` then points at GitHub Packages (`https://npm.pkg.github.com`) with
`access: restricted`, the workflow uses `GITHUB_TOKEN` with `packages: write`, and npm stays out
of it entirely. A package already pointing at `registry.npmjs.org` is a bug here, not a default.
