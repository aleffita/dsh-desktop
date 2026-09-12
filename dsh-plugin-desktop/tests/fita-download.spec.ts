import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fitaChannel } from '../src/fita-channel.ts'
import {
  downloadFitaArtifact,
  fitaChannelCacheDir,
  fitaChannelManifest,
} from '../src/fita-download.ts'

const dev = fitaChannel('dev')!
const beta = fitaChannel('beta')!
const body = new TextEncoder().encode('a build, honestly small')
const digest = createHash('sha256').update(body).digest('hex')

const roots: string[] = []
async function cacheRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fita-download-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function artifactResponse(): Response {
  return new Response(body, { status: 200, headers: { 'content-length': String(body.byteLength) } })
}

function requestFor(handlers: Record<string, () => Response | Promise<Response>>) {
  return async (url: string): Promise<Response> => {
    const handler = handlers[url]
    if (handler === undefined) throw new Error(`unexpected url ${url}`)
    return await handler()
  }
}

const dmgUrl = 'https://example.test/DSH-Fita-Dev-2.0.10.dmg'
const sumsUrl = 'https://example.test/SHA256SUMS.txt'

describe('installer manifest', () => {
  it('records the four facts the local installer reads', () => {
    expect(fitaChannelManifest(dev, '2.0.10-rc.1', 'a.dmg', 'ab'.repeat(32))).toEqual({
      channel: 'dev',
      version: '2.0.10-rc.1',
      dmg: 'a.dmg',
      dmgSha256: 'ab'.repeat(32),
    })
  })
})

describe('channel cache layout', () => {
  it('gives every channel its own directory', () => {
    expect(fitaChannelCacheDir('/cache', dev)).toBe('/cache/dev')
    expect(fitaChannelCacheDir('/cache', beta)).toBe('/cache/beta')
    expect(fitaChannelCacheDir('/cache', dev)).not.toBe(fitaChannelCacheDir('/cache', beta))
  })
})

