import { describe, expect, it } from 'vitest'
import {
  FITA_APPLICATION,
  FITA_CHANNELS,
  fitaChannel,
  readFitaBuildIdentity,
  runningFitaChannel,
} from '../src/fita-channel.ts'

describe('Fita channel registry', () => {
  it('declares every installable lane exactly once', () => {
    const slugs = FITA_CHANNELS.map(channel => channel.slug)
    expect(slugs).toEqual(['main', 'beta', 'dev', 'pr'])
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('declares one application identity, shared by every lane', () => {
    expect(FITA_APPLICATION.bundleId).toBe('dev.aleffita.dsh-harness')
    expect(FITA_APPLICATION.appName).toBe('DSH Harness')
    expect(FITA_APPLICATION.installs.endsWith('.app')).toBe(true)
  })

  it('gives every lane its own release stream, so releases cannot collide', () => {
    // A lane no longer owns an install; it owns how its build is found and fetched.
    for (const field of ['artifactSlug', 'tag', 'feed'] as const) {
      const values = FITA_CHANNELS.map(channel => channel[field])
      expect(new Set(values).size, `${field} is not unique`).toBe(values.length)
    }
  })

  it('keeps the fields the pipeline depends on well formed', () => {
    for (const channel of FITA_CHANNELS) {
      expect(channel.slug).toMatch(/^[a-z][a-z0-9]*$/u)
      expect(channel.tag).not.toBe('')
      expect(channel.lane).not.toBe('')
      expect(channel.feed).not.toBe('')
      expect(channel.accent).toMatch(/^#[0-9A-F]{6}$/u)
      expect(channel.onAccent).toMatch(/^#[0-9A-F]{6}$/u)
      expect(channel.artifactSlug.startsWith('DSH-')).toBe(true)
      expect(channel.description).not.toBe('')
    }
  })
})

describe('channel lookup', () => {
  it('finds a declared channel by slug', () => {
    expect(fitaChannel('dev')?.name).toBe('Dev')
  })

  it('reports an undeclared slug as absent rather than inventing one', () => {
    expect(fitaChannel('stable')).toBeUndefined()
    expect(fitaChannel('')).toBeUndefined()
  })
})

describe('running build identity', () => {
  it('reads the stamp fita:package writes', () => {
    // Exactly what the dev build carries inside app.asar/package.json.
    expect(readFitaBuildIdentity({ fitaProduct: 'DSH Fita', fitaChannel: 'dev', fitaFeed: 'dev' }))
      .toEqual({ channel: 'dev', product: 'DSH Fita', feed: 'dev' })
  })

  it('reports an unstamped build as unknown', () => {
    expect(readFitaBuildIdentity({ name: 'dsh-plugin-desktop', version: '2.0.9' })).toBeUndefined()
    expect(readFitaBuildIdentity(undefined)).toBeUndefined()
    expect(readFitaBuildIdentity(null)).toBeUndefined()
    expect(readFitaBuildIdentity({ fitaChannel: '' })).toBeUndefined()
    expect(readFitaBuildIdentity({ fitaChannel: 7 })).toBeUndefined()
  })

  it('tolerates a stamp that carries only the channel', () => {
    expect(readFitaBuildIdentity({ fitaChannel: 'beta' })).toEqual({ channel: 'beta' })
  })

  it('resolves the stamped channel to its registry entry', () => {
    const channel = runningFitaChannel({ fitaChannel: 'beta' })
    expect(channel?.slug).toBe('beta')
    expect(channel?.artifactSlug).toBe('DSH-Fita-Beta')
  })

  it('refuses to guess a channel the registry does not declare', () => {
    // A build stamped by something else must not be offered another channel's release.
    expect(runningFitaChannel({ fitaChannel: 'stable' })).toBeUndefined()
    expect(runningFitaChannel({ name: 'dsh-plugin-desktop' })).toBeUndefined()
  })
})
