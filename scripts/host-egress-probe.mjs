#!/usr/bin/env node
/**
 * Reproduces the measurement behind the corrected host-networking note in the
 * five READMEs (and the known-limitations bullet of issue #22): a plugin that
 * mounts after boot cannot route the host process's own outbound requests by
 * writing the proxy environment.
 *
 * The plugin's injection writes `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` into
 * `process.env`. This script measures who actually reads them, in three phases,
 * against a recording proxy that answers every request with 502:
 *
 *   A  write the proxy names mid-process, then `fetch()`   -> expect 0 hits
 *   B  install a global dispatcher, then `fetch()`         -> expect >= 1 hit
 *      (control: proves the recording proxy is reachable and the probe works)
 *   C  a child launched with NODE_USE_ENV_PROXY=1 that writes the names
 *      mid-process and then uses node:http and node:https  -> expect 0 hits
 *
 * Why the answer is what it is, in the harness's own words:
 * `apps/cli/src/profile-boot.ts` installs the process proxy policy from the
 * LAUNCH environment before the first plugin mounts, and its comment states
 * that Node's fetch ignores the proxy environment on its own and that
 * NODE_USE_ENV_PROXY cannot help because Node samples the environment at
 * start; `packages/util/http-proxy/src/install.ts` states that the global
 * dispatcher routes by its policy rather than by the environment and publishes
 * the names only for consumers that read an environment (`node:http`'s
 * `proxyEnv`) and for spawned children.
 *
 * Phase B needs `undici`, which is not a dependency of this package; the phase
 * is skipped when it cannot be imported.
 *
 * Usage: node scripts/host-egress-probe.mjs
 *
 * @module dsh-permission-rules/scripts/host-egress-probe
 */

import { createServer, request as httpRequest } from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const TARGET = 'http://example.com/'
const TIMEOUT_MS = 8000

if (process.env.HOST_EGRESS_PROBE_CHILD === '1') {
  // Phase C runs here: NODE_USE_ENV_PROXY was set by the parent AT LAUNCH, which
  // is the only moment Node samples it.
  const { request } = await import('node:http')
  const { request: httpsRequest } = await import('node:https')
  process.env.HTTP_PROXY = process.env.HOST_EGRESS_PROBE_PROXY
  process.env.HTTPS_PROXY = process.env.HOST_EGRESS_PROBE_PROXY

  const attempt = (label, send) => new Promise(resolve => {
    const req = send(response => { resolve(`${label}: HTTP ${response.statusCode}`); response.resume() })
    req.on('error', error => resolve(`${label}: ${error.code ?? error.name}`))
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); resolve(`${label}: timeout`) })
    req.end()
  })

  console.log(`  child NODE_USE_ENV_PROXY=${process.env.NODE_USE_ENV_PROXY}`)
  console.log(`  ${await attempt('node:http ', callback => request(TARGET, callback))}`)
  console.log(`  ${await attempt('node:https', callback => httpsRequest('https://example.com/', callback))}`)
  process.exit(0)
}

const hits = []
const proxy = createServer((request, response) => {
  hits.push(`REQ ${request.url ?? ''}`)
  response.writeHead(502)
  response.end('recording-proxy')
})
proxy.on('connect', (request, socket) => {
  hits.push(`CONNECT ${request.url ?? ''}`)
  socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')
})
await new Promise(resolve => { proxy.listen(0, '127.0.0.1', resolve) })
const proxyUrl = `http://127.0.0.1:${String(proxy.address().port)}`

console.log(`node ${process.version}`)
console.log(`recording proxy on ${proxyUrl} (answers 502 to everything)\n`)

// Phase A - exactly what injectProxyEnv() does to a process that is already up.
process.env.HTTP_PROXY = proxyUrl
process.env.HTTPS_PROXY = proxyUrl
process.env.ALL_PROXY = proxyUrl
hits.length = 0
let phaseA = 'ok'
try {
  await fetch(TARGET, { signal: AbortSignal.timeout(TIMEOUT_MS) })
} catch (error) {
  phaseA = error.name
}
console.log(`A  mid-process process.env write, then fetch()   -> proxy saw ${hits.length} (${phaseA})`)

// Phase B - the control, with no dependency: send one absolute-form request
// straight at the recording proxy, the way a proxied client would. If the proxy
// does not record this, the probe itself is broken and A/C prove nothing.
hits.length = 0
await new Promise(resolve => {
  const req = httpRequest(
    {
      host: '127.0.0.1',
      port: proxy.address().port,
      method: 'GET',
      path: TARGET,
      headers: { host: 'example.com' },
    },
    response => { response.resume(); response.on('end', resolve) },
  )
  req.on('error', () => resolve())
  req.end()
})
console.log(`B  control: absolute-form request to the proxy -> proxy saw ${hits.length} ${JSON.stringify(hits)}`)

// Phase B2 - the same control through an explicitly installed global dispatcher,
// which is what the launcher does at boot. Optional: `undici` is not a
// dependency of this package.
let dispatcherLine = 'skipped (undici not importable from here)'
try {
  const undici = await import('undici')
  hits.length = 0
  undici.setGlobalDispatcher(new undici.ProxyAgent(proxyUrl))
  try {
    await fetch(TARGET, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    // Routing through the recording proxy is expected to fail the request.
  }
  dispatcherLine = `proxy saw ${hits.length} ${JSON.stringify(hits)}`
} catch {
  // Optional by design.
}
console.log(`B2 global dispatcher installed, then fetch()    -> ${dispatcherLine}`)

// Phase C - the remaining path: NODE_USE_ENV_PROXY, sampled at launch.
hits.length = 0
await new Promise(resolve => {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
    env: {
      ...process.env,
      HOST_EGRESS_PROBE_CHILD: '1',
      HOST_EGRESS_PROBE_PROXY: proxyUrl,
      NODE_USE_ENV_PROXY: '1',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  child.on('exit', resolve)
})
console.log(`C  child with NODE_USE_ENV_PROXY=1 at launch     -> proxy saw ${hits.length}`)

console.log(`\nExpected: A = 0, B >= 1, C = 0.`)
console.log(`Conclusion when it matches: the injected proxy environment covers spawned`)
console.log(`children, not the host process's own outbound requests — see the READMEs'`)
console.log(`known-limitations bullet and AGENTS.md.`)

proxy.close()
