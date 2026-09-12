/** Same-origin browser client for launcher-owned Desktop settings operations. */

const SETTINGS_PATH = '/api/desktop/settings'
const PROFILE_CREATE_PATH = '/api/desktop/profiles/create'
const PROFILE_SELECT_PATH = '/api/desktop/profiles/select'
const PROFILE_DELETE_PATH = '/api/desktop/profiles/delete'
const AA_SELECT_PATH = '/api/desktop/aa/select'
const MARKET_SELECT_PATH = '/api/desktop/market/select'
const TERMINAL_OPEN_PATH = '/api/desktop/terminal/open'
const RESTART_PATH = '/api/desktop/restart'
const RECOVERY_RESTART_PATH = '/api/desktop/restart/recovery'
const RENDERER_RELOAD_PATH = '/api/desktop/developer/reload'
const DEVELOPER_TOOLS_TOGGLE_PATH = '/api/desktop/developer/devtools'
const UPDATE_CHECK_PATH = '/api/desktop/updates/check'
const CHANNELS_PATH = '/api/desktop/updates/channels'
const CHANNEL_CHECK_PATH = '/api/desktop/updates/channel-check'
const CHANNEL_DOWNLOAD_PATH = '/api/desktop/updates/channel-download'
const DIAGNOSTICS_EXPORT_PATH = '/api/desktop/diagnostics/export'
const MAX_PROFILES = 256
const MAX_PROFILE_NAME_LENGTH = 255
const MAX_LAN_URLS = 32
const MAX_LAN_ERROR_LENGTH = 128
const BROWSER_AUTH_TOKEN_QUERY = /^\?token=[A-Za-z0-9_-]{43}$/u
const LAN_CA_PATH = '/.well-known/dsh-desktop-ca.crt'
const LAN_ERROR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u
const SHA256_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u

/** Launcher-supported plugin market implementations. */
export type DesktopMarketProvider = 'disabled' | 'community-market' | 'dsh-market'

/** Safe profile projection returned to the renderer. */
export interface DesktopProfileView {
  readonly name: string
  readonly exists: boolean
  readonly webCapable: boolean
  readonly selectable: boolean
  readonly deletable: boolean
}

/** Market selection fixed for the running generation. */
export interface DesktopMarketView {
  readonly requested: DesktopMarketProvider
  readonly effective: DesktopMarketProvider
  readonly legacyDefaulted: boolean
}

/** Authenticated ordinary-browser URLs for the running Desktop generation. */
export type DesktopLanState = 'inactive' | 'starting' | 'ready' | 'failed'

/** Authenticated browser URLs and live LAN HTTPS edge state. */
export interface DesktopWebView {
  readonly localUrl: string
  readonly lanUrls: readonly string[]
  readonly lanState: DesktopLanState
  readonly lanError: string | null
  readonly lanCaFingerprint: string | null
  readonly lanCaUrls: readonly string[]
}

/** Complete launcher-owned settings projection. */
export interface DesktopSettingsView {
  readonly current: string
  readonly profiles: readonly DesktopProfileView[]
  readonly aa?: { readonly requested: boolean; readonly effective: boolean }
  readonly market: DesktopMarketView
  readonly web: DesktopWebView
}

/** A persisted selection that requires a new Desktop generation. */
export interface DesktopRestartAcceptance {
  readonly accepted: true
  readonly restartRequired: boolean
}

/** Browser operations consumed by the Desktop settings section. */
export interface DesktopSettingsApi {
  read(): Promise<DesktopSettingsView>
  createProfile(name: string): Promise<DesktopSettingsView>
  selectProfile(name: string): Promise<DesktopRestartAcceptance>
  deleteProfile(name: string): Promise<DesktopSettingsView>
  selectAa?(enabled: boolean): Promise<DesktopRestartAcceptance>
  selectMarket(provider: DesktopMarketProvider): Promise<DesktopRestartAcceptance>
  openTerminal(): Promise<void>
  restart(): Promise<void>
  restartToRecovery(): Promise<void>
  reloadRenderer(): Promise<void>
  toggleDeveloperTools(): Promise<void>
  checkForUpdates(): Promise<void>
  channels(): Promise<DesktopChannelsResponse>
  checkChannel(channel: string): Promise<DesktopChannelCheck>
  prepareChannel(channel: string): Promise<DesktopChannelDownload>
  exportDiagnostics(): Promise<void>
}

