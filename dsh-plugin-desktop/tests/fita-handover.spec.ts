import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runFitaHandoverLayer } from '../src/fita-handover.ts'
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
      request: { layer: 'payload', zipPath: join(root, 'a.zip'), appPath: join(root, 'DSH Fita Dev.app'), staging: join(root, 'staging') },
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
      request: { layer: 'payload', zipPath: join(root, 'a.zip'), appPath: join(root, 'DSH Fita Dev.app'), staging: join(root, 'staging') },
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
      request: { layer: 'full', dmgPath: join(root, 'a.dmg'), destination: join(root, 'Applications', 'DSH Fita Dev.app') },
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
      request: { layer: 'payload', zipPath: join(root, 'a.zip'), appPath: join(root, 'DSH Fita Dev.app'), staging: join(root, 'staging') },
      run,
      waitForExit: async () => {},
    })

    expect(outcome.status).toBe('applied-not-relaunched')
    expect(readFileSync(join(resources, 'app.asar'), 'utf8')).toBe('new')
  })
})
