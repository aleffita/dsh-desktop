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
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

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