/** One Fita channel as the settings surface may show it. */
export interface DesktopChannelView {
  /** Registry slug, also the value the check request carries. */
  readonly slug: string
  /** Human channel name. */
  readonly name: string
  /** Git lane that produces this channel's builds. */
  readonly lane: string
  /** Tag pattern the release workflow accepts. */
  readonly tag: string
  /** Updater feed name. */
  readonly feed: string
  /** App bundle name. */
  readonly appName: string
  /** Bundle identifier. */
  readonly bundleId: string
  /** Header accent colour. */
  readonly accent: string
  /** Whether this channel publishes pre-releases. */
  readonly prerelease: boolean
  /** Install path the local installer uses. */
  readonly installs: string
  /** One-line description. */
  readonly description: string
  /** Whether the renderer is running inside this channel. */
  readonly current: boolean
}

/** Every channel this build knows, and which one it is. */
export interface DesktopChannelsResponse {
  /** Slug of the running build's channel, or null when this build carries no stamp. */
  readonly current: string | null
  /** Catalogue, in registry order. */
  readonly channels: readonly DesktopChannelView[]
}

/** One downloadable file offered by a channel. */
export interface DesktopChannelArtifact {
  /** Published file name. */
  readonly name: string
  /** Direct download URL. */
  readonly url: string
}

/** Reasons a channel check can fail, as the UI may word them. */
export type DesktopChannelCheckFailure = 'request' | 'response' | 'malformed' | 'unknown-channel'

/** Outcome of checking one channel. */
export type DesktopChannelCheck =
  | {
    readonly status: 'offer'
    /** Channel that was checked. */
    readonly channel: string
    /** Version the channel currently publishes. */
    readonly version: string
    /** Whether that version is newer than the running build. */
    readonly newer: boolean
    /** The build to download, when the release carries one. */
    readonly dmg: DesktopChannelArtifact | null
    /** The checksum file to verify it with, when the release carries one. */
    readonly sums: DesktopChannelArtifact | null
  }
  | { readonly status: 'none'; readonly channel: string }
  | { readonly status: 'failed'; readonly channel: string; readonly reason: DesktopChannelCheckFailure }

/** Reasons preparing a channel's build can fail, as the UI may word them. */
export type DesktopChannelDownloadFailure =
  | 'unknown-channel'
  | 'no-release'
  | 'no-artifact'
  | 'request'
  | 'response'
  | 'malformed'
  | 'download'
  | 'checksum-missing'
  | 'checksum-mismatch'
  | 'too-large'
  | 'io'

/** Outcome of preparing a channel's build. */
export type DesktopChannelDownload =
  | {
    readonly status: 'verified'
    /** Version that was prepared. */
    readonly version: string
    /** Published file name. */
    readonly name: string
    /** Absolute path of the verified file. */
    readonly path: string
  }
  | {
    readonly status: 'stored'
    /** Version that was prepared. */
    readonly version: string
    /** Published file name. */
    readonly name: string
    /** Absolute path of the file; the release published no checksums. */
    readonly path: string
  }
  | { readonly status: 'failed'; readonly channel: string; readonly reason: DesktopChannelDownloadFailure }

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isMarketProvider(value: unknown): value is DesktopMarketProvider {
  return value === 'disabled' || value === 'community-market' || value === 'dsh-market'
}

function isLanState(value: unknown): value is DesktopLanState {
  return value === 'inactive' || value === 'starting' || value === 'ready' || value === 'failed'
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index])
}

