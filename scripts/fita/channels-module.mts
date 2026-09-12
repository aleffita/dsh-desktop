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
const FIELDS = ['slug', 'name', 'lane', 'tag', 'feed', 'appName', 'artifactSlug', 'bundleId', 'accent', 'onAccent', 'installs', 'description'] as const

interface Channel {
  readonly slug: string
  readonly name: string
  readonly lane: string
  readonly tag: string
  readonly feed: string
  readonly appName: string
  readonly artifactSlug: string
  readonly bundleId: string
  readonly accent: string
  readonly onAccent: string
  readonly prerelease: boolean
  readonly installs: string
  readonly description: string
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
 * @returns the validated channels.
 */
function validatedChannels(registry: Record<string, unknown>): Channel[] {
  const channels = registry.channels
  if (!Array.isArray(channels) || channels.length === 0) fail('fita/channels.yml declares no channels')
  const seen = new Map<string, string>()
  for (const [index, entry] of channels.entries()) {
    if (typeof entry !== 'object' || entry === null) fail(`channel ${String(index)} is not a mapping`)
    const channel = entry as Record<string, unknown>
    for (const field of FIELDS) {
      if (typeof channel[field] !== 'string' || channel[field] === '') fail(`channel ${String(index)} has no ${field}`)
    }
    if (typeof channel.prerelease !== 'boolean') fail(`channel ${String(channel.slug)} has no boolean prerelease`)
    if (!/^[a-z][a-z0-9]*$/u.test(channel.slug as string)) fail(`slug ${String(channel.slug)} must be lowercase alphanumeric`)
    for (const field of ['bundleId', 'appName', 'artifactSlug', 'installs'] as const) {
      const value = channel[field] as string
      const owner = seen.get(`${field}:${value}`)
      if (owner !== undefined) fail(`${field} "${value}" is claimed by both ${owner} and ${String(channel.slug)}`)
      seen.set(`${field}:${value}`, channel.slug as string)
    }
  }
  return channels as Channel[]
}

/**
 * Render the generated module.
 * @param registry - validated registry header values.
 * @param channels - validated channel entries.
 * @returns the exact file content both editions receive.
 */
function render(registry: { version: number; repository: string; product: string }, channels: readonly Channel[]): string {
  const entries = channels.map(channel => `  Object.freeze({
    slug: ${quote(channel.slug)},
    name: ${quote(channel.name)},
    lane: ${quote(channel.lane)},
    tag: ${quote(channel.tag)},
    feed: ${quote(channel.feed)},
    appName: ${quote(channel.appName)},
    artifactSlug: ${quote(channel.artifactSlug)},
    bundleId: ${quote(channel.bundleId)},
    accent: ${quote(channel.accent)},
    onAccent: ${quote(channel.onAccent)},
    prerelease: ${String(channel.prerelease)},
    installs: ${quote(channel.installs)},
    description: ${quote(channel.description)},
  }),`).join('\n')
  return `/**
 * Generated from fita/channels.yml — do not edit.
 *
 * The packaged app cannot read the registry, so the registry is frozen here.
 * Regenerate with \`yarn fita:channels\`; \`yarn check:fita-channels\` fails when this
 * file and fita/channels.yml disagree.
 */

/** One installable lane, exactly as fita/channels.yml declares it. */
export interface FitaChannel {
  /** Registry slug; the value \`fita:package\` stamps into the build as \`fitaChannel\`. */
  readonly slug: string
  /** Human channel name. */
  readonly name: string
  /** Git lane that produces this build. */
  readonly lane: string
  /** Tag pattern the release workflow accepts for this channel. */
  readonly tag: string
  /** electron-updater channel; the release carries \`<feed>-mac.yml\`. */
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
  /** Install path \`fita install <slug>\` uses. */
  readonly installs: string
  /** One-line description shown to the operator. */
  readonly description: string
}

/** Registry schema version. */
export const FITA_REGISTRY_VERSION = ${String(registry.version)}
/** Repository hosting this product's releases. */
export const FITA_REGISTRY_REPOSITORY = ${quote(registry.repository)}
/** Product name shared by every channel. */
export const FITA_REGISTRY_PRODUCT = ${quote(registry.product)}

/** Every installable channel, in registry order. */
export const FITA_CHANNELS: readonly FitaChannel[] = Object.freeze([
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
  const source = render(
    { version, repository: registry.repository as string, product: registry.product as string },
    validatedChannels(registry),
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
