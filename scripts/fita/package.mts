/**
 * Package one Fita channel.
 *
 * Reuses the upstream packaging pipeline (`packageMacSmoke`: preflight, universal
 * runtime preparation, electron-builder invocation, DMG verification) and adds
 * the three things a channel needs to stand on its own:
 *
 *   productName        the app identity that appears in Finder and the DMG
 *   appId              the bundle identifier, so channels coexist without fighting
 *   publish.channel    the updater feed (`<feed>-mac.yml`) baked into app-update.yml
 *
 * It also writes `fita-channel.json` next to the artifacts: the manifest the
 * installer, the pipelines and the e2e checks consume instead of guessing.
 *
 *   node scripts/fita/package.ts --list
 *   node scripts/fita/package.ts --channel dev --dry-run
 *   node scripts/fita/package.ts --channel dev
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareFsExtForElectron } from '../../dsh-plugin-desktop/scripts/prepare-fs-ext.ts'
import { prepareInstalledMacUniversalRuntime } from '../../dsh-plugin-desktop/scripts/mac-universal.ts'
import { packageMacSmoke } from '../../dsh-plugin-desktop/scripts/package-mac.ts'
import type { MacSmokePackageOptions } from '../../dsh-plugin-desktop/scripts/package-mac.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const desktopRoot = join(root, 'dsh-plugin-desktop')
const desktopRequire = createRequire(join(desktopRoot, 'package.json'))

interface Channel {
  readonly name: string
  readonly slug: string
  readonly lane: string
  readonly feed: string
  readonly appName: string
  readonly bundleId: string
  readonly accent: string
  readonly prerelease: boolean
}

function fail(message: string): never {
  process.stderr.write(`fita-package: ${message}\n`)
  process.exit(1)
}

function registry(): { product: string; repository: string; channels: Channel[] } {
  return desktopRequire('yaml').parse(readFileSync(join(root, 'fita', 'channels.yml'), 'utf8'))
}

function desktopVersion(): string {
  return JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')).version
}

function currentLane(): string {
  const branch = spawnSync('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' })
  return (branch.stdout ?? '').trim()
}

function resolveChannel(channels: readonly Channel[], requested: string | undefined): Channel {
  if (requested !== undefined) {
    const channel = channels.find(entry => entry.slug === requested)
    if (channel === undefined) fail(`unknown channel "${requested}"; known: ${channels.map(entry => entry.slug).join(', ')}`)
    return channel
  }
  const lane = currentLane()
  const channel = channels.find(entry => entry.lane === lane || entry.lane === `PR-<number>-<slug>` && lane.startsWith('PR-'))
  if (channel === undefined) {
    fail(`current lane "${lane}" matches no channel; pass --channel <slug> (known: ${channels.map(entry => entry.slug).join(', ')})`)
  }
  return channel
}

function stampFlags(channel: Channel, product: string): string[] {
  return [
    `--config.productName=${channel.appName}`,
    `--config.appId=${channel.bundleId}`,
    `--config.publish.channel=${channel.feed}`,
    `--config.extraMetadata.fitaProduct=${product}`,
    `--config.extraMetadata.fitaChannel=${channel.slug}`,
    `--config.extraMetadata.fitaFeed=${channel.feed}`,
  ]
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function parseFlags(argv: readonly string[]): Record<string, string | true> {
  const flags: Record<string, string | true> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? ''
    if (!argument.startsWith('--')) continue
    const [key, inline] = argument.replace(/^--/u, '').split('=')
    if (key === undefined) continue
    if (inline !== undefined) {
      flags[key] = inline
      continue
    }
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next
      index += 1
      continue
    }
    flags[key] = true
  }
  return flags
}

function build(channel: Channel, product: string, version: string, outputDir: string): void {
  const flags = stampFlags(channel, product)
  const options: MacSmokePackageOptions = {
    env: { ...process.env, FITA_CHANNEL: channel.slug },
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    workspaceRoot: root,
    desktopRoot,
    outputDir,
    resetOutput: () => rmSync(outputDir, { recursive: true, force: true }),
    prepareRuntime: () => {
      prepareFsExtForElectron({ platform: 'darwin', arch: 'arm64', desktopRoot })
      prepareFsExtForElectron({ platform: 'darwin', arch: 'x64', desktopRoot })
      prepareInstalledMacUniversalRuntime(desktopRoot)
    },
    builderCli: desktopRequire.resolve('electron-builder/cli.js'),
    verifier: fileURLToPath(new URL('./verify-channel.mts', import.meta.url)),
    nodeExecutable: process.execPath,
    run: (command, args, cwd, env) => {
      const decorated = args[0] === options.builderCli ? [...args, ...flags] : [...args]
      const result = spawnSync(command, decorated, { cwd, env, stdio: 'inherit' })
      if (result.error !== undefined) throw result.error
      if (result.status !== 0) throw new Error(`${command} ${decorated.join(' ')} exited with ${String(result.status)}`)
    },
    log: message => console.log(`[fita:${channel.slug}] ${message}`),
  }

  packageMacSmoke(options)

  const dmg = readdirSync(outputDir).find(name => name.endsWith('.dmg'))
  if (dmg === undefined) fail(`no DMG produced in ${outputDir}`)
  const feedFile = existsSync(join(outputDir, `${channel.feed}-mac.yml`)) ? `${channel.feed}-mac.yml` : undefined
  const manifest = {
    channel: channel.slug,
    name: channel.name,
    lane: channel.lane,
    product,
    version,
    appName: channel.appName,
    bundleId: channel.bundleId,
    feed: channel.feed,
    feedFile,
    accent: channel.accent,
    prerelease: channel.prerelease,
    dmg,
    dmgSha256: sha256(join(outputDir, dmg)),
    electronBuilderFlags: flags,
  }
  writeFileSync(join(outputDir, 'fita-channel.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`[fita:${channel.slug}] manifest written`)
}

function main(argv: readonly string[]): void {
  const flags = parseFlags(argv)
  const { product, repository, channels } = registry()

  if (flags.list === true) {
    for (const channel of channels) {
      process.stdout.write(
        `${channel.slug.padEnd(6)} feed=${String(channel.feed).padEnd(6)} app="${channel.appName}" bundle=${channel.bundleId}\n`,
      )
    }
    return
  }

  const channel = resolveChannel(channels, typeof flags.channel === 'string' ? flags.channel : undefined)
  const version = desktopVersion()
  const outputDir = join(desktopRoot, 'dist', `mac-${channel.slug}`)
  const planned = {
    channel: channel.slug,
    name: channel.name,
    lane: channel.lane,
    product,
    repository,
    version,
    appName: channel.appName,
    bundleId: channel.bundleId,
    feed: channel.feed,
    accent: channel.accent,
    prerelease: channel.prerelease,
    outputDir,
    electronBuilderFlags: stampFlags(channel, product),
  }

  if (flags['dry-run'] === true) {
    process.stdout.write(`${JSON.stringify(planned, null, 2)}\n`)
    return
  }

  console.log(`[fita:${channel.slug}] ${JSON.stringify(planned)}`)
  build(channel, product, version, outputDir)
}

try {
  main(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
