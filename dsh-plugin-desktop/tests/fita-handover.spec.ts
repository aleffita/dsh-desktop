import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fitaHandoverArguments,
  parseFitaHandoverArguments,
  runFitaHandoverLayer,
  runFitaHandoverProcess,
  startFitaHandover,
  waitForProcessExit,
  type FitaHandoverRequest,
} from '../src/fita-handover.ts'
import type { FitaCommandResult } from '../src/fita-install.ts'

const roots: string[] = []
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'fita-handover-spec-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('layer-aware hand-over', () => {
  it('applies the payload layer and relaunches, waiting first', async () => {
    const root = scratch()
    const resources = join(root, 'DSH Fita Dev.app', 'Contents', 'Resources')
    mkdirSync(resources, { recursive: true })
    writeFileSync(join(resources, 'app.asar'), 'old')
    const order: string[] = []
    const run = (command: string, args: readonly string[]): FitaCommandResult => {
      if (command === 'ditto') {
        order.push('extract')
        const destination = args[args.length - 1] as string
        const extracted = join(destination, 'DSH Fita Dev.app', 'Contents', 'Resources')
        mkdirSync(extracted, { recursive: true })
        writeFileSync(join(extracted, 'app.asar'), 'new')
        return { status: 0 }
      }
      if (command === 'open') {
        order.push('open')
        return { status: 0 }
      }
      return { status: 0 }
    }

    const outcome = await runFitaHandoverLayer({
      request: { layer: 'payload', waitForPid: 4242, zipPath: join(root, 'a.zip'), appPath: join(root, 'DSH Fita Dev.app'), staging: join(root, 'staging') },
      run,
      waitForExit: async () => { order.push('wait') },
    })

    expect(outcome).toEqual({ layer: 'payload', status: 'applied', appPath: join(root, 'DSH Fita Dev.app') })
    expect(order).toEqual(['wait', 'extract', 'open'])
    expect(readFileSync(join(resources, 'app.asar'), 'utf8')).toBe('new')
    expect(existsSync(join(resources, 'app.asar.previous'))).toBe(true)
  })

  it('reports a payload failure without relaunching', async () => {
    const root = scratch()
    const resources = join(root, 'DSH Fita Dev.app', 'Contents', 'Resources')
    mkdirSync(resources, { recursive: true })
    writeFileSync(join(resources, 'app.asar'), 'old')
    const calls: string[] = []
    const run = (command: string): FitaCommandResult => {
      calls.push(command)
      return { status: command === 'ditto' ? 1 : 0 }
    }

    const outcome = await runFitaHandoverLayer({
      request: { layer: 'payload', waitForPid: 4242, zipPath: join(root, 'a.zip'), appPath: join(root, 'DSH Fita Dev.app'), staging: join(root, 'staging') },
      run,
      waitForExit: async () => {},
    })

    expect(outcome).toEqual({ layer: 'payload', status: 'failed', reason: 'extract' })
    expect(calls).not.toContain('open')
    expect(readFileSync(join(resources, 'app.asar'), 'utf8')).toBe('old')
  })

  it('runs the full layer for a DMG, waiting first', async () => {
    const root = scratch()
    const order: string[] = []
    const run = (command: string, args: readonly string[]): FitaCommandResult => {
      if (command === 'hdiutil' && args[0] === 'attach') {
        order.push('mount')
        const mount = args[args.indexOf('-mountpoint') + 1] as string
        mkdirSync(join(mount, 'DSH Fita Dev.app'), { recursive: true })
        return { status: 0 }
      }
      if (command === 'ditto') {
        order.push('copy')
        mkdirSync(args[1] as string, { recursive: true })
        return { status: 0 }
      }
      if (command === 'open') {
        order.push('open')
        return { status: 0 }
      }
      return { status: 0 }
    }

    const outcome = await runFitaHandoverLayer({
      request: { layer: 'full', waitForPid: 4242, dmgPath: join(root, 'a.dmg'), destination: join(root, 'Applications', 'DSH Fita Dev.app') },
      run,
      waitForExit: async () => { order.push('wait') },
    })

    expect(outcome.status).toBe('applied')
    expect(outcome.layer).toBe('full')
    expect(order).toEqual(['wait', 'mount', 'copy', 'open'])
  })

  it('distinguishes a build that was applied but could not be started', async () => {
    const root = scratch()
    const resources = join(root, 'DSH Fita Dev.app', 'Contents', 'Resources')
    mkdirSync(resources, { recursive: true })
    writeFileSync(join(resources, 'app.asar'), 'old')
    const run = (command: string, args: readonly string[]): FitaCommandResult => {
      if (command === 'ditto') {
        const extracted = join(args[args.length - 1] as string, 'DSH Fita Dev.app', 'Contents', 'Resources')
        mkdirSync(extracted, { recursive: true })
        writeFileSync(join(extracted, 'app.asar'), 'new')
        return { status: 0 }
      }
      return { status: command === 'open' ? 1 : 0 }
    }

    const outcome = await runFitaHandoverLayer({
      request: { layer: 'payload', waitForPid: 4242, zipPath: join(root, 'a.zip'), appPath: join(root, 'DSH Fita Dev.app'), staging: join(root, 'staging') },
      run,
      waitForExit: async () => {},
    })

    expect(outcome.status).toBe('applied-not-relaunched')
    expect(readFileSync(join(resources, 'app.asar'), 'utf8')).toBe('new')
  })
})

