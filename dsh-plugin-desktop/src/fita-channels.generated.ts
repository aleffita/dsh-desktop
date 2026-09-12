/**
 * Generated from fita/channels.yml — do not edit.
 *
 * The packaged app cannot read the registry, so the registry is frozen here.
 * Regenerate with `yarn fita:channels`; `yarn check:fita-channels` fails when this
 * file and fita/channels.yml disagree.
 */

/** The identity every build shares: one application, many lanes. */
export interface FitaApplication {
  /** Bundle identifier of the single installed application. */
  readonly bundleId: string
  /** Name of the single installed application. */
  readonly appName: string
  /** Where `fita install` puts that application. */
  readonly installs: string
}

/** One release stream, exactly as fita/channels.yml declares it. */
export interface FitaLane {
  /** Registry slug; the value `fita:package` stamps into the build as `fitaChannel`. */
  readonly slug: string
  /** Human lane name. */
  readonly name: string
  /** Git lane that produces this build. */
  readonly lane: string
  /** Tag pattern the release workflow accepts for this lane. */
  readonly tag: string
  /** electron-updater channel; the release carries `<feed>-mac.yml`. */
  readonly feed: string
  /** URL-safe prefix the feed records for this lane's artifacts. */
  readonly artifactSlug: string
  /** Header accent colour. */
  readonly accent: string
  /** Foreground colour used on the accent. */
  readonly onAccent: string
  /** Whether releases in this lane are pre-releases. */
  readonly prerelease: boolean
  /** One-line description shown to the operator. */
  readonly description: string
}

/** Registry schema version. */
export const FITA_REGISTRY_VERSION = 1
/** Repository hosting this product's releases. */
export const FITA_REGISTRY_REPOSITORY = 'aleffita/dsh-desktop'
/** Product name shared by every lane. */
export const FITA_REGISTRY_PRODUCT = 'DSH Fita'

/** The one application these lanes belong to. */
export const FITA_APPLICATION: FitaApplication = Object.freeze({
  bundleId: 'dev.aleffita.dsh-harness',
  appName: 'DSH Harness',
  installs: '~/Applications/DSH Harness.app',
})

/** Every release stream, in registry order. */
export const FITA_LANES: readonly FitaLane[] = Object.freeze([
  Object.freeze({
    slug: 'main',
    name: 'Main',
    lane: 'master',
    tag: 'v*',
    feed: 'latest',
    artifactSlug: 'DSH-Fita',
    accent: '#1F6FEB',
    onAccent: '#FFFFFF',
    prerelease: false,
    description: 'Upstream mirror. What ships here is what upstream ships.',
  }),
  Object.freeze({
    slug: 'beta',
    name: 'Beta',
    lane: 'beta',
    tag: 'beta-v*',
    feed: 'beta',
    artifactSlug: 'DSH-Fita-Beta',
    accent: '#E3B341',
    onAccent: '#111111',
    prerelease: true,
    description: 'Upstream-bound work. Fixes here are meant to be extracted to upstream.',
  }),
  Object.freeze({
    slug: 'dev',
    name: 'Dev',
    lane: 'dev',
    tag: 'dev-v*',
    feed: 'dev',
    artifactSlug: 'DSH-Fita-Dev',
    accent: '#FF4D9D',
    onAccent: '#FFFFFF',
    prerelease: true,
    description: 'Our mainline. Diverges by design; product opinion lives here.',
  }),
  Object.freeze({
    slug: 'pr',
    name: 'Pull request',
    lane: 'PR-<number>-<slug>',
    tag: 'pr-<number>-v*',
    feed: 'pr',
    artifactSlug: 'DSH-Fita-PR',
    accent: '#FF7A59',
    onAccent: '#FFFFFF',
    prerelease: true,
    description: 'One installable build per review branch, colour-matched to the PR lane.',
  }),
])
