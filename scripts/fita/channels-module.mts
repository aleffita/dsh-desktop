/**
 * Freeze the channel registry into the app.
 *
 * `fita/channels.yml` is the single contract for channels, but the packaged app
 * cannot read it. This script renders it into `src/fita-channels.generated.ts`
 * inside both Desktop editions, so the registry the app carries and the registry
 * the pipeline reads can never drift: `--check` fails when they disagree.
 *
 *   node scripts/fita/channels-module.mts            # write both editions
 *   node scripts/fita/channels-module.mts --check    # verify, non-zero on drift
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const desktopRoot = join(root, 'dsh-plugin-desktop')
const desktopRequire = createRequire(join(desktopRoot, 'package.json'))

/** Editions that must carry an identical registry. */
const TARGETS = ['dsh-plugin-desktop', 'dsh-plugin-desktop-beta']

/** Fields a channel entry must declare, in the order the module renders them. */
const LANE_FIELDS = ['slug', 'name', 'lane', 'tag', 'feed', 'artifactSlug', 'accent', 'onAccent', 'description'] as const

/** Fields the one application declares. */
const APPLICATION_FIELDS = ['bundleId', 'appName', 'installs'] as const

interface Lane {
  readonly slug: string
  readonly name: string
  readonly lane: string
  readonly tag: string
  readonly feed: string
  readonly artifactSlug: string
  readonly accent: string
  readonly onAccent: string
  readonly prerelease: boolean
  readonly description: string
}

interface Application {
  readonly bundleId: string
  readonly appName: string
  readonly installs: string
}

function fail(message: string): never {
  process.stderr.write(`fita-channels: ${message}\n`)
  process.exit(1)
}

function quote(value: string): string {
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\n', '\\n')
  return `'${escaped}'`
}

/**
 * Validate the registry before anything is rendered from it.
 * @param registry - parsed `fita/channels.yml`.
 * @returns the application and the validated lanes.
 */
function validatedRegistry(registry: Record<string, unknown>): { application: Application; lanes: Lane[] } {
  const application = registry.application
  if (typeof application !== 'object' || application === null) fail('fita/channels.yml declares no application')
  const applicationRecord = application as Record<string, unknown>
  for (const field of APPLICATION_FIELDS) {
    if (typeof applicationRecord[field] !== 'string' || applicationRecord[field] === '') fail(`application has no ${field}`)
  }
  const lanes = registry.channels
  if (!Array.isArray(lanes) || lanes.length === 0) fail('fita/channels.yml declares no channels')
  const seen = new Map<string, string>()
  for (const [index, entry] of lanes.entries()) {
    if (typeof entry !== 'object' || entry === null) fail(`channel ${String(index)} is not a mapping`)
    const lane = entry as Record<string, unknown>
    for (const field of LANE_FIELDS) {
      if (typeof lane[field] !== 'string' || lane[field] === '') fail(`channel ${String(index)} has no ${field}`)
    }
    if (typeof lane.prerelease !== 'boolean') fail(`channel ${String(lane.slug)} has no boolean prerelease`)
    if (!/^[a-z][a-z0-9]*$/u.test(lane.slug as string)) fail(`slug ${String(lane.slug)} must be lowercase alphanumeric`)
    // A lane's identity is its release stream now: two lanes cannot claim the same tag,
    // feed or artifact prefix, or one release would be indistinguishable from another's.
    for (const field of ['tag', 'feed', 'artifactSlug'] as const) {
      const value = lane[field] as string
      const owner = seen.get(`${field}:${value}`)
      if (owner !== undefined) fail(`${field} "${value}" is claimed by both ${owner} and ${String(lane.slug)}`)
      seen.set(`${field}:${value}`, lane.slug as string)
    }
  }
  return { application: application as Application, lanes: lanes as Lane[] }
}

/**
 * Render the generated module.
 * @param registry - validated registry header values.
 * @param application - the one application identity.
 * @param lanes - validated lanes.
 * @returns the exact file content both editions receive.
 */
