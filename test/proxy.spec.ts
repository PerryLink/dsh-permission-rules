/**
 * Real local-proxy tests: ephemeral bind, plain-HTTP adjudication
 * (structured 403 bodies vs passthrough), CONNECT tunnels, block records
 * with attribution, disposal, and the subprocess environment injection
 * (set + exact restore). Everything runs on loopback ephemeral ports —
 * no external network.
 * @module dsh-permission-rules/test/proxy
 */

import { createServer, request as httpRequest } from 'node:http'
import type { Server } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NetworkProxy, injectProxyEnv, NO_PROXY_ENV_NAMES, PROXY_ENV_NAMES } from '../src/proxy.ts'
import type { NetworkBlockRecord, NetworkProxyOptions } from '../src/proxy.ts'
import type { CompiledRule } from '../src/rules.ts'
import type { NetworkDecision } from '../src/network.ts'

const warn = (): void => {}

/** One quick local HTTP origin for passthrough tests. */
async function origin(): Promise<{ server: Server; port: number; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(`origin:${req.url ?? ''}`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('origin bind failed')
  return { server, port: address.port, close: () => new Promise<void>(resolve => server.close(() => resolve())) }
}

/** Start a policy proxy whose decisions come from the given function. */
async function startProxy(decide: NetworkProxyOptions['decide'], extra: Partial<NetworkProxyOptions> = {}): Promise<NetworkProxy> {
  const proxy = new NetworkProxy({
    bind: '127.0.0.1',
    port: 0,
    maxRecent: 10,
    decide,
    logger: { warn },
    ...extra,
  })
  await proxy.start()
  return proxy
}

/** One plain HTTP request THROUGH the proxy (absolute-form). */
function viaProxy(proxyPort: number, url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: proxyPort, path: url, method: 'GET' }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => {
        body += chunk
      })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

/**
 * One CONNECT attempt through the proxy; resolves with the tunnel response
 * + whether bytes flow. Node's http client emits `connect` for EVERY
 * CONNECT response (2xx and 403 alike); for a non-2xx block the response
 * body arrives in `head` (CONNECT detaches the socket from the response
 * parser, so `res` never emits data) and the tunnel is closed, while a
 * 2xx tunnel is probed with an echo round-trip.
 */
function viaConnect(proxyPort: number, authority: string): Promise<{ status: number; body: string; echoed: boolean }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: authority })
    let status = 0
    let body = ''
    let echoed = false
    req.on('connect', (res, socket, head) => {
      status = res.statusCode ?? 0
      if (status >= 200 && status < 300) {
        socket.write('ping')
        socket.once('data', data => {
          echoed = String(data) === 'ping'
          socket.destroy()
          resolve({ status, body, echoed })
        })
      } else {
        body = String(head)
        socket.destroy()
        resolve({ status, body, echoed })
      }
    })
    req.on('error', reject)
    req.end()
  })
}

/** A minimal compiled-rule stand-in carrying only the reason the messages read. */
function reasonRule(reason: string): CompiledRule {
  return { reason, enabled: true } as CompiledRule
}

beforeEach(() => {
  // The env injector must restore exactly; start from a clean slate for determinism.
  for (const name of [...PROXY_ENV_NAMES, ...NO_PROXY_ENV_NAMES]) delete process.env[name]
})

afterEach(() => {
  for (const name of [...PROXY_ENV_NAMES, ...NO_PROXY_ENV_NAMES]) delete process.env[name]
})

describe('proxy environment injection', () => {
  it('sets every proxy variable and the NO_PROXY pair, then restores exactly', () => {
    process.env.HTTP_PROXY = 'http://corp.example:3128'
    process.env.no_proxy = 'internal.example'
    const restore = injectProxyEnv(48123, 'clear')
    try {
      expect(process.env.HTTP_PROXY).toBe('http://127.0.0.1:48123')
      expect(process.env.https_proxy).toBe('http://127.0.0.1:48123')
      expect(process.env.ALL_PROXY).toBe('http://127.0.0.1:48123')
      expect(process.env.NO_PROXY).toBe('')
      expect(process.env.no_proxy).toBe('')
    } finally {
      restore()
    }
    expect(process.env.HTTP_PROXY).toBe('http://corp.example:3128')
    expect(process.env.no_proxy).toBe('internal.example')
    expect(process.env.https_proxy).toBeUndefined()
    // On Windows `process.env` is case-insensitive, so NO_PROXY and no_proxy
    // are one variable and restoring the lowercase pair restores the
    // uppercase spelling too.
    if (process.platform === 'win32') {
      expect(process.env.NO_PROXY).toBe('internal.example')
    } else {
      expect(process.env.NO_PROXY).toBeUndefined()
    }
  })

  it('preserve mode leaves ambient NO_PROXY untouched', () => {
    process.env.NO_PROXY = 'corp.example'
    const restore = injectProxyEnv(48124, 'preserve')
    restore()
    expect(process.env.NO_PROXY).toBe('corp.example')
  })
})

