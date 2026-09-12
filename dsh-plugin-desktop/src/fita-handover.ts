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
    /** Process id of the app that must exit before anything is replaced. */
    readonly waitForPid: number
    /** Verified zip the payload comes from. */
    readonly zipPath: string
    /** Bundle whose code payload is replaced. */
    readonly appPath: string
    /** Directory the zip is extracted into. */
    readonly staging: string
  }
  | {
    readonly layer: 'full'
    /** Process id of the app that must exit before anything is replaced. */
    readonly waitForPid: number
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
/** Flag carrying the process id of the app the child must wait for. */
export const FITA_HANDOVER_WAIT_PID_FLAG = '--dsh-fita-handover-wait-pid'
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
  const waitForPid = Number(argumentValue(argv, FITA_HANDOVER_WAIT_PID_FLAG) ?? Number.NaN)
  // Without the parent's id the child cannot know when the bundle became free, and
  // replacing it while the app runs is the one thing this must never do.
  if (!Number.isSafeInteger(waitForPid) || waitForPid <= 0) return undefined
  const layer = argumentValue(argv, FITA_HANDOVER_LAYER_FLAG)
  if (layer === 'payload') {
    const zipPath = argumentValue(argv, FITA_HANDOVER_ZIP_FLAG)
    const appPath = argumentValue(argv, FITA_HANDOVER_APP_FLAG)
    const staging = argumentValue(argv, FITA_HANDOVER_STAGING_FLAG)
    if (zipPath === undefined || appPath === undefined || staging === undefined) return undefined
    return { layer: 'payload', waitForPid, zipPath, appPath, staging }
  }
  if (layer === 'full') {
    const dmgPath = argumentValue(argv, FITA_HANDOVER_DMG_FLAG)
    const destination = argumentValue(argv, FITA_HANDOVER_DESTINATION_FLAG)
    if (dmgPath === undefined || destination === undefined) return undefined
    return { layer: 'full', waitForPid, dmgPath, destination }
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

/**
 * Render a request back into the arguments that reproduce it.
 *
 * The exact inverse of `parseFitaHandoverArguments`, which is what makes the pair
 * testable as one contract: a request that survives the round trip is one the relaunched
 * process will read back identically.
 * @param request - layer and the paths it needs.
 * @returns the argument list, without the executable.
 */
export function fitaHandoverArguments(request: FitaHandoverRequest): string[] {
  const wait = `${FITA_HANDOVER_WAIT_PID_FLAG}=${String(request.waitForPid)}`
  if (request.layer === 'payload') {
    return [
      `${FITA_HANDOVER_LAYER_FLAG}=payload`,
      wait,
      `${FITA_HANDOVER_ZIP_FLAG}=${request.zipPath}`,
      `${FITA_HANDOVER_APP_FLAG}=${request.appPath}`,
      `${FITA_HANDOVER_STAGING_FLAG}=${request.staging}`,
    ]
  }
  return [
    `${FITA_HANDOVER_LAYER_FLAG}=full`,
    wait,
    `${FITA_HANDOVER_DMG_FLAG}=${request.dmgPath}`,
    `${FITA_HANDOVER_DESTINATION_FLAG}=${request.destination}`,
  ]
}

/** Options a detached hand-over process is started with. */
export interface FitaHandoverSpawnOptions {
  /** Whether the child outlives the app that starts it. */
  readonly detached: boolean
  /** The child must not hold the parent's streams open. */
  readonly stdio: 'ignore'
}

/** Starts one detached process. */
export type FitaSpawn = (
  command: string,
  args: readonly string[],
  options: FitaHandoverSpawnOptions,
) => void

/** Inputs for starting the hand-over process. */
export interface FitaHandoverStartOptions {
  /** Layer and the paths it needs. */
  readonly request: FitaHandoverRequest
  /** Executable to relaunch: this app's own binary. */
  readonly executable: string
  /** Spawn implementation; the caller passes the real one. */
  readonly spawn: FitaSpawn
}

/**
 * Start the hand-over process, detached, so it can outlive this app.
 *
 * The child waits for this process to exit before touching the bundle, which is why it
 * has to be detached and why its streams are ignored: the app quits immediately after.
 * @param options - request, executable and spawn implementation.
 * @returns the value to check against: the arguments the child was given.
 */
export function startFitaHandover(options: FitaHandoverStartOptions): readonly string[] {
  const args = fitaHandoverArguments(options.request)
  options.spawn(options.executable, args, { detached: true, stdio: 'ignore' })
  return args
}

/** Inputs for waiting on the app that owns the bundle. */
export interface FitaProcessWaitOptions {
  /** Process to wait for. */
  readonly pid: number
  /** Whether that process is still running; defaults to signalling it with 0. */
  readonly isAlive?: (pid: number) => boolean
  /** Pause between probes; defaults to a timer. */
  readonly pause?: (milliseconds: number) => Promise<void>
  /** Probe interval in milliseconds. */
  readonly intervalMs?: number
}

/** How long to wait between probes. Long enough to be cheap, short enough to feel immediate. */
export const FITA_WAIT_INTERVAL_MS = 250

/** Whether a process exists, without sending it a signal that would do anything. */
function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means it exists and belongs to somebody else; ESRCH means it is gone.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Wait until the app that owns a bundle has exited.
 *
 * The probe is `kill(pid, 0)`, which asks the operating system whether the process exists
 * and cannot affect it. There is no notification to subscribe to for a process that is not
 * our child, so this is the mechanism, not busy-waiting on our own work: the paused
 * interval is what keeps it cheap.
 * @param options - process id, injected probe and pause for tests, and the interval.
 * @returns a promise that resolves once the process is gone.
 */
export async function waitForProcessExit(options: FitaProcessWaitOptions): Promise<void> {
  const isAlive = options.isAlive ?? processIsAlive
  const pause = options.pause ?? (async (milliseconds: number) => {
    await new Promise<void>(resolve => { setTimeout(resolve, milliseconds) })
  })
  const interval = options.intervalMs ?? FITA_WAIT_INTERVAL_MS
  while (isAlive(options.pid)) await pause(interval)
}
