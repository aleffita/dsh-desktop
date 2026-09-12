import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  join(fileURLToPath(new URL('../../', import.meta.url)), '.github', 'workflows', 'desktop-release.yml'),
  'utf8',
)

describe('the release workflow ships channels, not one app', () => {
  it('maps every lane tag to its registry slug', () => {
    for (const [tag, slug] of [
      ['beta-v*', 'beta'],
      ['dev-v*', 'dev'],
      ['pr-*-v*', 'pr'],
      ['v*', 'main'],
    ] as const) {
      expect(workflow).toContain(`${tag}) slug=${slug}`)
    }
  })

  it('takes the channel from the registry rather than hard-coding it', () => {
    expect(workflow).toContain("fita/channels.yml")
    expect(workflow).toContain('artifactSlug')
    expect(workflow).toContain('prerelease')
  })

  it('packages the channel through the fork wrapper, which stamps identity and layers', () => {
    expect(workflow).toContain('yarn fita:package --channel ${{ steps.release.outputs.slug }}')
    // The former single-build path would produce neither the channel's identity nor the zip.
    expect(workflow).not.toContain('dist:mac-smoke')
  })

  it('collects what the channel manifest says was built, both layers included', () => {
    expect(workflow).toContain('fita-channel.json')
    expect(workflow).toContain('manifest.dmg')
    expect(workflow).toContain('manifest.zip')
    expect(workflow).toContain('manifest.feedFile')
    expect(workflow).toContain('SHA256SUMS.txt')
  })

  it('installs through the channel, not by dragging an app', () => {
    expect(workflow).toContain('yarn fita install ${SLUG}')
  })

  it('never publishes to npm', () => {
    expect(workflow).not.toContain('npm publish')
    expect(workflow).not.toContain('registry.npmjs.org')
    expect(workflow).not.toContain('NODE_AUTH_TOKEN')
  })

  it('marks a release pre-release exactly when the registry says so', () => {
    expect(workflow).toContain('if [[ "$PRERELEASE" == "true" ]]; then args+=(--prerelease); fi')
  })
})