function render(
  registry: { version: number; repository: string; product: string },
  application: Application,
  lanes: readonly Lane[],
): string {
  const entries = lanes.map(lane => `  Object.freeze({
    slug: ${quote(lane.slug)},
    name: ${quote(lane.name)},
    lane: ${quote(lane.lane)},
    tag: ${quote(lane.tag)},
    feed: ${quote(lane.feed)},
    artifactSlug: ${quote(lane.artifactSlug)},
    accent: ${quote(lane.accent)},
    onAccent: ${quote(lane.onAccent)},
    prerelease: ${String(lane.prerelease)},
    description: ${quote(lane.description)},
  }),`).join('\n')
  return `/**
 * Generated from fita/channels.yml — do not edit.
 *
 * The packaged app cannot read the registry, so the registry is frozen here.
 * Regenerate with \`yarn fita:channels\`; \`yarn check:fita-channels\` fails when this
 * file and fita/channels.yml disagree.
 */

/** The identity every build shares: one application, many lanes. */
export interface FitaApplication {
  /** Bundle identifier of the single installed application. */
  readonly bundleId: string
  /** Name of the single installed application. */
  readonly appName: string
  /** Where \`fita install\` puts that application. */
  readonly installs: string
}

/** One release stream, exactly as fita/channels.yml declares it. */
export interface FitaLane {
  /** Registry slug; the value \`fita:package\` stamps into the build as \`fitaChannel\`. */
  readonly slug: string
  /** Human lane name. */
  readonly name: string
  /** Git lane that produces this build. */
  readonly lane: string
  /** Tag pattern the release workflow accepts for this lane. */
  readonly tag: string
  /** electron-updater channel; the release carries \`<feed>-mac.yml\`. */
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
export const FITA_REGISTRY_VERSION = ${String(registry.version)}
/** Repository hosting this product's releases. */
export const FITA_REGISTRY_REPOSITORY = ${quote(registry.repository)}
/** Product name shared by every lane. */
export const FITA_REGISTRY_PRODUCT = ${quote(registry.product)}

/** The one application these lanes belong to. */
export const FITA_APPLICATION: FitaApplication = Object.freeze({
  bundleId: ${quote(application.bundleId)},
  appName: ${quote(application.appName)},
  installs: ${quote(application.installs)},
})

/** Every release stream, in registry order. */
export const FITA_LANES: readonly FitaLane[] = Object.freeze([
${entries}
])
`
}

function main(argv: readonly string[]): void {
  const check = argv.includes('--check')
  const registry = desktopRequire('yaml').parse(readFileSync(join(root, 'fita', 'channels.yml'), 'utf8')) as Record<string, unknown>
  const version = registry.version
  if (typeof version !== 'number') fail('fita/channels.yml declares no numeric version')
  for (const field of ['repository', 'product'] as const) {
    if (typeof registry[field] !== 'string' || registry[field] === '') fail(`fita/channels.yml declares no ${field}`)
  }
  const { application, lanes } = validatedRegistry(registry)
  const source = render(
    { version, repository: registry.repository as string, product: registry.product as string },
    application,
    lanes,
  )

  const drifted: string[] = []
  for (const target of TARGETS) {
    const file = join(root, target, 'src', 'fita-channels.generated.ts')
    if (check) {
      let current: string | undefined
      try {
        current = readFileSync(file, 'utf8')
      } catch {
        current = undefined
      }
      if (current !== source) drifted.push(file)
      continue
    }
    writeFileSync(file, source)
    process.stdout.write(`fita-channels: wrote ${target}/src/fita-channels.generated.ts\n`)
  }

  if (check) {
    if (drifted.length > 0) {
      for (const file of drifted) process.stderr.write(`fita-channels: ${file} is stale\n`)
      fail('run: yarn fita:channels')
    }
    process.stdout.write('fita-channels: both editions carry the registry from fita/channels.yml\n')
  }
}

main(process.argv.slice(2))
