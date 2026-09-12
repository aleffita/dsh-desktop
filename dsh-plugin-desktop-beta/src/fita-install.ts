/**
 * Install a prepared build over this channel's app bundle.
 *
 * The app already downloaded and verified the build; this is the last mile, and it is
 * deliberately the same two steps the install manager performs for a cached directory:
 * mount the verified DMG read-only, copy the app into its own `~/Applications` path,
 * clear the quarantine flag. The manager stays the reference path — this must satisfy
 * the same contract, which `yarn fita:verify-prepared` exercises.
 *
 * Mounting and copying are the caller's to sequence; replacing a *running* bundle is
 * not this function's business.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { FitaChannel } from './fita-channel.ts'

/**
 * Where a channel's app bundle belongs on this machine.
 *
 * The registry records `~/Applications/<appName>.app`; installing anywhere else would
 * leave a second copy that no channel owns.
 * @param channel - channel whose install path is resolved.
 * @param home - home directory to expand `~` against.
 * @returns the absolute path of the channel's own bundle.
 */
export function fitaInstallPath(channel: FitaChannel, home: string = homedir()): string {
  return join(home, channel.installs.replace(/^~\//u, ''))
}

/** Why a hand-over must not proceed. */
export type FitaHandoverRefusal = 'unknown-channel' | 'not-this-channel' | 'destination-mismatch'

/** What the hand-over may do next. */
export type FitaHandoverPlan =
  | { readonly status: 'install'; readonly dmgPath: string; readonly destination: string }
  | { readonly status: 'refused'; readonly reason: FitaHandoverRefusal }

/** Inputs for deciding what a hand-over may do. */
export interface FitaHandoverRequest {
  /** Channel this build was stamped with, when it is one of ours. */
  readonly runningChannel: FitaChannel | undefined
  /** Channel the verified build belongs to. */
  readonly preparedChannel: string
  /** Verified DMG on disk. */
  readonly preparedPath: string
  /** Bundle the install would replace. */
  readonly destination: string
  /** Home directory the channel's own path is resolved against. */
  readonly home: string
}

/**
 * Decide whether a prepared build may replace a bundle, and which.
 *
 * A build downloaded for one channel must never be installed over another channel's
 * bundle: that would swap one product for a different one under the same name. A build
 * with no stamp refuses too, because there is no channel whose bundle it could own.
 * @param request - running channel, prepared channel, prepared DMG, destination and home.
 * @returns the install to perform, or the reason it must not happen.
 */
export function planFitaHandover(request: FitaHandoverRequest): FitaHandoverPlan {
  if (request.runningChannel === undefined) return { status: 'refused', reason: 'unknown-channel' }
  if (request.preparedChannel !== request.runningChannel.slug) {
    return { status: 'refused', reason: 'not-this-channel' }
  }
  if (request.destination !== fitaInstallPath(request.runningChannel, request.home)) {
    return { status: 'refused', reason: 'destination-mismatch' }
  }
  return { status: 'install', dmgPath: request.preparedPath, destination: request.destination }
}

/**
 * Flag that relaunches this same app as the detached installing step.
 *
 * The installing step is this app again, not a second implementation: it is spawned
 * detached with these arguments, waits for the parent to exit, installs and relaunches.
 * `DESKTOP_INSTALLER_QUIT_FLAG` is the same idea for a launcher-driven installer.
 */
export const FITA_HANDOVER_DMG_FLAG = '--dsh-fita-handover-dmg'
/** Flag carrying the bundle a hand-over may replace. */
export const FITA_HANDOVER_DESTINATION_FLAG = '--dsh-fita-handover-destination'

/** What a relaunched hand-over process was asked to do. */
export interface FitaHandoverArguments {
  /** Verified DMG to install from. */
  readonly dmgPath: string
  /** Bundle to replace, resolved by the caller from the registry. */
  readonly destination: string
}

/**
 * Read a hand-over request out of a process's arguments.
 *
 * Both values are required, and an empty one is treated as absent rather than as a
 * path: a hand-over with no destination could otherwise replace something arbitrary.
 * @param argv - full process argument list.
 * @returns the request, or undefined when this is not a hand-over process.
 */
export function parseFitaHandoverArguments(argv: readonly string[]): FitaHandoverArguments | undefined {
  const valueOf = (flag: string): string | undefined => {
    const inline = argv.find(argument => argument.startsWith(`${flag}=`))
    if (inline !== undefined) {
      const value = inline.slice(flag.length + 1)
      return value === '' ? undefined : value
    }
    const index = argv.indexOf(flag)
    const next = index === -1 ? undefined : argv[index + 1]
    return next === undefined || next.startsWith('--') || next === '' ? undefined : next
  }
  const dmgPath = valueOf(FITA_HANDOVER_DMG_FLAG)
  const destination = valueOf(FITA_HANDOVER_DESTINATION_FLAG)
  if (dmgPath === undefined || destination === undefined) return undefined
  return { dmgPath, destination }
}

/** Reasons an install can fail, named rather than collapsed. */
export type FitaInstallFailure = 'mount' | 'no-app' | 'copy' | 'quarantine' | 'io'

/** Outcome of installing one prepared build. */
export type FitaInstallResult =
  | { readonly status: 'installed'; readonly appPath: string }
  | { readonly status: 'failed'; readonly reason: FitaInstallFailure }

/** One command's outcome, as the caller observes it. */
export interface FitaCommandResult {
  /** Process exit status. */
  readonly status: number
}

/** Command runner, injectable so the steps can be tested without mounting a DMG. */
export type FitaCommandRunner = (command: string, args: readonly string[]) => FitaCommandResult

/** Inputs for installing one prepared build. */
export interface FitaInstallOptions {
  /** Verified DMG on disk. */
  readonly dmgPath: string
  /** App bundle the channel owns, replaced only when the caller has quit. */
  readonly destination: string
  /** Command runner; defaults to a synchronous spawn. */
  readonly run?: FitaCommandRunner
}

function defaultRunner(command: string, args: readonly string[]): FitaCommandResult {
  const result = spawnSync(command, [...args], { encoding: 'utf8' })
  return { status: result.status ?? 1 }
}

/** What a hand-over process produced. */
export type FitaHandoverOutcome =
  | { readonly status: 'installed'; readonly appPath: string }
  | { readonly status: 'installed-not-relaunched'; readonly appPath: string }
  | { readonly status: 'failed'; readonly reason: FitaInstallFailure }

/** Inputs for one hand-over process. */
export interface FitaHandoverRunOptions {
  /** Verified DMG to install from. */
  readonly dmgPath: string
  /** Bundle to replace. */
  readonly destination: string
  /** Command runner, shared with the install step. */
  readonly run?: FitaCommandRunner
  /** Resolves once the process that owns the bundle has exited. */
  readonly waitForExit: () => Promise<void>
}

/**
 * Run a hand-over: wait for the running app to exit, install, relaunch.
 *
 * The order is the whole point — a bundle cannot be replaced while the app it belongs
 * to is running — so the wait happens before anything is mounted. An install that
 * succeeds but cannot relaunch is reported as such rather than as a failure: the user
 * has a new build on disk and needs to know it was not started.
 * @param options - DMG, destination, command runner and the wait for the parent.
 * @returns what happened, in those three states.
 */
export async function runFitaHandover(options: FitaHandoverRunOptions): Promise<FitaHandoverOutcome> {
  await options.waitForExit()
  const installed = await installFitaPreparedBuild({
    dmgPath: options.dmgPath,
    destination: options.destination,
    ...(options.run === undefined ? {} : { run: options.run }),
  })
  if (installed.status === 'failed') return { status: 'failed', reason: installed.reason }
  const run = options.run ?? defaultRunner
  if (run('open', ['-a', installed.appPath]).status !== 0) {
    return { status: 'installed-not-relaunched', appPath: installed.appPath }
  }
  return { status: 'installed', appPath: installed.appPath }
}

/**
 * Mount one DMG, copy the app it carries, and clear the quarantine flag.
 * @param options - verified DMG, destination bundle and optional command runner.
 * @returns the installed bundle, or a named failure. The mount is always released.
 */
export async function installFitaPreparedBuild(options: FitaInstallOptions): Promise<FitaInstallResult> {
  const run = options.run ?? defaultRunner
  let mount: string
  try {
    mount = mkdtempSync(join(tmpdir(), 'fita-install-'))
  } catch {
    return { status: 'failed', reason: 'io' }
  }

  let attached = false
  try {
    if (run('hdiutil', ['attach', options.dmgPath, '-nobrowse', '-readonly', '-mountpoint', mount]).status !== 0) {
      return { status: 'failed', reason: 'mount' }
    }
    attached = true
    let candidates: string[]
    try {
      candidates = readdirSync(mount).filter(entry => entry.endsWith('.app'))
    } catch {
      return { status: 'failed', reason: 'io' }
    }
    if (candidates.length !== 1) return { status: 'failed', reason: 'no-app' }
    const source = join(mount, candidates[0] as string)

    try {
      rmSync(options.destination, { recursive: true, force: true })
      await mkdir(dirname(options.destination), { recursive: true })
    } catch {
      return { status: 'failed', reason: 'io' }
    }
    // ditto preserves the bundle's metadata and permissions; a plain copy does not.
    if (run('ditto', [source, options.destination]).status !== 0) {
      return { status: 'failed', reason: 'copy' }
    }
    // The build is unsigned, so macOS would otherwise refuse to launch it.
    if (run('xattr', ['-dr', 'com.apple.quarantine', options.destination]).status !== 0) {
      return { status: 'failed', reason: 'quarantine' }
    }
    if (!existsSync(options.destination)) return { status: 'failed', reason: 'copy' }
    return { status: 'installed', appPath: options.destination }
  } finally {
    if (attached) run('hdiutil', ['detach', mount, '-quiet'])
    rmSync(mount, { recursive: true, force: true })
  }
}
