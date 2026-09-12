/**
 * Translate this repository's Yarn configuration into pnpm's.
 *
 * The two managers describe the same three things differently, and the translation has to be
 * exact because a wrong mapping silently installs a different dependency tree:
 *
 *   resolutions            -> pnpm.overrides
 *   patch:<pkg>#<patch>    -> pnpm.patchedDependencies (keyed by name@version)
 *   file:vendor/x.tgz      -> overrides entry, unchanged
 *
 *   node scripts/migrate/yarn-to-pnpm.mjs            # report only
 *   node scripts/migrate/yarn-to-pnpm.mjs --write     # rewrite package.json
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The one workspace-level setting pnpm needs that Yarn kept in package.json. */
export const PNPM_VERSION = '10.18.0'

/**
 * Split a Yarn `patch:` resolution into the package it patches and the patch file.
 *
 * Yarn writes `patch:<descriptor>#<patchPath>`, where the descriptor is either
 * `name@npm:version` or `name@file:<url-encoded path>`; either way the key before the `#` is
 * the instance being patched and the part after it is the patch to apply.
 * @param value - the resolution value.
 * @returns the descriptor and patch path, or undefined when it is not a patch resolution.
 */
export function parsePatchResolution(value) {
  if (!value.startsWith('patch:')) return undefined
  // Yarn URL-encodes the `:` in the descriptor, so `npm%3A1.2.3` is `npm:1.2.3`.
  const body = decodeURIComponent(value.slice('patch:'.length))
  const split = body.lastIndexOf('#')
  if (split === -1) return undefined
  return { descriptor: body.slice(0, split), patchPath: body.slice(split + 1).replace(/^\.\//u, '') }
}

/**
 * Read the package name a Yarn descriptor refers to.
 *
 * Scoped names contain a `/` and an `@`, so the version separator is the `@` after the scope,
 * not the first one.
 * @param descriptor - for example `@scope/name@npm:1.2.3` or `name@file:vendor/x.tgz`.
 * @returns the name, or undefined when the descriptor carries no version part.
 */
export function descriptorName(descriptor) {
  const at = descriptor.lastIndexOf('@')
  const scoped = descriptor.startsWith('@') ? descriptor.indexOf('@', 1) : 0
  if (at <= scoped) return undefined
  return descriptor.slice(0, at)
}

/**
 * Read the version a Yarn descriptor pins, when it pins one with `npm:`.
 * @param descriptor - for example `name@npm:1.2.3`.
 * @returns the version, or undefined when the descriptor points at a file or range.
 */
export function descriptorVersion(descriptor) {
  const marker = descriptor.lastIndexOf('@npm:')
  if (marker === -1) return undefined
  return descriptor.slice(marker + '@npm:'.length)
}

/**
 * Translate one resolutions map.
 * @param resolutions - Yarn's `resolutions`.
 * @returns pnpm overrides, patched dependencies and anything that could not be translated.
 */
export function translateResolutions(resolutions) {
  const overrides = {}
  const patchedDependencies = {}
  const problems = []
  for (const [key, value] of Object.entries(resolutions)) {
    const patch = parsePatchResolution(value)
    if (patch === undefined) {
      overrides[key] = value
      continue
    }
    const name = descriptorName(patch.descriptor)
    const version = descriptorVersion(patch.descriptor)
    if (name === undefined || version === undefined) {
      // A patch on a file: tarball has no npm version to key on; pnpm keys patches by
      // name@version, so this cannot be translated without knowing the version inside the tgz.
      problems.push(`${key} patches ${patch.descriptor}, which pins no npm version`)
      continue
    }
    patchedDependencies[`${name}@${version}`] = patch.patchPath
    // The override keeps the instance pinned to the same version the patch was written for.
    overrides[key] = version
  }
  return { overrides, patchedDependencies, problems }
}

function main(argv) {
  const write = argv.includes('--write')
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const { overrides, patchedDependencies, problems } = translateResolutions(manifest.resolutions ?? {})
  const report = {
    overrides: Object.keys(overrides).length,
    patchedDependencies: Object.keys(patchedDependencies).length,
    untranslatable: problems,
  }
  process.stdout.write(`yarn-to-pnpm: ${JSON.stringify(report)}\n`)
  if (problems.length > 0 && !write) return
  if (!write) {
    process.stdout.write('yarn-to-pnpm: report only; pass --write to rewrite package.json\n')
    return
  }
  const next = {
    ...manifest,
    packageManager: `pnpm@${PNPM_VERSION}`,
    pnpm: { overrides, patchedDependencies },
  }
  delete next.resolutions
  writeFileSync(resolve(root, 'package.json'), `${JSON.stringify(next, null, 2)}\n`)
  process.stdout.write('yarn-to-pnpm: package.json rewritten\n')
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