function isCanonicalIpv4(value: string): boolean {
  const parts = value.split('.')
  return parts.length === 4 && parts.every((part) => {
    if (!/^(?:0|[1-9][0-9]{0,2})$/u.test(part)) return false
    const octet = Number(part)
    return octet >= 0 && octet <= 255
  })
}

function parseProfile(value: unknown): DesktopProfileView {
  if (!isObject(value)
    || typeof value.name !== 'string'
    || value.name.length === 0
    || value.name.length > MAX_PROFILE_NAME_LENGTH
    || typeof value.exists !== 'boolean'
    || typeof value.webCapable !== 'boolean'
    || typeof value.selectable !== 'boolean'
    || typeof value.deletable !== 'boolean') {
    throw new Error('dsh-plugin-desktop: invalid profile settings response')
  }
  return Object.freeze({
    name: value.name,
    exists: value.exists,
    webCapable: value.webCapable,
    selectable: value.selectable,
    deletable: value.deletable,
  })
}

function parseBrowserUrl(value: unknown, loopback: boolean): string {
  if (typeof value !== 'string' || value.length > 2_048) {
    throw new Error('dsh-plugin-desktop: invalid browser URL in settings response')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('dsh-plugin-desktop: invalid browser URL in settings response')
  }
  if (url.protocol !== (loopback ? 'http:' : 'https:')
    || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || !BROWSER_AUTH_TOKEN_QUERY.test(url.search)
    || url.hash !== '' || url.port === '' || url.href !== value) {
    throw new Error('dsh-plugin-desktop: invalid browser URL in settings response')
  }
  if (loopback
    ? url.hostname !== '127.0.0.1'
    : !isCanonicalIpv4(url.hostname) || url.hostname.startsWith('127.') || url.hostname === '0.0.0.0') {
    throw new Error('dsh-plugin-desktop: invalid browser URL in settings response')
  }
  return url.href
}

function parseLanCaUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2_048) {
    throw new Error('dsh-plugin-desktop: invalid LAN CA URL in settings response')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('dsh-plugin-desktop: invalid LAN CA URL in settings response')
  }
  if (url.protocol !== 'https:'
    || url.username !== '' || url.password !== ''
    || !isCanonicalIpv4(url.hostname) || url.hostname.startsWith('127.') || url.hostname === '0.0.0.0'
    || url.port === '' || url.pathname !== LAN_CA_PATH
    || url.search !== '' || url.hash !== '' || url.href !== value) {
    throw new Error('dsh-plugin-desktop: invalid LAN CA URL in settings response')
  }
  return url.href
}

function parseLanError(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LAN_ERROR_LENGTH
    || !LAN_ERROR_PATTERN.test(value)) {
    throw new Error('dsh-plugin-desktop: invalid LAN HTTPS error in settings response')
  }
  return value
}

function parseLanCaFingerprint(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !SHA256_FINGERPRINT_PATTERN.test(value)) {
    throw new Error('dsh-plugin-desktop: invalid LAN CA fingerprint in settings response')
  }
  return value
}

