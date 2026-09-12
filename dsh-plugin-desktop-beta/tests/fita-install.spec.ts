import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fitaChannel } from '../src/fita-channel.ts'
import {
  FITA_HANDOVER_DESTINATION_FLAG,
  FITA_HANDOVER_DMG_FLAG,
  fitaInstallPath,
  installFitaPreparedBuild,
  parseFitaHandoverArguments,
  planFitaHandover,
  runFitaHandover,
  type FitaCommandResult,
} from '../src/fita-install.ts'

const roots: string[] = []
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'fita-install-spec-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A runner that answers like a DMG carrying one app, recording every call. */
function dmgRunner(appNames: readonly string[]): {
  run: (command: string, args: readonly string[]) => FitaCommandResult
  calls: [string, readonly string[]][]
} {
  const calls: [string, readonly string[]][] = []
  const run = (command: string, args: readonly string[]): FitaCommandResult => {
    calls.push([command, args])
    if (command === 'hdiutil' && args[0] === 'attach') {
      const mount = args[args.indexOf('-mountpoint') + 1] as string
      for (const name of appNames) mkdirSync(join(mount, name), { recursive: true })
      return { status: 0 }
    }
    if (command === 'ditto') {
      const destination = args[1] as string
      mkdirSync(destination, { recursive: true })
      writeFileSync(join(destination, 'binary'), 'x')
      return { status: 0 }
    }
    return { status: 0 }
  }
  return { run, calls }
}

describe('installing a prepared build', () => {
  it('mounts read-only, copies the app, clears quarantine and detaches', async () => {
    const root = scratch()
    const dmg = join(root, 'DSH-Fita-Dev-2.0.10.dmg')
    writeFileSync(dmg, 'dmg')
    const destination = join(root, 'Applications', 'DSH Fita Dev.app')
    const { run, calls } = dmgRunner(['DSH Fita Dev.app'])

    const result = await installFitaPreparedBuild({ dmgPath: dmg, destination, run })

    expect(result).toEqual({ status: 'installed', appPath: destination })
    expect(existsSync(join(destination, 'binary'))).toBe(true)
    const attach = calls.find(([, args]) => args[0] === 'attach')
    expect(attach?.[1]).toContain('-readonly')
    expect(attach?.[1]).toContain('-nobrowse')
    expect(calls).toContainEqual(['xattr', ['-dr', 'com.apple.quarantine', destination]])
    expect(calls.some(([command, args]) => command === 'hdiutil' && args[0] === 'detach')).toBe(true)
  })

  it('replaces an existing bundle with the prepared one', async () => {
    const root = scratch()
    const dmg = join(root, 'a.dmg')
    writeFileSync(dmg, 'dmg')
    const destination = join(root, 'Applications', 'DSH Fita Dev.app')
    mkdirSync(join(destination, 'old'), { recursive: true })
    const { run } = dmgRunner(['DSH Fita Dev.app'])

    const result = await installFitaPreparedBuild({ dmgPath: dmg, destination, run })

    expect(result.status).toBe('installed')
    expect(existsSync(join(destination, 'old'))).toBe(false)
    expect(existsSync(join(destination, 'binary'))).toBe(true)
  })

  it('names a mount failure and never copies anything', async () => {
    const root = scratch()
    const dmg = join(root, 'a.dmg')
    writeFileSync(dmg, 'dmg')
    const destination = join(root, 'Applications', 'DSH Fita Dev.app')
    const run = vi.fn((command: string): FitaCommandResult => ({ status: command === 'hdiutil' ? 1 : 0 }))

    const result = await installFitaPreparedBuild({ dmgPath: dmg, destination, run })

    expect(result).toEqual({ status: 'failed', reason: 'mount' })
    expect(existsSync(destination)).toBe(false)
  })

  it('refuses a DMG that does not carry exactly one app', async () => {
    const root = scratch()
    const dmg = join(root, 'a.dmg')
    writeFileSync(dmg, 'dmg')
    const destination = join(root, 'Applications', 'DSH Fita Dev.app')

    const none = await installFitaPreparedBuild({ dmgPath: dmg, destination, run: dmgRunner([]).run })
    expect(none).toEqual({ status: 'failed', reason: 'no-app' })

    const two = await installFitaPreparedBuild({
      dmgPath: dmg,
      destination,
      run: dmgRunner(['DSH Fita Dev.app', 'Something Else.app']).run,
    })
    expect(two).toEqual({ status: 'failed', reason: 'no-app' })
  })

  it('names a copy failure and a quarantine failure, and still detaches', async () => {
    const root = scratch()
    const dmg = join(root, 'a.dmg')
    writeFileSync(dmg, 'dmg')
    const destination = join(root, 'Applications', 'DSH Fita Dev.app')
    const base = dmgRunner(['DSH Fita Dev.app'])
    const run = (command: string, args: readonly string[]): FitaCommandResult =>
      command === 'ditto' ? { status: 1 } : base.run(command, args)

    const copy = await installFitaPreparedBuild({ dmgPath: dmg, destination, run })
    expect(copy).toEqual({ status: 'failed', reason: 'copy' })
    // The mount is released on the failure path too, through the same runner.
    expect(base.calls.some(([command, args]) => command === 'hdiutil' && args[0] === 'detach')).toBe(true)

    const quarantineBase = dmgRunner(['DSH Fita Dev.app'])
    const quarantine = await installFitaPreparedBuild({
      dmgPath: dmg,
      destination,
      run: (command, args) => command === 'xattr' ? { status: 1 } : quarantineBase.run(command, args),
    })
    // The app is unsigned, so a quarantine that cannot be cleared is not an install.
    expect(quarantine).toEqual({ status: 'failed', reason: 'quarantine' })
  })
})

