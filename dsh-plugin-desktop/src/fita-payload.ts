/**
 * Apply the payload layer of an update: swap the app's code, keep the previous one.
 *
 * The zip a channel publishes carries the whole `.app`. Only `app.asar` and
 * `app.asar.unpacked` are its code payload; the Electron runtime, the Info.plist and the
 * resources are not, so those are left alone. The previous payload is renamed aside
 * rather than deleted, so a build that fails to boot can be restored, and it is only
 * dropped once the new one is running.
 */

import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { fitaDefaultRunner, type FitaCommandResult, type FitaCommandRunner } from './fita-install.ts'

/** Reasons applying a payload can fail, named rather than collapsed. */
export type FitaPayloadFailure = 'extract' | 'missing-payload' | 'io'

/** Outcome of applying a payload. */
export type FitaPayloadResult =
  | { readonly status: 'applied'; readonly appPath: string }
  | { readonly status: 'failed'; readonly reason: FitaPayloadFailure }

/** The two paths a payload swap touches inside a bundle. */
const PAYLOAD = ['app.asar', 'app.asar.unpacked'] as const

/** Inputs for applying one payload. */
export interface FitaPayloadOptions {
  /** Verified zip on disk. */
  readonly zipPath: string
  /** App bundle whose payload is replaced. */
  readonly appPath: string
  /** Directory the zip is extracted into; created when absent. */
  readonly staging: string
  /** Command runner, shared with the rest of the update path. */
  readonly run?: FitaCommandRunner
}

/** Name the previous payload is kept under until the new one has booted. */
function previousPath(path: string): string {
  return `${path}.previous`
}

/**
 * Swap an app bundle's code payload for the one a verified zip carries.
 *
 * Nothing is removed before the new payload is in place, and a failure at any step puts
 * the bundle back the way it was: a half-applied update is worse than none.
 * @param options - verified zip, bundle, staging directory and command runner.
 * @returns the applied bundle, or a named failure.
 */
export async function applyFitaPayload(options: FitaPayloadOptions): Promise<FitaPayloadResult> {
  const run = options.run ?? fitaDefaultRunner
  const resources = join(options.appPath, 'Contents', 'Resources')
  const extracted = join(options.staging, 'extract')
  try {
    rmSync(extracted, { recursive: true, force: true })
    await mkdir(extracted, { recursive: true })
  } catch {
    return { status: 'failed', reason: 'io' }
  }
  // ditto preserves the code signature metadata a plain unzip would drop.
  const extraction: FitaCommandResult = run('ditto', ['-x', '-k', options.zipPath, extracted])
  if (extraction.status !== 0) return { status: 'failed', reason: 'extract' }

  const source = locateExtractedApp(extracted)
  if (source === undefined) return { status: 'failed', reason: 'missing-payload' }

  const incoming = PAYLOAD.filter(name => existsSync(join(source, 'Contents', 'Resources', name)))
  if (!incoming.includes('app.asar')) return { status: 'failed', reason: 'missing-payload' }

  const moved: string[] = []
  try {
    for (const name of incoming) {
      const target = join(resources, name)
      if (existsSync(target)) {
        rmSync(previousPath(target), { recursive: true, force: true })
        await rename(target, previousPath(target))
      }
      await rename(join(source, 'Contents', 'Resources', name), target)
      moved.push(name)
    }
  } catch {
    restorePayload(resources, moved)
    return { status: 'failed', reason: 'io' }
  }
  return { status: 'applied', appPath: options.appPath }
}

/**
 * Find the single `.app` an extraction produced.
 * @param directory - extraction directory.
 * @returns the app path, or undefined when there is not exactly one.
 */
function locateExtractedApp(directory: string): string | undefined {
  let entries: string[]
  try {
    entries = readdirSync(directory)
  } catch {
    return undefined
  }
  const apps = entries.filter(entry => entry.endsWith('.app'))
  if (apps.length !== 1) return undefined
  return join(directory, apps[0] as string)
}

/** Put a bundle's payload back the way it was. */
function restorePayload(resources: string, moved: readonly string[]): void {
  for (const name of moved) {
    const target = join(resources, name)
    const previous = previousPath(target)
    try {
      rmSync(target, { recursive: true, force: true })
      if (existsSync(previous)) renameSync(previous, target)
    } catch {
      // Restoring is best effort; the caller reports the failure that caused it.
    }
  }
}

/**
 * Drop the previous payload after the new one has booted.
 * @param appPath - bundle whose previous payload is no longer needed.
 */
export function commitFitaPayload(appPath: string): void {
  const resources = join(appPath, 'Contents', 'Resources')
  for (const name of PAYLOAD) rmSync(previousPath(join(resources, name)), { recursive: true, force: true })
}

/**
 * Restore the previous payload of a bundle whose new one did not work.
 * @param appPath - bundle to roll back.
 * @returns whether a previous payload was there to restore.
 */
export function rollbackFitaPayload(appPath: string): boolean {
  const resources = join(appPath, 'Contents', 'Resources')
  let restored = false
  for (const name of PAYLOAD) {
    const target = join(resources, name)
    const previous = previousPath(target)
    if (!existsSync(previous)) continue
    try {
      rmSync(target, { recursive: true, force: true })
      renameSync(previous, target)
      restored = true
    } catch {
      // Leave what is there rather than removing a payload with no replacement.
    }
  }
  return restored
}
