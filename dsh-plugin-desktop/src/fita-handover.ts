/**
 * Run a hand-over for whichever layer the feed chose.
 *
 * Everything here is glue: the payload path swaps the app's code with a verified zip, the
 * full path installs a verified DMG, and both wait for the app that owns the bundle to
 * exit before touching anything and relaunch it afterwards. The two layers are told apart
 * by what they are, not by a flag, so a caller cannot ask for the wrong one by accident.
 */

import type { FitaCommandRunner } from './fita-install.ts'
import { installFitaPreparedBuild } from './fita-install.ts'
import { applyFitaPayload } from './fita-payload.ts'

/** Which layer a hand-over applies, and what it needs. */
export type FitaHandoverRequest =
  | {
    readonly layer: 'payload'
    /** Verified zip the payload comes from. */
    readonly zipPath: string
    /** Bundle whose code payload is replaced. */
    readonly appPath: string
    /** Directory the zip is extracted into. */
    readonly staging: string
  }
  | {
    readonly layer: 'full'
    /** Verified DMG the install comes from. */
    readonly dmgPath: string
    /** Bundle the install replaces. */
    readonly destination: string
  }

/** Why a hand-over could not finish. */
export type FitaHandoverFailure = 'mount' | 'no-app' | 'copy' | 'quarantine' | 'io' | 'extract' | 'missing-payload' | 'relaunch'

/** What a hand-over did. */
export interface FitaHandoverLayerOutcome {
  /** Layer that ran. */
  readonly layer: FitaHandoverRequest['layer']
  /** Whether the build is on disk, and whether it was started again. */
  readonly status: 'applied' | 'applied-not-relaunched' | 'failed'
  /** Bundle that now carries the update, when one was applied. */
  readonly appPath?: string
  /** Why it failed, when it did. */
  readonly reason?: FitaHandoverFailure
}

/** Inputs for one layer-aware hand-over. */
export interface FitaHandoverLayerOptions {
  /** Layer and the paths it needs. */
  readonly request: FitaHandoverRequest
  /** Command runner. */
  readonly run?: FitaCommandRunner
  /** Resolves once the app that owns the bundle has exited. */
  readonly waitForExit: () => Promise<void>
}

/**
 * Wait for the app to exit, apply the chosen layer, and relaunch.
 * @param options - the layer request, a command runner and the wait for the parent.
 * @returns what happened: applied, applied but not restarted, or a named failure.
 */
export async function runFitaHandoverLayer(options: FitaHandoverLayerOptions): Promise<FitaHandoverLayerOutcome> {
  const { request } = options
  // Nothing may be mounted, extracted or replaced while the bundle is in use.
  await options.waitForExit()

  if (request.layer === 'payload') {
    const applied = await applyFitaPayload({
      zipPath: request.zipPath,
      appPath: request.appPath,
      staging: request.staging,
      ...(options.run === undefined ? {} : { run: options.run }),
    })
    if (applied.status === 'failed') {
      return { layer: 'payload', status: 'failed', reason: applied.reason }
    }
    return relaunchOutcome('payload', applied.appPath, options)
  }

  const installed = await installFitaPreparedBuild({
    dmgPath: request.dmgPath,
    destination: request.destination,
    ...(options.run === undefined ? {} : { run: options.run }),
  })
  if (installed.status === 'failed') {
    return { layer: 'full', status: 'failed', reason: installed.reason }
  }
  return relaunchOutcome('full', installed.appPath, options)
}

/** Start the updated app, and say so when that is the part that failed. */
async function relaunchOutcome(
  layer: FitaHandoverRequest['layer'],
  appPath: string,
  options: FitaHandoverLayerOptions,
): Promise<FitaHandoverLayerOutcome> {
  const run = options.run
  if (run === undefined) return { layer, status: 'applied-not-relaunched', appPath }
  const relaunched = run('open', ['-a', appPath])
  return relaunched.status === 0
    ? { layer, status: 'applied', appPath }
    : { layer, status: 'applied-not-relaunched', appPath }
}
