/** Private same-origin Desktop settings API shared with the bundled renderer. */

import type { DesktopMarketProvider } from './desktop-market.ts'

/** Read the current Desktop-owned settings state. */
export const DESKTOP_SETTINGS_PATH = '/api/desktop/settings'

/** Create one safe Web profile without selecting it. */
export const DESKTOP_PROFILE_CREATE_PATH = '/api/desktop/profiles/create'

/** Select one compatible profile for the next Desktop generation. */
export const DESKTOP_PROFILE_SELECT_PATH = '/api/desktop/profiles/select'

/** Delete one inactive, user-created Web Profile. */
export const DESKTOP_PROFILE_DELETE_PATH = '/api/desktop/profiles/delete'

/** Persist the Market provider selected for the next Desktop generation. */
export const DESKTOP_AA_SELECT_PATH = '/api/desktop/aa/select'

export const DESKTOP_MARKET_SELECT_PATH = '/api/desktop/market/select'

/** Open the launcher-owned DSH terminal without accepting command text. */
export const DESKTOP_TERMINAL_OPEN_PATH = '/api/desktop/terminal/open'

/** Queue an orderly Desktop relaunch after acknowledging the renderer. */
export const DESKTOP_RESTART_PATH = '/api/desktop/restart'

/** Queue an orderly relaunch that opens the recovery assistant before Host boot. */
export const DESKTOP_RECOVERY_RESTART_PATH = '/api/desktop/restart/recovery'

/** Reload the renderer through the launcher without exposing Electron APIs. */
export const DESKTOP_RENDERER_RELOAD_PATH = '/api/desktop/developer/reload'

/** Toggle the mounted window's Developer Tools through the launcher. */
export const DESKTOP_DEVELOPER_TOOLS_TOGGLE_PATH = '/api/desktop/developer/devtools'

/** Run the generation-owned manual update check. */
export const DESKTOP_UPDATE_CHECK_PATH = '/api/desktop/updates/check'

/** Read the channels this build knows and which one it is. */
export const DESKTOP_CHANNELS_PATH = '/api/desktop/updates/channels'

/** Ask one channel whether it offers a newer build. */
export const DESKTOP_CHANNEL_CHECK_PATH = '/api/desktop/updates/channel-check'

/** Download and verify one channel's build into its own cache directory. */
export const DESKTOP_CHANNEL_DOWNLOAD_PATH = '/api/desktop/updates/channel-download'

/** Apply the update a channel offers: download its layer, then hand over and quit. */
export const DESKTOP_CHANNEL_APPLY_PATH = '/api/desktop/updates/channel-apply'

/** Export one local diagnostic archive through the launcher-owned flow. */
export const DESKTOP_DIAGNOSTICS_EXPORT_PATH = '/api/desktop/diagnostics/export'

/** Renderer-safe projection of one discovered profile. */
export interface DesktopSettingsProfileView {
  /** Profile name accepted by the launcher. */
  readonly name: string
  /** Whether its manifest already exists on disk. */
  readonly exists: boolean
  /** Whether it contains the Web application required by Desktop. */
  readonly webCapable: boolean
  /** Whether the launcher can select it. */
  readonly selectable: boolean
  /** Whether the profile can be removed without affecting recovery state. */
  readonly deletable: boolean
}

/** Requested and generation-effective Market provider state. */
export interface DesktopSettingsMarketView {
  /** Explicit or fail-safe provider requested on disk. */
  readonly requested: DesktopMarketProvider
  /** Provider composed into the currently running generation. */
  readonly effective: DesktopMarketProvider
  /** Whether an absent or invalid legacy state produced the fail-safe default. */
  readonly legacyDefaulted: boolean
}

/** Marker-free ordinary-browser URLs for the running Web generation. */
export interface DesktopSettingsWebView {
  /** Always-available loopback URL using the actual listening port. */
  readonly localUrl: string
  /** Authenticated HTTPS URLs; non-empty only while the LAN edge is ready. */
  readonly lanUrls: readonly string[]
  /** Actual hot edge state, distinct from the persisted LAN preference. */
  readonly lanState: 'inactive' | 'starting' | 'ready' | 'failed'
  /** Stable certificate/bind failure category, present only for a failed edge. */
  readonly lanError: string | null
  /** SHA-256 identity for the installation-local CA, when available. */
  readonly lanCaFingerprint: string | null
  /** Public CA downloads on each ready HTTPS authority, without auth tokens. */
  readonly lanCaUrls: readonly string[]
}

/** Complete renderer-safe Desktop settings state. */
export interface DesktopSettingsResponse {
  /** Profile backing the currently running generation. */
  readonly current: string
  /** Fresh profile discovery without filesystem paths or manifest details. */
  readonly profiles: readonly DesktopSettingsProfileView[]
  /** Market choice for the current and next generation. */
  readonly aa: { readonly requested: boolean; readonly effective: boolean }
  readonly market: DesktopSettingsMarketView
  /** Actual browser URLs for the current WebServer generation. */
  readonly web: DesktopSettingsWebView
}

/** Exact body accepted by the profile-creation endpoint. */
export interface DesktopProfileCreateRequest {
  readonly name: string
}

/** Successful creation returns a fresh state that includes the new profile. */
export type DesktopProfileCreateResponse = DesktopSettingsResponse

/** Exact body accepted by the profile-selection endpoint. */
export interface DesktopProfileSelectRequest {
  readonly name: string
}

/** Successful persisted selection returned before the Host restarts. */
export interface DesktopRestartAcceptance {
  readonly accepted: true
  readonly restartRequired: boolean
}

/** Successful profile selection handoff. */
export type DesktopProfileSelectResponse = DesktopRestartAcceptance

