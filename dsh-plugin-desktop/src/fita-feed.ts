/**
 * Read a channel's updater feed and decide which layer an update is.
 *
 * A channel publishes two artifacts: the zip, which is the payload an Electron app
 * updates itself from on macOS, and the DMG, which is the full install. The feed — the
 * `<feed>-mac.yml` electron-builder writes and the release carries — is what says which
 * one this update needs, so the decision is a reading of the feed rather than a guess in
 * the app.
 *
 * Only the subset electron-updater emits is parsed: `version`, `path`, `sha512` and the
 * `files` list. Anything else in the document is ignored.
 */

import type { FitaChannel } from './fita-channel.ts'

/** One file the feed advertises. */
export interface FitaFeedFile {
  /** Published file name. */
  readonly url: string
  /** Base64 digest the file must match, when the feed carries one. */
  readonly sha512?: string
  /** Size in bytes, when the feed carries one. */
  readonly size?: number
}

/** The parts of a channel feed this app relies on. */
export interface FitaFeed {
  /** Version the feed announces. */
  readonly version: string
  /** File the feed points at as the update. */
  readonly path?: string
  /** Every advertised file. */
  readonly files: readonly FitaFeedFile[]
}

/**
 * Parse the subset of a channel feed this app uses.
 * @param text - contents of a `<feed>-mac.yml`.
 * @returns the feed, or null when it carries no version or no files.
 */
export function parseFitaFeed(text: string): FitaFeed | null {
  let version: string | undefined
  let path: string | undefined
  const files: FitaFeedFile[] = []
  let current: { url: string; sha512?: string; size?: number } | undefined
  let inFiles = false

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+$/u, '')
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const indented = /^\s/u.test(line)
    if (!indented) {
      inFiles = line.startsWith('files:')
      if (!inFiles) {
        const match = /^(version|path):\s*(.+)$/u.exec(line)
        if (match !== null) {
          const value = (match[2] ?? '').trim().replace(/^['"]|['"]$/gu, '')
          if (match[1] === 'version') version = value
          else path = value
        }
      }
      continue
    }
    if (!inFiles) continue
    const url = /^\s*-\s*url:\s*(.+)$/u.exec(line)
    if (url !== null) {
      if (current !== undefined) files.push(current)
      current = { url: (url[1] ?? '').trim().replace(/^['"]|['"]$/gu, '') }
      continue
    }
    if (current === undefined) continue
    const digest = /^\s*sha512:\s*(.+)$/u.exec(line)
    if (digest !== null) {
      current.sha512 = (digest[1] ?? '').trim()
      continue
    }
    const size = /^\s*size:\s*(\d+)\s*$/u.exec(line)
    if (size !== null) current.size = Number(size[1])
  }
  if (current !== undefined) files.push(current)
  if (version === undefined || version === '' || files.length === 0) return null
  return { version, ...(path === undefined ? {} : { path }), files }
}

/** Which layer an update needs, or why it cannot be applied. */
export type FitaUpdateLayer =
  | { readonly layer: 'payload'; readonly file: FitaFeedFile }
  | { readonly layer: 'full'; readonly file: FitaFeedFile }
  | { readonly layer: 'none'; readonly reason: 'not-this-channel' }

/**
 * A layer an update can actually be applied as.
 *
 * `none` is an answer, not a layer: it never reaches the step that downloads and applies,
 * so that step takes this narrower type and cannot be handed a decision it cannot act on.
 */
export type FitaChosenLayer = Extract<FitaUpdateLayer, { readonly layer: 'payload' | 'full' }>

/** A file belongs to this channel when its name carries the channel's artifact slug. */
function ownedByChannel(file: FitaFeedFile, channel: FitaChannel): boolean {
  return file.url.startsWith(`${channel.artifactSlug}-`)
}

/**
 * Choose the artifact an update should use.
 *
 * The zip is preferred because it replaces only the code payload; the DMG is the full
 * install and is used when the feed offers no zip. A file that does not carry this
 * channel's artifact slug is never chosen, so one channel cannot install another's build.
 * @param feed - parsed channel feed.
 * @param channel - channel the running build belongs to.
 * @returns the layer and file to use, or why there is none.
 */
export function fitaUpdateLayer(feed: FitaFeed, channel: FitaChannel): FitaUpdateLayer {
  const owned = feed.files.filter(file => ownedByChannel(file, channel))
  // A feed may carry one file per architecture; the universal build is the one that
  // runs on whatever machine is asking, so it wins over an arch-specific sibling.
  const pick = (extension: string): FitaFeedFile | undefined => {
    const matching = owned.filter(file => file.url.endsWith(extension))
    return matching.find(file => file.url.endsWith(`-universal${extension}`)) ?? matching[0]
  }
  const payload = pick('.zip')
  if (payload !== undefined) return { layer: 'payload', file: payload }
  const full = pick('.dmg')
  if (full !== undefined) return { layer: 'full', file: full }
  return { layer: 'none', reason: 'not-this-channel' }
}
