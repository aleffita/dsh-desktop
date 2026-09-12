/** Strict loopback HTTP handlers for the private Desktop settings API. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { assertDesktopProfileName } from './profile-manager.ts'
import type { DesktopMarketProvider } from './desktop-market.ts'
import type DesktopSettingsController from './desktop-settings-controller.ts'
import type { DesktopSettingsPostResponse } from './desktop-settings-controller.ts'
import { fitaChannel, FITA_CHANNELS, type FitaChannel } from './fita-channel.ts'
import type { FitaChannelCheck } from './fita-release-source.ts'
import type {
  DesktopChannelCheckResponse,
  DesktopChannelsResponse,
  DesktopMarketSelectRequest,
  DesktopProfileCreateRequest,
  DesktopProfileDeleteRequest,
  DesktopProfileSelectRequest,
  DesktopSettingsErrorResponse,
} from './desktop-settings-contract.ts'

const MAX_SETTINGS_BODY_BYTES = 16 * 1024

class BodyTooLargeError extends Error {}

function finishJson(
  res: ServerResponse,
  statusCode: number,
  value: object,
  allow?: 'GET' | 'POST',
): void {
  res.statusCode = statusCode
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  if (allow !== undefined) res.setHeader('allow', allow)
  res.end(JSON.stringify(value))
}

function error(message: string): DesktopSettingsErrorResponse {
  return { error: message }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '[::1]'
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  if (address === '::1' || address === '127.0.0.1') return true
  if (address.startsWith('::ffff:')) {
    const mapped = address.slice('::ffff:'.length)
    return mapped.startsWith('127.')
  }
  return address.startsWith('127.')
}

function expectedLoopbackOrigin(expectedOrigin: string): URL | undefined {
  try {
    const url = new URL(expectedOrigin)
    if (url.origin !== expectedOrigin || url.protocol !== 'http:'
      || url.username !== '' || url.password !== ''
      || !isLoopbackHostname(url.hostname)) return undefined
    return url
  } catch {
    return undefined
  }
}

function exactHeaderOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    return url.origin === value ? value : undefined
  } catch {
    return undefined
  }
}

function referrerOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

/**
 * Require the actual socket and Host to stay on the configured loopback origin.
 * A mutating request must carry the exact Origin. A read-only browser GET may
 * use the standard same-origin fetch metadata plus its same-origin referrer,
 * because browsers commonly omit Origin on same-origin GET requests.
 */
function isSameOriginLoopbackRequest(
  req: IncomingMessage,
  expectedOrigin: string,
  mutating: boolean,
): boolean {
  const expected = expectedLoopbackOrigin(expectedOrigin)
  if (expected === undefined || !isLoopbackAddress(req.socket.remoteAddress)) return false
  if (req.headers.host?.toLowerCase() !== expected.host.toLowerCase()) return false
  if (exactHeaderOrigin(req.headers.origin) === expected.origin) {
    return req.headers['sec-fetch-site'] === undefined || req.headers['sec-fetch-site'] === 'same-origin'
  }
  if (mutating) return false
  return req.headers['sec-fetch-site'] === 'same-origin'
    && referrerOrigin(req.headers.referer) === expected.origin
}

