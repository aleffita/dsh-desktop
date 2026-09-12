import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyFitaPayload, commitFitaPayload, rollbackFitaPayload } from '../src/fita-payload.ts'
import type { FitaCommandResult } from '../src/fita-install.ts'

const roots: string[] = []
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'fita-payload-spec-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A bundle with the given payload contents. */
function bundle(root: string, asar: string, unpacked = 'native'): { appPath: string; resources: string } {
  const appPath = join(root, 'DSH Fita Dev.app')
  const resources = join(appPath, 'Contents', 'Resources')
  mkdirSync(resources, { recursive: true })
  writeFileSync(join(resources, 'app.asar'), asar)
  if (unpacked !== '') writeFileSync(join(resources, 'app.asar.unpacked'), unpacked)
  writeFileSync(join(resources, 'electron.asar'), 'runtime')
  return { appPath, resources }
}

/** A runner that "extracts" by laying down the app a zip would carry. */
function extractRunner(payload: { asar?: string; unpacked?: string }, status = 0) {
  return (command: string, args: readonly string[]): FitaCommandResult => {
    if (command !== 'ditto') return { status: 0 }
    if (status !== 0) return { status }
    const destination = args[args.length - 1] as string
    const resources = join(destination, 'DSH Fita Dev.app', 'Contents', 'Resources')
    mkdirSync(resources, { recursive: true })
    if (payload.asar !== undefined) writeFileSync(join(resources, 'app.asar'), payload.asar)
    if (payload.unpacked !== undefined) writeFileSync(join(resources, 'app.asar.unpacked'), payload.unpacked)
    return { status: 0 }
  }
}

describe('applying a payload', () => {
  it('replaces the code payload and keeps the previous one', async () => {
    const root = scratch()
    const { appPath, resources } = bundle(root, 'old')
    const result = await applyFitaPayload({
      zipPath: join(root, 'a.zip'),
      appPath,
      staging: join(root, 'staging'),
      run: extractRunner({ asar: 'new', unpacked: 'new-native' }),
    })

    expect(result).toEqual({ status: 'applied', appPath })
    expect(readFileSync(join(resources, 'app.asar'), 'utf8')).toBe('new')
    expect(readFileSync(join(resources, 'app.asar.unpacked'), 'utf8')).toBe('new-native')
    expect(readFileSync(join(resources, 'app.asar.previous'), 'utf8')).toBe('old')
    // The runtime is not part of the payload and must not be touched.
    expect(readFileSync(join(resources, 'electron.asar'), 'utf8')).toBe('runtime')
  })

  it('changes nothing when the extraction fails', async () => {
    const root = scratch()
    const { appPath, resources } = bundle(root, 'old')
    const result = await applyFitaPayload({
      zipPath: join(root, 'a.zip'),
      appPath,
      staging: join(root, 'staging'),
      run: extractRunner({ asar: 'new' }, 1),
    })

    expect(result).toEqual({ status: 'failed', reason: 'extract' })
    expect(readFileSync(join(resources, 'app.asar'), 'utf8')).toBe('old')
    expect(existsSync(join(resources, 'app.asar.previous'))).toBe(false)
  })

  it('refuses an extraction that carries no app.asar', async () => {
    const root = scratch()
    const { appPath, resources } = bundle(root, 'old')
    const result = await applyFitaPayload({
      zipPath: join(root, 'a.zip'),
      appPath,
      staging: join(root, 'staging'),
      run: extractRunner({ unpacked: 'native' }),
    })

    expect(result).toEqual({ status: 'failed', reason: 'missing-payload' })
    expect(readFileSync(join(resources, 'app.asar'), 'utf8')).toBe('old')
  })

  it('restores the previous payload on rollback and drops it on commit', async () => {
    const root = scratch()
    const { appPath, resources } = bundle(root, 'old')
    await applyFitaPayload({
      zipPath: join(root, 'a.zip'),
      appPath,
      staging: join(root, 'staging'),
      run: extractRunner({ asar: 'new' }),
    })

    expect(rollbackFitaPayload(appPath)).toBe(true)
    expect(readFileSync(join(resources, 'app.asar'), 'utf8')).toBe('old')
    expect(existsSync(join(resources, 'app.asar.previous'))).toBe(false)

    await applyFitaPayload({
      zipPath: join(root, 'a.zip'),
      appPath,
      staging: join(root, 'staging'),
      run: extractRunner({ asar: 'newer' }),
    })
    commitFitaPayload(appPath)
    expect(readFileSync(join(resources, 'app.asar'), 'utf8')).toBe('newer')
    expect(existsSync(join(resources, 'app.asar.previous'))).toBe(false)
  })

  it('reports nothing to roll back when there is no previous payload', () => {
    const root = scratch()
    const { appPath } = bundle(root, 'only')
    expect(rollbackFitaPayload(appPath)).toBe(false)
  })
})
