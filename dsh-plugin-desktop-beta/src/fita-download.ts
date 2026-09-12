/**
 * Download and verify one channel's build.
 *
 * The app cannot replace itself while it runs, so this stops at the honest point:
 * the artifact lands in a per-channel cache directory, its SHA-256 is compared with
 * the release's own `SHA256SUMS.txt`, and only a verified file is left behind with
 * the real name. Anything else is removed.
 *
 * The cache is scoped by channel on purpose: electron-builder's `updaterCacheDirName`
 * derives from the package name, so every channel would share one directory and two
 * channels updating at once would fight over it.
 */

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FitaChannel } from './fita-channel.ts'
import { fitaExpectedChecksum } from './fita-release.ts'
import type { UpdateRequest } from './update-checker.ts'

/** Refuse an artifact larger than this; a desktop DMG is far below it. */
export const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024 * 1024

/** Download and verification failure reasons, named rather than collapsed. */
export type FitaDownloadFailure =
  | 'download'
  | 'checksum-missing'
  | 'checksum-mismatch'
  | 'too-large'
  | 'io'

/**
 * Outcome of preparing one channel's build.
 *
 * `verified` means the digest was compared with the release's own checksum file;
 * `stored` means the release published no checksums at all, so the file is on disk
 * and nothing more may be claimed about it.
 */
export type FitaDownloadResult =
  | {
    readonly status: 'verified'
    /** Absolute path of the verified file. */
    readonly path: string
    /** File name as published, which is what the release records. */
    readonly name: string
    /** Lowercase hex digest the file was verified against. */
    readonly sha256: string
  }
  | {
    readonly status: 'stored'
    /** Absolute path of the unverified file. */
    readonly path: string
    /** File name as published. */
    readonly name: string
    /** Digest computed while downloading, for the caller to compare if it can. */
    readonly sha256: string
  }
  | { readonly status: 'failed'; readonly reason: FitaDownloadFailure }

/** The facts `fita install --from-dir` reads from a build directory. */
export interface FitaChannelManifest {
  /** Registry slug the build belongs to. */
  readonly channel: string
  /** Version that was downloaded. */
  readonly version: string
  /** Published DMG name, relative to the directory. */
  readonly dmg: string
  /** Digest the DMG was verified against, or the one computed when none was published. */
  readonly dmgSha256: string
}

/**
 * Build the manifest the local installer reads.
 *
 * The app has just verified these facts, so it can hand the installer a directory it
 * already understands instead of inventing a second install path.
 * @param channel - channel that published the build.
 * @param version - version that was downloaded.
 * @param name - published DMG name.
 * @param sha256 - digest the file carries.
 * @returns the manifest to write beside the DMG.
 */
export function fitaChannelManifest(
  channel: FitaChannel,
  version: string,
  name: string,
  sha256: string,
): FitaChannelManifest {
  return { channel: channel.slug, version, dmg: name, dmgSha256: sha256 }
}

/** Inputs for one artifact download. */
export interface FitaDownloadOptions {
  /** Channel that published the artifact. */
  readonly channel: FitaChannel
  /** Version the artifact belongs to, recorded for the installer. */
  readonly version: string
  /** Directory that holds every channel's cached builds. */
  readonly cacheRoot: string
  /** File name as published by the release. */
  readonly artifact: { readonly name: string; readonly url: string }
  /** Checksum file published alongside it, when the release carries one. */
  readonly sums: { readonly name: string; readonly url: string } | null
  /** Request adapter, normally Electron's native network session. */
  readonly request: UpdateRequest
  /** Caller-owned cancellation. */
  readonly signal?: AbortSignal
}

/**
 * Cache directory for one channel's builds.
 * @param cacheRoot - root directory for downloaded builds.
 * @param channel - channel the directory belongs to.
 * @returns the channel's own directory, never a shared one.
 */
export function fitaChannelCacheDir(cacheRoot: string, channel: FitaChannel): string {
  return join(cacheRoot, channel.slug)
}

/** Keep only the file name, so a hostile listing cannot write outside the cache. */
function safeFileName(name: string): string | null {
  if (name.length === 0 || name.includes('/') || name.includes('\\') || name.startsWith('.')) return null
  return name
}

/**
 * Download one artifact and verify it against the release's checksums.
 * @param options - channel, cache root, artifact, checksums and request adapter.
 * @returns the verified file, or a named failure. Nothing unverified is left behind.
 */
export async function downloadFitaArtifact(options: FitaDownloadOptions): Promise<FitaDownloadResult> {
  const name = safeFileName(options.artifact.name)
  if (name === null) return { status: 'failed', reason: 'io' }

  let expected: string | undefined
  if (options.sums !== null) {
    let sumsBody: string
    try {
      const response = await options.request(options.sums.url, {
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      if (response.status !== 200) return { status: 'failed', reason: 'checksum-missing' }
      sumsBody = await response.text()
    } catch {
      return { status: 'failed', reason: 'checksum-missing' }
    }
    expected = fitaExpectedChecksum(sumsBody, name)
    if (expected === undefined) return { status: 'failed', reason: 'checksum-missing' }
  }

  const directory = fitaChannelCacheDir(options.cacheRoot, options.channel)
  const finalPath = join(directory, name)
  const partialPath = `${finalPath}.partial`
  try {
    await mkdir(directory, { recursive: true })
  } catch {
    return { status: 'failed', reason: 'io' }
  }

  let response: Response
  try {
    response = await options.request(options.artifact.url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch {
    return { status: 'failed', reason: 'download' }
  }
  if (response.status !== 200 || response.body === null) {
    return { status: 'failed', reason: 'download' }
  }

  const hash = createHash('sha256')
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_ARTIFACT_BYTES) {
    return { status: 'failed', reason: 'too-large' }
  }
  const sink = createWriteStream(partialPath, { mode: 0o600 })
  let written = 0
  try {
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      written += value.byteLength
      if (written > MAX_ARTIFACT_BYTES) {
        await reader.cancel()
        throw new Error('artifact exceeds the size bound')
      }
      hash.update(value)
      await new Promise<void>((resolve, reject) => {
        sink.write(Buffer.from(value), (error) => { if (error) reject(error); else resolve() })
      })
    }
    await new Promise<void>((resolve, reject) => {
      sink.end((error?: Error | null) => { if (error) reject(error); else resolve() })
    })
  } catch {
    sink.destroy()
    await rm(partialPath, { force: true })
    return { status: 'failed', reason: written > MAX_ARTIFACT_BYTES ? 'too-large' : 'download' }
  }

  const digest = hash.digest('hex')
  if (expected !== undefined && digest !== expected) {
    await rm(partialPath, { force: true })
    return { status: 'failed', reason: 'checksum-mismatch' }
  }
  try {
    await rename(partialPath, finalPath)
  } catch {
    await rm(partialPath, { force: true })
    return { status: 'failed', reason: 'io' }
  }
  try {
    // The directory is now something `fita install --from-dir` can install from.
    await writeFile(
      join(directory, 'fita-channel.json'),
      `${JSON.stringify(fitaChannelManifest(options.channel, options.version, name, digest), null, 2)}\n`,
      { mode: 0o600 },
    )
  } catch {
    // Half a build directory is not installable, so it does not stay behind.
    await rm(finalPath, { force: true })
    return { status: 'failed', reason: 'io' }
  }
  return expected === undefined
    ? { status: 'stored', path: finalPath, name, sha256: digest }
    : { status: 'verified', path: finalPath, name, sha256: digest }
}