function isJsonRequest(req: IncomingMessage): boolean {
  return req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const declaredLength = req.headers['content-length']
  if (declaredLength !== undefined) {
    if (!/^\d+$/.test(declaredLength)) throw new SyntaxError('invalid content length')
    if (Number(declaredLength) > MAX_SETTINGS_BODY_BYTES) throw new BodyTooLargeError()
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.byteLength
    if (size > MAX_SETTINGS_BODY_BYTES) throw new BodyTooLargeError()
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function isExactRecord(value: unknown, key: string): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 1
    && Object.prototype.hasOwnProperty.call(value, key)
}

function parseProfileRequest(value: unknown): DesktopProfileCreateRequest | undefined {
  if (!isExactRecord(value, 'name') || typeof value.name !== 'string') return undefined
  try {
    assertDesktopProfileName(value.name)
    return { name: value.name }
  } catch {
    return undefined
  }
}

function isMarketProvider(value: unknown): value is DesktopMarketProvider {
  return value === 'disabled' || value === 'community-market' || value === 'dsh-market'
}

function parseMarketRequest(value: unknown): DesktopMarketSelectRequest | undefined {
  if (!isExactRecord(value, 'provider') || !isMarketProvider(value.provider)) return undefined
  return { provider: value.provider }
}

function isEmptyRequest(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 0
}

async function parsePostBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<unknown | typeof INVALID_BODY> {
  if (!isJsonRequest(req)) {
    finishJson(res, 415, error('content type must be application/json'))
    return INVALID_BODY
  }
  try {
    return await readJson(req)
  } catch (cause) {
    const tooLarge = cause instanceof BodyTooLargeError
    finishJson(res, tooLarge ? 413 : 400, error(tooLarge ? 'request body is too large' : 'invalid JSON request'))
    return INVALID_BODY
  }
}

const INVALID_BODY = Symbol('invalid body')

function finishPostResponse<T extends object>(
  res: ServerResponse,
  statusCode: number,
  operation: DesktopSettingsPostResponse<T>,
  operationName: string,
  reportError: (operation: string, cause: unknown) => void,
): void {
  finishJson(res, statusCode, operation.response)
  const afterResponse = operation.afterResponse
  if (afterResponse === undefined) return
  setImmediate(() => {
    void Promise.resolve().then(afterResponse).catch((cause: unknown) => {
      reportError(`${operationName} after response`, cause)
    })
  })
}

/** Serve the renderer-safe Desktop settings snapshot. */
export async function handleDesktopSettingsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopSettingsController,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'GET') return finishJson(res, 405, error('method not allowed'), 'GET')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, false)) {
    return finishJson(res, 403, error('forbidden'))
  }
  try {
    finishJson(res, 200, controller.read())
  } catch (cause) {
    reportError('read settings', cause)
    finishJson(res, 500, error('desktop settings unavailable'))
  }
}

/** Create one safe Web profile without changing the active generation. */
export async function handleDesktopProfileCreateRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopSettingsController,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const value = await parsePostBody(req, res)
  if (value === INVALID_BODY) return
  const request = parseProfileRequest(value)
  if (request === undefined) return finishJson(res, 400, error('invalid profile creation request'))
  try {
    finishJson(res, 201, controller.createProfile(request.name))
  } catch (cause) {
    reportError('create profile', cause)
    finishJson(res, 409, error('profile could not be created'))
  }
}

/** Select one compatible profile through the restart-safe launcher service. */
export async function handleDesktopProfileSelectRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopSettingsController,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const value = await parsePostBody(req, res)
  if (value === INVALID_BODY) return
  const request = parseProfileRequest(value) as DesktopProfileSelectRequest | undefined
  if (request === undefined) return finishJson(res, 400, error('invalid profile selection request'))
  try {
    const operation = await controller.selectProfile(request.name)
    finishPostResponse(
      res,
      operation.response.restartRequired ? 202 : 200,
      operation,
      'select profile',
      reportError,
    )
  } catch (cause) {
    reportError('select profile', cause)
    finishJson(res, 409, error('profile could not be selected'))
  }
}

/** Delete one inactive user profile and return a fresh settings projection. */
export async function handleDesktopProfileDeleteRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopSettingsController,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const value = await parsePostBody(req, res)
  if (value === INVALID_BODY) return
  const request = parseProfileRequest(value) as DesktopProfileDeleteRequest | undefined
  if (request === undefined) return finishJson(res, 400, error('invalid profile deletion request'))
  try {
    finishJson(res, 200, await controller.deleteProfile(request.name))
  } catch (cause) {
    reportError('delete profile', cause)
    finishJson(res, 409, error('profile could not be deleted'))
  }
}

