# Fita Harness — installed builds

Several channels live side by side on one machine. Nothing is dragged into
`/Applications` by hand: a channel resolves to a release of our fork, the DMG is verified
and unpacked by the install manager.

## Install manager

`fita/channels.yml` is the registry; `scripts/fita/fita.mjs` is the client.

```sh
yarn fita list                       # channels, lane, accent, installed version
yarn fita status                     # per channel: version and install path
yarn fita install dev                # newest dev release -> ~/Applications/DSH Fita Dev.app
yarn fita install beta --version=2.0.10-rc.2
yarn fita use dev                    # launch the dev build
yarn fita uninstall beta
```

What `install` does, in order: resolve the channel's release by its tag pattern, download
the DMG and `SHA256SUMS.txt` from the release, verify the checksum, mount read-only,
`ditto` the app into the channel's own path, clear the quarantine flag (our builds are
unsigned), detach, done. It never touches another channel's install.

Install locations are per channel (`~/Applications/…`), so no `sudo` and no collisions;
`/Applications` stays free for whatever the user keeps there deliberately.

## Installing a local build, and the multi-install gate

A channel can be installed from a directory this machine just built, before any release
exists:

```sh
yarn fita:package --channel dev
yarn fita install dev --from-dir=dsh-plugin-desktop/dist/mac-dev
```

`--from-dir` reads the build's `fita-channel.json` and refuses a build that is not this
channel, carries no version, or whose DMG is absent; it verifies the declared `dmgSha256`
instead of a downloaded `SHA256SUMS.txt`. `FITA_INSTALL_ROOT` relocates every install into a
scratch root, so a test run never touches the builds the user actually has.

That is what the end-to-end gate uses:

```sh
node scripts/fita/verify-installs.mts --channels=dev,beta [--root=…] [--keep]
```

It installs at least two channels side by side and proves, per channel: its own app bundle,
its own bundle identifier, the version, the updater channel in the baked `app-update.yml`, and
a packaged runtime that boots **headlessly** through the embedded Harness CLI
(`ELECTRON_RUN_AS_NODE=1 <app>/Contents/MacOS/<appName> <app>/…/app.asar/node_modules/@deepseek-ai/dsh/lib/bin.js --version`)
— no window, nothing the user is running gets disturbed. It closes with the side-by-side
invariant: no two channels may share a bundle identifier or an app name.

Packaged paths are inspected through the asar API, not `existsSync`: plain Node cannot see
inside `app.asar`, so a file check would report the embedded CLI as missing in a build that
has it. The boot assertion, not a file listing, is what proves the packaged runtime.

## Per-channel packaging

`scripts/fita/package.mts` reuses the upstream packaging pipeline and stamps the three
things a channel owns:

```sh
yarn fita:package --list
yarn fita:package --channel dev --dry-run
yarn fita:package --channel dev
```

- `--config.productName` → the channel's `appName`, so the app bundle and the DMG carry it;
- `--config.appId` → the channel's `bundleId`, so two channels are two apps, not one app in
  two places;
- `--config.publish.channel` → the channel's `feed`, so electron-builder writes
  `<feed>-mac.yml` and bakes `channel: <feed>` into `app-update.yml`;
- `--config.artifactName` → the channel's `artifactSlug`, so the DMG file, its blockmap and the
  feed's `path:` are one string produced in one place. Without it, a product name with spaces is
  sanitised in the feed but not on disk, and the updater asks for an asset the release never
  carried — the first dev build failed exactly that way;
- `extraMetadata.fitaProduct|fitaChannel|fitaFeed` record the channel inside the packaged
  `package.json`.

Each build writes `fita-channel.json` next to the artifacts (channel, lane, app name, bundle
id, feed, version, DMG name and sha256), which is what the installer, the release workflow
and the e2e checks read instead of guessing.

The channel-aware verifier runs inside the same pipeline (`scripts/fita/verify-channel.mts`):
it mounts the DMG, asserts the bundle name, `CFBundleIdentifier`, version, the baked
`app-update.yml` channel and repository, and that the feed's `path:` names the DMG that
shipped with it. A channel that cannot prove its identity does not produce artifacts.

## CI/CD integration

The release workflow is the only producer of installable artifacts:

| produced by | artifact | consumed by |
| --- | --- | --- |
| `desktop-release.yml` (tag per lane) | DMG, `.blockmap`, `<feed>-mac.yml`, `SHA256SUMS.txt` as a GitHub release | `fita install`, the in-app updater |
| workflow artifacts on the same run | the same files, for inspection | humans, PR builds |
| GitHub Packages (planned) | our plugin packages, `@aleffita/…` | `dsh plugin add` from our registry |

So the loop is: land on a lane → tag the lane → the pipeline publishes the channel's
release → `yarn fita install <channel>` or the running app's updater picks it up.
