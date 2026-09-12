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
