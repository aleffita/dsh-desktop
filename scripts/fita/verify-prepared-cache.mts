/**
 * Prove a prepared cache directory is one the installer accepts.
 *
 * The in-app update flow ends by leaving the verified build in a directory the local
 * installer can take. This script proves that claim end to end, offline: it builds a
 * cache directory exactly as the app does — the app's own `fitaChannelManifest`, and
 * the channel's real DMG hard-linked rather than copied — then runs
 * `fita install --from-dir` against it and checks the installed app's identity.
 *
 *   node scripts/fita/verify-prepared-cache.mts --channel=dev [--keep]
 */

import { spawnSync } from 'node:child_process'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { fitaChannelManifest } from '../../dsh-plugin-desktop/src/fita-download.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const desktopRoot = join(root, 'dsh-plugin-desktop')
const desktopRequire = createRequire(join(desktopRoot, 'package.json'))

interface Channel {
  readonly slug: string
  readonly appName: string
  readonly bundleId: string
}

const problems: string[] = []

function note(message: string): void {
  process.stdout.write(`fita-prepared: ${message}\n`)
}

function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(command, args, { encoding: 'utf8', env })
}

function plistValue(plist: string, key: string): string | undefined {
  const result = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], { encoding: 'utf8' })
  return result.status === 0 ? (result.stdout ?? '').trim() : undefined
}

function main(argv: readonly string[]): void {
  const flag = (name: string): string | undefined => {
    const inline = argv.find(argument => argument.startsWith(`--${name}=`))
    return inline === undefined ? undefined : inline.split('=').slice(1).join('=')
  }
  const slug = flag('channel') ?? 'dev'
  const source = join(desktopRoot, 'dist', `mac-${slug}`)
  const manifestPath = join(source, 'fita-channel.json')
  if (!existsSync(manifestPath)) {
    process.stderr.write(`fita-prepared: no build in ${source}; run: yarn fita:package --channel ${slug}\n`)
    process.exit(1)
  }
  const built = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    channel: string
    version: string
    dmg: string
    dmgSha256: string
  }
  const registry = desktopRequire('yaml').parse(readFileSync(join(root, 'fita', 'channels.yml'), 'utf8')) as { channels: Channel[] }
  const channel = registry.channels.find(entry => entry.slug === built.channel)
  if (channel === undefined) {
    process.stderr.write(`fita-prepared: ${built.channel} is not in the registry\n`)
    process.exit(1)
  }

  // Exactly what the app leaves behind: the DMG under its published name and the
  // manifest written from the facts it verified.
  const cache = mkdtempSync(join(tmpdir(), 'fita-prepared-'))
  const prepared = join(cache, channel.slug)
  mkdirSync(prepared, { recursive: true })
  linkSync(join(source, built.dmg), join(prepared, built.dmg))
  writeFileSync(
    join(prepared, 'fita-channel.json'),
    `${JSON.stringify(fitaChannelManifest(channel as never, built.version, built.dmg, built.dmgSha256), null, 2)}\n`,
  )
  note(`prepared ${prepared} from ${built.dmg}`)

  const installRoot = mkdtempSync(join(tmpdir(), 'fita-prepared-install-'))
  const install = run(
    process.execPath,
    [join(root, 'scripts', 'fita', 'fita.mjs'), 'install', channel.slug, `--from-dir=${prepared}`],
    { ...process.env, FITA_INSTALL_ROOT: installRoot },
  )
  if (install.status !== 0) {
    problems.push(`install failed: ${(install.stderr || install.stdout).trim().slice(0, 300)}`)
  } else {
    note(`installed: ${(install.stdout || '').trim().split('\n').slice(-1)[0] ?? ''}`)
    const app = join(installRoot, `${channel.appName}.app`)
    if (!existsSync(app)) {
      problems.push(`expected ${channel.appName}.app in ${installRoot}`)
    } else {
      const identifier = plistValue(join(app, 'Contents', 'Info.plist'), 'CFBundleIdentifier')
      if (identifier !== channel.bundleId) problems.push(`bundle id ${identifier ?? 'absent'} != ${channel.bundleId}`)
      const version = plistValue(join(app, 'Contents', 'Info.plist'), 'CFBundleShortVersionString')
      if (version !== built.version) problems.push(`version ${version ?? 'absent'} != ${built.version}`)
    }
  }

  rmSync(prepared, { recursive: true, force: true })
  rmSync(cache, { recursive: true, force: true })
  rmSync(installRoot, { recursive: true, force: true })

  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`fita-prepared: ${problem}\n`)
    process.exit(1)
  }
  note(`ok — a cache prepared like the app's installed ${channel.appName} ${built.version} side by side`)
}

try {
  main(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`fita-prepared: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
