# Fita Harness — channels

A **channel** is one installable lane: a git branch, a tag pattern, an updater feed, an
app identity and a colour. `fita/channels.yml` declares them; nothing else may hardcode
a channel name.

## Registry

| channel | lane | tag | feed | app | accent |
| --- | --- | --- | --- | --- | --- |
| Main | `master` | `v*` | `latest-mac.yml` | `DSH Fita` | `#1F6FEB` design-system blue |
| Beta | `beta` | `beta-v*` | `beta-mac.yml` | `DSH Fita Beta` | `#E3B341` yellow |
| Dev | `dev` | `dev-v*` | `dev-mac.yml` | `DSH Fita Dev` | `#FF4D9D` pink |
| Pull request | `PR-<n>-<slug>` | `pr-<n>-v*` | `pr-mac.yml` | `DSH Fita PR` | `#FF7A59` orange-pink |

Each entry carries: `name`, `slug`, `lane`, `tag`, `feed`, `appName`, `artifactSlug`,
`bundleId`, `accent`, `onAccent`, `prerelease`, `installs`, `description`. A channel is added by
adding an entry — the release workflow, the header and the installer read the same file.

## Why a distinct `bundleId` and `appName` per channel

Side-by-side installs are the point: `DSH Fita Dev.app` and `DSH Fita Beta.app` must be
able to run at the same time, keep separate update caches, and never fight over the same
LaunchServices identity. That is why the channel definitions include both, and why the
packaging step must stamp them per channel instead of inheriting a single static value.

The updater reads its feed from `app-update.yml` baked at build time, so a channel build
must also bake `channel: <feed>` — otherwise every channel would chase `latest-mac.yml`.

## Header identity

The window header carries the product identity and the channel together:

```
┌───────────────────────────────────────────────┐
│  deepseek  [ FITA ] HARNESS                   │
│  dev-v2.0.10-rc.1                             │
└───────────────────────────────────────────────┘
```

- `HARNESS` keeps the upstream white wordmark on its upstream background — the brand we
  are building on stays recognisable.
- `FITA` sits before it as a chip whose **background is the channel accent** and whose
  foreground is `onAccent`. `dev` pink, `beta` yellow, `main` blue, pull requests
  orange-pink; a custom channel picks its own colour in the registry.
- The subtitle is a **thin, serif, left-aligned** version slug, aligned with the start of
  the wordmark, drawn in the channel accent, so a screenshot identifies the build without
  opening About.

Everything above is data: `header` in `fita/channels.yml` holds the wordmark, the chip
label, the wordmark colours and the subtitle typography. The renderer resolves
`color: channel` to the active channel's `accent`.

## Channel manifest

Every channel build writes `fita-channel.json` next to its artifacts. It is the only
description of what was actually built, and consumers read it instead of re-deriving names:

| field | example | read by |
| --- | --- | --- |
| `channel`, `name`, `lane` | `dev`, `Dev`, `dev` | installer, e2e, workflow |
| `product`, `version` | `DSH Fita`, `2.0.9` | workflow, installer |
| `appName`, `artifactSlug`, `bundleId` | `DSH Fita Dev`, `DSH-Fita-Dev`, `ai.deepseek.dsh.desktop.dev` | installer, e2e |
| `feed`, `feedFile` | `dev`, `dev-mac.yml` | workflow, updater |
| `accent`, `prerelease` | `#FF4D9D`, `true` | header, workflow |
| `dmg`, `dmgSha256` | `DSH-Fita-Dev-2.0.9-universal.dmg`, `…` | installer, e2e |
| `electronBuilderFlags` | the stamped flags | whoever debugs a build |

The channel verifier runs *before* the manifest is written, so a build that cannot prove
its identity produces neither: no artifacts, no manifest, nothing to ship.

## Consumption map

| consumer | reads | uses |
| --- | --- | --- |
| release workflow | `channels.yml` | tag pattern, feed name, app name, bundle id, prerelease flag |
| header renderer | `channels.yml` | chip label, accent, subtitle typography and slug |
| installer (`fita`) | `channels.yml` | install path, app name, which release to fetch |
| packaging (`fita:package`) | `channels.yml` + `fita-channel.json` | product name, bundle id, updater feed, manifest provenance |
| updater | baked `app-update.yml` + `channels.yml` | `channel: <feed>`, owner/repo of our fork (see *Updater vocabulary*) |
| marketplace source | `channels.yml` | which builds and plugins this source offers |

## Updater vocabulary: the shipped app knows two channels, we ship four

Measured on the vendored runtime, not assumed:

- `dsh-plugin-desktop/src/update-checker.ts:19` — `export type DesktopReleaseChannel = 'stable' | 'beta'`.
  Our lanes `dev` and `pr` are outside that union, so the app's own update path cannot
  name them.
