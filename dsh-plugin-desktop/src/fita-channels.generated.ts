/**
 * Generated from fita/channels.yml — do not edit.
 *
 * The packaged app cannot read the registry, so the registry is frozen here.
 * Regenerate with `yarn fita:channels`; `yarn check:fita-channels` fails when this
 * file and fita/channels.yml disagree.
 */

/** One installable lane, exactly as fita/channels.yml declares it. */
export interface FitaChannel {
  /** Registry slug; the value `fita:package` stamps into the build as `fitaChannel`. */
  readonly slug: string
  /** Human channel name. */
  readonly name: string
  /** Git lane that produces this build. */
  readonly lane: string
  /** Tag pattern the release workflow accepts for this channel. */
  readonly tag: string
  /** electron-updater channel; the release carries `<feed>-mac.yml`. */
  readonly feed: string
  /** App bundle name. */
  readonly appName: string
  /** URL-safe prefix the updater feed records for this channel's artifacts. */
  readonly artifactSlug: string
  /** Bundle identifier, unique per channel so installs stand side by side. */
  readonly bundleId: string
  /** Header accent colour. */
  readonly accent: string
  /** Foreground colour used on the accent. */
  readonly onAccent: string
  /** Whether releases in this channel are pre-releases. */
  readonly prerelease: boolean
  /** Install path `fita install <slug>` uses. */
  readonly installs: string
  /** One-line description shown to the operator. */
  readonly description: string
}

/** Registry schema version. */
export const FITA_REGISTRY_VERSION = 1
/** Repository hosting this product's releases. */
export const FITA_REGISTRY_REPOSITORY = 'aleffita/dsh-desktop'
/** Product name shared by every channel. */
export const FITA_REGISTRY_PRODUCT = 'DSH Fita'

/** Every installable channel, in registry order. */
export const FITA_CHANNELS: readonly FitaChannel[] = Object.freeze([
  Object.freeze({
    slug: 'main',
    name: 'Main',
    lane: 'master',
    tag: 'v*',
    feed: 'latest',
    appName: 'DSH Fita',
    artifactSlug: 'DSH-Fita',
    bundleId: 'ai.deepseek.dsh.desktop',
    accent: '#1F6FEB',
    onAccent: '#FFFFFF',
    prerelease: false,
    installs: '~/Applications/DSH Fita.app',
    description: 'Upstream mirror. What ships here is what upstream ships.',
  }),
  Object.freeze({
    slug: 'beta',
    name: 'Beta',
    lane: 'beta',
    tag: 'beta-v*',
    feed: 'beta',
    appName: 'DSH Fita Beta',
    artifactSlug: 'DSH-Fita-Beta',
    bundleId: 'ai.deepseek.dsh.desktop.beta',
    accent: '#E3B341',
    onAccent: '#111111',
    prerelease: true,
    installs: '~/Applications/DSH Fita Beta.app',
    description: 'Upstream-bound work. Fixes here are meant to be extracted to upstream.',
  }),
  Object.freeze({
    slug: 'dev',
    name: 'Dev',
    lane: 'dev',
    tag: 'dev-v*',
    feed: 'dev',
    appName: 'DSH Fita Dev',
    artifactSlug: 'DSH-Fita-Dev',
    bundleId: 'ai.deepseek.dsh.desktop.dev',
    accent: '#FF4D9D',
    onAccent: '#FFFFFF',
    prerelease: true,
    installs: '~/Applications/DSH Fita Dev.app',
    description: 'Our mainline. Diverges by design; product opinion lives here.',
  }),
  Object.freeze({
    slug: 'pr',
    name: 'Pull request',
    lane: 'PR-<number>-<slug>',
    tag: 'pr-<number>-v*',
    feed: 'pr',
    appName: 'DSH Fita PR',
    artifactSlug: 'DSH-Fita-PR',
    bundleId: 'ai.deepseek.dsh.desktop.pr',
    accent: '#FF7A59',
    onAccent: '#FFFFFF',
    prerelease: true,
    installs: '~/Applications/DSH Fita PR.app',
    description: 'One installable build per review branch, colour-matched to the PR lane.',
  }),
])
