/**
 * Choose the release a channel ships from, and the files inside it.
 *
 * Upstream asks one fixed version endpoint for `stable` or `beta`. Our channels are
 * GitHub releases of our own fork, and each lane tags its own way (`v*`, `beta-v*`,
 * `dev-v*`, `pr-<n>-v*`), so "which release is mine, and is it newer" has to be
 * answered here. Everything in this module is a pure function of a release listing,
 * so the decision is testable without a network.
 */

import { compareSemVerVersions, parseSemVer } from './update-checker.ts'
import type { FitaChannel } from './fita-channel.ts'

/** One asset attached to a release, as the GitHub API reports it. */
export interface FitaReleaseAsset {
  /** File name as published. */
  readonly name: string
  /** Direct download URL. */
  readonly browser_download_url: string
  /** Size in bytes, when the listing reports it. */
  readonly size?: number
}

/** One release, as the GitHub API reports it. */
export interface FitaRelease {
  /** Git tag the release was cut from. */
  readonly tag_name: string
  /** Draft releases are invisible to users and must never be offered. */
  readonly draft?: boolean
  /** Prerelease flag GitHub reports, kept for reporting rather than selection. */
  readonly prerelease?: boolean
  /** Attached files. */
  readonly assets?: readonly FitaReleaseAsset[]
}

/** Result of asking whether a channel has something newer than the running build. */
export interface FitaChannelAvailability {
  /** Channel the answer belongs to. */
  readonly channel: FitaChannel
  /** Version the channel currently offers. */
  readonly version: string
  /** Release the version came from. */
  readonly release: FitaRelease
  /** Whether the offered version is newer than the running build. */
  readonly newer: boolean
}

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/gu

/**
 * Build the matcher for one channel's tags.
 *
 * The registry writes patterns, not versions: `*` is the version and
 * `<number>` is a pull-request number.
 * @param channel - channel whose `tag` pattern is compiled.
 * @returns an anchored pattern whose last group is the version.
 */
export function fitaTagPattern(channel: FitaChannel): RegExp {
  const pattern = channel.tag
    .replace(REGEX_SPECIAL, '\\$&')
    .replaceAll('\\*', '(.+)')
    .replaceAll('<number>', '(\\d+)')
  return new RegExp(`^${pattern}$`, 'u')
}

/**
 * Read the version a tag carries for its channel.
 * @param channel - channel the tag is expected to belong to.
 * @param tag - release tag, for example `dev-v2.0.10-rc.1`.
 * @returns the canonical version, or null when the tag is not this channel's or is not SemVer.
 */
export function fitaReleaseVersion(channel: FitaChannel, tag: string): string | null {
  const match = fitaTagPattern(channel).exec(tag)
  if (match === null) return null
  const captured = match[match.length - 1]
  if (captured === undefined || captured.length === 0) return null
  const parsed = parseSemVer(captured)
  return parsed === null ? null : parsed.version
}

/**
 * Whether a channel may offer a version.
 *
 * A stable channel must not offer a prerelease, the same rule the upstream
 * download path enforces: the tag pattern alone would let `v2.0.10-rc.1` into `main`.
 * @param channel - channel being considered.
 * @param version - canonical version from the tag.
 * @returns true when the channel may offer that version.
 */
export function fitaChannelAcceptsVersion(channel: FitaChannel, version: string): boolean {
  if (channel.prerelease) return true
  const parsed = parseSemVer(version)
  return parsed !== null && parsed.prerelease.length === 0
}

/**
 * Pick the newest release a channel should offer.
 * @param releases - release listing, in any order.
 * @param channel - channel to select for.
 * @returns the newest eligible release, or undefined when the channel has none yet.
 */
export function selectFitaRelease(
  releases: readonly FitaRelease[],
  channel: FitaChannel,
): FitaRelease | undefined {
  let best: { release: FitaRelease; version: string } | undefined
  for (const release of releases) {
    if (release.draft === true) continue
    const version = fitaReleaseVersion(channel, release.tag_name)
    if (version === null || !fitaChannelAcceptsVersion(channel, version)) continue
    if (best === undefined) {
      best = { release, version }
      continue
    }
    const order = compareSemVerVersions(version, best.version)
    if (order !== null && order > 0) best = { release, version }
  }
  return best?.release
}

/**
 * Answer whether a channel offers something newer than the running build.
 * @param releases - release listing, in any order.
 * @param channel - channel to select for.
 * @param currentVersion - version of the running build.
 * @returns the availability, or undefined when the channel offers nothing eligible.
 */
export function fitaChannelAvailability(
  releases: readonly FitaRelease[],
  channel: FitaChannel,
  currentVersion: string,
): FitaChannelAvailability | undefined {
  const release = selectFitaRelease(releases, channel)
  if (release === undefined) return undefined
  const version = fitaReleaseVersion(channel, release.tag_name)
  if (version === null) return undefined
  const order = compareSemVerVersions(version, currentVersion)
  return { channel, version, release, newer: order !== null && order > 0 }
}

/**
 * Find the DMG a channel's release carries for one version.
 *
 * The artifact name is built from the channel's `artifactSlug`, so the asset, the
 * updater feed and the local installer all agree on one string. An asset whose name
 * does not carry the requested version is not offered: guessing across versions is
 * how the wrong build gets installed.
 * @param release - release to search.
 * @param channel - channel that produced the release.
 * @param version - canonical version the build must match.
 * @returns the asset, or undefined when the release carries no such DMG.
 */
export function fitaReleaseDmg(
  release: FitaRelease,
  channel: FitaChannel,
  version: string,
): FitaReleaseAsset | undefined {
  const prefix = `${channel.artifactSlug}-${version}-`
  const candidates = (release.assets ?? []).filter(
    asset => asset.name.startsWith(prefix) && asset.name.endsWith('.dmg'),
  )
  return candidates.find(asset => asset.name.endsWith('-universal.dmg')) ?? candidates[0]
}

/**
 * Find the checksum file a release carries.
 * @param release - release to search.
 * @returns the asset, or undefined when the release publishes no checksums.
 */
export function fitaReleaseSums(release: FitaRelease): FitaReleaseAsset | undefined {
  return (release.assets ?? []).find(asset => asset.name === 'SHA256SUMS.txt')
}

/**
 * Read the expected checksum for one file out of a `SHA256SUMS.txt` body.
 * @param sums - contents of the checksum file.
 * @param fileName - file the checksum must belong to.
 * @returns the lowercase hex digest, or undefined when the file is not listed.
 */
export function fitaExpectedChecksum(sums: string, fileName: string): string | undefined {
  for (const line of sums.split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/u.exec(line.trim())
    if (match === null) continue
    const [, digest, name] = match
    if (digest === undefined || name === undefined) continue
    if (name.trim() === fileName) return digest.toLowerCase()
  }
  return undefined
}
