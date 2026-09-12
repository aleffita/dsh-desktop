/**
 * Reject the whitespace the changed-path gate rejects.
 *
 * The CI `changes` job runs `git diff --check` over the pull request diff before
 * anything else does. Running the same check locally is what keeps a documentation
 * edit from failing the pipeline minutes later — which is exactly what happened
 * once: three files whose appended sections ended in a blank line.
 *
 *   yarn check:diff                  # against dev
 *   yarn check:diff origin/dev       # against an explicit base
 *
 * It is deliberately not part of `check:layout`: a CI checkout of a pull request
 * has no local `dev` to find a merge base with, so the gate would fail there for
 * the wrong reason.
 */

import { spawnSync } from 'node:child_process'

const base = process.argv[2] ?? process.env.FITA_DIFF_BASE ?? 'dev'

/**
 * Run one git command and report its complaint.
 * @param args - git arguments.
 * @returns the reported problem, or an empty string when git was satisfied.
 */
function problemsFrom(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  if (result.status === 0) return ''
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  return output === '' ? `git ${args.join(' ')} exited ${String(result.status ?? 1)}` : output
}

const mergeBase = spawnSync('git', ['merge-base', base, 'HEAD'], { encoding: 'utf8' })
if (mergeBase.status !== 0) {
  process.stderr.write(`check-diff: cannot find a merge base with ${base}\n`)
  process.exit(1)
}
const range = `${(mergeBase.stdout ?? '').trim()}...HEAD`

const problems = [
  ['committed changes', problemsFrom(['diff', '--check', range])],
  ['working tree', problemsFrom(['diff', '--check'])],
].filter(([, problem]) => problem !== '')

if (problems.length > 0) {
  for (const [scope, problem] of problems) process.stderr.write(`check-diff: ${scope}\n${problem}\n`)
  process.exit(1)
}

process.stdout.write(`check-diff: no whitespace errors against ${base}\n`)
