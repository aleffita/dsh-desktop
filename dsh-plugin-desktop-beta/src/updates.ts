/** Cordis Host plugin for scheduled and interactive DSH Desktop updates. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import {
  DESKTOP_CHANNELS_PATH,
  DESKTOP_CHANNEL_APPLY_PATH,
  DESKTOP_CHANNEL_CHECK_PATH,
  DESKTOP_CHANNEL_DOWNLOAD_PATH,
  DESKTOP_UPDATE_CHECK_PATH,
} from './desktop-settings-contract.ts'
import type { DesktopChannelApplyResponse, DesktopChannelDownloadResponse } from './desktop-settings-contract.ts'
import {
  handleDesktopChannelApplyRequest,
  handleDesktopChannelCheckRequest,
  handleDesktopChannelDownloadRequest,
  handleDesktopChannelsRequest,
  handleDesktopUpdateCheckRequest,
} from './desktop-settings-route.ts'
import type { FitaChannel } from './fita-channel.ts'
import { downloadFitaArtifact } from './fita-download.ts'
import { startFitaUpdate } from './fita-update-action.ts'
import { checkFitaChannelReleases, readFitaChannelFeed } from './fita-release-source.ts'
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
        version: check.version,
        cacheRoot,
        artifact: { name: check.dmg.name, url: check.dmg.browser_download_url },
        sums: check.sums === undefined ? null : { name: check.sums.name, url: check.sums.browser_download_url },
        request,
      })
      if (result.status === 'failed') return { status: 'failed', channel: channel.slug, reason: result.reason }
      return { status: result.status, version: check.version, name: result.name, path: result.path }
    }
    // Applying is the one action that ends this process: the started child waits for it to
    // exit, so the last thing done here is asking the runtime to leave in order.
    const applyChannel = async (channel: FitaChannel): Promise<DesktopChannelApplyResponse> => {
      const runtime = ctx.desktopRuntime.updates
      const running = runtime.fitaChannel
      // Only this build's own channel may be applied: another channel's build would replace
      // this product with a different one under the same name.
      if (running === undefined || running.slug !== channel.slug) {
        return { status: 'failed', channel: channel.slug, reason: 'unknown-channel' }
      }
      const check = await checkFitaChannelReleases({
        channel,
        currentVersion: runtime.currentVersion,
        request: runtime.request,
      })
      if (check.status === 'failed' || check.status === 'none' || !check.newer) {
        return { status: 'failed', channel: channel.slug, reason: 'no-release' }
      }
      // Without a feed there is no layer to choose, and an update cannot be applied blind.
      if (check.feed === undefined) return { status: 'failed', channel: channel.slug, reason: 'no-feed' }
      const layer = await readFitaChannelFeed({ url: check.feed.browser_download_url, channel, request: runtime.request })
      if (layer === undefined) return { status: 'failed', channel: channel.slug, reason: 'no-feed' }
      // The bundle this app runs from, derived from Electron's resources path rather than
      // asked of a capability: `Contents/Resources` sits inside `<app>.app/Contents`.
      const resourcesPath = (process as { resourcesPath?: string }).resourcesPath
      if (resourcesPath === undefined) return { status: 'failed', channel: channel.slug, reason: 'io' }
      const appPath = dirname(dirname(resourcesPath))
      const started = await startFitaUpdate({
        channel,
        layer,
        version: check.version,
        appPath,
        executable: process.execPath,
        cacheRoot,
        staging: join(cacheRoot, 'staging'),
        artifactUrl: new URL(layer.file.url, check.feed.browser_download_url).href,
        request: runtime.request,
        spawn: (command, args, options) => {
          const child = spawn(command, [...args], options)
          // The child has to outlive this process, so it is not waited on.
          child.unref()
        },
        currentPid: process.pid,
      })
      if (started.status === 'failed') return { status: 'failed', channel: channel.slug, reason: started.reason }
      const quit = runtime.quitForHandover
      if (quit === undefined) return { status: 'failed', channel: channel.slug, reason: 'io' }
      await quit()
      return { status: 'started', channel: channel.slug, layer: started.layer }
    }
    const unregisterChannelApply = ctx.webServer.register({
      kind: 'exact',
      path: DESKTOP_CHANNEL_APPLY_PATH,
      handler: (req, res) => {
        const rejection = ctx.connection.requestRejection(req)
        if (rejection !== undefined) {
          res.writeHead(rejection)
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        return handleDesktopChannelApplyRequest(
          req,
          res,
          rendererOrigin,
          applyChannel,
          (operation, cause) => {
            ctx.logger.error(
              `dsh-plugin-desktop: failed to ${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
            )
          },
        )
      },
    })
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
      unregisterChannelApply()
      unregisterChannelDownload()
      unregisterChannels()
      unregisterChannelCheck()
      await lifecycle.dispose()
    }
  }, 'dsh-plugin-desktop: update polling, confirmation, and installer handoff')
}
