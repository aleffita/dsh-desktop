import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const stablePackage = join(root, 'dsh-plugin-desktop')
const betaPackage = join(root, 'dsh-plugin-desktop-beta')
// Both editions share behavior. Only release identity and launcher wording differ.
const betaOnlyPaths = new Set([])
const allowedDifferences = new Set(['product-identity.ts'])
const normalizeIdentity = source => source.toString().replaceAll('dsh-plugin-desktop-beta', 'dsh-plugin-desktop').replaceAll('DSH Desktop Beta', 'DSH Desktop').replaceAll('2.0.9-beta.1', '2.0.9')

// `tests/` and `scripts/` are *not* shared the way `src/` is, and copying one edition's
// file over the other is a mistake this gate now catches: a difference declared here has to
// keep existing, so a file that suddenly matches its sibling is reported instead of passing.
const declaredTestDifferences = new Set([
  'bin.spec.ts',
  'client-directory-picker-browse-patch.spec.ts',
  'desktop-plugins.spec.ts',
  'package.spec.ts',
  'plugin.spec.ts',
  'profile-manager.spec.ts',
  'setup-wizard-settings.spec.ts',
  'setup-wizard-state.spec.ts',
  'startup-recovery-controller.spec.ts',
  'update-checker.spec.ts',
  'update-download.spec.ts',
  'verify-mac-release.spec.ts',
  'verify-mac-smoke.spec.ts',
  'verify-win-installer.spec.ts',
  'verify-win-portable.spec.ts',
])
const declaredScriptDifferences = new Set([
  'probe-windows-installer-quit.ps1',
  'verify-loader-boot.mjs',
  'verify-profile-boot.mjs',
  'verify-win-installer.ts',
  'verify-win-portable.ts',
])
const stableOnlyTests = new Set([
  'launch-environment.spec.ts',
  'windows-nsis-ab.spec.ts',
])
const stableOnlyScripts = new Set([
  'build-windows-nsis-ab.ts',
  'generate-windows-app-icon.mjs',
  'inspect-windows-installed-app.ts',
  'probe-windows-packaged-runtime.ts',
  'run-windows-nsis-ab.ps1',
  'verify-nsis-ab-prepackaged.ts',
  'windows-nsis-ab.ts',
])

function files(directory, base = directory) {
  const result = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...files(path, base))
    else if (entry.isFile()) result.push(relative(base, path).split(sep).join('/'))
  }
  return result
}

const stableRoot = join(stablePackage, 'src')
const betaRoot = join(betaPackage, 'src')
const sharedPaths = new Set([...files(stableRoot), ...files(betaRoot), ...betaOnlyPaths])
const differences = []
for (const path of [...sharedPaths].sort()) {
  if (allowedDifferences.has(path)) continue
  let stable
  let beta
  try { stable = readFileSync(join(stableRoot, path)) } catch { stable = undefined }
  try { beta = readFileSync(join(betaRoot, path)) } catch { beta = undefined }
  if (betaOnlyPaths.has(path)) {
    if (stable !== undefined || beta === undefined) differences.push(`${path} (must exist only in beta)`)
    continue
  }
  if (stable === undefined || beta === undefined || normalizeIdentity(stable) !== normalizeIdentity(beta)) differences.push(path)
}

if (differences.length > 0) {
  throw new Error(`Desktop variant source drift is not declared:\n${differences.map(path => `- src/${path}`).join('\n')}`)
}

process.stdout.write(`verify-desktop-variants: ${String(sharedPaths.size - allowedDifferences.size - betaOnlyPaths.size)} shared source files are aligned; both editions use isolated Host and chrome\n`)

// Same idea for the edition-specific trees, with the differences declared explicitly.
for (const [sub, declared, stableOnly] of [
  ['tests', declaredTestDifferences, stableOnlyTests],
  ['scripts', declaredScriptDifferences, stableOnlyScripts],
]) {
  const stableDir = join(stablePackage, sub)
  const betaDir = join(betaPackage, sub)
  const stableFiles = new Set(files(stableDir).filter(path => !stableOnly.has(path)))
  const betaFiles = new Set(files(betaDir))
  for (const path of [...new Set([...stableFiles, ...betaFiles])].sort()) {
    const inStable = stableFiles.has(path)
    const inBeta = betaFiles.has(path)
    if (!inBeta) {
      differences.push(`${sub}/${path} (exists only in stable and is not declared stable-only)`)
      continue
    }
    if (!inStable) {
      differences.push(`${sub}/${path} (exists only in beta)`)
      continue
    }
    const stable = normalizeIdentity(readFileSync(join(stableDir, path)))
    const beta = normalizeIdentity(readFileSync(join(betaDir, path)))
    if (declared.has(path)) {
      if (stable === beta) {
        differences.push(`${sub}/${path} (declared as an edition difference but now matches the other edition — was one copied over the other?)`)
      }
      continue
    }
    if (stable !== beta) differences.push(`${sub}/${path} (differs and is not declared)`)
  }
}

if (differences.length > 0) {
  throw new Error(`Desktop variant source drift is not declared:\n${differences.map(path => `- ${path}`).join('\n')}`)
}
