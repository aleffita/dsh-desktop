import { describe, expect, it } from 'vitest'
import { fitaChannel } from '../src/fita-channel.ts'
import {
  fitaChannelAcceptsVersion,
  fitaChannelAvailability,
  fitaExpectedChecksum,
  fitaReleaseDmg,
  fitaReleaseSums,
  fitaReleaseVersion,
  fitaTagPattern,
  selectFitaRelease,
  type FitaRelease,
} from '../src/fita-release.ts'

const main = fitaChannel('main')!
const beta = fitaChannel('beta')!
const dev = fitaChannel('dev')!
const pr = fitaChannel('pr')!

function release(tag: string, names: readonly string[] = [], extra: Partial<FitaRelease> = {}): FitaRelease {
  return {
    tag_name: tag,
    assets: names.map(name => ({ name, browser_download_url: `https://example.test/${name}` })),
    ...extra,
  }
}

describe('channel tag patterns', () => {
  it('reads the version each lane puts in its tag', () => {
    expect(fitaReleaseVersion(main, 'v2.0.9')).toBe('2.0.9')
    expect(fitaReleaseVersion(beta, 'beta-v2.0.10-rc.2')).toBe('2.0.10-rc.2')
    expect(fitaReleaseVersion(dev, 'dev-v2.0.9')).toBe('2.0.9')
    expect(fitaReleaseVersion(pr, 'pr-42-v2.0.9')).toBe('2.0.9')
  })

  it('refuses another lane tag, and a tag that is not SemVer', () => {
    expect(fitaReleaseVersion(main, 'beta-v2.0.9')).toBeNull()
    expect(fitaReleaseVersion(beta, 'v2.0.9')).toBeNull()
    expect(fitaReleaseVersion(dev, 'dev-latest')).toBeNull()
    expect(fitaReleaseVersion(pr, 'pr-x-v2.0.9')).toBeNull()
    expect(fitaReleaseVersion(main, 'v2.0')).toBeNull()
  })

  it('anchors the pattern, so a prefix cannot masquerade as a match', () => {
    expect(fitaTagPattern(dev).test('xdev-v2.0.9')).toBe(false)
    expect(fitaTagPattern(dev).test('dev-v2.0.9-extra')).toBe(true)
  })
})

describe('what a channel may offer', () => {
  it('keeps prereleases out of the stable channel', () => {
    expect(fitaChannelAcceptsVersion(main, '2.0.9')).toBe(true)
    expect(fitaChannelAcceptsVersion(main, '2.0.10-rc.1')).toBe(false)
    expect(fitaChannelAcceptsVersion(beta, '2.0.10-rc.1')).toBe(true)
    expect(fitaChannelAcceptsVersion(dev, '2.0.10-rc.1')).toBe(true)
  })
})

describe('release selection', () => {
  const listing: readonly FitaRelease[] = [
    release('v2.0.8'),
    release('beta-v2.0.10-rc.1'),
    release('dev-v2.0.9'),
    release('dev-v2.0.10-rc.1'),
    release('pr-42-v2.0.9'),
    release('dev-v9.9.9', [], { draft: true }),
  ]

  it('picks the newest release of the requested channel only', () => {
    expect(selectFitaRelease(listing, dev)?.tag_name).toBe('dev-v2.0.10-rc.1')
    expect(selectFitaRelease(listing, main)?.tag_name).toBe('v2.0.8')
    expect(selectFitaRelease(listing, pr)?.tag_name).toBe('pr-42-v2.0.9')
  })

  it('never offers a draft', () => {
    // The only dev tag above 2.0.10-rc.1 is a draft; it must stay invisible.
    expect(selectFitaRelease([release('dev-v9.9.9', [], { draft: true }), release('dev-v2.0.9')], dev)?.tag_name)
      .toBe('dev-v2.0.9')
  })

  it('ignores prereleases when a stable channel is asked', () => {
    expect(selectFitaRelease([release('v2.0.10-rc.1'), release('v2.0.9')], main)?.tag_name).toBe('v2.0.9')
  })

  it('reports no release at all rather than an arbitrary one', () => {
    expect(selectFitaRelease([release('beta-v2.0.10-rc.1')], dev)).toBeUndefined()
    expect(selectFitaRelease([], dev)).toBeUndefined()
  })
})

describe('availability against the running build', () => {
  it('says when the channel is ahead, level, or behind', () => {
    const ahead = fitaChannelAvailability([release('dev-v2.0.10-rc.1')], dev, '2.0.9')
    expect(ahead?.version).toBe('2.0.10-rc.1')
    expect(ahead?.newer).toBe(true)

    const level = fitaChannelAvailability([release('dev-v2.0.9')], dev, '2.0.9')
    expect(level?.newer).toBe(false)

    const behind = fitaChannelAvailability([release('dev-v2.0.8')], dev, '2.0.9')
    expect(behind?.newer).toBe(false)
  })

  it('answers nothing when the channel has published nothing eligible', () => {
    expect(fitaChannelAvailability([release('beta-v2.0.10-rc.1')], dev, '2.0.9')).toBeUndefined()
  })
})

describe('release assets', () => {
  const devRelease = release('dev-v2.0.9', [
    'dev-mac.yml',
    'DSH-Fita-Dev-2.0.9-universal.dmg',
    'DSH-Fita-Dev-2.0.9-universal.dmg.blockmap',
    'SHA256SUMS.txt',
  ])

  it('finds the DMG that carries the channel and the version', () => {
    expect(fitaReleaseDmg(devRelease, dev, '2.0.9')?.name).toBe('DSH-Fita-Dev-2.0.9-universal.dmg')
    expect(fitaReleaseDmg(devRelease, dev, '2.0.10')).toBeUndefined()
    expect(fitaReleaseDmg(devRelease, beta, '2.0.9')).toBeUndefined()
  })

  it('prefers the universal build when a release carries several', () => {
    const many = release('dev-v2.0.9', [
      'DSH-Fita-Dev-2.0.9-arm64.dmg',
      'DSH-Fita-Dev-2.0.9-universal.dmg',
    ])
    expect(fitaReleaseDmg(many, dev, '2.0.9')?.name).toBe('DSH-Fita-Dev-2.0.9-universal.dmg')
  })

  it('finds the checksum file, and reads one file out of it', () => {
    expect(fitaReleaseSums(devRelease)?.name).toBe('SHA256SUMS.txt')
    expect(fitaReleaseSums(release('dev-v2.0.9'))).toBeUndefined()

    const digest = 'a'.repeat(64)
    const sums = [
      'not a checksum line',
      `${digest}  DSH-Fita-Dev-2.0.9-universal.dmg`,
      `${'b'.repeat(64)} *DSH-Fita-Dev-2.0.9-arm64.dmg`,
    ].join('\n')
    expect(fitaExpectedChecksum(sums, 'DSH-Fita-Dev-2.0.9-universal.dmg')).toBe(digest)
    expect(fitaExpectedChecksum(sums, 'DSH-Fita-Dev-2.0.9-arm64.dmg')).toBe('b'.repeat(64))
    expect(fitaExpectedChecksum(sums, 'DSH-Fita-Dev-2.0.8-universal.dmg')).toBeUndefined()
  })
})
