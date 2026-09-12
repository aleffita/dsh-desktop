/** Independent Desktop frame portalled above the upstream content viewport. */

import { LayoutTemplate, PanelTop, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  DesktopChannelApply,
  DesktopChannelCheck,
  DesktopChannelDownload,
  DesktopChannelsResponse,
  DesktopSettingsApi,
} from './desktop-settings-api.ts'
import type { DesktopClientEnvironment, DesktopClientMode } from './environment.ts'
import { DesktopNativeActions } from './DesktopNativeActions.tsx'
import { Button } from '../native-ui/components/ui/button.tsx'
import type { DesktopSettingsLocaleKey } from './desktop-settings-locales.ts'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '../native-ui/components/ui/hover-card.tsx'

export interface DesktopFrameTitlebarInjected {
  readonly environment: DesktopClientEnvironment
  readonly api: Pick<
    DesktopSettingsApi,
    'openTerminal' | 'restart' | 'restartToRecovery' | 'reloadRenderer' | 'toggleDeveloperTools' | 'checkForUpdates'
  > & Partial<Pick<DesktopSettingsApi, 'channels' | 'checkChannel' | 'prepareChannel' | 'applyChannel'>>
  readonly remoteControl?: { readonly seen: boolean; open(): Promise<void> }
  readonly setMode: (mode: DesktopClientMode) => Promise<void>
}

/** What the last check of the running channel answered. */
type ChannelOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'upstream' }
  | { readonly kind: 'channel'; readonly result: DesktopChannelCheck }
  | { readonly kind: 'failed' }
  | { readonly kind: 'download'; readonly result: DesktopChannelDownload }
  | { readonly kind: 'applying'; readonly result: DesktopChannelApply }

