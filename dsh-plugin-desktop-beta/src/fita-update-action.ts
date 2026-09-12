/**
 * Do the update the feed described: fetch the layer, then hand over to the child.
 *
 * This is the step the app performs before it exits, and it is the only place that decides
 * what the child will be told. Everything it needs was already verified: the feed said
 * which layer the update is, and the file it names carries the digest to check against — a
 * file whose digest the feed does not record is refused here rather than applied unverified.
 */

import type { FitaChannel } from './fita-channel.ts'
import { downloadFitaArtifact } from './fita-download.ts'
import type { FitaChosenLayer } from './fita-feed.ts'
import { startFitaHandover, type FitaHandoverRequest, type FitaSpawn } from './fita-handover.ts'
import type { UpdateRequest } from './update-checker.ts'

/** Why an update could not be handed over. */
export type FitaUpdateActionFailure = 'unverifiable' | 'download' | 'checksum-missing' | 'checksum-mismatch' | 'too-large' | 'io'

/** What starting an update did. */
export type FitaUpdateActionOutcome =
  | {
    readonly status: 'started'
    /** Layer the child was told to apply. */
    readonly layer: FitaChosenLayer['layer']
    /** Verified file the child will read. */
    readonly artifactPath: string
  }
  | { readonly status: 'failed'; readonly reason: FitaUpdateActionFailure }

/** Inputs for starting one update. */
export interface FitaUpdateActionOptions {
  /** Channel this build belongs to. */
  readonly channel: FitaChannel
  /** Layer the channel feed chose. */
  readonly layer: FitaChosenLayer
  /** Version the feed announced. */
  readonly version: string
  /** Bundle the update applies to. */
  readonly appPath: string
  /** Executable to relaunch as the hand-over. */
  readonly executable: string
  /** Root of the per-channel cache; the channel's own directory is derived from it. */
  readonly cacheRoot: string
  /** Absolute URL of the feed's file, resolved against the release that carries it. */
  readonly artifactUrl: string
  /** Directory the payload is extracted into by the child. */
  readonly staging: string
  /** Request adapter for the download. */
  readonly request: UpdateRequest
  /** Spawn implementation for the detached child. */
  readonly spawn: FitaSpawn
  /** Pid of this process, which the child waits for. */
  readonly currentPid: number
}

/**
 * Download the update's layer and start the hand-over that applies it.
 * @param options - channel, chosen layer, paths, adapters and this process's pid.
 * @returns the started hand-over, or a named failure. Nothing is started on failure.
 */
export async function startFitaUpdate(options: FitaUpdateActionOptions): Promise<FitaUpdateActionOutcome> {
  const digest = options.layer.file.sha512
  // The feed naming a file is not the same as the feed letting us verify it.
  if (digest === undefined || digest.length === 0) return { status: 'failed', reason: 'unverifiable' }

  const downloaded = await downloadFitaArtifact({
    channel: options.channel,
    version: options.version,
    cacheRoot: options.cacheRoot,
    artifact: { name: options.layer.file.url, url: options.artifactUrl },
    sums: null,
    expectedSha512: digest,
    request: options.request,
  })
  if (downloaded.status === 'failed') {
    return { status: 'failed', reason: downloaded.reason }
  }

  const request: FitaHandoverRequest = options.layer.layer === 'payload'
    ? {
      layer: 'payload',
      waitForPid: options.currentPid,
      zipPath: downloaded.path,
      appPath: options.appPath,
      staging: options.staging,
    }
    : {
      layer: 'full',
      waitForPid: options.currentPid,
      dmgPath: downloaded.path,
      destination: options.appPath,
    }
  startFitaHandover({ request, executable: options.executable, spawn: options.spawn })
  return { status: 'started', layer: options.layer.layer, artifactPath: downloaded.path }
}
