/** Independent Desktop frame portalled above the upstream content viewport. */

import { LayoutTemplate, PanelTop, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DesktopChannelCheck, DesktopChannelsResponse, DesktopSettingsApi } from './desktop-settings-api.ts'
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
  > & Partial<Pick<DesktopSettingsApi, 'channels' | 'checkChannel'>>
  readonly remoteControl?: { readonly seen: boolean; open(): Promise<void> }
  readonly setMode: (mode: DesktopClientMode) => Promise<void>
}

/** What the last check of the running channel answered. */
type ChannelOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'upstream' }
  | { readonly kind: 'channel'; readonly result: DesktopChannelCheck }
  | { readonly kind: 'failed' }

export function DesktopVersionControl({
  version,
  checkForUpdates,
  channels,
  checkChannel,
  t,
}: {
  readonly version: string
  readonly checkForUpdates: () => Promise<void>
  readonly channels?: () => Promise<DesktopChannelsResponse>
  readonly checkChannel?: (channel: string) => Promise<DesktopChannelCheck>
  readonly t: (key: DesktopSettingsLocaleKey) => string
}) {
  const [checking, setChecking] = useState(false)
  const [outcome, setOutcome] = useState<ChannelOutcome>({ kind: 'idle' })
  const [catalogue, setCatalogue] = useState<DesktopChannelsResponse | undefined>(undefined)
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
  const runCheck = (): void => {
    if (checking) return
    setChecking(true)
    setOutcome({ kind: 'idle' })
    // A stamped build asks its own channel; an unstamped one keeps the upstream
    // check, because we have no channel to ask on its behalf.
    const task = current !== null && checkChannel !== undefined
      ? checkChannel(current).then(result => { setOutcome({ kind: 'channel', result }) })
      : checkForUpdates().then(() => { setOutcome({ kind: 'upstream' }) })
    void task
      .catch(() => { setOutcome({ kind: 'failed' }) })
      .finally(() => { setChecking(false) })
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
          <strong>{running?.name ?? t('channelUnknown')}</strong>
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
        <ChannelOutcomeLine outcome={outcome} t={t} />
      </HoverCardContent>
    </HoverCard>
  )
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