- `dsh-plugin-desktop/src/update-download.ts:183` — the artifact it offers is
  `channel === 'beta' ? 'DSH-Desktop-Beta' : 'DSH-Desktop'`. A `dev` build that used the
  built-in path would present itself as `DSH-Desktop`, i.e. as stable.
- `dsh-plugin-desktop/src/update-download.ts:260` — `validatedVersion` enforces
  channel/prerelease agreement, so stable and beta cannot borrow each other's versions.

Consequences for the program, in order:

1. The channel-aware updater is ours to build; it must key on `channels.yml` and the
   installed `fita-channel.json`, never on the app's two-value union.
2. `app-update.yml` is still written per channel by `electron-builder` and is correct
   (`channel: dev`, owner/repo of our fork) — that is the descriptor our updater reads.
   Verified for the dev build: `provider: github`, `owner: aleffita`, `repo: dsh-desktop`,
   `channel: dev`.
3. `updaterCacheDirName` is derived from the package name, not the product name
   (`app-builder-lib/out/appInfo.js:126` → `dsh-plugin-desktop-updater`), so **every**
   channel shares one cache directory. Nothing consumes it today — no file under
   `dsh-plugin-desktop/src` imports `electron-updater`, `autoUpdater` or `app-update.yml`;
   the app reaches its own version endpoint instead — so this is latent, not broken. Our
   updater must scope its download/cache paths by channel rather than inherit the shared
   name.

## How a running build knows its channel

Two halves, both generated from the registry so a channel is declared once:

**The stamp.** `fita:package` passes `--config.extraMetadata.fitaProduct|fitaChannel|fitaFeed`,
so the packaged `package.json` carries the channel. Verified on the dev build by reading
`Contents/Resources/app.asar/package.json` back out of the DMG:

```
name: dsh-plugin-desktop | version: 2.0.9
fitaProduct: DSH Fita | fitaChannel: dev | fitaFeed: dev
```

That is the app's own answer to "which channel am I", read through the same
`new URL('../package.json', import.meta.url)` the version already comes from. There is no
second source and no guessing: a build without the stamp — upstream's, or one made before the
registry existed — is reported as *unknown*, and the app must not offer it another channel's
release.

**The catalogue.** The packaged app cannot read `fita/channels.yml`, so
`scripts/fita/channels-module.mts` freezes it into `src/fita-channels.generated.ts` in **both**
editions (`yarn fita:channels`), and `yarn check:fita-channels` — part of `check:layout` —
fails when the committed module and the YAML disagree. `src/fita-channel.ts` is the only
reader: `fitaChannel(slug)` looks a channel up, `readFitaBuildIdentity(manifest)` reads the
stamp, `runningFitaChannel(manifest)` resolves the two together and returns undefined rather
than a wrong channel. `tests/fita-channel.spec.ts` holds the invariants: unique
slug/`bundleId`/`appName`/`artifactSlug`/`installs`, well-formed accents and install paths, and
the refusal to resolve an undeclared slug.

So adding a channel stays a one-file change: declare it in `fita/channels.yml`, run
`yarn fita:channels`, and both the pipeline and the app see it.

## Asking that channel for a build

`src/fita-release.ts` decides, from a release listing alone, which release a channel should
offer: `fitaTagPattern` compiles the registry's `tag` pattern into an anchored matcher whose
last group is the version, selection refuses drafts and other lanes' tags, and a stable channel
never offers a prerelease — the tag pattern `v*` alone would let `v2.0.10-rc.1` into `main`,
which is the rule the upstream download path already enforces. The DMG has to carry both the
channel's `artifactSlug` and the requested version, so the wrong build cannot be installed by
accident, and `fitaExpectedChecksum` reads one digest out of the release's `SHA256SUMS.txt`.

`src/fita-release-source.ts` is the network half: it reads the listing of the repository the
registry names and answers with one of three states — `offer` (version, release, DMG,
checksums), `none` (the channel has published nothing eligible), or `failed` with a named
reason (`request`, `response`, `malformed`). A channel check that could not complete is never
reported as "up to date", because that is the one wrong answer a user cannot detect.

### What the renderer sees

Two routes, both registered by the `desktop-updates` plugin and both behind the same loopback
and same-origin rules as the rest of the settings API:

| route | body | answer |
| --- | --- | --- |
| `GET /api/desktop/updates/channels` | none | `{ current, channels[] }` — the catalogue in registry order, each entry marked with `current: true` for the running build; `current` is null when this build carries no stamp |
| `POST /api/desktop/updates/channel-check` | `{ "channel": "<slug>" }` | the three states above, projected into renderer-safe shapes: artifact names and URLs, no host objects |

An undeclared slug is *answered*, not rejected: `{ "status": "failed", "reason":
"unknown-channel" }` lets the UI say what happened instead of showing a generic error, and the
Host never has to guess what the caller meant. A check that throws is a 500 with the cause
logged — the same fail-closed shape as the interactive update route.
