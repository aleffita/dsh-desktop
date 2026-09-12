import { describe, expect, it } from 'vitest'
import {
  GITHUB_PACKAGES_REGISTRY,
  planPublish,
  type PublishCandidate,
} from '../src/fita-packages.ts'

function candidate(overrides: Partial<PublishCandidate> & { name: string }): PublishCandidate {
  return {
    version: '1.0.0',
    directory: 'somewhere',
    private: false,
    registry: GITHUB_PACKAGES_REGISTRY,
    ...overrides,
  }
}

describe('what this repository would publish', () => {
  it('says nothing when no package carries our scope', () => {
    const plan = planPublish([
      candidate({ name: 'dsh-plugin-desktop' }),
      candidate({ name: 'dsh-community-market', private: true }),
    ])
    expect(plan.status).toBe('nothing')
    if (plan.status !== 'nothing') return
    expect(plan.reason).toContain('@aleffita/')
  })

  it('publishes a scoped package that is public and points at GitHub Packages', () => {
    const plan = planPublish([
      candidate({ name: '@aleffita/dsh-planning', version: '0.1.0' }),
      candidate({ name: 'dsh-plugin-desktop' }),
    ])
    expect(plan.status).toBe('publish')
    if (plan.status !== 'publish') return
    expect(plan.packages.map(entry => entry.name)).toEqual(['@aleffita/dsh-planning'])
  })

  it('refuses a scoped package that still points at npm', () => {
    const plan = planPublish([
      candidate({ name: '@aleffita/x', registry: 'https://registry.npmjs.org' }),
    ])
    expect(plan.status).toBe('invalid')
    if (plan.status !== 'invalid') return
    expect(plan.problems[0]).toContain('npmjs.org')
  })

  it('refuses a scoped package that is private, and says so rather than skipping it', () => {
    const plan = planPublish([candidate({ name: '@aleffita/x', private: true })])
    expect(plan.status).toBe('invalid')
    if (plan.status !== 'invalid') return
    expect(plan.problems[0]).toContain('private')
  })

  it('reports every problem at once', () => {
    const plan = planPublish([
      candidate({ name: '@aleffita/a', private: true }),
      candidate({ name: '@aleffita/b', registry: 'https://registry.npmjs.org' }),
    ])
    expect(plan.status).toBe('invalid')
    if (plan.status !== 'invalid') return
    expect(plan.problems).toHaveLength(2)
  })
})
