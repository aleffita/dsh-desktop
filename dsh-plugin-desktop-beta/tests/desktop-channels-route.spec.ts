import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { fitaChannel } from '../src/fita-channel.ts'
import {
  handleDesktopChannelCheckRequest,
  handleDesktopChannelsRequest,
} from '../src/desktop-settings-route.ts'
import type { FitaChannelCheck } from '../src/fita-release-source.ts'

const origin = 'http://127.0.0.1:43120'
const dev = fitaChannel('dev')!

function postRequest(payload: unknown): IncomingMessage {
  return {
    method: 'POST',
    headers: {
      host: '127.0.0.1:43120',
      origin,
      'content-type': 'application/json',
    },
    socket: { remoteAddress: '127.0.0.1' },
    async * [Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(payload))
    },
  } as unknown as IncomingMessage
}

function response(): { res: ServerResponse; body: () => unknown; status: () => number } {
  let text = ''
  const res = {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((value?: string) => { text = value ?? '' }),
  } as unknown as ServerResponse
  return {
    res,
    body: () => (text === '' ? undefined : JSON.parse(text)),
    status: () => (res as unknown as { statusCode: number }).statusCode,
  }
}

describe('channel catalogue route', () => {
  it('describes every channel and marks the running one', async () => {
    const { res, body, status } = response()
    await handleDesktopChannelsRequest(postRequest({}), res, origin, dev)
    const payload = body() as { current: string; channels: { slug: string; current: boolean; bundleId: string }[] }
    expect(status()).toBe(200)
    expect(payload.current).toBe('dev')
    expect(payload.channels.map(channel => channel.slug)).toEqual(['main', 'beta', 'dev', 'pr'])
    expect(payload.channels.filter(channel => channel.current).map(channel => channel.slug)).toEqual(['dev'])
    expect(payload.channels[0]?.bundleId).toBe('ai.deepseek.dsh.desktop')
  })

  it('reports a build with no stamp as belonging to no channel', async () => {
    const { res, body } = response()
    await handleDesktopChannelsRequest(postRequest({}), res, origin, undefined)
    expect((body() as { current: string | null }).current).toBeNull()
  })

  it('refuses a body that is not empty, another method, and another origin', async () => {
    const notEmpty = response()
    await handleDesktopChannelsRequest(postRequest({ channel: 'dev' }), notEmpty.res, origin, dev)
    expect(notEmpty.status()).toBe(400)

    const wrongMethod = response()
    await handleDesktopChannelsRequest(
      { method: 'GET', headers: {}, socket: {} } as unknown as IncomingMessage,
      wrongMethod.res,
      origin,
      dev,
    )
    expect(wrongMethod.status()).toBe(405)

    const crossOrigin = response()
    await handleDesktopChannelsRequest(
      {
        method: 'POST',
        headers: { host: '127.0.0.1:43120', origin: 'https://example.test', 'content-type': 'application/json' },
        socket: { remoteAddress: '127.0.0.1' },
        async * [Symbol.asyncIterator]() { yield Buffer.from('{}') },
      } as unknown as IncomingMessage,
      crossOrigin.res,
      origin,
      dev,
    )
    expect(crossOrigin.status()).toBe(403)
  })
})

describe('channel check route', () => {
  const offer: FitaChannelCheck = {
    status: 'offer',
    channel: dev,
    version: '2.0.10-rc.1',
    release: { tag_name: 'dev-v2.0.10-rc.1' },
    newer: true,
    dmg: { name: 'DSH-Fita-Dev-2.0.10-rc.1-universal.dmg', browser_download_url: 'https://example.test/dev.dmg' },
    sums: { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.test/SHA256SUMS.txt' },
  }

  it('projects an offer into the renderer-safe contract', async () => {
    const { res, body, status } = response()
    await handleDesktopChannelCheckRequest(postRequest({ channel: 'dev' }), res, origin, async () => offer)
    expect(status()).toBe(200)
    expect(body()).toEqual({
      status: 'offer',
      channel: 'dev',
      version: '2.0.10-rc.1',
      newer: true,
      dmg: { name: 'DSH-Fita-Dev-2.0.10-rc.1-universal.dmg', url: 'https://example.test/dev.dmg' },
      sums: { name: 'SHA256SUMS.txt', url: 'https://example.test/SHA256SUMS.txt' },
    })
  })

  it('passes none and failure through with their reason', async () => {
    const none = response()
    await handleDesktopChannelCheckRequest(postRequest({ channel: 'dev' }), none.res, origin, async () => ({ status: 'none', channel: dev }))
    expect(none.body()).toEqual({ status: 'none', channel: 'dev' })

    const failed = response()
    await handleDesktopChannelCheckRequest(
      postRequest({ channel: 'dev' }),
      failed.res,
      origin,
      async () => ({ status: 'failed', channel: dev, reason: 'malformed' }),
    )
    expect(failed.body()).toEqual({ status: 'failed', channel: 'dev', reason: 'malformed' })
  })

  it('answers an undeclared channel with a named failure instead of checking it', async () => {
    const check = vi.fn(async () => offer)
    const { res, body, status } = response()
    await handleDesktopChannelCheckRequest(postRequest({ channel: 'stable' }), res, origin, check)
    expect(status()).toBe(200)
    expect(body()).toEqual({ status: 'failed', channel: 'stable', reason: 'unknown-channel' })
    expect(check).not.toHaveBeenCalled()
  })

  it('rejects a malformed body before any channel work', async () => {
    const check = vi.fn(async () => offer)
    for (const payload of [{}, { channel: 7 }, []]) {
      const { res, status } = response()
      await handleDesktopChannelCheckRequest(postRequest(payload), res, origin, check)
      expect(status()).toBe(400)
    }
    expect(check).not.toHaveBeenCalled()
  })

  it('refuses another method and another origin', async () => {
    const check = vi.fn(async () => offer)
    const wrongMethod = response()
    await handleDesktopChannelCheckRequest(
      { method: 'GET', headers: {}, socket: {} } as unknown as IncomingMessage,
      wrongMethod.res,
      origin,
      check,
    )
    expect(wrongMethod.status()).toBe(405)

    const crossOrigin = response()
    await handleDesktopChannelCheckRequest(
      {
        method: 'POST',
        headers: { host: '127.0.0.1:43120', origin: 'https://example.test', 'content-type': 'application/json' },
        socket: { remoteAddress: '127.0.0.1' },
        async * [Symbol.asyncIterator]() { yield Buffer.from('{"channel":"dev"}') },
      } as unknown as IncomingMessage,
      crossOrigin.res,
      origin,
      check,
    )
    expect(crossOrigin.status()).toBe(403)
    expect(check).not.toHaveBeenCalled()
  })

  it('reports an unexpected check failure as a server error', async () => {
    const reportError = vi.fn()
    const { res, status } = response()
    await handleDesktopChannelCheckRequest(
      postRequest({ channel: 'dev' }),
      res,
      origin,
      async () => { throw new Error('boom') },
      reportError,
    )
    expect(status()).toBe(500)
    expect(reportError).toHaveBeenCalledWith('check a channel', expect.any(Error))
  })
})
