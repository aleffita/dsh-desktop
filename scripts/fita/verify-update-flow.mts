/**
 * Prove the update flow end to end, offline.
 *
 * It serves a synthetic release over loopback — a `dev-mac.yml` and the zip it names — then
 * runs the same chain the app runs: read the feed, choose the layer, download and verify
 * against the feed's digest, start the hand-over, and apply the payload as the child would.
 * Real HTTP, a real zip, real `ditto` extraction, a real payload swap.
 *
 *   node scripts/fita/verify-update-flow.mts
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fitaChannel } from '../../dsh-plugin-desktop/src/fita-channel.ts'
import { fitaDefaultRunner, type FitaCommandResult } from '../../dsh-plugin-desktop/src/fita-install.ts'
import { parseFitaHandoverArguments } from '../../dsh-plugin-desktop/src/fita-handover.ts'
import { readFitaChannelFeed } from '../../dsh-plugin-desktop/src/fita-release-source.ts'
import { startFitaUpdate } from '../../dsh-plugin-desktop/src/fita-update-action.ts'
import { runFitaHandoverProcess } from '../../dsh-plugin-desktop/src/fita-handover.ts'

const problems: string[] = []
function note(message: string): void {
  process.stdout.write(`fita-update: ${message}\n`)
}

const channel = fitaChannel('dev')
if (channel === undefined) {
  process.stderr.write('fita-update: dev is not in the registry\n')
  process.exit(1)
}

const root = mkdtempSync(join(tmpdir(), 'fita-update-flow-'))
const installed = join(root, 'Applications', 'DSH Fita Dev.app')
const resources = join(installed, 'Contents', 'Resources')
const payloadSource = join(root, 'payload', 'DSH Fita Dev.app')
mkdirSync(join(payloadSource, 'Contents', 'Resources'), { recursive: true })
mkdirSync(resources, { recursive: true })
writeFileSync(join(resources, 'app.asar'), 'old payload')
writeFileSync(join(resources, 'electron.asar'), 'runtime stays')
writeFileSync(join(payloadSource, 'Contents', 'Resources', 'app.asar'), 'new payload')

const zip = join(root, 'DSH-Fita-Dev-9.9.9-universal.zip')
const zipped = spawnSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', payloadSource, zip], { encoding: 'utf8' })
if (zipped.status !== 0) {
  process.stderr.write(`fita-update: could not build the zip: ${zipped.stderr}\n`)
  process.exit(1)
}
const digest = createHash('sha512').update(readFileSync(zip)).digest('base64')
const feed = `version: 9.9.9
files:
  - url: ${zip.split('/').pop()}
    sha512: ${digest}
    size: ${String(readFileSync(zip).byteLength)}
path: ${zip.split('/').pop()}
`

const server = createServer((request, response) => {
  if (request.url === `/${channel.feed}-mac.yml`) {
    response.writeHead(200, { 'content-type': 'text/yaml' })
    response.end(feed)
    return
  }
  if (request.url === `/${zip.split('/').pop()}`) {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(readFileSync(zip).byteLength) })
    response.end(readFileSync(zip))
    return
  }
  response.writeHead(404)
  response.end('no')
})

await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
const address = server.address()
if (address === null || typeof address === 'string') {
  process.stderr.write('fita-update: the local server did not start\n')
  process.exit(1)
}
const origin = `http://127.0.0.1:${String(address.port)}`
const request = async (url: string, init?: RequestInit): Promise<Response> => await fetch(url, init)

try {
  const layer = await readFitaChannelFeed({ url: `${origin}/${channel.feed}-mac.yml`, channel, request })
  if (layer === undefined || layer.layer !== 'payload') {
    problems.push('the feed did not resolve to a payload layer')
  } else {
    note(`feed chose the ${layer.layer} layer: ${layer.file.url}`)
    let spawned: readonly string[] = []
    const started = await startFitaUpdate({
      channel,
      layer,
      version: '9.9.9',
      appPath: installed,
      executable: process.execPath,
      cacheRoot: join(root, 'cache'),
      staging: join(root, 'cache', 'staging'),
      artifactUrl: `${origin}/${layer.file.url}`,
      request,
      spawn: (_command, args) => { spawned = args },
      currentPid: process.pid,
    })
    if (started.status !== 'started') problems.push(`starting the update failed: ${started.reason}`)
    else note(`started the hand-over for ${started.layer}, verified against the feed digest`)

    const parsed = parseFitaHandoverArguments(['child', ...spawned])
    if (parsed === undefined || parsed.layer !== 'payload') {
      problems.push('the child was not started with a payload request')
    } else {
      const outcome = await runFitaHandoverProcess({
        request: parsed,
        run: fitaDefaultRunner,
        waitForExit: async () => {},
        exit: () => {},
      })
      if (outcome.status !== 'applied-not-relaunched') {
        problems.push(`the child did not apply the payload: ${JSON.stringify(outcome)}`)
      } else {
        const applied = readFileSync(join(resources, 'app.asar'), 'utf8')
        const previous = readFileSync(join(resources, 'app.asar.previous'), 'utf8')
        const runtime = readFileSync(join(resources, 'electron.asar'), 'utf8')
        if (applied !== 'new payload') problems.push(`the payload was not replaced (${applied})`)
        if (previous !== 'old payload') problems.push(`the previous payload was not kept (${previous})`)
        if (runtime !== 'runtime stays') problems.push('the runtime was touched by a payload update')
        if (problems.length === 0) {
          note('ok — the update flow reached the bundle: payload replaced, previous kept, runtime untouched')
        }
      }
    }
  }
} finally {
  server.close()
  rmSync(root, { recursive: true, force: true })
}

if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`fita-update: ${problem}\n`)
  process.exit(1)
}
