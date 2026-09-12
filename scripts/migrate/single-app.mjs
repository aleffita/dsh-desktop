/**
 * Move the channel registry from per-lane identity to one application with lanes.
 *
 * The migration is a shape change, not a rewrite: `bundleId`, `appName` and `installs` stop
 * being lane properties and become one `application` block, because there is one installed app
 * and lanes are chosen inside it. Everything a *release* needs stays per lane — `tag`, `feed`,
 * `artifactSlug`, `accent`, `name`, `description`, `prerelease` — since those describe how a
 * lane's build is found and fetched, not what the application is.
 *
 * It is a script, and it runs as a report by default, for the same reason the pnpm translator
 * is one: the edits were re-derived by hand twice before this existed.
 *
 *   node scripts/migrate/single-app.mjs          # report what would change
 *   node scripts/migrate/single-app.mjs --write  # change fita/channels.yml
 *
 * After `--write`, the generator and the modules that read the old fields have to be updated
 * before the repository is consistent again; the checklist it prints is that order.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const registryPath = resolve(root, 'fita', 'channels.yml')

/** The one identity every build shares. */
export const APPLICATION = Object.freeze({
  bundleId: 'dev.aleffita.dsh-harness',
  appName: 'DSH Harness',
  installs: '~/Applications/DSH Harness.app',
})

/** Lane properties that stop existing, because they are the application's. */
export const APPLICATION_FIELDS = ['appName', 'bundleId', 'installs']

/** What has to happen after the registry changes, in order. */
export const FOLLOW_UP = [
  'scripts/fita/channels-module.mts: LANE_FIELDS + APPLICATION_FIELDS, uniqueness on tag/feed/artifactSlug, emit FITA_APPLICATION + FITA_LANES',
  'src/fita-channel.ts (both editions): the lane type loses appName/bundleId/installs; export the application',
  'src/fita-install.ts: fitaInstallPath takes the application, and planFitaHandover compares against it',
  'scripts/fita/package.mts and fita.mjs: stamp the application identity plus the build lane; one install target',
  'scripts/fita/verify-channel.mts, verify-installs.mts, verify-prepared-cache.mts, verify-update-flow.mts: read the application for identity, the lane for the release',
  'tests: fita-channel.spec.ts asserts one application plus lane-shaped uniqueness; the installer and hand-over specs follow',
  'e2e: verify-installs.mts becomes "one app, lanes switched inside it"',
  '.github/workflows/desktop-release.yml and docs/fita/*: the app is one, the lanes are release streams',
]

/**
 * Render the registry with one application block and lane-only channels.
 * @param source - current `fita/channels.yml`.
 * @returns the migrated file contents, or undefined when it is already migrated.
 */
export function migrateRegistry(source) {
  if (source.includes('\napplication:\n')) return undefined
  let next = source.replace(
    'version: 1\nrepository: aleffita/dsh-desktop\nproduct: DSH Fita\n',
    `version: 1\nrepository: aleffita/dsh-desktop\nproduct: DSH Fita\napplication:\n  bundleId: ${APPLICATION.bundleId}\n  appName: ${APPLICATION.appName}\n  installs: '${APPLICATION.installs}'\n`,
  )
  if (next === source) return undefined
  for (const field of APPLICATION_FIELDS) {
    next = next.replace(new RegExp(`^    ${field}: [^\\n]+\\n`, 'gmu'), '')
  }
  return next
}

function main(argv) {
  const write = argv.includes('--write')
  const source = readFileSync(registryPath, 'utf8')
  const migrated = migrateRegistry(source)
  if (migrated === undefined) {
    process.stdout.write('single-app: fita/channels.yml already describes one application\n')
    return
  }
  const lanes = [...migrated.matchAll(/^  - name: (.+)$/gmu)].map(match => match[1])
  process.stdout.write(`single-app: application ${APPLICATION.bundleId} (${APPLICATION.appName})\n`)
  process.stdout.write(`single-app: lanes left as release streams: ${lanes.join(', ')}\n`)
  if (!write) {
    process.stdout.write('single-app: report only; pass --write, then follow the checklist:\n')
    for (const step of FOLLOW_UP) process.stdout.write(`  - ${step}\n`)
    return
  }
  writeFileSync(registryPath, migrated)
  process.stdout.write('single-app: fita/channels.yml rewritten; the follow-up checklist now applies:\n')
  for (const step of FOLLOW_UP) process.stdout.write(`  - ${step}\n`)
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
