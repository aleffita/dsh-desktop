import { describe, expect, it } from 'vitest'
import { fitaChannel } from '../src/fita-channel.ts'
import { fitaUpdateLayer, parseFitaFeed } from '../src/fita-feed.ts'

const dev = fitaChannel('dev')!
const beta = fitaChannel('beta')!

/** The dev channel's feed, copied from a real build. */
const devFeed = `version: 2.0.9
files:
  - url: DSH-Fita-Dev-2.0.9-universal.zip
    sha512: C6l5IaYNuNBLAWdYk8xY7cQe6N629tt9Mu877WCXSDm7R4dxYoK2vzpm3skEPwCrBNnYg95CrjuaURSrYEWTfQ==
    size: 269199071
  - url: DSH-Fita-Dev-2.0.9-universal.dmg
    sha512: ZNIQEG93P75AyG3ND/IefMF/pMMBVQ/KBr/thWpbDrESoojJJyOIJ3In/GJFtov3agd+6bl+E2FR+tDcH3VHLw==
    size: 278573399
path: DSH-Fita-Dev-2.0.9-universal.zip
sha512: C6l5IaYNuNBLAWdYk8xY7cQe6N629tt9Mu877WCXSDm7R4dxYoK2vzpm3skEPwCrBNnYg95CrjuaURSrYEWTfQ==
releaseDate: '2026-09-12T22:29:33.168Z'
`

describe('channel feed parsing', () => {
  it('reads the version, the path and every file from a real feed', () => {
    const feed = parseFitaFeed(devFeed)
    expect(feed?.version).toBe('2.0.9')
    expect(feed?.path).toBe('DSH-Fita-Dev-2.0.9-universal.zip')
    expect(feed?.files.map(file => file.url)).toEqual([
      'DSH-Fita-Dev-2.0.9-universal.zip',
      'DSH-Fita-Dev-2.0.9-universal.dmg',
    ])
    expect(feed?.files[0]?.size).toBe(269199071)
    expect(feed?.files[0]?.sha512?.startsWith('C6l5IaYN')).toBe(true)
  })

  it('refuses a document with no version or no files', () => {
    expect(parseFitaFeed('files:\n  - url: a.zip\n')).toBeNull()
    expect(parseFitaFeed('version: 2.0.9\nfiles: []\n')).toBeNull()
    expect(parseFitaFeed('')).toBeNull()
  })
})

describe('layer decision', () => {
  it('prefers the payload when the feed carries one', () => {
    const feed = parseFitaFeed(devFeed)!
    expect(fitaUpdateLayer(feed, dev)).toEqual({
      layer: 'payload',
      file: { url: 'DSH-Fita-Dev-2.0.9-universal.zip', sha512: feed.files[0]?.sha512, size: 269199071 },
    })
  })

  it('falls back to the full install when there is no payload', () => {
    const feed = parseFitaFeed(`version: 2.0.9
files:
  - url: DSH-Fita-Dev-2.0.9-universal.dmg
path: DSH-Fita-Dev-2.0.9-universal.dmg
`)!
    expect(fitaUpdateLayer(feed, dev).layer).toBe('full')
  })

  it('never chooses another channel build', () => {
    const feed = parseFitaFeed(devFeed)!
    expect(fitaUpdateLayer(feed, beta)).toEqual({ layer: 'none', reason: 'not-this-channel' })
  })

  it('reports none for a feed whose files are not this channel at all', () => {
    const feed = parseFitaFeed(`version: 2.0.9
files:
  - url: something-else.zip
`)!
    expect(fitaUpdateLayer(feed, dev)).toEqual({ layer: 'none', reason: 'not-this-channel' })
  })

  it('prefers the universal payload when a feed carries several', () => {
    const feed = parseFitaFeed(`version: 2.0.9
files:
  - url: DSH-Fita-Dev-2.0.9-arm64.zip
  - url: DSH-Fita-Dev-2.0.9-universal.zip
`)!
    const layer = fitaUpdateLayer(feed, dev)
    expect(layer.layer).toBe('payload')
    if (layer.layer !== 'payload') return
    expect(layer.file.url.endsWith('-universal.zip')).toBe(true)
  })
})
