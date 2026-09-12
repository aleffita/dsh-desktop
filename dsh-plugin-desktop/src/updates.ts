/** Cordis Host plugin for scheduled and interactive DSH Desktop updates. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { dirname, join } from 'node:path'
import {
  DESKTOP_CHANNELS_PATH,
  DESKTOP_CHANNEL_CHECK_PATH,
  DESKTOP_CHANNEL_DOWNLOAD_PATH,
  DESKTOP_UPDATE_CHECK_PATH,
} from './desktop-settings-contract.ts'
import type { DesktopChannelDownloadResponse } from './desktop-settings-contract.ts'
import {
  handleDesktopChannelCheckRequest,
  handleDesktopChannelDownloadRequest,
  handleDesktopChannelsRequest,
  handleDesktopUpdateCheckRequest,
} from './desktop-settings-route.ts'
import type { FitaChannel } from './fita-channel.ts'
import { downloadFitaArtifact } from './fita-download.ts'
import { checkFitaChannelReleases } from './fita-release-source.ts'
import type {} from './runtime.ts'
import { startDesktopUpdateLifecycle } from './update-lifecycle.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-updates'

/** Native adapter required for network, tray, confirmation, and installer access. */
export const inject = ['desktopRuntime', 'webServer', 'connection']

const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Scheduled update policy. */
export interface Config {
  /** Enable background checks in packaged applications. */
  enabled: boolean
  /** Delay before the first background check after plugin activation. */
  initialDelayMs: number
  /** Delay between completion of one background check and the next attempt. */
  intervalMs: number
  /** Maximum duration of one version request before caller-owned cancellation. */
  requestTimeoutMs: number
}

/** Validated scheduled update policy. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  initialDelayMs: z.number().step(1).min(0).max(MAX_TIMER_DELAY_MS).default(60_000),
  intervalMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(6 * 60 * 60 * 1000),
  requestTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(15_000),
})

/**
 * Register effect-scoped update polling and its dynamic tray command.
 * @param ctx - Host context carrying the desktop native adapter.
 * @param config - validated polling and timeout values.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => {
    const lifecycle = startDesktopUpdateLifecycle({
      adapter: ctx.desktopRuntime.updates,
      policy: config,
      locale: () => ctx.desktopRuntime.locale,
      registerTrayItem: item => ctx.desktopRuntime.registerTrayItem(item),
    })
    const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`
    const unregister = ctx.webServer.register({
      kind: 'exact',
      path: DESKTOP_UPDATE_CHECK_PATH,
      handler: (req, res) => {
        const rejection = ctx.connection.requestRejection(req)
        if (rejection !== undefined) {
          res.writeHead(rejection)
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        return handleDesktopUpdateCheckRequest(
          req,
          res,
          rendererOrigin,
          () => lifecycle.checkNow(),
          (operation, cause) => {
            ctx.logger.error(
              `dsh-plugin-desktop: failed to ${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
            )
          },
        )
      },
    })
    // Channels are ours, not upstream's: the renderer reads the catalogue and asks
    // one channel at a time, so it can show which channel this build is and what
    // each other channel currently offers.
    const unregisterChannels = ctx.webServer.register({
      kind: 'exact',
      path: DESKTOP_CHANNELS_PATH,
      handler: (req, res) => {
        const rejection = ctx.connection.requestRejection(req)
        if (rejection !== undefined) {
          res.writeHead(rejection)
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        return handleDesktopChannelsRequest(req, res, rendererOrigin, ctx.desktopRuntime.updates.fitaChannel)
      },
    })
    const unregisterChannelCheck = ctx.webServer.register({
      kind: 'exact',
      path: DESKTOP_CHANNEL_CHECK_PATH,
      handler: (req, res) => {
        const rejection = ctx.connection.requestRejection(req)
        if (rejection !== undefined) {
          res.writeHead(rejection)
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        return handleDesktopChannelCheckRequest(
          req,
          res,
          rendererOrigin,
          channel => checkFitaChannelReleases({
            channel,
            currentVersion: ctx.desktopRuntime.updates.currentVersion,
            request: ctx.desktopRuntime.updates.request,
          }),
          (operation, cause) => {
            ctx.logger.error(
              `dsh-plugin-desktop: failed to ${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
            )
          },
        )
      },
    })
    // Each channel gets its own cache directory: electron-builder's shared
    // `updaterCacheDirName` would have every channel writing to one path.
    const cacheRoot = join(dirname(ctx.desktopRuntime.updates.statePath), 'channels')
    const prepareChannel = async (channel: FitaChannel): Promise<DesktopChannelDownloadResponse> => {
      const request = ctx.desktopRuntime.updates.request
      const check = await checkFitaChannelReleases({
        channel,
        currentVersion: ctx.desktopRuntime.updates.currentVersion,
        request,
      })
      if (check.status === 'failed') return { status: 'failed', channel: channel.slug, reason: check.reason }
      if (check.status === 'none' || !check.newer) return { status: 'failed', channel: channel.slug, reason: 'no-release' }
      if (check.dmg === undefined) return { status: 'failed', channel: channel.slug, reason: 'no-artifact' }
      const result = await downloadFitaArtifact({
        channel,
        cacheRoot,
        artifact: { name: check.dmg.name, url: check.dmg.browser_download_url },
        sums: check.sums === undefined ? null : { name: check.sums.name, url: check.sums.browser_download_url },
        request,
      })
      if (result.status === 'failed') return { status: 'failed', channel: channel.slug, reason: result.reason }
      return { status: result.status, version: check.version, name: result.name, path: result.path }
    }
    const unregisterChannelDownload = ctx.webServer.register({
      kind: 'exact',
      path: DESKTOP_CHANNEL_DOWNLOAD_PATH,
      handler: (req, res) => {
        const rejection = ctx.connection.requestRejection(req)
        if (rejection !== undefined) {
          res.writeHead(rejection)
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        return handleDesktopChannelDownloadRequest(
          req,
          res,
          rendererOrigin,
          prepareChannel,
          (operation, cause) => {
            ctx.logger.error(
              `dsh-plugin-desktop: failed to ${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
            )
          },
        )
      },
    })
    return async () => {
      unregister()
      unregisterChannelDownload()
      unregisterChannels()
      unregisterChannelCheck()
      await lifecycle.dispose()
    }
  }, 'dsh-plugin-desktop: update polling, confirmation, and installer handoff')
}
