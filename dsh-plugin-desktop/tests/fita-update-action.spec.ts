import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fitaChannel } from '../src/fita-channel.ts'
import { parseFitaHandoverArguments } from '../src/fita-handover.ts'
import { startFitaUpdate } from '../src/fita-update-action.ts'
import type { FitaChosenLayer } from '../src/fita-feed.ts'

const dev = fitaChannel('dev')!
const body = new TextEncoder().encode('a payload')
const sha512 = createHash('sha512').update(body).digest('base64')

const roots: string[] = []
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'fita-action-spec-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function options(root: string, layer: FitaChosenLayer, overrides: Partial<Parameters<typeof startFitaUpdate>[0]> = {}) {
  return {
    channel: dev,
    layer,
    version: '2.0.10-rc.1',
    appPath: join(root, 'Applications', 'DSH Fita Dev.app'),
    executable: '/Applications/DSH Fita Dev.app/Contents/MacOS/DSH Fita Dev',
    cacheRoot: join(root, 'cache'),
    staging: join(root, 'cache', 'dev', 'staging'),
    artifactUrl: 'https://example.test/DSH-Fita-Dev-2.0.10-rc.1-universal.zip',
    request: async () => new Response(body, { status: 200, headers: { 'content-length': String(body.byteLength) } }),
    spawn: vi.fn(),
    currentPid: 4321,
    ...overrides,
  }
}

const payload: FitaChosenLayer = {
  layer: 'payload',
  file: { url: 'DSH-Fita-Dev-2.0.10-rc.1-universal.zip', sha512, size: body.byteLength },
}
const full: FitaChosenLayer = {
  layer: 'full',
  file: { url: 'DSH-Fita-Dev-2.0.10-rc.1-universal.dmg', sha512, size: body.byteLength },
}

describe('starting an update from the chosen layer', () => {
  it('downloads the payload and hands over the payload request', async () => {
    const root = scratch()
    const spawn = vi.fn()
    const outcome = await startFitaUpdate(options(root, payload, { spawn }))

    expect(outcome).toMatchObject({ status: 'started', layer: 'payload' })
    expect(spawn).toHaveBeenCalledTimes(1)
    const [, args] = spawn.mock.calls[0] as [string, string[]]
    expect(parseFitaHandoverArguments(['x', ...args])).toEqual({
      layer: 'payload',
      waitForPid: 4321,
      zipPath: join(root, 'cache', 'dev', 'DSH-Fita-Dev-2.0.10-rc.1-universal.zip'),
      appPath: join(root, 'Applications', 'DSH Fita Dev.app'),
      staging: join(root, 'cache', 'dev', 'staging'),
    })
  })

  it('hands over the full request for the full layer', async () => {
    const root = scratch()
    const spawn = vi.fn()
    const outcome = await startFitaUpdate(options(root, full, {
      spawn,
      artifactUrl: 'https://example.test/DSH-Fita-Dev-2.0.10-rc.1-universal.dmg',
    }))

    expect(outcome).toMatchObject({ status: 'started', layer: 'full' })
    const [, args] = spawn.mock.calls[0] as [string, string[]]
    expect(parseFitaHandoverArguments(['x', ...args])).toMatchObject({
      layer: 'full',
      waitForPid: 4321,
      destination: join(root, 'Applications', 'DSH Fita Dev.app'),
    })
  })

  it('refuses a file the feed does not let it verify, and starts nothing', async () => {
    const root = scratch()
    const spawn = vi.fn()
    const outcome = await startFitaUpdate(options(root, { layer: 'payload', file: { url: 'a.zip' } }, { spawn }))

    expect(outcome).toEqual({ status: 'failed', reason: 'unverifiable' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('starts nothing when the digest does not match', async () => {
    const root = scratch()
    const spawn = vi.fn()
    const outcome = await startFitaUpdate(options(root, {
      layer: 'payload',
      file: { url: 'a.zip', sha512: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
    }, { spawn }))

    expect(outcome).toEqual({ status: 'failed', reason: 'checksum-mismatch' })
    expect(spawn).not.toHaveBeenCalled()
    expect(readdirSync(join(root, 'cache', 'dev'))).toEqual([])
  })

  it('starts nothing when the download fails', async () => {
    const root = scratch()
    const spawn = vi.fn()
    const outcome = await startFitaUpdate(options(root, payload, {
      spawn,
      request: async () => { throw new Error('offline') },
    }))

    expect(outcome).toEqual({ status: 'failed', reason: 'download' })
    expect(spawn).not.toHaveBeenCalled()
  })
})
