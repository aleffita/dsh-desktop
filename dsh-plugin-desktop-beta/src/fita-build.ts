/** The channel this running build was stamped with. */

import { readFileSync } from 'node:fs'
import type { FitaChannel } from './fita-channel.ts'
import { runningFitaChannel } from './fita-channel.ts'

/**
 * Read the running build's channel from its own packaged manifest.
 *
 * A build with no stamp, or with a slug the registry does not declare, resolves to
 * undefined: upstream's build and builds made before the registry exist are not ours
 * to update, and borrowing another channel would offer the wrong release.
 * @param moduleUrl - module below the package's `src` or `lib` directory.
 * @returns the channel, or undefined when this build is not one of ours.
 */
export function readRunningFitaChannel(moduleUrl: string = import.meta.url): FitaChannel | undefined {
  try {
    const manifest: unknown = JSON.parse(readFileSync(new URL('../package.json', moduleUrl), 'utf8'))
    return runningFitaChannel(manifest)
  } catch {
    return undefined
  }
}