/** Exact body accepted by the profile-deletion endpoint. */
export interface DesktopProfileDeleteRequest {
  readonly name: string
}

/** Successful deletion returns a fresh state without the removed profile. */
export type DesktopProfileDeleteResponse = DesktopSettingsResponse

/** Exact body accepted by the Market-provider endpoint. */
export interface DesktopMarketSelectRequest {
  readonly provider: DesktopMarketProvider
}

/** Successful Market selection handoff. */
export type DesktopMarketSelectResponse = DesktopRestartAcceptance

/** Exact empty body accepted by the terminal endpoint. */
export type DesktopTerminalOpenRequest = Readonly<Record<string, never>>

/** Successful handoff to the launcher-owned terminal action. */
export interface DesktopTerminalOpenResponse {
  readonly accepted: true
}

/** Exact empty body accepted by the explicit restart endpoint. */
export type DesktopRestartRequest = Readonly<Record<string, never>>

/** Successful handoff to the launcher's orderly relaunch flow. */
export interface DesktopRestartResponse {
  readonly accepted: true
}

/** Exact empty body accepted by the recovery-restart endpoint. */
export type DesktopRecoveryRestartRequest = Readonly<Record<string, never>>

/** Successful handoff to the launcher's recovery relaunch flow. */
export type DesktopRecoveryRestartResponse = DesktopRestartResponse

/** Exact empty body accepted by the renderer-reload endpoint. */
export type DesktopRendererReloadRequest = Readonly<Record<string, never>>

/** Successful handoff to the launcher-owned renderer reload. */
export interface DesktopRendererReloadResponse {
  readonly accepted: true
}

/** Exact empty body accepted by the Developer Tools endpoint. */
export type DesktopDeveloperToolsToggleRequest = Readonly<Record<string, never>>

/** Successful handoff to the launcher-owned Developer Tools action. */
export interface DesktopDeveloperToolsToggleResponse {
  readonly accepted: true
}

/** Exact empty body accepted by the manual update-check endpoint. */
export type DesktopUpdateCheckRequest = Readonly<Record<string, never>>

/** Successful completion of the interactive update-check flow. */
export interface DesktopUpdateCheckResponse {
  readonly accepted: true
}

/** One channel as the renderer may see it, with no host references. */
export interface DesktopChannelView {
  /** Registry slug. */
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

/** Exact body accepted by the per-channel check endpoint. */
export interface DesktopChannelCheckRequest {
  /** Registry slug to check. */
  readonly channel: string
}

/** One downloadable file offered by a channel. */
export interface DesktopChannelArtifact {
  /** Published file name. */
  readonly name: string
  /** Direct download URL. */
  readonly url: string
}

/** Outcome of checking one channel. */
export type DesktopChannelCheckResponse =
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
  | {
    readonly status: 'failed'
    /** Channel that was checked. */
    readonly channel: string
    /** Which step failed: transport, response, payload, or an undeclared channel. */
    readonly reason: DesktopChannelCheckOutcomeFailure
  }

/** Reasons a channel check can fail, as the renderer may see them. */
export type DesktopChannelCheckOutcomeFailure = 'request' | 'response' | 'malformed' | 'unknown-channel'

/** Exact body accepted by the channel download endpoint. */
export interface DesktopChannelDownloadRequest {
  /** Registry slug whose build should be prepared. */
  readonly channel: string
}

/** Outcome of preparing one channel's build. */
export type DesktopChannelDownloadResponse =
  | {
    readonly status: 'verified'
    /** Version that was downloaded. */
    readonly version: string
    /** Published file name. */
    readonly name: string
    /** Absolute path of the verified file. */
    readonly path: string
  }
  | {
    readonly status: 'stored'
    /** Version that was downloaded. */
    readonly version: string
    /** Published file name. */
    readonly name: string
    /** Absolute path of the file; the release published no checksums. */
    readonly path: string
  }
  | {
    readonly status: 'failed'
    /** Channel that was asked. */
    readonly channel: string
    /** Which step failed. */
    readonly reason: DesktopChannelDownloadOutcomeFailure
  }

/** Exact body accepted by the channel apply endpoint. */
export interface DesktopChannelApplyRequest {
  /** Registry slug whose update should be applied. */
  readonly channel: string
}

/** Outcome of starting to apply one channel's update. */
export type DesktopChannelApplyResponse =
  | {
    readonly status: 'started'
    /** Channel whose update is being applied. */
    readonly channel: string
    /** Layer the update turned out to be. */
    readonly layer: 'payload' | 'full'
  }
  | {
    readonly status: 'failed'
    /** Channel that was asked. */
    readonly channel: string
    /** Which step failed. */
    readonly reason: DesktopChannelApplyOutcomeFailure
  }

/** Reasons applying a channel update can fail, as the renderer may see them. */
export type DesktopChannelApplyOutcomeFailure =
  | 'unknown-channel'
  | 'no-release'
  | 'no-feed'
  | 'unverifiable'
  | 'download'
  | 'checksum-missing'
  | 'checksum-mismatch'
  | 'too-large'
  | 'io'

/** Reasons a channel download can fail, as the renderer may see them. */
export type DesktopChannelDownloadOutcomeFailure =
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

/** Exact empty body accepted by the diagnostic-export endpoint. */
export type DesktopDiagnosticsExportRequest = Readonly<Record<string, never>>

/** Successful handoff to the launcher-owned diagnostic export flow. */
export interface DesktopDiagnosticsExportResponse {
  readonly accepted: true
}

/** Stable API failure shape that never contains native paths or raw causes. */
export interface DesktopSettingsErrorResponse {
  readonly error: string
}
