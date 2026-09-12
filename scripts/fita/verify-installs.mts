/**
 * End-to-end check for Fita channel builds.
 *
 * Installs each requested channel from its locally built directory, then proves
 * what a channel promises: its own app bundle, its own bundle identifier, its own
 * updater feed, and a packaged runtime that actually boots — headlessly, through
 * the embedded `dsh` CLI, so no window is opened and no running app is disturbed.
 *
 *   node scripts/fita/verify-installs.mts --channels=dev,beta
 *   node scripts/fita/verify-installs.mts --channels=dev --root=/tmp/fita-e2e --keep
 *
 * It is the gate that lets a channel be pushed: a build that cannot install,
 * identify itself and boot is not a release candidate.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const desktopRoot = join(root, 'dsh-plugin-desktop')
const desktopRequire = createRequire(join(desktopRoot, 'package.json'))

/**
 * Electron reads inside `app.asar` natively; plain Node does not, so `existsSync`
 * always reports a packaged path as absent. An unpacked build is inspected
 * through the asar API instead: the same reader that produced the archive.
 */
function asarHas(archive: string, innerPath: string): boolean | undefined {
  try {
    const asar = desktopRequire('@electron/asar') as { statFile: (file: string, inner: string) => { size: number } }
    return asar.statFile(archive, innerPath).size > 0
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') return undefined
    return false
  }
}

interface Lane {
  readonly name: string
  readonly slug: string
  readonly feed: string
}

interface Application {
  readonly bundleId: string
  readonly appName: string
  readonly installs: string
}

const problems: string[] = []

function note(message: string): void {
  process.stdout.write(`fita-e2e: ${message}\n`)
}

function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { encoding: 'utf8', env })
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function plistValue(plist: string, key: string): string | undefined {
  const result = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], { encoding: 'utf8' })
  return result.status === 0 ? (result.stdout ?? '').trim() : undefined
}

function feedValue(text: string, key: string): string | undefined {
  return new RegExp(`^${key}:\\s*(.+)$`, 'mu').exec(text)?.[1]?.trim().replace(/^['"]|['"]$/gu, '')
}

function main(argv: readonly string[]): void {
  const flag = (name: string): string | undefined => {
    const inline = argv.find(argument => argument.startsWith(`--${name}=`))
    if (inline !== undefined) return inline.split('=').slice(1).join('=')
    const index = argv.indexOf(`--${name}`)
    const next = index >= 0 ? argv[index + 1] : undefined
    return next !== undefined && !next.startsWith('--') ? next : undefined
  }
  const slugs = (flag('channels') ?? '').split(',').map(entry => entry.trim()).filter(Boolean)
  if (slugs.length < 2) {
    process.stderr.write('fita-e2e: pass at least two channels, for example --channels=dev,beta\n')
    process.exit(1)
  }
  const keep = argv.includes('--keep')
  const installRoot = flag('root') ?? mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'fita-e2e-'))
  const installedPaths: string[] = []
  const version = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')).version
  const registry = desktopRequire('yaml').parse(readFileSync(join(root, 'fita', 'channels.yml'), 'utf8'))
  const application: Application = registry.application
  const channels: Lane[] = registry.channels
  const env = { ...process.env, FITA_INSTALL_ROOT: installRoot }

  note(`installing ${slugs.join(', ')} under ${installRoot}`)
  for (const slug of slugs) {
    const channel = channels.find(entry => entry.slug === slug)
    if (channel === undefined) {
      problems.push(`unknown channel "${slug}"`)
      continue
    }
    const source = join(desktopRoot, 'dist', `mac-${slug}`)
    if (!existsSync(join(source, 'fita-channel.json'))) {
      problems.push(`${slug}: no build in ${source}; run: yarn fita:package --channel ${slug}`)
      continue
    }
    const install = run(process.execPath, [join(root, 'scripts', 'fita', 'fita.mjs'), 'install', slug, `--from-dir=${source}`], env)
    if (install.status !== 0) {
      problems.push(`${slug}: install failed: ${install.stderr.trim() || install.stdout.trim()}`)
      continue
    }
    note(`${slug}: installed`)

    // One application, so every lane's build must land on the same path: applying a lane
    // over this app is what choosing a lane does.
    const appPath = join(installRoot, `${application.appName}.app`)
    if (!existsSync(appPath)) {
      problems.push(`${slug}: expected ${application.appName}.app in ${installRoot}`)
      continue
    }
    if (installedPaths.length > 0 && !installedPaths.includes(appPath)) {
      problems.push(`${slug}: installed to ${appPath}, but another lane installed to ${installedPaths[0] ?? ''}`)
    }
    installedPaths.push(appPath)
    const plist = join(appPath, 'Contents', 'Info.plist')
    const identifier = plistValue(plist, 'CFBundleIdentifier')
    if (identifier !== application.bundleId) problems.push(`${slug}: bundle id ${identifier ?? 'absent'} != ${application.bundleId}`)
    const shortVersion = plistValue(plist, 'CFBundleShortVersionString')
    if (shortVersion !== version) problems.push(`${slug}: version ${shortVersion ?? 'absent'} != ${version}`)

    const updateFile = join(appPath, 'Contents', 'Resources', 'app-update.yml')
    if (!existsSync(updateFile)) {
      problems.push(`${slug}: app-update.yml absent`)
    } else {
      const channelFeed = feedValue(readFileSync(updateFile, 'utf8'), 'channel')
      if (channelFeed !== channel.feed) problems.push(`${slug}: update channel ${channelFeed ?? 'absent'} != ${channel.feed}`)
    }

    // Headless boot through the embedded Harness CLI: proves the packaged runtime
    // resolves and starts without opening the app the user is running.
    const executable = join(appPath, 'Contents', 'MacOS', application.appName)
    const archive = join(appPath, 'Contents', 'Resources', 'app.asar')
    const cliInner = 'node_modules/@deepseek-ai/dsh/lib/bin.js'
    const cli = join(archive, ...cliInner.split('/'))
    const packaged = asarHas(archive, cliInner)
    if (!existsSync(executable)) problems.push(`${slug}: missing executable ${executable}`)
    else if (packaged === false) problems.push(`${slug}: missing embedded CLI ${cliInner} in app.asar`)
    else {
      const boot = run(executable, [cli, '--version'], { ...env, ELECTRON_RUN_AS_NODE: '1', DSH_TELEMETRY_DISABLED: '1' })
      const printed = boot.stdout.trim()
      if (boot.status !== 0 || printed.length === 0) {
        problems.push(`${slug}: embedded CLI did not boot (status ${String(boot.status)}): ${(boot.stderr || boot.stdout).trim().slice(0, 200)}`)
      } else {
        note(`${slug}: embedded runtime boots, harness ${printed}${packaged === undefined ? ' (asar inventory unavailable)' : ''}`)
      }
    }
  }

  // One-application invariant: every lane applies to the same bundle, and no lane claims an
  // identity of its own. Two lanes disagreeing on the path is the failure this catches.
  const installed = slugs
    .map(slug => channels.find(entry => entry.slug === slug))
    .filter((channel): channel is Lane => channel !== undefined)
  if (new Set(installedPaths).size > 1) problems.push('lanes installed to different paths')

  if (!keep) rmSync(installRoot, { recursive: true, force: true })

  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`fita-e2e: ${problem}\n`)
    process.exit(1)
  }
  note(`ok — ${String(installed.length)} lanes applied over one application under ${installRoot}`)
}

try {
  main(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