/** Persist one Market provider and queue restart only after persistence succeeds. */
export async function handleDesktopMarketSelectRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopSettingsController,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const value = await parsePostBody(req, res)
  if (value === INVALID_BODY) return
  const request = parseMarketRequest(value)
  if (request === undefined) return finishJson(res, 400, error('invalid Market selection request'))
  try {
    const operation = await controller.selectMarket(request.provider)
    finishPostResponse(
      res,
      operation.response.restartRequired ? 202 : 200,
      operation,
      'select Market provider',
      reportError,
    )
  } catch (cause) {
    reportError('select Market provider', cause)
    finishJson(res, 500, error('Market selection could not be saved'))
  }
}

/** Save the AA opt-in before scheduling its next Host generation. */
export async function handleDesktopAaSelectRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopSettingsController,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const value = await parsePostBody(req, res)
  if (value === INVALID_BODY) return
  const request = isExactRecord(value, 'enabled') && typeof value.enabled === 'boolean' ? { enabled: value.enabled } : undefined
  if (request === undefined) return finishJson(res, 400, error('invalid AA selection request'))
  try {
    const operation = await controller.selectAa(request.enabled)
    finishPostResponse(
      res,
      operation.response.restartRequired ? 202 : 200,
      operation,
      'select AA plugin',
      reportError,
    )
  } catch (cause) {
    reportError('select AA plugin', cause)
    finishJson(res, 500, error('AA selection could not be saved'))
  }
}

/** Open the launcher-owned DSH terminal from an exact empty request. */
export async function handleDesktopTerminalOpenRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopSettingsController,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const value = await parsePostBody(req, res)
  if (value === INVALID_BODY) return
  if (!isEmptyRequest(value)) return finishJson(res, 400, error('invalid terminal request'))
  try {
    finishJson(res, 200, controller.openTerminal())
  } catch (cause) {
    reportError('open terminal', cause)
    finishJson(res, 500, error('terminal could not be opened'))
  }
}

/** Queue an orderly Desktop relaunch from an exact empty request. */
export async function handleDesktopRestartRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopSettingsController,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const value = await parsePostBody(req, res)
  if (value === INVALID_BODY) return
  if (!isEmptyRequest(value)) return finishJson(res, 400, error('invalid restart request'))
  finishPostResponse(res, 202, controller.restart(), 'restart Desktop', reportError)
}

/** Queue an orderly recovery-mode relaunch from an exact empty request. */
export async function handleDesktopRecoveryRestartRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopSettingsController,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const value = await parsePostBody(req, res)
  if (value === INVALID_BODY) return
  if (!isEmptyRequest(value)) return finishJson(res, 400, error('invalid recovery restart request'))
  finishPostResponse(res, 202, controller.restartToRecovery(), 'restart Desktop in recovery mode', reportError)
}

/** Reload the renderer after acknowledging an exact empty same-origin request. */
export async function handleDesktopRendererReloadRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopSettingsController,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const value = await parsePostBody(req, res)
  if (value === INVALID_BODY) return
  if (!isEmptyRequest(value)) return finishJson(res, 400, error('invalid renderer reload request'))
  finishPostResponse(res, 202, controller.reloadRenderer(), 'reload renderer', reportError)
}

/** Toggle Developer Tools from an exact empty same-origin request. */
export async function handleDesktopDeveloperToolsToggleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopSettingsController,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const value = await parsePostBody(req, res)
  if (value === INVALID_BODY) return
  if (!isEmptyRequest(value)) return finishJson(res, 400, error('invalid Developer Tools request'))
  try {
    finishJson(res, 200, controller.toggleDeveloperTools())
  } catch (cause) {
    reportError('toggle Developer Tools', cause)
    finishJson(res, 500, error('Developer Tools could not be toggled'))
  }
}

