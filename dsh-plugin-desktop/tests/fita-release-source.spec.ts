import { describe, expect, it } from 'vitest'
import { fitaChannel } from '../src/fita-channel.ts'
import {
  checkFitaChannelReleases,
  fitaReleasesEndpoint,
  MAX_RELEASES_RESPONSE_BYTES,
  parseFitaReleases,
  readFitaChannelFeed,
} from '../src/fita-release-source.ts'

const dev = fitaChannel('dev')!
const beta = fitaChannel('beta')!

const listing = [
  {
    tag_name: 'dev-v2.0.10-rc.1',
    draft: false,
    prerelease: true,
    assets: [
      { name: 'dev-mac.yml', browser_download_url: 'https://example.test/dev-mac.yml', size: 361 },
      { name: 'DSH-Fita-Dev-2.0.10-rc.1-universal.dmg', browser_download_url: 'https://example.test/dev.dmg', size: 278583798 },
      { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.test/SHA256SUMS.txt', size: 300 },
      { name: 'dev-mac.yml', browser_download_url: 'https://example.test/dev-mac.yml', size: 512 },
    ],
  },
  { tag_name: 'beta-v2.0.10-rc.1', draft: false, prerelease: true, assets: [] },
  { tag_name: 'dev-v9.9.9', draft: true, prerelease: false, assets: [] },
]

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

describe('release endpoint', () => {
  it('reads the repository the registry names', () => {
    expect(fitaReleasesEndpoint()).toBe('https://api.github.com/repos/aleffita/dsh-desktop/releases?per_page=100')
    expect(fitaReleasesEndpoint('other/fork')).toContain('/repos/other/fork/releases')
  })
})

describe('listing parsing', () => {
  it('keeps usable entries and drops the rest', () => {
    const parsed = parseFitaReleases([
      ...listing,
      { no_tag: true },
      null,
      { tag_name: 'v2.0.9', assets: [{ name: 'x.dmg' }, { name: 'y.dmg', browser_download_url: 'https://example.test/y.dmg' }] },
    ])
    expect(parsed?.map(release => release.tag_name)).toEqual([
      'dev-v2.0.10-rc.1',
      'beta-v2.0.10-rc.1',
      'dev-v9.9.9',
      'v2.0.9',
    ])
    expect(parsed?.[0]?.assets).toHaveLength(4)
    expect(parsed?.[2]?.draft).toBe(true)
    // An asset without a download URL cannot be fetched, so it is not offered.
    expect(parsed?.[3]?.assets).toEqual([{ name: 'y.dmg', browser_download_url: 'https://example.test/y.dmg' }])
  })

  it('rejects a payload that is not a release array', () => {
    expect(parseFitaReleases({ message: 'Not Found' })).toBeNull()
    expect(parseFitaReleases('nope')).toBeNull()
  })
})

describe('channel check', () => {
  it('offers the download and its checksum for a newer release of this channel', async () => {
    const result = await checkFitaChannelReleases({
      channel: dev,
      currentVersion: '2.0.9',
      request: async () => jsonResponse(listing),
    })
    expect(result.status).toBe('offer')
    if (result.status !== 'offer') return
    expect(result.version).toBe('2.0.10-rc.1')
    expect(result.newer).toBe(true)
    expect(result.dmg?.name).toBe('DSH-Fita-Dev-2.0.10-rc.1-universal.dmg')
    expect(result.sums?.name).toBe('SHA256SUMS.txt')
    expect(result.feed?.name).toBe('dev-mac.yml')
  })

  it('reports a channel that is level with the running build without calling it an update', async () => {
    const result = await checkFitaChannelReleases({
      channel: dev,
      currentVersion: '2.0.10-rc.1',
      request: async () => jsonResponse(listing),
    })
    expect(result.status).toBe('offer')
    if (result.status !== 'offer') return
    expect(result.newer).toBe(false)
  })

  it('says none when the channel has published nothing eligible', async () => {
    const result = await checkFitaChannelReleases({
      channel: dev,
      currentVersion: '2.0.9',
      request: async () => jsonResponse([listing[1]]),
    })
    expect(result.status).toBe('none')
  })

  it('names each failure instead of reporting up-to-date', async () => {
    const unreachable = await checkFitaChannelReleases({
      channel: beta,
      currentVersion: '2.0.9',
      request: async () => { throw new Error('offline') },
    })
    expect(unreachable).toEqual({ status: 'failed', channel: beta, reason: 'request' })

    const missing = await checkFitaChannelReleases({
      channel: beta,
      currentVersion: '2.0.9',
      request: async () => jsonResponse({ message: 'Not Found' }, 404),
    })
    expect(missing).toEqual({ status: 'failed', channel: beta, reason: 'response' })

    const notJson = await checkFitaChannelReleases({
      channel: beta,
      currentVersion: '2.0.9',
      request: async () => new Response('<html>rate limited</html>', { status: 200 }),
    })
    expect(notJson).toEqual({ status: 'failed', channel: beta, reason: 'malformed' })

    const wrongShape = await checkFitaChannelReleases({
      channel: beta,
      currentVersion: '2.0.9',
      request: async () => jsonResponse({ message: 'Not Found' }),
    })
    expect(wrongShape).toEqual({ status: 'failed', channel: beta, reason: 'malformed' })
  })

  it('refuses a body larger than the sanity bound', async () => {
    const oversized = await checkFitaChannelReleases({
      channel: beta,
      currentVersion: '2.0.9',
      request: async () => new Response('x'.repeat(MAX_RELEASES_RESPONSE_BYTES + 1), { status: 200 }),
    })
    expect(oversized).toEqual({ status: 'failed', channel: beta, reason: 'response' })
  })
})

describe('reading a channel feed', () => {
  const feedText = `version: 2.0.10-rc.1
files:
  - url: DSH-Fita-Dev-2.0.10-rc.1-universal.zip
    sha512: zzz
  - url: DSH-Fita-Dev-2.0.10-rc.1-universal.dmg
    sha512: yyy
path: DSH-Fita-Dev-2.0.10-rc.1-universal.zip
`

  it('answers the payload layer when the feed offers one', async () => {
    const layer = await readFitaChannelFeed({
      url: 'https://example.test/dev-mac.yml',
      channel: dev,
      request: async () => new Response(feedText, { status: 200 }),
    })
    expect(layer?.layer).toBe('payload')
    if (layer?.layer !== 'payload') return
    expect(layer.file.url).toBe('DSH-Fita-Dev-2.0.10-rc.1-universal.zip')
  })

  it('falls back to the full layer when the feed carries no payload', async () => {
    const layer = await readFitaChannelFeed({
      url: 'https://example.test/dev-mac.yml',
      channel: dev,
      request: async () => new Response(`version: 2.0.10-rc.1
files:
  - url: DSH-Fita-Dev-2.0.10-rc.1-universal.dmg
`, { status: 200 }),
    })
    expect(layer?.layer).toBe('full')
  })

  it('answers nothing rather than guessing when it cannot read the feed', async () => {
    const cases = [
      async () => { throw new Error('offline') },
      async () => new Response('nope', { status: 404 }),
      async () => new Response('not a feed', { status: 200 }),
      async () => new Response(`version: 2.0.10
files:
  - url: another-channel.zip
`, { status: 200 }),
    ]
    for (const request of cases) {
      await expect(readFitaChannelFeed({ url: 'https://example.test/dev-mac.yml', channel: dev, request }))
        .resolves.toBeUndefined()
    }
  })
})