/** Validate the bounded settings projection before it reaches React state. */
export function parseDesktopSettingsView(value: unknown): DesktopSettingsView {
  if (!isObject(value)
    || typeof value.current !== 'string'
    || value.current.length === 0
    || value.current.length > MAX_PROFILE_NAME_LENGTH
    || !Array.isArray(value.profiles)
    || value.profiles.length > MAX_PROFILES
    || (value.aa !== undefined && (!isObject(value.aa) || typeof value.aa.requested !== 'boolean' || typeof value.aa.effective !== 'boolean'))
    || !isObject(value.market)
    || !isMarketProvider(value.market.requested)
    || !isMarketProvider(value.market.effective)
    || typeof value.market.legacyDefaulted !== 'boolean'
    || !isObject(value.web)
    || !hasExactKeys(value.web, [
      'localUrl',
      'lanUrls',
      'lanState',
      'lanError',
      'lanCaFingerprint',
      'lanCaUrls',
    ])
    || !Array.isArray(value.web.lanUrls)
    || value.web.lanUrls.length > MAX_LAN_URLS
    || !Array.isArray(value.web.lanCaUrls)
    || value.web.lanCaUrls.length > MAX_LAN_URLS
    || !isLanState(value.web.lanState)) {
    throw new Error('dsh-plugin-desktop: invalid Desktop settings response')
  }
  const profiles = value.profiles.map(parseProfile)
  const localUrl = parseBrowserUrl(value.web.localUrl, true)
  const lanUrls = value.web.lanUrls.map(url => parseBrowserUrl(url, false))
  const lanCaUrls = value.web.lanCaUrls.map(parseLanCaUrl)
  const lanError = parseLanError(value.web.lanError)
  const lanCaFingerprint = parseLanCaFingerprint(value.web.lanCaFingerprint)
  if (new Set(profiles.map(profile => profile.name)).size !== profiles.length) {
    throw new Error('dsh-plugin-desktop: duplicate profile in settings response')
  }
  if (new Set(lanUrls).size !== lanUrls.length || new Set(lanCaUrls).size !== lanCaUrls.length) {
    throw new Error('dsh-plugin-desktop: duplicate LAN URL in settings response')
  }
  if ((value.web.lanState === 'ready') !== (lanUrls.length > 0)) {
    throw new Error('dsh-plugin-desktop: inconsistent LAN HTTPS state in settings response')
  }
  if (value.web.lanState !== 'failed' && lanError !== null) {
    throw new Error('dsh-plugin-desktop: inconsistent LAN HTTPS error in settings response')
  }
  return Object.freeze({
    current: value.current,
    profiles: Object.freeze(profiles),
    aa: Object.freeze(isObject(value.aa) ? { requested: value.aa.requested as boolean, effective: value.aa.effective as boolean } : { requested: false, effective: false }),
    market: Object.freeze({
      requested: value.market.requested,
      effective: value.market.effective,
      legacyDefaulted: value.market.legacyDefaulted,
    }),
    web: Object.freeze({
      localUrl,
      lanUrls: Object.freeze(lanUrls),
      lanState: value.web.lanState,
      lanError,
      lanCaFingerprint,
      lanCaUrls: Object.freeze(lanCaUrls),
    }),
  })
}

/** Validate restart acknowledgement returned before the Host generation exits. */
export function parseDesktopRestartAcceptance(value: unknown): DesktopRestartAcceptance {
  if (!isObject(value) || value.accepted !== true || typeof value.restartRequired !== 'boolean') {
    throw new Error('dsh-plugin-desktop: invalid Desktop restart response')
  }
  return Object.freeze({ accepted: true, restartRequired: value.restartRequired })
}

/** Validate the exact acknowledgement returned by a Desktop side effect. */
export function parseDesktopActionAcceptance(value: unknown): void {
  if (!isObject(value)
    || Object.keys(value).length !== 1
    || value.accepted !== true) {
    throw new Error('dsh-plugin-desktop: invalid Desktop action response')
  }
}

function parseChannelArtifact(value: unknown): DesktopChannelArtifact | null {
  if (value === null) return null
  if (!isObject(value) || typeof value.name !== 'string' || typeof value.url !== 'string') {
    throw new Error('dsh-plugin-desktop: invalid Desktop channel artifact')
  }
  return Object.freeze({ name: value.name, url: value.url })
}