export function DesktopVersionControl({
  version,
  checkForUpdates,
  channels,
  checkChannel,
  prepareChannel,
  applyChannel,
  t,
}: {
  readonly version: string
  readonly checkForUpdates: () => Promise<void>
  readonly channels?: () => Promise<DesktopChannelsResponse>
  readonly checkChannel?: (channel: string) => Promise<DesktopChannelCheck>
  readonly prepareChannel?: (channel: string) => Promise<DesktopChannelDownload>
  readonly applyChannel?: (channel: string) => Promise<DesktopChannelApply>
  readonly t: (key: DesktopSettingsLocaleKey) => string
}) {
  const [checking, setChecking] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [outcome, setOutcome] = useState<ChannelOutcome>({ kind: 'idle' })
  const [catalogue, setCatalogue] = useState<DesktopChannelsResponse | undefined>(undefined)
  const [asked, setAsked] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (channels === undefined) return
    let active = true
    void channels()
      .then((response) => { if (active) setCatalogue(response) })
      .catch(() => { if (active) setCatalogue(undefined) })
    return () => { active = false }
  }, [channels])
  const current = catalogue?.current ?? null
  const running = catalogue?.channels.find(channel => channel.slug === current)
  // What the popover is asking about: the running channel unless the user picked
  // another one to compare against.
  const target = asked ?? current
  const runCheck = (): void => {
    if (checking) return
    setChecking(true)
    setOutcome({ kind: 'idle' })
    // A stamped build asks its channel; an unstamped one keeps the upstream check,
    // because we have no channel to ask on its behalf.
    const task = target !== null && checkChannel !== undefined
      ? checkChannel(target).then(result => { setOutcome({ kind: 'channel', result }) })
      : checkForUpdates().then(() => { setOutcome({ kind: 'upstream' }) })
    void task
      .catch(() => { setOutcome({ kind: 'failed' }) })
      .finally(() => { setChecking(false) })
  }
  // A build is only worth preparing when the check found a newer one that carries
  // an artifact; anything else would download nothing.
  // Only the running channel may be prepared: installing another channel's build
  // over this bundle would replace one channel with a different product.
  const offered = outcome.kind === 'channel'
    && outcome.result.status === 'offer'
    && outcome.result.newer
    && outcome.result.dmg !== null
    && asked === undefined
    && (current === null || outcome.result.channel === current)
  const runPrepare = (): void => {
    if (preparing || current === null || prepareChannel === undefined) return
    setPreparing(true)
    void prepareChannel(current)
      .then(result => { setOutcome({ kind: 'download', result }) })
      .catch(() => { setOutcome({ kind: 'failed' }) })
      .finally(() => { setPreparing(false) })
  }
  // Applying is the step that ends this process, so it is offered only for the running
  // channel and only when a check found something newer there.
  const canApply = offered && applyChannel !== undefined
  const runApply = (): void => {
    if (applying || current === null || applyChannel === undefined) return
    setApplying(true)
    void applyChannel(current)
      .then(result => { setOutcome({ kind: 'applying', result }) })
      .catch(() => { setOutcome({ kind: 'failed' }) })
      .finally(() => { setApplying(false) })
  }
  const visibleVersion = `v${version}`
  return (
    <HoverCard>
      <HoverCardTrigger
        closeDelay={200}
        delay={150}
        render={<button type="button" className="dshDesktopFrameVersion" />}
        aria-label={`${t('currentVersion')} ${visibleVersion}`}
      >
        {visibleVersion}
        {running !== undefined && <span className="dshDesktopFrameChannel"> {running.name}</span>}
      </HoverCardTrigger>
      <HoverCardContent className="dshDesktopVersionPopover">
        <div className="dshDesktopVersionPopoverHeader">
          <span>{t('currentVersion')}</span>
          <strong>{visibleVersion}</strong>
        </div>
        <div className="dshDesktopVersionPopoverChannel">
          <span>{t('channelLabel')}</span>
          {catalogue === undefined || current === null
            ? <strong>{running?.name ?? t('channelUnknown')}</strong>
            : (
              <select
                className="dshDesktopVersionChannelSelect"
                aria-label={t('channelLabel')}
                value={target ?? current}
                onChange={event => { setAsked(event.target.value === current ? undefined : event.target.value) }}
              >
                {catalogue.channels.map(channel => (
                  <option key={channel.slug} value={channel.slug}>
                    {channel.slug === current ? `${channel.name} (${t('channelCurrent')})` : channel.name}
                  </option>
                ))}
              </select>
            )}
        </div>
        <Button
          className="dshDesktopVersionCheckButton"
          disabled={checking}
          size="sm"
          variant="outline"
          onClick={runCheck}
        >
          <RefreshCw aria-hidden="true" />
          <span>{t(checking ? 'checkingForUpdates' : 'checkForUpdates')}</span>
        </Button>
        {offered && prepareChannel !== undefined && (
          <Button
            className="dshDesktopVersionCheckButton"
            disabled={preparing}
            size="sm"
            variant="outline"
            onClick={runPrepare}
          >
            <span>{t(preparing ? 'channelPreparing' : 'channelPrepare')}</span>
          </Button>
        )}
        {canApply && (
          <Button
            className="dshDesktopVersionCheckButton"
            disabled={applying}
            size="sm"
            variant="outline"
            onClick={runApply}
          >
            <span>{t(applying ? 'channelApplying' : 'channelApply')}</span>
          </Button>
        )}
        <ChannelOutcomeLine outcome={outcome} t={t} />
      </HoverCardContent>
    </HoverCard>
  )
}

/** How starting an applied update is presented, without React. */
export interface ChannelApplyPresentation {
  /** Whether the line is an error or information. */
  readonly severity: 'note' | 'error'
  /** Locale key to render. */
  readonly key: DesktopSettingsLocaleKey
}

/**
 * Turn a started update into the one line the user sees.
 *
 * A started update ends this process, so there is nothing to report afterwards beyond the
 * layer it turned out to be; a failure keeps the app running and says so.
 * @param result - outcome of starting to apply an update.
 * @returns the severity and the copy.
 */
export function presentChannelApply(result: DesktopChannelApply): ChannelApplyPresentation {
  return result.status === 'started'
    ? { severity: 'note', key: result.layer === 'payload' ? 'channelApplying' : 'channelApplyingFull' }
    : { severity: 'error', key: 'channelApplyFailed' }
}

/** How one prepared build is presented, without React. */
export interface ChannelDownloadPresentation {
  /** Whether the line is an error or information. */
  readonly severity: 'note' | 'error'
  /** Locale key to render. */
  readonly key: DesktopSettingsLocaleKey
  /** Path to show, when a file is on disk. */
  readonly path?: string
}

/**
 * Turn a preparation result into the one line the user sees.
 *
 * `stored` is presented as what it is: the release published no checksums, so the
 * file is on disk and nothing more was proven.
 * @param result - outcome of preparing one channel's build.
 * @returns the severity, the copy, and a path when there is a file.
 */
