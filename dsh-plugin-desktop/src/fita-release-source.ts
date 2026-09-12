/**
 * Ask our own releases whether a channel has something newer.
 *
 * The channel-aware half of the updater: it reads the release listing of the fork
 * that publishes these channels, hands it to the pure selection in
 * `fita-release.ts`, and reports exactly one of three things — a channel offer, an
 * honest "nothing to offer", or a named failure. "Could not tell" must never look
 * like "up to date".
 */

import { FITA_REGISTRY_REPOSITORY } from './fita-channels.generated.ts'
import type { FitaChannel } from './fita-channel.ts'
import { parseFitaFeed, fitaUpdateLayer, type FitaChosenLayer } from './fita-feed.ts'
import {
  fitaChannelAvailability,
  fitaReleaseDmg,
  fitaReleaseFeed,
  fitaReleaseSums,
  type FitaRelease,
  type FitaReleaseAsset,
} from './fita-release.ts'
import type { UpdateRequest } from './update-checker.ts'

/** Sanity bound on a release listing; the GitHub API returns far less for 100 releases. */
export const MAX_RELEASES_RESPONSE_BYTES = 512 * 1024

/** How many releases a single check reads. */
export const RELEASES_PER_PAGE = 100

/** Release listing endpoint for the repository the registry names. */
export function fitaReleasesEndpoint(repository: string = FITA_REGISTRY_REPOSITORY): string {
  return `https://api.github.com/repos/${repository}/releases?per_page=${String(RELEASES_PER_PAGE)}`
}

/** Why a channel check could not answer. */
export type FitaChannelCheckFailure = 'request' | 'response' | 'malformed'

/** What a channel check found. */
export type FitaChannelCheck =
  | {
    readonly status: 'offer'
    /** Channel the offer belongs to. */
    readonly channel: FitaChannel
    /** Version the channel currently publishes. */
    readonly version: string
    /** Release the version came from. */
    readonly release: FitaRelease
    /** Whether that version is newer than the running build. */
    readonly newer: boolean
    /** The DMG to download for that version, when the release carries one. */
    readonly dmg: FitaReleaseAsset | undefined
    /** The checksum file to verify it against, when the release carries one. */
    readonly sums: FitaReleaseAsset | undefined
    /** The updater feed, which says which layer the update is. */
    readonly feed: FitaReleaseAsset | undefined
  }
  | {
    readonly status: 'none'
    /** Channel that has published nothing eligible yet. */
    readonly channel: FitaChannel
  }
  | {
    readonly status: 'failed'
    /** Channel that could not be checked. */
    readonly channel: FitaChannel
    /** Which step failed, for reporting rather than guessing. */
    readonly reason: FitaChannelCheckFailure
  }

/** Inputs for one channel check. */
export interface FitaChannelCheckOptions {
  /** Channel to check. */
  readonly channel: FitaChannel
  /** Version of the running build. */
  readonly currentVersion: string
  /** Repository to read, defaulting to the registry's. */
  readonly repository?: string
  /** Optional fetch implementation for a host adapter or test. */
  readonly request?: UpdateRequest
  /** Caller-owned cancellation; the checker creates no timeout of its own. */
  readonly signal?: AbortSignal
}

/**
 * Read at most `limit` bytes of a response body.
 * @param response - response whose body is read once.
 * @param limit - maximum accepted byte length.
 * @returns the decoded body, or null when the body exceeds the limit.
 */
async function readLimitedBody(response: Response, limit: number): Promise<string | null> {
  const body = response.body
  if (body === null) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value === undefined) continue
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

/**
 * Keep only the release entries the selection can use.
 * @param value - parsed JSON of the release listing.
 * @returns the releases, or null when the payload is not a release array.
 */
export function parseFitaReleases(value: unknown): FitaRelease[] | null {
  if (!Array.isArray(value)) return null
  const releases: FitaRelease[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const tag = record['tag_name']
    if (typeof tag !== 'string' || tag.length === 0) continue
    const assets: FitaReleaseAsset[] = []
    const rawAssets = record['assets']
    if (Array.isArray(rawAssets)) {
      for (const asset of rawAssets) {
        if (typeof asset !== 'object' || asset === null) continue
        const fields = asset as Record<string, unknown>
        const name = fields['name']
        const url = fields['browser_download_url']
        if (typeof name !== 'string' || typeof url !== 'string') continue
        const size = fields['size']
        assets.push({
          name,
          browser_download_url: url,
          ...(typeof size === 'number' ? { size } : {}),
        })
      }
    }
    releases.push({
      tag_name: tag,
      draft: record['draft'] === true,
      prerelease: record['prerelease'] === true,
      assets,
    })
  }
  return releases
}

/**
 * Check one channel against the releases of the repository that publishes it.
 * @param options - channel, running version, and optional request adapter.
 * @returns an offer, an honest none, or a named failure.
 */
export async function checkFitaChannelReleases(
  options: FitaChannelCheckOptions,
): Promise<FitaChannelCheck> {
  const { channel } = options
  const request = options.request ?? ((url, init) => fetch(url, init))
  let response: Response
  try {
    response = await request(fitaReleasesEndpoint(options.repository), {
      method: 'GET',
      headers: { accept: 'application/vnd.github+json' },
      cache: 'no-store',
      redirect: 'error',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch {
    return { status: 'failed', channel, reason: 'request' }
  }
  if (response.status !== 200) return { status: 'failed', channel, reason: 'response' }

  let body: string | null
  try {
    body = await readLimitedBody(response, MAX_RELEASES_RESPONSE_BYTES)
  } catch {
    return { status: 'failed', channel, reason: 'response' }
  }
  if (body === null) return { status: 'failed', channel, reason: 'response' }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { status: 'failed', channel, reason: 'malformed' }
  }
  const releases = parseFitaReleases(parsed)
  if (releases === null) return { status: 'failed', channel, reason: 'malformed' }

  const availability = fitaChannelAvailability(releases, channel, options.currentVersion)
  if (availability === undefined) return { status: 'none', channel }
  return {
    status: 'offer',
    channel,
    version: availability.version,
    release: availability.release,
    newer: availability.newer,
    dmg: fitaReleaseDmg(availability.release, channel, availability.version),
    sums: fitaReleaseSums(availability.release),
    feed: fitaReleaseFeed(availability.release, channel),
  }
}

/** Inputs for reading a channel's feed from its release. */
export interface FitaFeedReadOptions {
  /** URL of the `<feed>-mac.yml` asset. */
  readonly url: string
  /** Channel the feed belongs to. */
  readonly channel: FitaChannel
  /** Request adapter, normally Electron's native network session. */
  readonly request: UpdateRequest
  /** Caller-owned cancellation. */
  readonly signal?: AbortSignal
}

/**
 * Read a channel's feed and decide which layer its update is.
 *
 * A feed that cannot be read, or that names no file of this channel, yields undefined: the
 * caller must fall back to the full install rather than guess a layer it cannot verify.
 * @param options - feed URL, channel and request adapter.
 * @returns the layer and file, or undefined when the feed cannot answer.
 */
export async function readFitaChannelFeed(options: FitaFeedReadOptions): Promise<FitaChosenLayer | undefined> {
  let response: Response
  try {
    response = await options.request(options.url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch {
    return undefined
  }
  if (response.status !== 200) return undefined
  let body: string
  try {
    body = await response.text()
  } catch {
    return undefined
  }
  const feed = parseFitaFeed(body)
  if (feed === null) return undefined
  const layer = fitaUpdateLayer(feed, options.channel)
  return layer.layer === 'none' ? undefined : layer
}