function parseChannelView(value: unknown): DesktopChannelView {
  if (!isObject(value)) throw new Error('dsh-plugin-desktop: invalid Desktop channel')
  const strings = ['slug', 'name', 'lane', 'tag', 'feed', 'appName', 'bundleId', 'accent', 'installs', 'description'] as const
  for (const field of strings) {
    if (typeof value[field] !== 'string') throw new Error('dsh-plugin-desktop: invalid Desktop channel')
  }
  if (typeof value.prerelease !== 'boolean' || typeof value.current !== 'boolean') {
    throw new Error('dsh-plugin-desktop: invalid Desktop channel')
  }
  return Object.freeze({
    slug: value.slug as string,
    name: value.name as string,
    lane: value.lane as string,
    tag: value.tag as string,
    feed: value.feed as string,
    appName: value.appName as string,
    bundleId: value.bundleId as string,
    accent: value.accent as string,
    prerelease: value.prerelease,
    installs: value.installs as string,
    description: value.description as string,
    current: value.current,
  })
}

/** Parse the channel catalogue response. */
export function parseDesktopChannelsResponse(value: unknown): DesktopChannelsResponse {
  if (!isObject(value) || !Array.isArray(value.channels)) {
    throw new Error('dsh-plugin-desktop: invalid Desktop channels response')
  }
  const current = value.current
  if (current !== null && typeof current !== 'string') {
    throw new Error('dsh-plugin-desktop: invalid Desktop channels response')
  }
  const channels = value.channels.map(parseChannelView)
  return Object.freeze({ current, channels: Object.freeze(channels) })
}

/** Parse the outcome of checking one channel. */
export function parseDesktopChannelCheck(value: unknown): DesktopChannelCheck {
  if (!isObject(value) || typeof value.channel !== 'string') {
    throw new Error('dsh-plugin-desktop: invalid Desktop channel check response')
  }
  if (value.status === 'none') {
    return Object.freeze({ status: 'none' as const, channel: value.channel })
  }
  if (value.status === 'failed') {
    const reason = value.reason
    if (reason !== 'request' && reason !== 'response' && reason !== 'malformed' && reason !== 'unknown-channel') {
      throw new Error('dsh-plugin-desktop: invalid Desktop channel failure')
    }
    return Object.freeze({ status: 'failed' as const, channel: value.channel, reason })
  }
  if (value.status !== 'offer'
    || typeof value.version !== 'string'
    || typeof value.newer !== 'boolean') {
    throw new Error('dsh-plugin-desktop: invalid Desktop channel check response')
  }
  return Object.freeze({
    status: 'offer' as const,
    channel: value.channel,
    version: value.version,
    newer: value.newer,
    dmg: parseChannelArtifact(value.dmg),
    sums: parseChannelArtifact(value.sums),
  })
}

/** Parse the outcome of preparing one channel's build. */
export function parseDesktopChannelDownload(value: unknown): DesktopChannelDownload {
  if (!isObject(value) || typeof value.status !== 'string') {
    throw new Error('dsh-plugin-desktop: invalid Desktop channel download response')
  }
  if (value.status === 'failed') {
    const reason = value.reason
    const reasons: readonly DesktopChannelDownloadFailure[] = [
      'unknown-channel', 'no-release', 'no-artifact', 'request', 'response', 'malformed',
      'download', 'checksum-missing', 'checksum-mismatch', 'too-large', 'io',
    ]
    if (typeof value.channel !== 'string' || !reasons.includes(reason as DesktopChannelDownloadFailure)) {
      throw new Error('dsh-plugin-desktop: invalid Desktop channel download failure')
    }
    return Object.freeze({ status: 'failed' as const, channel: value.channel, reason: reason as DesktopChannelDownloadFailure })
  }
  if ((value.status !== 'verified' && value.status !== 'stored')
    || typeof value.version !== 'string'
    || typeof value.name !== 'string'
    || typeof value.path !== 'string') {
    throw new Error('dsh-plugin-desktop: invalid Desktop channel download response')
  }
  return Object.freeze({ status: value.status, version: value.version, name: value.name, path: value.path })
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`dsh-plugin-desktop: Desktop settings request failed (${String(response.status)})`)
  }
  try {
    return await response.json() as unknown
  } catch {
    throw new Error('dsh-plugin-desktop: Desktop settings response was not JSON')
  }
}

