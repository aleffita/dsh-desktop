# Fita Harness — one application, many lanes

This file records the decision, and it is now implemented in the registry, the packaging
scripts, the installer and the e2e. The product owner's correction narrowed what the earlier
slices assumed:

> One bundle id — `dev.aleffita.dsh-harness` — one application in `Applications`, and inside it
> the lanes are chosen and switched between. Not one app per lane.

The earlier slices built per-lane installs: each channel carried its own `bundleId` and
`appName` and landed beside the others in `~/Applications`. That works, and it is what
`yarn fita:verify-installs` proves, but it is not the product we want. It is also not what an
Electron app has to do: the code payload is a directory inside one bundle, and this repository
already knows how to replace it safely.

## What becomes a single identity

| today, per lane | becomes |
| --- | --- |
| `bundleId` (`ai.deepseek.dsh.desktop.dev`, `…beta`, …) | one: `dev.aleffita.dsh-harness` |
| `appName` (`DSH Fita Dev`) | one application name |
| install path per lane (`~/Applications/DSH Fita Dev.app`) | one install location |
| `fita install <slug>` installs that lane after removing the sibling | installs the one app; the lane is a state inside it |
| side-by-side `verify-installs` e2e | an e2e that switches lanes inside one app |

## What stays per lane, and why

A lane is still a **release stream**, and the registry still describes it: `tag` (which tag
carries its builds), `feed` (`<feed>-mac.yml`), `artifactSlug` (the file names its release
carries), `accent`/`name`/`description` (what the UI shows), `prerelease` (whether its releases
are pre-releases). Those are how a lane's build is *found and fetched*; none of them needs to be
the application's identity.

## Why the update machinery already is the switching mechanism

Choosing another lane is: fetch that lane's payload, verify it against that lane's feed, then
swap `app.asar` while keeping the previous one. That is exactly what the payload layer of the
update does, generalised from "newer version of my lane" to "another lane's build". So switching
lanes does not need a new mechanism — it needs the update path to accept a lane the app is not
currently on, and the app to remember which lane it is running (the `fitaChannel` stamp, which
already exists and is read from the packaged manifest).

The DMG layer stays for what a payload cannot change: the Electron runtime, native modules or
resources — and for a first install.

## Cost, measured before starting

Per-lane identity is referenced 60 times across `fita/channels.yml`, `scripts/fita/*`
(`package.mts`, `fita.mjs`, `verify-channel.mts`, `verify-installs.mts`,
`verify-prepared-cache.mts`, `channels-module.mts`), `docs/fita/*` and
`.github/workflows/desktop-release.yml`. The migration is therefore:

1. Registry: one application identity; lanes keep tag/feed/artifactSlug/accent/prerelease.
2. `fita:package`: stamp the single identity plus the lane the build belongs to; keep per-lane
   artifact names and feed so releases stay distinguishable.
3. `fita install`: one target; `use` and `uninstall` stop being per-lane.
4. The e2e becomes "one app, lanes switched inside it", with the payload path proven to land on
   `dev.aleffita.dsh-harness` — `yarn fita:verify-update` already proves the swap itself.
5. Docs: `CHANNELS.md`, `INSTALLS.md`, `README.md` and this file kept in step.

Landed: `fita/channels.yml` declares one `application` block and lanes without identity,
`FITA_APPLICATION` travels with every build, `fita install` puts one application in
`~/Applications/DSH Harness.app`, and the e2e applies two lanes over that one bundle and boots
it — `yarn fita list` shows every lane carrying `app="DSH Harness"`, `bundle=dev.aleffita.dsh-harness`.
