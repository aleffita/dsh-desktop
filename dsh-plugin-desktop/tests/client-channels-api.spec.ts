import { describe, expect, it, vi } from 'vitest'
import {
  createDesktopSettingsApi,
  desktopSettingsPaths,
  parseDesktopChannelCheck,
  parseDesktopChannelApply,
  parseDesktopChannelDownload,
  parseDesktopChannelsResponse,
} from '../src/client/desktop-settings-api.ts'

const catalogue = {
  current: 'dev',
  channels: [
    {
      slug: 'main',
      name: 'Main',
      lane: 'master',
      tag: 'v*',
      feed: 'latest',
      appName: 'DSH Fita',
      bundleId: 'ai.deepseek.dsh.desktop',
      accent: '#1F6FEB',
      prerelease: false,
      installs: '~/Applications/DSH Fita.app',
      description: 'Upstream mirror.',
      current: false,
    },
    {
      slug: 'dev',
      name: 'Dev',
      lane: 'dev',
      tag: 'dev-v*',
      feed: 'dev',
      appName: 'DSH Fita Dev',
      bundleId: 'ai.deepseek.dsh.desktop.dev',
      accent: '#FF4D9D',
      prerelease: true,
      installs: '~/Applications/DSH Fita Dev.app',
      description: 'Our mainline.',
      current: true,
    },
  ],
}

function jsonFetcher(payload: unknown, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response(JSON.stringify(payload), { status }))
}

