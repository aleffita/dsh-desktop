/**
 * Verify one packaged Fita channel against its registry declaration.
 *
 * Runs inside the packaging pipeline (`packageMacSmoke` invokes it with the
 * output directory) and is also usable on its own:
 *
 *   node scripts/fita/verify-channel.ts ../dsh-plugin-desktop/dist/mac-dev
 *   node scripts/fita/verify-channel.ts <outputDir> --channel=dev
 *
 * It mounts the DMG read-only and asserts the identity a channel promises:
 * the app bundle exists under the channel's product name, its bundle identifier
 * and version match, `app-update.yml` points at our repository with the
 * channel's feed, and the updater feed names the DMG it shipped with.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const desktopRoot = join(root, 'dsh-plugin-desktop')
const desktopRequire = createRequire(join(desktopRoot, 'package.json'))

interface Channel {
  readonly name: string
  readonly slug: string
  readonly feed: string
  readonly appName: string
  readonly bundleId: string
}

function fail(message: string): never {
  process.stderr.write(`fita-verify: ${message}\n`)
  process.exit(1)
}

function run(command: string, args: readonly string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed: ${(result.stderr || '').trim()}`)
  return (result.stdout ?? '').trim()
}

function plistValue(plist: string, key: string): string | undefined {
  const result = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], { encoding: 'utf8' })
  return result.status === 0 ? (result.stdout ?? '').trim() : undefined
}

function feedValue(feed: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(.+)$`, 'mu').exec(feed)
  return match?.[1]?.trim().replace(/^['"]|['"]$/gu, '')
}

function main(argv: readonly string[]): void {
  const outputDir = resolve(argv.find(argument => !argument.startsWith('--')) ?? fail('missing output directory'))
  const registry = desktopRequire('yaml').parse(readFileSync(join(root, 'fita', 'channels.yml'), 'utf8'))
  const slug = argv.find(argument => argument.startsWith('--channel='))?.split('=')[1]
    ?? process.env.FITA_CHANNEL
    ?? basename(outputDir).replace(/^mac-/u, '')
  const channel: Channel | undefined = registry.channels.find((entry: Channel) => entry.slug === slug)
  if (channel === undefined) fail(`output directory ${outputDir} names no known channel (got "${slug}")`)
  const version = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')).version

  const dmgName = (spawnSync('find', [outputDir, '-maxdepth', '1', '-name', '*.dmg'], { encoding: 'utf8' }).stdout ?? '')
    .split('\n').filter(Boolean)[0]
  if (dmgName === undefined) fail(`no DMG in ${outputDir}`)
  const dmg = dmgName

  const problems: string[] = []
  const mount = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'fita-verify-'))
  run('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-mountpoint', mount])
  try {
    const appPath = join(mount, `${channel.appName}.app`)
    if (!existsSync(appPath)) {
      const found = (spawnSync('find', [mount, '-maxdepth', '1', '-name', '*.app'], { encoding: 'utf8' }).stdout ?? '')
        .split('\n').filter(Boolean)
      problems.push(`expected "${channel.appName}.app" in the DMG, found ${found.map(entry => basename(entry)).join(', ') || 'none'}`)
    } else {
      const plist = join(appPath, 'Contents', 'Info.plist')
      const identifier = plistValue(plist, 'CFBundleIdentifier')
      if (identifier !== channel.bundleId) problems.push(`CFBundleIdentifier is ${identifier ?? 'absent'}, expected ${channel.bundleId}`)
      const shortVersion = plistValue(plist, 'CFBundleShortVersionString')
      if (shortVersion !== version) problems.push(`CFBundleShortVersionString is ${shortVersion ?? 'absent'}, expected ${version}`)
      const display = plistValue(plist, 'CFBundleDisplayName') ?? plistValue(plist, 'CFBundleName')
      if (display !== channel.appName) problems.push(`CFBundleDisplayName is ${display ?? 'absent'}, expected ${channel.appName}`)

      const updateFile = join(appPath, 'Contents', 'Resources', 'app-update.yml')
      if (!existsSync(updateFile)) {
        problems.push('app-update.yml is absent, so the build has no update feed')
      } else {
        const update = readFileSync(updateFile, 'utf8')
        const feed = feedValue(update, 'channel')
        if (feed !== channel.feed) problems.push(`app-update.yml channel is ${feed ?? 'absent'}, expected ${channel.feed}`)
        const owner = feedValue(update, 'owner')
        if (owner !== registry.repository.split('/')[0]) problems.push(`app-update.yml owner is ${owner ?? 'absent'}, expected ${registry.repository}`)
      }
    }
  } finally {
    spawnSync('hdiutil', ['detach', mount, '-quiet'], { encoding: 'utf8' })
    rmSync(mount, { recursive: true, force: true })
  }

  const feedFile = join(outputDir, `${channel.feed}-mac.yml`)
  if (!existsSync(feedFile)) {
    problems.push(`${channel.feed}-mac.yml is absent, so this channel has no updater feed`)
  } else {
    const feed = readFileSync(feedFile, 'utf8')
    const path = feedValue(feed, 'path')
    if (path !== basename(dmg)) problems.push(`feed path is ${path ?? 'absent'}, expected ${basename(dmg)}`)
    const feedVersion = feedValue(feed, 'version')
    if (feedVersion !== version) problems.push(`feed version is ${feedVersion ?? 'absent'}, expected ${version}`)
  }

  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`fita-verify: ${problem}\n`)
    process.exit(1)
  }
  process.stdout.write(`fita-verify: ${slug} ok — ${basename(dmg)}, ${channel.bundleId}, feed ${channel.feed}-mac.yml\n`)
}

try {
  main(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