describe('plain-HTTP proxying', () => {
  it('forwards allowed requests to the origin', async () => {
    const upstream = await origin()
    const proxy = await startProxy(() => ({ action: 'allow', matched: false, mode: 'allow-all' }))
    try {
      const result = await viaProxy(proxy.port, `http://127.0.0.1:${upstream.port}/hello`)
      expect(result.status).toBe(200)
      expect(result.body).toBe('origin:/hello')
    } finally {
      await proxy.close()
      await upstream.close()
    }
  })

  it('blocks denied requests with a structured 403 body and records the block', async () => {
    const upstream = await origin()
    const blocks: NetworkBlockRecord[] = []
    const decide = (): NetworkDecision => ({ action: 'deny', matched: true, mode: 'deny-all', ruleIndex: 3, source: '/ws/rules.yaml', rule: reasonRule('no mirrors') })
    const proxy = await startProxy(decide, { attribution: () => ({ tool: 'bash' }), onBlock: record => blocks.push(record) })
    try {
      const result = await viaProxy(proxy.port, `http://127.0.0.1:${upstream.port}/x`)
      expect(result.status).toBe(403)
      expect(result.body).toContain('[network: denied by rule 4] no mirrors')
      expect(blocks).toHaveLength(1)
      expect(blocks[0]).toMatchObject({ tool: 'bash', attributed: true, action: 'deny', mode: 'deny-all', matched: true, ruleIndex: 3 })
      expect(proxy.blockStats()).toEqual({ denied: 1, askBlocked: 0 })
      expect(proxy.recentBlocks()).toHaveLength(1)
    } finally {
      await proxy.close()
      await upstream.close()
    }
  })

  it('words mode-default and ask blocks distinctly', async () => {
    const upstream = await origin()
    const proxy = await startProxy(() => ({ action: 'ask', matched: false, mode: 'whitelist' }))
    try {
      const result = await viaProxy(proxy.port, `http://127.0.0.1:${upstream.port}/x`)
      expect(result.status).toBe(403)
      expect(result.body).toContain('[network: blocked pending approval] whitelist mode')
      expect(proxy.blockStats()).toEqual({ denied: 0, askBlocked: 1 })
    } finally {
      await proxy.close()
      await upstream.close()
    }
  })
})

describe('CONNECT tunneling', () => {
  it('denies a blocked tunnel before any TCP connection to the target', async () => {
    const proxy = await startProxy(() => ({ action: 'deny', matched: false, mode: 'deny-all' }))
    try {
      const result = await viaConnect(proxy.port, 'blocked.example:443')
      expect(result.status).toBe(403)
      expect(result.body).toContain('[network: denied] network mode deny-all')
      expect(proxy.blockStats()).toEqual({ denied: 1, askBlocked: 0 })
    } finally {
      await proxy.close()
    }
  })

  it('tunnels an allowed CONNECT to a local echo server', async () => {
    const echo = createNetServer(socket => socket.pipe(socket))
    await new Promise<void>(resolve => echo.listen(0, '127.0.0.1', resolve))
    const address = echo.address()
    if (address === null || typeof address === 'string') throw new Error('echo bind failed')
    const echoPort = address.port
    const proxy = await startProxy(() => ({ action: 'allow', matched: false, mode: 'allow-all' }))
    try {
      const result = await viaConnect(proxy.port, `127.0.0.1:${echoPort}`)
      expect(result.status).toBe(200)
      expect(result.echoed).toBe(true)
      expect(proxy.blockStats()).toEqual({ denied: 0, askBlocked: 0 })
    } finally {
      await proxy.close()
      await new Promise<void>(resolve => echo.close(() => resolve()))
    }
  })
})

describe('proxy lifecycle', () => {
  it('close() settles and stops accepting connections', async () => {
    const proxy = await startProxy(() => ({ action: 'allow', matched: false, mode: 'allow-all' }))
    const port = proxy.port
    expect(port).toBeGreaterThan(0)
    await proxy.close()
    await expect(viaProxy(port, 'http://example.com/')).rejects.toThrow()
  })
})
