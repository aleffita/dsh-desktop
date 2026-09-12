import { describe, expect, it } from 'vitest'
import { presentChannelApply, presentChannelCheck, presentChannelDownload } from '../src/client/DesktopFrameTitlebarView.tsx'
import { en, zh } from '../src/client/desktop-settings-locales.ts'

const dev = { slug: 'dev', name: 'Dev' }

describe('channel check presentation', () => {
  it('shows the newer version when the channel is ahead', () => {
    expect(presentChannelCheck({
      status: 'offer',
      channel: 'dev',
      version: '2.0.10-rc.1',
      newer: true,
      dmg: { name: 'a.dmg', url: 'https://example.test/a.dmg' },
      sums: null,
    })).toEqual({ severity: 'note', key: 'channelNewer', version: '2.0.10-rc.1' })
  })

  it('says a level channel has nothing newer, without inventing a version', () => {
    expect(presentChannelCheck({
      status: 'offer',
      channel: 'dev',
      version: '2.0.9',
      newer: false,
      dmg: null,
      sums: null,
    })).toEqual({ severity: 'note', key: 'channelUpToDate' })
  })

  it('distinguishes a channel that published nothing from a check that failed', () => {
    expect(presentChannelCheck({ status: 'none', channel: 'dev' }))
      .toEqual({ severity: 'note', key: 'channelNone' })
    for (const [reason, key] of [
      ['request', 'channelFailedRequest'],
      ['response', 'channelFailedResponse'],
      ['malformed', 'channelFailedMalformed'],
      ['unknown-channel', 'channelFailedUnknown'],
    ] as const) {
      expect(presentChannelCheck({ status: 'failed', channel: 'dev', reason }))
        .toEqual({ severity: 'error', key })
    }
  })

  it('has copy for every key it can produce, in both languages', () => {
    const outcomes = [
      presentChannelCheck({ status: 'none', channel: 'dev' }),
      presentChannelCheck({ status: 'failed', channel: 'dev', reason: 'request' }),
      presentChannelCheck({ status: 'failed', channel: 'dev', reason: 'response' }),
      presentChannelCheck({ status: 'failed', channel: 'dev', reason: 'malformed' }),
      presentChannelCheck({ status: 'failed', channel: 'dev', reason: 'unknown-channel' }),
      presentChannelCheck({ status: 'offer', channel: 'dev', version: '2.0.9', newer: false, dmg: null, sums: null }),
      presentChannelCheck({ status: 'offer', channel: 'dev', version: '2.0.10', newer: true, dmg: null, sums: null }),
    ]
    for (const outcome of outcomes) {
      expect(en[outcome.key]).toBeTruthy()
      expect(zh[outcome.key]).toBeTruthy()
    }
    // The channel label itself is rendered next to the version in the titlebar.
    expect(en.channelLabel).toBeTruthy()
    expect(zh.channelLabel).toBeTruthy()
    expect(en.channelUnknown).toBeTruthy()
    expect(dev.slug).toBe('dev')
  })
})

describe('prepared build presentation', () => {
  it('shows the path for a verified build, and for a stored one says what it is', () => {
    expect(presentChannelDownload({
      status: 'verified',
      version: '2.0.10-rc.1',
      name: 'a.dmg',
      path: '/cache/dev/a.dmg',
    })).toEqual({ severity: 'note', key: 'channelPreparedVerified', path: '/cache/dev/a.dmg' })
    expect(presentChannelDownload({
      status: 'stored',
      version: '2.0.10-rc.1',
      name: 'a.dmg',
      path: '/cache/dev/a.dmg',
    })).toEqual({ severity: 'note', key: 'channelPreparedStored', path: '/cache/dev/a.dmg' })
  })

  it('reports a failed preparation without a path', () => {
    expect(presentChannelDownload({ status: 'failed', channel: 'dev', reason: 'checksum-mismatch' }))
      .toEqual({ severity: 'error', key: 'channelPrepareFailed' })
  })

  it('has copy for the prepare action in both languages', () => {
    for (const key of ['channelPrepare', 'channelPreparing', 'channelPreparedVerified', 'channelPreparedStored', 'channelPrepareFailed'] as const) {
      expect(en[key]).toBeTruthy()
      expect(zh[key]).toBeTruthy()
    }
  })
})

describe('applied update presentation', () => {
  it('says which layer is being applied, and reports a refusal as a failure', () => {
    expect(presentChannelApply({ status: 'started', channel: 'dev', layer: 'payload' }))
      .toEqual({ severity: 'note', key: 'channelApplying' })
    expect(presentChannelApply({ status: 'started', channel: 'dev', layer: 'full' }))
      .toEqual({ severity: 'note', key: 'channelApplyingFull' })
    expect(presentChannelApply({ status: 'failed', channel: 'dev', reason: 'no-feed' }))
      .toEqual({ severity: 'error', key: 'channelApplyFailed' })
  })

  it('has copy for the apply action in both languages', () => {
    for (const key of ['channelApply', 'channelApplying', 'channelApplyingFull', 'channelApplyFailed'] as const) {
      expect(en[key]).toBeTruthy()
      expect(zh[key]).toBeTruthy()
    }
  })
})