describe('hand-over plan', () => {
  const dev = fitaChannel('dev')!
  const destination = fitaInstallPath(dev, '/home/operator')

  it('installs the running channel own build over its own bundle', () => {
    expect(planFitaHandover({
      runningChannel: dev,
      preparedChannel: 'dev',
      preparedPath: '/cache/dev/a.dmg',
      destination,
      home: '/home/operator',
    })).toEqual({ status: 'install', dmgPath: '/cache/dev/a.dmg', destination })
  })

  it('resolves the channel path from the registry, not from the caller', () => {
    expect(fitaInstallPath(dev, '/home/operator')).toBe('/home/operator/Applications/DSH Fita Dev.app')
    expect(fitaInstallPath(fitaChannel('beta')!, '/home/operator')).toBe('/home/operator/Applications/DSH Fita Beta.app')
  })

  it('refuses a build that belongs to another channel', () => {
    expect(planFitaHandover({
      runningChannel: dev,
      preparedChannel: 'beta',
      preparedPath: '/cache/beta/a.dmg',
      destination,
      home: '/home/operator',
    })).toEqual({ status: 'refused', reason: 'not-this-channel' })
  })

  it('refuses a build with no channel at all', () => {
    expect(planFitaHandover({
      runningChannel: undefined,
      preparedChannel: 'dev',
      preparedPath: '/cache/dev/a.dmg',
      destination,
      home: '/home/operator',
    })).toEqual({ status: 'refused', reason: 'unknown-channel' })
  })

  it('refuses to install outside the channel own path', () => {
    expect(planFitaHandover({
      runningChannel: dev,
      preparedChannel: 'dev',
      preparedPath: '/cache/dev/a.dmg',
      destination: '/Applications/DSH Fita Dev.app',
      home: '/home/operator',
    })).toEqual({ status: 'refused', reason: 'destination-mismatch' })
  })
})

