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

## Consumption map

| consumer | reads | uses |
| --- | --- | --- |
| release workflow | `channels.yml` | tag pattern, feed name, app name, bundle id, prerelease flag |
| header renderer | `channels.yml` | chip label, accent, subtitle typography and slug |
| installer (`fita`) | `channels.yml` | install path, app name, which release to fetch |
| packaging (`fita:package`) | `channels.yml` + `fita-channel.json` | product name, bundle id, updater feed, manifest provenance |
| updater | baked `app-update.yml` | `channel: <feed>`, owner/repo of our fork |
| marketplace source | `channels.yml` | which builds and plugins this source offers |
