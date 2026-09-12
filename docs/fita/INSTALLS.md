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

## What still has to be stamped per channel

The manager can already install one build per channel, but two things are baked at
packaging time and are still upstream-shaped:

1. **App identity** — `productName` and `bundleId` are static. Side-by-side installs want
   `DSH Fita Dev` / `ai.deepseek.dsh.desktop.dev`, otherwise LaunchServices sees one app in
   two places and the updater cache is shared.
2. **Update feed** — electron-builder writes `<feed>-mac.yml` and bakes `channel: <feed>`
   into `app-update.yml` only when the packaging step passes the channel. Today every build
   points at the `latest` feed.

Both are one packaging wrapper away: a fork-side `scripts/fita/package.ts` that reads
`fita/channels.yml`, resolves the channel from the lane/tag, and forwards
`--config.productName`, `--config.appId` and `--config.publish.channel` to
electron-builder while reusing the upstream preflight and verifiers. Tracked as the next
slice in `README.md`; until it lands, `install` works and side-by-side is by path, not by
identity.

## CI/CD integration

The release workflow is the only producer of installable artifacts:

| produced by | artifact | consumed by |
| --- | --- | --- |
| `desktop-release.yml` (tag per lane) | DMG, `.blockmap`, `<feed>-mac.yml`, `SHA256SUMS.txt` as a GitHub release | `fita install`, the in-app updater |
| workflow artifacts on the same run | the same files, for inspection | humans, PR builds |
| GitHub Packages (planned) | our plugin packages, `@aleffita/…` | `dsh plugin add` from our registry |

So the loop is: land on a lane → tag the lane → the pipeline publishes the channel's
release → `yarn fita install <channel>` or the running app's updater picks it up.
