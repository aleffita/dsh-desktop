#!/usr/bin/env node
/**
 * Fita install manager.
 *
 * Installs, tracks and switches the app builds this fork publishes, one per
 * channel declared in `fita/channels.yml`. Nothing is copied by hand: a channel
 * resolves to a GitHub release of our fork, the DMG is verified against the
 * release's SHA256SUMS.txt, mounted, and the app lands in the channel's own
 * install path with its own identity, so several channels run side by side.
 *
 *   yarn fita list
 *   yarn fita status
 *   yarn fita install dev [--version 2.0.10-rc.1]
 *   yarn fita use dev
 *   yarn fita uninstall dev
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
// `yaml` ships with the desktop workspace, so resolve it there instead of adding
// a dependency to the private workspace root.
const { parse } = createRequire(join(root, 'dsh-plugin-desktop', 'package.json'))('yaml')
const registry = parse(readFileSync(join(root, 'fita', 'channels.yml'), 'utf8'))
const channels = registry.channels ?? []

function fail(message) {
  process.stderr.write(`fita: ${message}\n`)
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed: ${(result.stderr || '').trim()}`)
  return (result.stdout ?? '').trim()
}

function expand(path) {
  return resolve(path.replace(/^~(?=\/|$)/u, homedir()))
}

/**
 * Install directory for one channel. `FITA_INSTALL_ROOT` relocates every channel
 * under a single root, which is how the e2e checks install without touching the
 * applications the user actually runs.
 */
function installPath(channel) {
  const destination = expand(channel.installs)
  const root = process.env.FITA_INSTALL_ROOT
  return root === undefined ? destination : join(resolve(root), basename(destination))
}

function channelFor(slug) {
  const channel = channels.find(entry => entry.slug === slug)
  if (channel === undefined) fail(`unknown channel "${slug}"; known: ${channels.map(entry => entry.slug).join(', ')}`)
  return channel
}

function installedVersion(channel) {
  const bundle = join(installPath(channel), 'Contents', 'Info.plist')
  if (!existsSync(bundle)) return undefined
  return run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', bundle])
}

function releases({ limit = 50 } = {}) {
  const output = run('gh', [
    'release', 'list',
    '--repo', registry.repository,
    '--limit', String(limit),
    '--json', 'tagName,isPrerelease,isDraft,publishedAt,assets',
  ])
  return JSON.parse(output)
}

function tagFor(channel) {
  const prefix = channel.tag.replace(/\*$/u, '')
  const match = releases().find(release => release.tagName.startsWith(prefix))
  if (match === undefined) fail(`no release matching "${channel.tag}" in ${registry.repository}`)
  return match
}

function commandList() {
  for (const channel of channels) {
    const version = installedVersion(channel)
    process.stdout.write(
      `${channel.slug.padEnd(6)} lane=${String(channel.lane).padEnd(22)} ` +
      `accent=${channel.accent} app="${channel.appName}" ` +
      `installed=${version ?? '-'}\n`
    )
  }
}

function commandStatus() {
  for (const channel of channels) {
    const version = installedVersion(channel)
    process.stdout.write(`${channel.slug.padEnd(6)} ${version === undefined ? 'not installed' : version}  ${channel.installs}\n`)
  }
}

function download(url, destination) {
  const response = spawnSync('curl', ['-fsSL', url, '-o', destination], { encoding: 'utf8' })
  if (response.status !== 0) fail(`download failed: ${url} (${(response.stderr || '').trim()})`)
}