describe('starting a hand-over', () => {
  const payload: FitaHandoverRequest = {
    layer: 'payload',
    waitForPid: 4321,
    zipPath: '/cache/dev/a.zip',
    appPath: '/home/operator/Applications/DSH Fita Dev.app',
    staging: '/cache/dev/staging',
  }
  const full: FitaHandoverRequest = {
    layer: 'full',
    waitForPid: 4321,
    dmgPath: '/cache/dev/a.dmg',
    destination: '/home/operator/Applications/DSH Fita Dev.app',
  }

  it('renders arguments the parser reads back unchanged', () => {
    for (const request of [payload, full]) {
      expect(parseFitaHandoverArguments(['DSH Fita Dev', ...fitaHandoverArguments(request)]))
        .toEqual(request)
    }
  })

  it('starts the app itself, detached, with the request as arguments', () => {
    const calls: [string, readonly string[], unknown][] = []
    const args = startFitaHandover({
      request: payload,
      executable: '/Applications/DSH Fita Dev.app/Contents/MacOS/DSH Fita Dev',
      spawn: (command, spawned, options) => { calls.push([command, spawned, options]) },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toContain('DSH Fita Dev')
    expect(calls[0]?.[1]).toEqual(args)
    // Detached and silent: the child has to outlive this process and cannot hold its streams.
    expect(calls[0]?.[2]).toEqual({ detached: true, stdio: 'ignore' })
    expect(parseFitaHandoverArguments(['x', ...args])).toEqual(payload)
  })
})

describe('the pid a hand-over waits for', () => {
  const request: FitaHandoverRequest = {
    layer: 'full',
    waitForPid: 987,
    dmgPath: '/cache/dev/a.dmg',
    destination: '/home/operator/Applications/DSH Fita Dev.app',
  }

  it('travels with the request and comes back unchanged', () => {
    expect(parseFitaHandoverArguments(['x', ...fitaHandoverArguments(request)])).toEqual(request)
  })

  it('refuses a request with no usable pid', () => {
    const args = fitaHandoverArguments(request)
    // A hand-over cannot replace a bundle without knowing when it became free.
    expect(parseFitaHandoverArguments(args.filter(argument => !argument.startsWith('--dsh-fita-handover-wait-pid')))).toBeUndefined()
    expect(parseFitaHandoverArguments(args.map(argument => argument.startsWith('--dsh-fita-handover-wait-pid')
      ? '--dsh-fita-handover-wait-pid=nope'
      : argument))).toBeUndefined()
    expect(parseFitaHandoverArguments(args.map(argument => argument.startsWith('--dsh-fita-handover-wait-pid')
      ? '--dsh-fita-handover-wait-pid=0'
      : argument))).toBeUndefined()
    // The first occurrence wins when a flag repeats, the same convention as the rest of
    // the settings API arguments; the test states it rather than leaving it implicit.
    const repeated = [...args, '--dsh-fita-handover-wait-pid=1']
    expect(parseFitaHandoverArguments(repeated)?.waitForPid).toBe(987)
  })
})

describe('waiting for the app to exit', () => {
  it('resolves as soon as the process is gone, without waiting', async () => {
    const pause = vi.fn(async () => {})
    await waitForProcessExit({ pid: 1, isAlive: () => false, pause })
    expect(pause).not.toHaveBeenCalled()
  })

  it('probes until the process is gone', async () => {
    let alive = 3
    const pause = vi.fn(async () => { alive -= 1 })
    await waitForProcessExit({ pid: 42, isAlive: () => alive > 0, pause, intervalMs: 7 })
    expect(pause).toHaveBeenCalledTimes(3)
    expect(pause).toHaveBeenCalledWith(7)
  })

  it('asks the operating system by default, without affecting the process', async () => {
    // Our own pid is alive; a pid that cannot exist is not. Neither may be signalled.
    await expect(waitForProcessExit({ pid: process.pid + 1_000_000, intervalMs: 1 })).resolves.toBeUndefined()
  })
})

describe('running as the hand-over process', () => {
  it('waits, applies the layer and exits zero on success', async () => {
    const root = scratch()
    const resources = join(root, 'DSH Fita Dev.app', 'Contents', 'Resources')
    mkdirSync(resources, { recursive: true })
    writeFileSync(join(resources, 'app.asar'), 'old')
    const order: string[] = []
    const run = (command: string, args: readonly string[]): FitaCommandResult => {
      if (command === 'ditto') {
        order.push('extract')
        const extracted = join(args[args.length - 1] as string, 'DSH Fita Dev.app', 'Contents', 'Resources')
        mkdirSync(extracted, { recursive: true })
        writeFileSync(join(extracted, 'app.asar'), 'new')
        return { status: 0 }
      }
      if (command === 'open') order.push('open')
      return { status: 0 }
    }

    const outcome = await runFitaHandoverProcess({
      request: { layer: 'payload', waitForPid: 1, zipPath: join(root, 'a.zip'), appPath: join(root, 'DSH Fita Dev.app'), staging: join(root, 'staging') },
      run,
      waitForExit: async () => { order.push('wait') },
      exit: code => { order.push(`exit:${String(code)}`) },
    })

    expect(outcome.status).toBe('applied')
    expect(order).toEqual(['wait', 'extract', 'open', 'exit:0'])
  })

  it('exits non-zero when the layer failed, and says which reason', async () => {
    const root = scratch()
    const codes: number[] = []
    const outcome = await runFitaHandoverProcess({
      request: { layer: 'full', waitForPid: 1, dmgPath: join(root, 'a.dmg'), destination: join(root, 'Applications', 'DSH Fita Dev.app') },
      run: () => ({ status: 1 }),
      waitForExit: async () => {},
      exit: code => { codes.push(code) },
    })

    expect(outcome).toMatchObject({ layer: 'full', status: 'failed', reason: 'mount' })
    expect(codes).toEqual([1])
  })

  it('waits for the pid it was told to wait for by default', async () => {
    const root = scratch()
    const seen: number[] = []
    await runFitaHandoverProcess({
      request: { layer: 'full', waitForPid: 4_000_001, dmgPath: join(root, 'a.dmg'), destination: join(root, 'x.app') },
      run: () => ({ status: 1 }),
      waitForExit: async () => { seen.push(4_000_001) },
      exit: () => {},
    })
    expect(seen).toEqual([4_000_001])
  })
})
