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

/**
 * Flags that relaunch this app as the detached hand-over process.
 *
 * The installing step is this app again, not a second implementation: it is spawned with
 * these arguments, waits for the parent to exit, applies the layer and relaunches. The
 * layer is named explicitly so the process cannot pick the wrong one from the paths it
 * happens to have.
 */
export const FITA_HANDOVER_LAYER_FLAG = '--dsh-fita-handover-layer'
/** Flag carrying the verified zip of a payload hand-over. */
export const FITA_HANDOVER_ZIP_FLAG = '--dsh-fita-handover-zip'
/** Flag carrying the bundle a payload hand-over swaps code in. */
export const FITA_HANDOVER_APP_FLAG = '--dsh-fita-handover-app'
/** Flag carrying the directory a payload hand-over extracts into. */
export const FITA_HANDOVER_STAGING_FLAG = '--dsh-fita-handover-staging'
/** Flag carrying the verified DMG of a full hand-over. */
export const FITA_HANDOVER_DMG_FLAG = '--dsh-fita-handover-dmg'
/** Flag carrying the bundle a full hand-over replaces. */
export const FITA_HANDOVER_DESTINATION_FLAG = '--dsh-fita-handover-destination'

/** One argument value, in either `--flag=value` or `--flag value` form. */
function argumentValue(argv: readonly string[], flag: string): string | undefined {
  const inline = argv.find(argument => argument.startsWith(`${flag}=`))
  if (inline !== undefined) {
    const value = inline.slice(flag.length + 1)
    return value === '' ? undefined : value
  }
  const index = argv.indexOf(flag)
  const next = index === -1 ? undefined : argv[index + 1]
  return next === undefined || next.startsWith('--') || next === '' ? undefined : next
}

/**
 * Read a hand-over request out of a process's arguments.
 *
 * Every path the chosen layer needs is required, and an empty value counts as absent: a
 * hand-over with no destination could otherwise replace something arbitrary.
 * @param argv - full process argument list.
 * @returns the request, or undefined when this is not a hand-over process.
 */
export function parseFitaHandoverArguments(argv: readonly string[]): FitaHandoverRequest | undefined {
  const layer = argumentValue(argv, FITA_HANDOVER_LAYER_FLAG)
  if (layer === 'payload') {
    const zipPath = argumentValue(argv, FITA_HANDOVER_ZIP_FLAG)
    const appPath = argumentValue(argv, FITA_HANDOVER_APP_FLAG)
    const staging = argumentValue(argv, FITA_HANDOVER_STAGING_FLAG)
    if (zipPath === undefined || appPath === undefined || staging === undefined) return undefined
    return { layer: 'payload', zipPath, appPath, staging }
  }
  if (layer === 'full') {
    const dmgPath = argumentValue(argv, FITA_HANDOVER_DMG_FLAG)
    const destination = argumentValue(argv, FITA_HANDOVER_DESTINATION_FLAG)
    if (dmgPath === undefined || destination === undefined) return undefined
    return { layer: 'full', dmgPath, destination }
  }
  return undefined
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
