/**
 * Channel lookup and running-build identity for the Fita distribution.
 *
 * Two questions the app has to answer about channels, answered here and nowhere
 * else: which channels exist (the registry frozen in `fita-channels.generated.ts`)
 * and which one this build is. `fita:package` stamps the build's `package.json`
 * with `fitaChannel`; a build without that stamp is reported as unknown instead of
 * guessed, because offering the wrong channel means offering the wrong release.
 */

import { FITA_CHANNELS } from './fita-channels.generated.ts'
import type { FitaChannel } from './fita-channels.generated.ts'

export type { FitaChannel }
export { FITA_CHANNELS }

/** The stamp `fita:package` writes into a packaged build's `package.json`. */
export interface FitaBuildIdentity {
  /** Registry slug the build was stamped with. */
  readonly channel: string
  /** Product name the build was stamped with, when the stamp carries one. */
  readonly product?: string
  /** Updater feed the build was stamped with, when the stamp carries one. */
  readonly feed?: string
}

/**
 * Find a channel by registry slug.
 * @param slug - registry slug, for example `dev`.
 * @returns the channel, or undefined when the registry does not declare that slug.
 */
export function fitaChannel(slug: string): FitaChannel | undefined {
  return FITA_CHANNELS.find(channel => channel.slug === slug)
}

/**
 * Read the Fita stamp from a packaged manifest.
 *
 * Upstream builds and builds made before the registry carry no stamp at all.
 * @param manifest - parsed `package.json` of the running app.
 * @returns the stamped identity, or undefined when the build carries no channel.
 */
export function readFitaBuildIdentity(manifest: unknown): FitaBuildIdentity | undefined {
  if (typeof manifest !== 'object' || manifest === null) return undefined
  const record = manifest as Record<string, unknown>
  const channel = record['fitaChannel']
  if (typeof channel !== 'string' || channel.length === 0) return undefined
  const product = record['fitaProduct']
  const feed = record['fitaFeed']
  return {
    channel,
    ...(typeof product === 'string' && product.length > 0 ? { product } : {}),
    ...(typeof feed === 'string' && feed.length > 0 ? { feed } : {}),
  }
}

/**
 * Resolve the channel the running build belongs to.
 * @param manifest - parsed `package.json` of the running app.
 * @returns the registry entry, or undefined for an unstamped or unknown build.
 */
export function runningFitaChannel(manifest: unknown): FitaChannel | undefined {
  const identity = readFitaBuildIdentity(manifest)
  return identity === undefined ? undefined : fitaChannel(identity.channel)
}
