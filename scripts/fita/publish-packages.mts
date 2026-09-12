/**
 * Publish the packages we own to GitHub Packages.
 *
 * The registry requires a package name scoped to its owner, so the rule here is stated once:
 * a package is ours to publish when it is named `@aleffita/…`, is not private, and points its
 * `publishConfig.registry` at GitHub Packages. Anything scoped that does not satisfy the rest is
 * a configuration bug and fails the run rather than being skipped quietly; nothing scoped yet is
 * reported as nothing to publish, which is the honest state before the first plugin lands.
 *
 *   node scripts/fita/publish-packages.mts            # check only
 *   node scripts/fita/publish-packages.mts --publish  # publish, requires NODE_AUTH_TOKEN
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GITHUB_PACKAGES_REGISTRY,
  planPublish,
  type PublishCandidate,
} from '../../dsh-plugin-desktop/src/fita-packages.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Read every workspace package the root manifest declares. */
function workspaceCandidates(): PublishCandidate[] {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { workspaces?: string[] }
  const candidates: PublishCandidate[] = []
  for (const workspace of manifest.workspaces ?? []) {
    const file = join(root, workspace, 'package.json')
    if (!existsSync(file)) continue
    const entry = JSON.parse(readFileSync(file, 'utf8')) as {
      name?: unknown
      version?: unknown
      private?: unknown
      publishConfig?: { registry?: unknown }
    }
    if (typeof entry.name !== 'string' || typeof entry.version !== 'string') continue
    candidates.push({
      name: entry.name,
      version: entry.version,
      directory: workspace,
      private: entry.private === true,
      ...(typeof entry.publishConfig?.registry === 'string' ? { registry: entry.publishConfig.registry } : {}),
    })
  }
  return candidates
}

function main(argv: readonly string[]): void {
  const publish = argv.includes('--publish')
  const plan = planPublish(workspaceCandidates())
  if (plan.status === 'nothing') {
    process.stdout.write(`fita-packages: nothing to publish — ${plan.reason}\n`)
    return
  }
  if (plan.status === 'invalid') {
    for (const problem of plan.problems) process.stderr.write(`fita-packages: ${problem}\n`)
    process.exit(1)
  }
  for (const candidate of plan.packages) {
    process.stdout.write(`fita-packages: ${candidate.name}@${candidate.version} → ${GITHUB_PACKAGES_REGISTRY}\n`)
    if (!publish) continue
    const result = spawnSync(
      'yarn',
      ['workspace', candidate.name, 'npm', 'publish', '--access', 'restricted'],
      { cwd: root, stdio: 'inherit', env: process.env },
    )
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
  if (!publish) process.stdout.write('fita-packages: check only; pass --publish to publish\n')
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`fita-packages: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