describe('channel catalogue parsing', () => {
  it('accepts a well-formed catalogue and freezes it', () => {
    const parsed = parseDesktopChannelsResponse(catalogue)
    expect(parsed.current).toBe('dev')
    expect(parsed.channels.map(channel => channel.slug)).toEqual(['main', 'dev'])
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  it('accepts a build that belongs to no channel', () => {
    expect(parseDesktopChannelsResponse({ current: null, channels: [] }).current).toBeNull()
  })

  it('refuses a catalogue the host would never send', () => {
    expect(() => parseDesktopChannelsResponse(null)).toThrow()
    expect(() => parseDesktopChannelsResponse({ current: 7, channels: [] })).toThrow()
    expect(() => parseDesktopChannelsResponse({ current: 'dev', channels: [{ slug: 'dev' }] })).toThrow()
    expect(() => parseDesktopChannelsResponse({ current: 'dev', channels: [{ ...catalogue.channels[1], current: 'yes' }] })).toThrow()
  })
})

describe('channel check parsing', () => {
  it('keeps an offer with its artifact names and URLs', () => {
    const parsed = parseDesktopChannelCheck({
      status: 'offer',
      channel: 'dev',
      version: '2.0.10-rc.1',
      newer: true,
      dmg: { name: 'a.dmg', url: 'https://example.test/a.dmg' },
      sums: { name: 'SHA256SUMS.txt', url: 'https://example.test/SHA256SUMS.txt' },
    })
    expect(parsed).toMatchObject({ status: 'offer', version: '2.0.10-rc.1', newer: true })
  })

  it('keeps a release without artifacts as an offer with nothing to download', () => {
    const parsed = parseDesktopChannelCheck({
      status: 'offer',
      channel: 'dev',
      version: '2.0.9',
      newer: false,
      dmg: null,
      sums: null,
    })
    expect(parsed).toMatchObject({ status: 'offer', dmg: null, sums: null })
  })

  it('keeps none and each named failure', () => {
    expect(parseDesktopChannelCheck({ status: 'none', channel: 'dev' })).toEqual({ status: 'none', channel: 'dev' })
    for (const reason of ['request', 'response', 'malformed', 'unknown-channel'] as const) {
      expect(parseDesktopChannelCheck({ status: 'failed', channel: 'dev', reason }))
        .toEqual({ status: 'failed', channel: 'dev', reason })
    }
  })

  it('refuses an unknown status, an unknown reason, and a broken artifact', () => {
    expect(() => parseDesktopChannelCheck({ status: 'maybe', channel: 'dev' })).toThrow()
    expect(() => parseDesktopChannelCheck({ status: 'failed', channel: 'dev', reason: 'aliens' })).toThrow()
    expect(() => parseDesktopChannelCheck({ status: 'offer', channel: 'dev', version: '2.0.9', newer: true, dmg: { name: 'a.dmg' }, sums: null })).toThrow()
  })
})

describe('channel client methods', () => {
  it('posts the catalogue request and returns the parsed channels', async () => {
    const fetcher = jsonFetcher(catalogue)
    const api = createDesktopSettingsApi(fetcher as never)
    const parsed = await api.channels()
    expect(parsed.current).toBe('dev')
    expect(fetcher).toHaveBeenCalledWith(desktopSettingsPaths.channels, expect.objectContaining({ method: 'POST' }))
  })

  it('posts the channel it was asked to check', async () => {
    const fetcher = jsonFetcher({ status: 'none', channel: 'beta' })
    const api = createDesktopSettingsApi(fetcher as never)
    await expect(api.checkChannel('beta')).resolves.toEqual({ status: 'none', channel: 'beta' })
    const body = (fetcher.mock.calls[0]?.[1] as RequestInit | undefined)?.body
    expect(body).toBe(JSON.stringify({ channel: 'beta' }))
  })

  it('surfaces a host refusal instead of inventing an answer', async () => {
    const api = createDesktopSettingsApi(jsonFetcher({ error: 'forbidden' }, 403) as never)
    await expect(api.channels()).rejects.toThrow(/403/u)
  })
})

describe('channel download parsing', () => {
  it('keeps what was proven: verified, stored, or a named failure', () => {
    expect(parseDesktopChannelDownload({
      status: 'verified',
      version: '2.0.10-rc.1',
      name: 'a.dmg',
      path: '/cache/dev/a.dmg',
    })).toEqual({ status: 'verified', version: '2.0.10-rc.1', name: 'a.dmg', path: '/cache/dev/a.dmg' })
    expect(parseDesktopChannelDownload({
      status: 'stored',
      version: '2.0.10-rc.1',
      name: 'a.dmg',
      path: '/cache/dev/a.dmg',
    })).toMatchObject({ status: 'stored' })
    for (const reason of ['checksum-mismatch', 'too-large', 'unknown-channel'] as const) {
      expect(parseDesktopChannelDownload({ status: 'failed', channel: 'dev', reason }))
        .toEqual({ status: 'failed', channel: 'dev', reason })
    }
  })

  it('refuses an unknown reason and a truncated success', () => {
    expect(() => parseDesktopChannelDownload({ status: 'failed', channel: 'dev', reason: 'aliens' })).toThrow()
    expect(() => parseDesktopChannelDownload({ status: 'verified', version: '2.0.9', name: 'a.dmg' })).toThrow()
    expect(() => parseDesktopChannelDownload({ status: 'downloaded' })).toThrow()
  })

  it('posts the channel it was asked to prepare', async () => {
    const fetcher = jsonFetcher({
      status: 'verified',
      version: '2.0.10-rc.1',
      name: 'a.dmg',
      path: '/cache/dev/a.dmg',
    })
    const api = createDesktopSettingsApi(fetcher as never)
    await expect(api.prepareChannel('dev')).resolves.toMatchObject({ status: 'verified' })
    expect(fetcher).toHaveBeenCalledWith(
      desktopSettingsPaths.channelDownload,
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

describe('channel apply parsing and call', () => {
  it('keeps the layer an applied update turned out to be', () => {
    expect(parseDesktopChannelApply({ status: 'started', channel: 'dev', layer: 'payload' }))
      .toEqual({ status: 'started', channel: 'dev', layer: 'payload' })
    expect(parseDesktopChannelApply({ status: 'started', channel: 'dev', layer: 'full' }))
      .toMatchObject({ layer: 'full' })
  })

  it('keeps each named failure', () => {
    for (const reason of ['no-feed', 'unverifiable', 'checksum-mismatch', 'io'] as const) {
      expect(parseDesktopChannelApply({ status: 'failed', channel: 'dev', reason }))
        .toEqual({ status: 'failed', channel: 'dev', reason })
    }
  })

  it('refuses an unknown layer, an unknown reason and a missing channel', () => {
    expect(() => parseDesktopChannelApply({ status: 'started', channel: 'dev', layer: 'delta' })).toThrow()
    expect(() => parseDesktopChannelApply({ status: 'failed', channel: 'dev', reason: 'aliens' })).toThrow()
    expect(() => parseDesktopChannelApply({ status: 'failed', reason: 'io' })).toThrow()
  })

  it('posts the channel it was asked to apply', async () => {
    const fetcher = jsonFetcher({ status: 'started', channel: 'dev', layer: 'payload' })
    const api = createDesktopSettingsApi(fetcher as never)
    await expect(api.applyChannel('dev')).resolves.toMatchObject({ status: 'started' })
    expect(fetcher).toHaveBeenCalledWith(desktopSettingsPaths.channelApply, expect.objectContaining({ method: 'POST' }))
  })
})
