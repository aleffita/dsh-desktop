import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(fileURLToPath(new URL('../../', import.meta.url)))
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

describe('the gates that run before the pipeline does', () => {
  it('installs itself from the repository, not from each machine', () => {
    expect(read('package.json')).toContain('git config core.hooksPath .githooks')
    for (const hook of ['.githooks/pre-commit', '.githooks/pre-push']) {
      const mode = statSync(join(root, hook)).mode
      expect(mode & 0o111, `${hook} must be executable`).toBeGreaterThan(0)
    }
  })

  it('runs, in pre-commit, the checks that have actually caught mistakes here', () => {
    const hook = read('.githooks/pre-commit')
    expect(hook).toContain('scripts/verify-diff-whitespace.mjs')
    expect(hook).toContain('scripts/verify-desktop-variants.mjs')
    expect(hook).toContain('scripts/fita/channels-module.mts')
  })

  it('runs in pre-push the exact command CI runs', () => {
    const hook = read('.githooks/pre-push')
    const ci = read('.github/workflows/ci.yml')
    expect(hook).toContain('yarn check')
    // The pipeline's gate and the hook's gate are one command, not two that can drift.
    expect(ci).toContain('yarn check')
  })

  it('keeps the pipeline blocking rather than advisory', () => {
    // Set on `dev` through the API; this test records the intent next to the gates, and
    // `docs/fita/WORKFLOWS.md` records why the conditional jobs are not required.
    expect(read('docs/fita/WORKFLOWS.md')).toContain('`changes` and `check` are required status checks')
  })
})