/** Run the generation-owned interactive update flow from an exact empty request. */
export async function handleDesktopUpdateCheckRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  checkNow: () => Promise<void>,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const value = await parsePostBody(req, res)
  if (value === INVALID_BODY) return
  if (!isEmptyRequest(value)) return finishJson(res, 400, error('invalid update check request'))
  try {
    await checkNow()
    finishJson(res, 200, { accepted: true })
  } catch (cause) {
    reportError('check for updates', cause)
    finishJson(res, 500, error('updates could not be checked'))
  }
}

/** Export diagnostics from an exact empty same-origin request. */
export async function handleDesktopDiagnosticsExportRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopSettingsController,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const value = await parsePostBody(req, res)
  if (value === INVALID_BODY) return
  if (!isEmptyRequest(value)) return finishJson(res, 400, error('invalid diagnostic export request'))
  try {
    finishJson(res, 200, await controller.exportDiagnostics())
  } catch (cause) {
    reportError('export diagnostics', cause)
    finishJson(res, 500, error('diagnostics could not be exported'))
  }
}

export const desktopSettingsRouteConstants = Object.freeze({
  maxBodyBytes: MAX_SETTINGS_BODY_BYTES,
})

/**
 * Describe the channels this build knows and which one it is.
 * @param req - incoming request.
 * @param res - response to finish.
 * @param expectedOrigin - loopback origin every settings request must match.
 * @param current - channel this build was stamped with, when it is one of ours.
 */
export function handleDesktopChannelsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  current: FitaChannel | undefined,
): void {
  if (req.method !== 'GET') return finishJson(res, 405, error('method not allowed'), 'GET')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, false)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const response: DesktopChannelsResponse = {
    current: current?.slug ?? null,
    channels: FITA_CHANNELS.map(channel => ({ ...channel, current: channel.slug === current?.slug })),
  }
  finishJson(res, 200, response)
}

/** Project one channel check into the renderer-safe contract. */
function channelCheckResponse(result: FitaChannelCheck, channel: FitaChannel): DesktopChannelCheckResponse {
  if (result.status === 'none') return { status: 'none', channel: channel.slug }
  if (result.status === 'failed') return { status: 'failed', channel: channel.slug, reason: result.reason }
  return {
    status: 'offer',
    channel: channel.slug,
    version: result.version,
    newer: result.newer,
    dmg: result.dmg === undefined
      ? null
      : { name: result.dmg.name, url: result.dmg.browser_download_url },
    sums: result.sums === undefined
      ? null
      : { name: result.sums.name, url: result.sums.browser_download_url },
  }
}

/**
 * Ask one declared channel whether it offers a newer build.
 *
 * An undeclared slug is answered, not rejected: the renderer gets a named failure
 * it can show, and the Host never has to guess what the caller meant.
 * @param req - incoming request.
 * @param res - response to finish.
 * @param expectedOrigin - loopback origin every settings request must match.
 * @param check - channel check implementation, bound to the Host generation.
 * @param reportError - sink for unexpected failures.
 */
export async function handleDesktopChannelCheckRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  check: (channel: FitaChannel) => Promise<FitaChannelCheck>,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const value = await parsePostBody(req, res)
  if (value === INVALID_BODY) return
  const slug = typeof value === 'object' && value !== null
    ? (value as { channel?: unknown }).channel
    : undefined
  if (typeof slug !== 'string' || slug.length === 0) {
    return finishJson(res, 400, error('invalid channel check request'))
  }
  const channel = fitaChannel(slug)
  if (channel === undefined) {
    const response: DesktopChannelCheckResponse = { status: 'failed', channel: slug, reason: 'unknown-channel' }
    return finishJson(res, 200, response)
  }
  try {
    finishJson(res, 200, channelCheckResponse(await check(channel), channel))
  } catch (cause) {
    reportError('check a channel', cause)
    finishJson(res, 500, error('the channel could not be checked'))
  }
}