export function presentChannelDownload(result: DesktopChannelDownload): ChannelDownloadPresentation {
  if (result.status === 'failed') return { severity: 'error', key: 'channelPrepareFailed' }
  return {
    severity: 'note',
    key: result.status === 'verified' ? 'channelPreparedVerified' : 'channelPreparedStored',
    path: result.path,
  }
}

/** How one channel check is presented, without React. */
export interface ChannelCheckPresentation {
  /** Whether the line is an error or information. */
  readonly severity: 'note' | 'error'
  /** Locale key to render. */
  readonly key: DesktopSettingsLocaleKey
  /** Version to append, when the message is about one. */
  readonly version?: string
}

/**
 * Turn a channel check into the one line the user sees.
 * @param result - outcome of checking one channel.
 * @returns the severity, the copy, and a version when there is one.
 */
export function presentChannelCheck(result: DesktopChannelCheck): ChannelCheckPresentation {
  if (result.status === 'none') return { severity: 'note', key: 'channelNone' }
  if (result.status === 'failed') {
    const keys = {
      request: 'channelFailedRequest',
      response: 'channelFailedResponse',
      malformed: 'channelFailedMalformed',
      'unknown-channel': 'channelFailedUnknown',
    } as const satisfies Record<typeof result.reason, DesktopSettingsLocaleKey>
    return { severity: 'error', key: keys[result.reason] }
  }
  if (!result.newer) return { severity: 'note', key: 'channelUpToDate' }
  return { severity: 'note', key: 'channelNewer', version: result.version }
}

/** Report exactly what the last check found, including "could not tell". */
function ChannelOutcomeLine({
  outcome,
  t,
}: {
  readonly outcome: ChannelOutcome
  readonly t: (key: DesktopSettingsLocaleKey) => string
}) {
  if (outcome.kind === 'idle') return null
  if (outcome.kind === 'failed') {
    return <span className="dshDesktopVersionCheckError" role="alert">{t('checkForUpdatesError')}</span>
  }
  if (outcome.kind === 'upstream') {
    return <span className="dshDesktopVersionCheckNote" role="status">{t('channelNone')}</span>
  }
  if (outcome.kind === 'applying') {
    const applied = presentChannelApply(outcome.result)
    const className = applied.severity === 'error' ? 'dshDesktopVersionCheckError' : 'dshDesktopVersionCheckNote'
    const role = applied.severity === 'error' ? 'alert' : 'status'
    return <span className={className} role={role}>{t(applied.key)}</span>
  }
  if (outcome.kind === 'download') {
    const prepared = presentChannelDownload(outcome.result)
    const className = prepared.severity === 'error' ? 'dshDesktopVersionCheckError' : 'dshDesktopVersionCheckNote'
    const role = prepared.severity === 'error' ? 'alert' : 'status'
    return (
      <span className={className} role={role}>
        {prepared.path === undefined ? t(prepared.key) : `${t(prepared.key)} ${prepared.path}`}
      </span>
    )
  }
  const presentation = presentChannelCheck(outcome.result)
  const className = presentation.severity === 'error' ? 'dshDesktopVersionCheckError' : 'dshDesktopVersionCheckNote'
  const role = presentation.severity === 'error' ? 'alert' : 'status'
  return (
    <span className={className} role={role}>
      {presentation.version === undefined
        ? t(presentation.key)
        : `${t(presentation.key)} v${presentation.version}`}
    </span>
  )
}

const MODE_OPTIONS = [
  { mode: 'compatibility', title: 'compatibilityMode', body: 'compatibilityModeBody' },
  { mode: 'extended', title: 'extendedMode', body: 'extendedModeBody' },
  { mode: 'advanced', title: 'advancedMode', body: 'advancedModeBody' },
] as const satisfies readonly {
  readonly mode: DesktopClientMode
  readonly title: DesktopSettingsLocaleKey
  readonly body: DesktopSettingsLocaleKey
}[]

function DesktopModeIcon({ mode }: { readonly mode: DesktopClientMode }) {
  if (mode === 'compatibility') return <LayoutTemplate aria-hidden="true" />
  if (mode === 'extended') return <PanelTop aria-hidden="true" />
  return <Sparkles aria-hidden="true" />
}