describe('verified download', () => {
  it('keeps a verified file under its published name', async () => {
    const root = await cacheRoot()
    const result = await downloadFitaArtifact({
      channel: dev,
      version: '2.0.10-rc.1',
      cacheRoot: root,
      artifact: { name: 'DSH-Fita-Dev-2.0.10.dmg', url: dmgUrl },
      sums: { name: 'SHA256SUMS.txt', url: sumsUrl },
      request: requestFor({
        [sumsUrl]: () => new Response(`${digest}  DSH-Fita-Dev-2.0.10.dmg\n`),
        [dmgUrl]: () => artifactResponse(),
      }),
    })
    expect(result).toEqual({
      status: 'verified',
      path: join(root, 'dev', 'DSH-Fita-Dev-2.0.10.dmg'),
      name: 'DSH-Fita-Dev-2.0.10.dmg',
      sha256: digest,
    })
    if (result.status !== 'verified') return
    expect(await readFile(result.path)).toEqual(Buffer.from(body))
    expect((await readdir(join(root, 'dev'))).sort()).toEqual(['DSH-Fita-Dev-2.0.10.dmg', 'fita-channel.json'])
    // The directory is now installable by the local installer, which reads these four.
    expect(JSON.parse(await readFile(join(root, 'dev', 'fita-channel.json'), 'utf8'))).toEqual({
      channel: 'dev',
      version: '2.0.10-rc.1',
      dmg: 'DSH-Fita-Dev-2.0.10.dmg',
      dmgSha256: digest,
    })
  })

  it('refuses a file whose checksum does not match, and leaves nothing behind', async () => {
    const root = await cacheRoot()
    const result = await downloadFitaArtifact({
      channel: dev,
      version: '2.0.10-rc.1',
      cacheRoot: root,
      artifact: { name: 'DSH-Fita-Dev-2.0.10.dmg', url: dmgUrl },
      sums: { name: 'SHA256SUMS.txt', url: sumsUrl },
      request: requestFor({
        [sumsUrl]: () => new Response(`${'0'.repeat(64)}  DSH-Fita-Dev-2.0.10.dmg\n`),
        [dmgUrl]: () => artifactResponse(),
      }),
    })
    expect(result).toEqual({ status: 'failed', reason: 'checksum-mismatch' })
    expect(await readdir(join(root, 'dev'))).toEqual([])
  })

  it('refuses to install a file the release does not list', async () => {
    const root = await cacheRoot()
    const result = await downloadFitaArtifact({
      channel: dev,
      version: '2.0.10-rc.1',
      cacheRoot: root,
      artifact: { name: 'DSH-Fita-Dev-2.0.10.dmg', url: dmgUrl },
      sums: { name: 'SHA256SUMS.txt', url: sumsUrl },
      request: requestFor({ [sumsUrl]: () => new Response(`${digest}  something-else.dmg\n`) }),
    })
    expect(result).toEqual({ status: 'failed', reason: 'checksum-missing' })
  })

  it('names a download failure and a checksum-fetch failure apart', async () => {
    const root = await cacheRoot()
    const downloadFailed = await downloadFitaArtifact({
      channel: dev,
      version: '2.0.10-rc.1',
      cacheRoot: root,
      artifact: { name: 'a.dmg', url: dmgUrl },
      sums: null,
      request: async () => { throw new Error('offline') },
    })
    expect(downloadFailed).toEqual({ status: 'failed', reason: 'download' })

    const sumsUnavailable = await downloadFitaArtifact({
      channel: dev,
      version: '2.0.10-rc.1',
      cacheRoot: root,
      artifact: { name: 'a.dmg', url: dmgUrl },
      sums: { name: 'SHA256SUMS.txt', url: sumsUrl },
      request: requestFor({ [sumsUrl]: () => new Response('nope', { status: 404 }) }),
    })
    expect(sumsUnavailable).toEqual({ status: 'failed', reason: 'checksum-missing' })
  })

  it('refuses an HTTP failure and a name that would escape the cache', async () => {
    const root = await cacheRoot()
    const notFound = await downloadFitaArtifact({
      channel: dev,
      version: '2.0.10-rc.1',
      cacheRoot: root,
      artifact: { name: 'a.dmg', url: dmgUrl },
      sums: null,
      request: requestFor({ [dmgUrl]: () => new Response('missing', { status: 404 }) }),
    })
    expect(notFound).toEqual({ status: 'failed', reason: 'download' })

    const escaping = await downloadFitaArtifact({
      channel: dev,
      version: '2.0.10-rc.1',
      cacheRoot: root,
      artifact: { name: '../escaped.dmg', url: dmgUrl },
      sums: null,
      request: async () => artifactResponse(),
    })
    expect(escaping).toEqual({ status: 'failed', reason: 'io' })
  })

  it('refuses an artifact larger than the size bound before writing it', async () => {
    const root = await cacheRoot()
    const result = await downloadFitaArtifact({
      channel: dev,
      version: '2.0.10-rc.1',
      cacheRoot: root,
      artifact: { name: 'huge.dmg', url: dmgUrl },
      sums: null,
      request: requestFor({
        [dmgUrl]: () => new Response(body, {
          status: 200,
          headers: { 'content-length': String(5 * 1024 * 1024 * 1024) },
        }),
      }),
    })
    expect(result).toEqual({ status: 'failed', reason: 'too-large' })
  })

  it('never claims verification when the release published no checksums', async () => {
    // No sums asset means no verification is possible. What this function must never
    // do is call the result verified.
    const root = await cacheRoot()
    const result = await downloadFitaArtifact({
      channel: beta,
      version: '2.0.10-rc.1',
      cacheRoot: root,
      artifact: { name: 'beta.dmg', url: dmgUrl },
      sums: null,
      request: requestFor({ [dmgUrl]: () => artifactResponse() }),
    })
    expect(result.status).toBe('stored')
    if (result.status !== 'stored') return
    expect(result.sha256).toBe(digest)
    expect((await readdir(join(root, 'beta'))).sort()).toEqual(['beta.dmg', 'fita-channel.json'])
  })
})