function post(fetcher: FetchLike, path: string, body: object): Promise<Response> {
  return fetcher(path, {
    method: 'POST',
    credentials: 'same-origin',
    redirect: 'error',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

/** Construct the default same-origin API, with a fetch seam for focused tests. */
export function createDesktopSettingsApi(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): DesktopSettingsApi {
  return Object.freeze({
    async read() {
      const response = await fetcher(SETTINGS_PATH, {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
      })
      return parseDesktopSettingsView(await readResponse(response))
    },
    async createProfile(name: string) {
      return parseDesktopSettingsView(await readResponse(await post(fetcher, PROFILE_CREATE_PATH, { name })))
    },
    async selectProfile(name: string) {
      return parseDesktopRestartAcceptance(await readResponse(await post(fetcher, PROFILE_SELECT_PATH, { name })))
    },
    async deleteProfile(name: string) {
      return parseDesktopSettingsView(await readResponse(await post(fetcher, PROFILE_DELETE_PATH, { name })))
    },
    async selectAa(enabled: boolean) {
      return parseDesktopRestartAcceptance(await readResponse(await post(fetcher, AA_SELECT_PATH, { enabled })))
    },
    async selectMarket(provider: DesktopMarketProvider) {
      return parseDesktopRestartAcceptance(await readResponse(await post(fetcher, MARKET_SELECT_PATH, { provider })))
    },
    async openTerminal() {
      parseDesktopActionAcceptance(await readResponse(await post(fetcher, TERMINAL_OPEN_PATH, {})))
    },
    async restart() {
      parseDesktopActionAcceptance(await readResponse(await post(fetcher, RESTART_PATH, {})))
    },
    async restartToRecovery() {
      parseDesktopActionAcceptance(await readResponse(await post(fetcher, RECOVERY_RESTART_PATH, {})))
    },
    async reloadRenderer() {
      parseDesktopActionAcceptance(await readResponse(await post(fetcher, RENDERER_RELOAD_PATH, {})))
    },
    async toggleDeveloperTools() {
      parseDesktopActionAcceptance(await readResponse(await post(fetcher, DEVELOPER_TOOLS_TOGGLE_PATH, {})))
    },
    async checkForUpdates() {
      parseDesktopActionAcceptance(await readResponse(await post(fetcher, UPDATE_CHECK_PATH, {})))
    },
    async channels() {
      return parseDesktopChannelsResponse(await readResponse(await post(fetcher, CHANNELS_PATH, {})))
    },
    async checkChannel(channel: string) {
      return parseDesktopChannelCheck(await readResponse(await post(fetcher, CHANNEL_CHECK_PATH, { channel })))
    },
    async prepareChannel(channel: string) {
      return parseDesktopChannelDownload(await readResponse(await post(fetcher, CHANNEL_DOWNLOAD_PATH, { channel })))
    },
    async exportDiagnostics() {
      parseDesktopActionAcceptance(await readResponse(await post(fetcher, DIAGNOSTICS_EXPORT_PATH, {})))
    },
  })
}

export const desktopSettingsPaths = Object.freeze({
  settings: SETTINGS_PATH,
  profileCreate: PROFILE_CREATE_PATH,
  profileSelect: PROFILE_SELECT_PATH,
  profileDelete: PROFILE_DELETE_PATH,
  marketSelect: MARKET_SELECT_PATH,
  terminalOpen: TERMINAL_OPEN_PATH,
  restart: RESTART_PATH,
  recoveryRestart: RECOVERY_RESTART_PATH,
  rendererReload: RENDERER_RELOAD_PATH,
  developerToolsToggle: DEVELOPER_TOOLS_TOGGLE_PATH,
  updateCheck: UPDATE_CHECK_PATH,
  channels: CHANNELS_PATH,
  channelCheck: CHANNEL_CHECK_PATH,
  channelDownload: CHANNEL_DOWNLOAD_PATH,
  diagnosticsExport: DIAGNOSTICS_EXPORT_PATH,
})