/** Persist a presentation choice before opening the standard Desktop restart confirmation. */
export async function selectDesktopFrameMode(
  mode: DesktopClientMode,
  setMode: (mode: DesktopClientMode) => Promise<void>,
  restart: () => Promise<void>,
): Promise<void> {
  await setMode(mode)
  await restart()
}

export function DesktopModeControl({
  mode,
  setMode,
  restart,
  t,
}: {
  readonly mode: DesktopClientMode
  readonly remoteControl?: { readonly seen: boolean; open(): Promise<void> }
  readonly setMode: (mode: DesktopClientMode) => Promise<void>
  readonly restart: () => Promise<void>
  readonly t: (key: DesktopSettingsLocaleKey) => string
}) {
  const [switching, setSwitching] = useState<DesktopClientMode>()
  const [failed, setFailed] = useState(false)
  const current = MODE_OPTIONS.find(option => option.mode === mode)
  if (current === undefined) return null

  const switchTo = (next: DesktopClientMode): void => {
    if (switching !== undefined || next === mode) return
    setSwitching(next)
    setFailed(false)
    void selectDesktopFrameMode(next, setMode, restart)
      .catch(() => { setFailed(true) })
      .finally(() => { setSwitching(undefined) })
  }

  return (
    <HoverCard>
      <HoverCardTrigger
        closeDelay={200}
        delay={150}
        render={<button type="button" className="dshDesktopFrameMode" />}
        aria-label={`${t('presentationTitle')}: ${t(current.title)}`}
      >
        {t(current.title)}
      </HoverCardTrigger>
      <HoverCardContent className="dshDesktopVersionPopover dshDesktopModePopover">
        <div className="dshDesktopModePopoverHeader">{t('switchPresentationMode')}</div>
        <div className="dshDesktopModeOptions" role="group" aria-label={t('switchPresentationMode')}>
          {MODE_OPTIONS.filter(option => option.mode !== mode).map(option => (
            <Button
              className="dshDesktopModeOption"
              disabled={switching !== undefined}
              key={option.mode}
              size="sm"
              variant="ghost"
              onClick={() => { switchTo(option.mode) }}
            >
              <DesktopModeIcon mode={option.mode} />
              <span className="dshDesktopModeOptionCopy">
                <strong>{t(option.title)}</strong>
                <small>{switching === option.mode ? t('switchingPresentationMode') : t(option.body)}</small>
              </span>
            </Button>
          ))}
        </div>
        {failed && <span className="dshDesktopVersionCheckError" role="alert">{t('switchPresentationModeError')}</span>}
      </HoverCardContent>
    </HoverCard>
  )
}

/** Horizontal frame surface; the unrelated upstream content starts below it. */
export function DesktopFrameTitlebarView({ api, environment, setMode, t, remoteControl }: DesktopFrameTitlebarInjected & {
  readonly t: (key: DesktopSettingsLocaleKey) => string
}) {
  return (
    <header
      className="dshDesktopFrameTitlebar"
      data-dsh-desktop-frame="titlebar"
      data-mode={environment.mode}
      data-platform={environment.platform}
      data-material={environment.material}
    >
      <div className="dshDesktopFrameIdentity">
        <span className="dshDesktopFrameProduct">DSH Desktop</span>
        <DesktopVersionControl
          version={environment.version}
          checkForUpdates={api.checkForUpdates}
          {...(api.channels === undefined ? {} : { channels: api.channels })}
          {...(api.checkChannel === undefined ? {} : { checkChannel: api.checkChannel })}
          {...(api.prepareChannel === undefined ? {} : { prepareChannel: api.prepareChannel })}
          {...(api.applyChannel === undefined ? {} : { applyChannel: api.applyChannel })}
          t={t}
        />
        <DesktopModeControl
          mode={environment.mode}
          setMode={setMode}
          restart={api.restart}
          t={t}
        />
      </div>
      <div className="dshDesktopFrameActions">
        {remoteControl && <button type="button" className="dshDesktopFrameMode dshDesktopRemoteControl" onClick={() => { void remoteControl.open().catch(() => {}) }}>
          {t('remoteControl')}{!remoteControl.seen && <span className="dshDesktopRemoteControlDot" aria-label={t('remoteControlNew')} />}
        </button>}
        <DesktopNativeActions api={api} t={t} placement="titlebar" />
      </div>
    </header>
  )
}