function commandInstall(slug, requestedVersion, fromDir) {
  const channel = channelFor(slug)
  const work = mkdtempSync(join(tmpdir(), `fita-${slug}-`))
  let dmg
  let checksumSource
  let version

  if (fromDir !== undefined) {
    const source = resolve(fromDir)
    const manifestPath = join(source, 'fita-channel.json')
    if (!existsSync(manifestPath)) fail(`${source} carries no fita-channel.json; build the channel first`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.channel !== channel.slug) fail(`${source} is the ${manifest.channel} build, not ${channel.slug}`)
    if (typeof manifest.version !== 'string') fail(`${source}/fita-channel.json carries no version`)
    version = manifest.version
    dmg = join(source, manifest.dmg)
    if (!existsSync(dmg)) fail(`missing ${manifest.dmg} in ${source}`)
    const sums = join(source, 'SHA256SUMS.txt')
    if (existsSync(sums)) checksumSource = sums
    else writeFileSync(join(work, 'SHA256SUMS.txt'), `${manifest.dmgSha256}  ${manifest.dmg}\n`)
    if (checksumSource === undefined) checksumSource = join(work, 'SHA256SUMS.txt')
    process.stdout.write(`fita: installing ${manifest.dmg} from ${source}\n`)
  } else {
    const release = tagFor(channel)
    version = release.tagName.replace(/^[a-z-]*v/u, '')
    if (requestedVersion !== undefined && requestedVersion !== version) {
      fail(`channel ${slug} resolves to ${version}; ${requestedVersion} was requested`)
    }
    const dmgAsset = release.assets.find(asset => asset.name.endsWith('.dmg'))
    if (dmgAsset === undefined) fail(`release ${release.tagName} has no DMG asset`)
    const sumsAsset = release.assets.find(asset => asset.name === 'SHA256SUMS.txt')
    dmg = join(work, dmgAsset.name)
    process.stdout.write(`fita: downloading ${dmgAsset.name} from ${release.tagName}\n`)
    download(`https://github.com/${registry.repository}/releases/download/${release.tagName}/${encodeURIComponent(dmgAsset.name)}`, dmg)
    if (sumsAsset !== undefined) {
      checksumSource = join(work, 'SHA256SUMS.txt')
      download(`https://github.com/${registry.repository}/releases/download/${release.tagName}/SHA256SUMS.txt`, checksumSource)
    }
  }

  if (checksumSource !== undefined) {
    const expected = readFileSync(checksumSource, 'utf8').split('\n').find(line => line.trim().endsWith(basename(dmg)))
    if (expected !== undefined) {
      const actual = run('shasum', ['-a', '256', dmg]).split(/\s+/u)[0]
      if (actual !== expected.trim().split(/\s+/u)[0]) fail(`checksum mismatch for ${basename(dmg)}`)
      process.stdout.write('fita: checksum verified\n')
    }
  }

  const mount = join(work, 'mnt')
  run('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-mountpoint', mount])
  try {
    const candidates = run('find', [mount, '-maxdepth', '1', '-name', '*.app']).split('\n').filter(Boolean)
    if (candidates.length !== 1) fail(`expected one app in the DMG, found ${candidates.length}`)
    const destination = installPath(channel)
    rmSync(destination, { recursive: true, force: true })
    run('mkdir', ['-p', dirname(destination)])
    run('ditto', [candidates[0], destination])
    run('xattr', ['-dr', 'com.apple.quarantine', destination])
    process.stdout.write(`fita: installed ${channel.appName} ${version} at ${destination}\n`)
  } finally {
    spawnSync('hdiutil', ['detach', mount, '-quiet'], { encoding: 'utf8' })
    rmSync(work, { recursive: true, force: true })
  }
}

function commandUse(slug) {
  const channel = channelFor(slug)
  const destination = installPath(channel)
  if (!existsSync(destination)) fail(`${channel.appName} is not installed; run: yarn fita install ${slug}`)
  run('open', ['-a', destination])
}

function commandUninstall(slug) {
  const channel = channelFor(slug)
  rmSync(installPath(channel), { recursive: true, force: true })
  process.stdout.write(`fita: removed ${channel.appName}\n`)
}

function main(argv) {
  const [command, ...rest] = argv
  const positional = rest.filter(argument => !argument.startsWith('--'))
  const flags = Object.fromEntries(
    rest.filter(argument => argument.startsWith('--')).map(argument => {
      const [key, value] = argument.replace(/^--/u, '').split('=')
      return [key, value ?? true]
    })
  )

  switch (command) {
    case 'list': return commandList()
    case 'status': return commandStatus()
    case 'install': {
      const slug = positional[0] ?? fail('install needs a channel slug')
      return commandInstall(slug, typeof flags.version === 'string' ? flags.version : undefined, typeof flags['from-dir'] === 'string' ? flags['from-dir'] : undefined)
    }
    case 'use': return commandUse(positional[0] ?? fail('use needs a channel slug'))
    case 'uninstall': return commandUninstall(positional[0] ?? fail('uninstall needs a channel slug'))
    default:
      writeFileSync(process.stderr.fd, 'usage: fita list|status|install <slug> [--version x]|use <slug>|uninstall <slug>\n')
      process.exit(1)
  }
}

main(process.argv.slice(2))