describe('hand-over arguments', () => {
  it('reads both values in either form', () => {
    expect(parseFitaHandoverArguments([
      'DSH Fita Dev',
      `${FITA_HANDOVER_DMG_FLAG}=/cache/dev/a.dmg`,
      `${FITA_HANDOVER_DESTINATION_FLAG}=/home/operator/Applications/DSH Fita Dev.app`,
    ])).toEqual({
      dmgPath: '/cache/dev/a.dmg',
      destination: '/home/operator/Applications/DSH Fita Dev.app',
    })
    expect(parseFitaHandoverArguments([
      'DSH Fita Dev',
      FITA_HANDOVER_DMG_FLAG, '/cache/dev/a.dmg',
      FITA_HANDOVER_DESTINATION_FLAG, '/home/operator/Applications/DSH Fita Dev.app',
    ])).toEqual({
      dmgPath: '/cache/dev/a.dmg',
      destination: '/home/operator/Applications/DSH Fita Dev.app',
    })
  })

  it('is undefined for an ordinary launch', () => {
    expect(parseFitaHandoverArguments(['DSH Fita Dev', '--some-other-flag'])).toBeUndefined()
  })

  it('refuses a request missing either value', () => {
    expect(parseFitaHandoverArguments([`${FITA_HANDOVER_DMG_FLAG}=/a.dmg`])).toBeUndefined()
    expect(parseFitaHandoverArguments([`${FITA_HANDOVER_DESTINATION_FLAG}=/b.app`])).toBeUndefined()
  })

  it('treats an empty value as absent rather than as a path', () => {
    expect(parseFitaHandoverArguments([
      `${FITA_HANDOVER_DMG_FLAG}=`,
      `${FITA_HANDOVER_DESTINATION_FLAG}=/b.app`,
    ])).toBeUndefined()
    expect(parseFitaHandoverArguments([
      `${FITA_HANDOVER_DMG_FLAG}=/a.dmg`,
      `${FITA_HANDOVER_DESTINATION_FLAG}=`,
    ])).toBeUndefined()
    // A flag followed by another flag has no value.
    expect(parseFitaHandoverArguments([
      FITA_HANDOVER_DMG_FLAG, FITA_HANDOVER_DESTINATION_FLAG, '/b.app',
    ])).toBeUndefined()
  })
})

describe('running a hand-over', () => {
  function handoverFixture(openStatus = 0): {
    waitForExit: ReturnType<typeof vi.fn>
    run: (command: string, args: readonly string[]) => FitaCommandResult
    calls: [string, readonly string[]][]
  } {
    const base = dmgRunner(['DSH Fita Dev.app'])
    const calls: [string, readonly string[]][] = base.calls
    const run = (command: string, args: readonly string[]): FitaCommandResult => {
      if (command !== 'open') return base.run(command, args)
      calls.push([command, args])
      return { status: openStatus }
    }
    // The wait records itself in the same log, so the order can be asserted.
    const waitForExit = vi.fn(async () => { calls.push(['wait', []]) })
    return { waitForExit, run, calls }
  }

  it('waits for the running app before touching the bundle, then relaunches it', async () => {
    const root = scratch()
    const dmg = join(root, 'a.dmg')
    writeFileSync(dmg, 'dmg')
    const destination = join(root, 'Applications', 'DSH Fita Dev.app')
    const fixture = handoverFixture()

    const result = await runFitaHandover({
      dmgPath: dmg,
      destination,
      run: fixture.run,
      waitForExit: fixture.waitForExit,
    })

    expect(result).toEqual({ status: 'installed', appPath: destination })
    expect(fixture.waitForExit).toHaveBeenCalledTimes(1)
    // Nothing may be mounted before the owner of the bundle has exited.
    expect(fixture.calls[0]?.[0]).toBe('wait')
    expect(fixture.calls.find(([command]) => command === 'hdiutil')?.[1][0]).toBe('attach')
    expect(fixture.calls).toContainEqual(['open', ['-a', destination]])
  })

  it('reports an install failure and never relaunches', async () => {
    const root = scratch()
    const dmg = join(root, 'a.dmg')
    writeFileSync(dmg, 'dmg')
    const destination = join(root, 'Applications', 'DSH Fita Dev.app')
    const fixture = handoverFixture()
    const run = (command: string, args: readonly string[]): FitaCommandResult =>
      command === 'hdiutil' && args[0] === 'attach' ? { status: 1 } : fixture.run(command, args)

    const result = await runFitaHandover({
      dmgPath: dmg,
      destination,
      run,
      waitForExit: fixture.waitForExit,
    })

    expect(result).toEqual({ status: 'failed', reason: 'mount' })
    expect(fixture.calls.some(([command]) => command === 'open')).toBe(false)
  })

  it('distinguishes an installed build that could not be relaunched', async () => {
    const root = scratch()
    const dmg = join(root, 'a.dmg')
    writeFileSync(dmg, 'dmg')
    const destination = join(root, 'Applications', 'DSH Fita Dev.app')
    const fixture = handoverFixture(1)

    const result = await runFitaHandover({
      dmgPath: dmg,
      destination,
      run: fixture.run,
      waitForExit: fixture.waitForExit,
    })

    expect(result).toEqual({ status: 'installed-not-relaunched', appPath: destination })
  })
})
