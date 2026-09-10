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
import { connect as netConnect, createServer as createNetServer } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NetworkProxy, injectProxyEnv, NO_PROXY_ENV_NAMES, PROXY_ENV_NAMES, readAmbientProxy } from '../src/proxy.ts'
import type { NetworkBlockRecord, NetworkProxyOptions } from '../src/proxy.ts'
import { compileRules, parseRulesDocument, targetMatchesNetwork } from '../src/rules.ts'
import type { CompiledRule } from '../src/rules.ts'
import type { NetworkDecision } from '../src/network.ts'

/**
 * Resolver control for the no-adjudicated-address case (issue #21): the real
 * `node:dns/promises` is kept for every other test, and flipping `fail` makes
 * the proxy's adjudication resolution fail while the name stays genuinely
 * resolvable — the only way to observe whether the tunnel then dials the NAME
 * (a second resolution with Node's 250 ms happy-eyeballs budget) or fails
 * closed.
 */
const dnsControl = vi.hoisted(() => ({ fail: false }))

vi.mock('node:dns/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:dns/promises')>()
  return {
    ...actual,
    lookup: async (...args: Parameters<typeof actual.lookup>) => {
      if (dnsControl.fail) throw new Error('EAI_AGAIN transient resolver failure')
      return actual.lookup(...args)
    },
  }
})

const warn = (): void => {}

/** One quick local HTTP origin for passthrough tests. */
async function origin(bind = '127.0.0.1'): Promise<{ server: Server; port: number; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(`origin:${req.url ?? ''}`)
  })
  await new Promise<void>(resolve => server.listen(0, bind, resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('origin bind failed')
  return { server, port: address.port, close: () => new Promise<void>(resolve => server.close(() => resolve())) }
}

/**
 * One local HTTP origin reachable by NAME on hosts whose `localhost` answers
 * with either family: binding `::` accepts IPv4 and IPv6 on the same port
 * (Node's default `ipv6Only: false`), with an IPv4-only fallback for runners
 * without IPv6 — the pinned lookup hands Node every adjudicated address, so
 * either answer reaches this server.
 */
async function originByName(): Promise<{ server: Server; port: number; close: () => Promise<void> }> {
  try {
    return await origin('::')
  } catch {
    return await origin('127.0.0.1')
  }
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

/** Poll a condition until it holds (event-loop-friendly assertion support). */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met in time')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

// Windows (IOCP) surfaces an idle CONNECT socket's RST as 'close' without an
// 'error' event; Linux (epoll) emits ECONNRESET — the crash class reported in
// issue #12 (Ubuntu). CI's ubuntu job asserts the logged-error path; the
// survival-and-still-serving assertions run everywhere.
const expectResetErrorLogged = process.platform !== 'win32'

/**
 * Raw CONNECT whose client sends a real RST as soon as the request line is
 * written (issue #12's crash trigger: the client-side reset, not the
 * upstream one — a clean FIN never emits 'error' on the proxy socket).
 */
function resetConnect(proxyPort: number, authority: string, delayMs = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(proxyPort, '127.0.0.1')
    let settled = false
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
    }
    socket.on('error', () => settle(() => reject(new Error('resetConnect: client socket error'))))
    socket.on('connect', () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`)
      // Delay the RST so the request is delivered and parsed first —
      // resetting instantly can kill the connection before the server ever
      // emits 'connect' and hands the raw socket to handleConnect.
      setTimeout(() => {
        socket.resetAndDestroy()
        settle(resolve)
      }, delayMs)
    })
    socket.setTimeout(2000, () => {
      socket.destroy()
      settle(() => reject(new Error('resetConnect: connect timed out')))
    })
  })
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

describe('CONNECT socket reset hardening (issue #12)', () => {
  it('survives a client reset on the 400 early-return path and keeps serving', async () => {
    const warnings: string[] = []
    const proxy = await startProxy(() => ({ action: 'deny', matched: false, mode: 'deny-all' }), { logger: { warn: message => warnings.push(message) } })
    try {
      await resetConnect(proxy.port, 'not-an-authority', 100)
      if (expectResetErrorLogged) {
        await waitFor(() => warnings.some(message => message.includes('CONNECT socket error')))
      }
      const result = await viaConnect(proxy.port, 'blocked.example:443')
      expect(result.status).toBe(403)
    } finally {
      await proxy.close()
    }
  })

  it('survives a client reset on the 403 deny path and still records the block', async () => {
    const warnings: string[] = []
    const proxy = await startProxy(() => ({ action: 'deny', matched: false, mode: 'deny-all' }), { logger: { warn: message => warnings.push(message) } })
    try {
      // IP-literal target: the deny decision resolves without DNS, so the
      // block record is deterministic (the DNS-await window is covered by
      // the pending-decision test above).
      await resetConnect(proxy.port, '127.0.0.1:9', 100)
      if (expectResetErrorLogged) {
        await waitFor(() => warnings.some(message => message.includes('CONNECT socket error')))
      }
      await waitFor(() => proxy.blockStats().denied === 1)
      expect(proxy.blockStats()).toEqual({ denied: 1, askBlocked: 0 })
      const result = await viaConnect(proxy.port, '127.0.0.1:9')
      expect(result.status).toBe(403)
    } finally {
      await proxy.close()
    }
  })

  it('survives a client reset while the decision is pending', async () => {
    let release!: () => void
    const gate = new Promise<NetworkDecision>(resolve => {
      release = () => resolve({ action: 'allow', matched: false, mode: 'allow-all' })
    })
    const decide = ((): Promise<NetworkDecision> => gate) as unknown as NetworkProxyOptions['decide']
    const proxy = await startProxy(decide)
    try {
      await resetConnect(proxy.port, '127.0.0.1:443')
      await new Promise(resolve => setTimeout(resolve, 50))
      release()
      // The released allow targets a port with no listener; the upstream
      // refusal must be contained, and the proxy must keep serving.
      await new Promise(resolve => setTimeout(resolve, 50))
      const result = await viaConnect(proxy.port, 'not-an-authority')
      expect(result.status).toBe(400)
    } finally {
      await proxy.close()
    }
  })

  it('survives a client reset mid-tunnel and keeps serving', async () => {
    const echo = createNetServer(socket => socket.pipe(socket))
    await new Promise<void>(resolve => echo.listen(0, '127.0.0.1', resolve))
    const address = echo.address()
    if (address === null || typeof address === 'string') throw new Error('echo bind failed')
    const warnings: string[] = []
    const proxy = await startProxy(() => ({ action: 'allow', matched: false, mode: 'allow-all' }), { logger: { warn: message => warnings.push(message) } })
    try {
      await new Promise<void>((resolve, reject) => {
        const req = httpRequest({ host: '127.0.0.1', port: proxy.port, method: 'CONNECT', path: `127.0.0.1:${address.port}` })
        req.on('connect', (_res, socket) => {
          socket.write('ping')
          socket.once('data', () => {
            socket.resetAndDestroy()
            resolve()
          })
        })
        req.on('error', reject)
        req.end()
      })
      // With active tunnel pipes the reset surfaces as 'error' on every
      // platform, so the guard's logged teardown is assertable here.
      await waitFor(() => warnings.some(message => message.includes('CONNECT socket error')))
      const result = await viaConnect(proxy.port, `127.0.0.1:${address.port}`)
      expect(result.status).toBe(200)
      expect(result.echoed).toBe(true)
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

/**
 * End-to-end guards for the mapped-literal bypass class and for connecting on
 * the adjudicated address. Before the fix an IPv4-mapped IPv6 literal matched
 * neither an IPv4 literal nor an IPv4 CIDR `ips` rule, while Node still routed
 * the connection to the denied IPv4 destination — so a mapped target passed the
 * rule and reached the address it was meant to block.
 */
describe('mapped IPv6 targets and adjudicated-address pinning', () => {
  const COMPILE = { patternMode: 'glob', maxRules: 64, maxGlobStars: 4, caseInsensitivePaths: true } as const

  /** A decide built from the REAL matcher over one `ips` deny rule. */
  function ipsDenyDecide(ipPatterns: readonly string[]): NetworkProxyOptions['decide'] {
    const yaml = `rules:\n  - action: deny\n    reason: mapped-target guard\n    match:\n      network:\n        ips: [${ipPatterns.join(', ')}]\n`
    const network = compileRules(parseRulesDocument(yaml), COMPILE).rules[0]?.network
    if (network === undefined) throw new Error('expected a compiled network block')
    return target => (targetMatchesNetwork(target, network)
      ? { action: 'deny', matched: true, mode: 'allow-all', source: '/ws/rules.yaml', rule: reasonRule('mapped-target guard') }
      : { action: 'allow', matched: false, mode: 'allow-all' })
  }

  it('denies a plain-HTTP target spelled as an IPv4-mapped IPv6 literal (literal rule)', async () => {
    // 127.0.0.2 is NOT bindable on macOS runners (EADDRNOTAVAIL), so the denied
    // address is the ordinary loopback: the mapped spelling reaches the same
    // destination, which is what the rule must catch.
    const upstream = await origin()
    const proxy = await startProxy(ipsDenyDecide(['127.0.0.1']))
    try {
      expect((await viaProxy(proxy.port, `http://127.0.0.1:${upstream.port}/x`)).status).toBe(403)
      expect((await viaProxy(proxy.port, `http://[::ffff:127.0.0.1]:${upstream.port}/x`)).status).toBe(403)
      expect(proxy.blockStats().denied).toBe(2)
    } finally {
      await proxy.close()
      await upstream.close()
    }
  })

  it('denies the mapped spelling under an IPv4 CIDR rule as well', async () => {
    const upstream = await origin()
    const proxy = await startProxy(ipsDenyDecide(['127.0.0.0/8']))
    try {
      expect((await viaProxy(proxy.port, `http://127.0.0.1:${upstream.port}/x`)).status).toBe(403)
      expect((await viaProxy(proxy.port, `http://[::ffff:127.0.0.1]:${upstream.port}/x`)).status).toBe(403)
    } finally {
      await proxy.close()
      await upstream.close()
    }
  })

  it('denies a CONNECT tunnel to an IPv4-mapped IPv6 target', async () => {
    const echo = createNetServer(socket => socket.pipe(socket))
    await new Promise<void>(resolve => echo.listen(0, '127.0.0.1', resolve))
    const address = echo.address()
    if (address === null || typeof address === 'string') throw new Error('echo bind failed')
    const proxy = await startProxy(ipsDenyDecide(['127.0.0.1']))
    try {
      expect((await viaConnect(proxy.port, `127.0.0.1:${address.port}`)).status).toBe(403)
      expect((await viaConnect(proxy.port, `[::ffff:127.0.0.1]:${address.port}`)).status).toBe(403)
    } finally {
      await proxy.close()
      await new Promise<void>(resolve => echo.close(() => resolve()))
    }
  })

  it('forwards a named target through the addresses the decision saw', async () => {
    const upstream = await originByName()
    const adjudicated: string[][] = []
    const proxy = await startProxy(target => {
      adjudicated.push([...target.ips])
      return { action: 'allow', matched: false, mode: 'allow-all' }
    })
    try {
      const result = await viaProxy(proxy.port, `http://localhost:${upstream.port}/pin`)
      expect(result.status).toBe(200)
      expect(result.body).toBe('origin:/pin')
      // The decision resolved the name, and the connection reused that address
      // list instead of resolving a second time.
      expect(adjudicated[0]?.length ?? 0).toBeGreaterThan(0)
    } finally {
      await proxy.close()
      await upstream.close()
    }
  })
})

/**
 * Issue #21: the CONNECT tunnel used to fall back to `connect(port, host)`
 * whenever the adjudication had produced no address. That is a SECOND DNS
 * resolution — the answer may differ from the one the rules were evaluated
 * against (DNS rebinding) — and it is the one remaining path where Node's
 * happy-eyeballs race applies: with the default 250 ms
 * `autoSelectFamilyAttemptTimeout`, any endpoint more than ~250 ms away fails
 * or thrashes through the proxy while a direct client is fine. A tunnel with
 * no adjudicated address must fail closed instead.
 */
describe('CONNECT without an adjudicated address fails closed (issue #21)', () => {
  it('answers 502 instead of dialing the hostname when the adjudication resolved nothing', async () => {
    const echo = createNetServer(socket => socket.pipe(socket))
    await new Promise<void>(resolve => echo.listen(0, '127.0.0.1', resolve))
    const address = echo.address()
    if (address === null || typeof address === 'string') throw new Error('echo bind failed')
    const warnings: string[] = []
    const proxy = await startProxy(() => ({ action: 'allow', matched: false, mode: 'allow-all' }), { logger: { warn: message => warnings.push(message) } })
    dnsControl.fail = true
    try {
      // `localhost` is reachable by name: before the fix the tunnel dialed it
      // and answered 200 (a second resolution the rules never saw).
      const result = await viaConnect(proxy.port, `localhost:${address.port}`)
      expect(result.status).toBe(502)
      expect(result.echoed).toBe(false)
      expect(warnings.some(message => message.includes('no adjudicated address for localhost'))).toBe(true)
    } finally {
      dnsControl.fail = false
      await proxy.close()
      await new Promise<void>(resolve => echo.close(() => resolve()))
    }
  })

  it('still tunnels an adjudicated literal address', async () => {
    const echo = createNetServer(socket => socket.pipe(socket))
    await new Promise<void>(resolve => echo.listen(0, '127.0.0.1', resolve))
    const address = echo.address()
    if (address === null || typeof address === 'string') throw new Error('echo bind failed')
    const proxy = await startProxy(() => ({ action: 'allow', matched: false, mode: 'allow-all' }))
    dnsControl.fail = true
    try {
      // An IP-literal target needs no resolution, so the resolver failure is
      // irrelevant: the tunnel dials the adjudicated address.
      const result = await viaConnect(proxy.port, `127.0.0.1:${address.port}`)
      expect(result.status).toBe(200)
      expect(result.echoed).toBe(true)
    } finally {
      dnsControl.fail = false
      await proxy.close()
      await new Promise<void>(resolve => echo.close(() => resolve()))
    }
  })
})

/**
 * Issue #19 item 2: an ALLOWED connection can be chained through an upstream
 * proxy (`network.upstreamProxy`). What matters is not only that chaining
 * happens, but what the upstream is NEVER asked to do — a blocked target, an
 * `ips`-scoped decision, or a loopback target — and that a failure is loud
 * instead of a silent direct dial.
 */
describe('upstream chaining (issue #19 item 2)', () => {
  /** One recording upstream proxy: echoes CONNECT tunnels and records every request line. */
  async function recordingUpstream(): Promise<{ port: number; seen: string[]; close: () => Promise<void> }> {
    const seen: string[] = []
    const server = createServer((req, res) => {
      seen.push(`REQ ${req.method ?? ''} ${req.url ?? ''}`)
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(`upstream:${req.url ?? ''}`)
    })
    server.on('connect', (req, socket) => {
      seen.push(`CONNECT ${req.url ?? ''}`)
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      socket.pipe(socket)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('upstream bind failed')
    return { port: address.port, seen, close: () => new Promise<void>(resolve => server.close(() => resolve())) }
  }

  const allow = (): NetworkDecision => ({ action: 'allow', matched: false, mode: 'allow-all' })
  const deny = (): NetworkDecision => ({ action: 'deny', matched: false, mode: 'deny-all' })
  const upstreamAt = (port: number) => (): { http: string; https: string } => ({
    http: `http://127.0.0.1:${port}`,
    https: `http://127.0.0.1:${port}`,
  })

  it('reads the ambient proxy per scheme, prefers the lowercase name, and drops unusable values', () => {
    const env = (values: Record<string, string>) => (name: string): string | undefined => values[name]
    // The lowercase spelling wins over the uppercase one.
    expect(readAmbientProxy(env({ http_proxy: 'http://lower:1', HTTP_PROXY: 'http://upper:1' }))).toEqual({ http: 'http://lower:1', https: 'http://lower:1' })
    // ALL_PROXY covers both schemes when neither scheme name is set.
    expect(readAmbientProxy(env({ ALL_PROXY: 'http://all:1' }))).toEqual({ http: 'http://all:1', https: 'http://all:1' })
    // An https-only environment chains https and leaves http direct.
    expect(readAmbientProxy(env({ HTTPS_PROXY: 'http://secure:1' }))).toEqual({ https: 'http://secure:1' })
    // A SOCKS value is unusable (Node has no SOCKS client) and is dropped.
    expect(readAmbientProxy(env({ http_proxy: 'socks5://127.0.0.1:1080', HTTPS_PROXY: 'http://secure:1' }))).toEqual({ https: 'http://secure:1' })
    // Blank and unparseable values are treated as unset.
    expect(readAmbientProxy(env({ http_proxy: '   ' }))).toEqual({})
    expect(readAmbientProxy(env({ http_proxy: 'not a url' }))).toEqual({})
  })

  it('chains an allowed CONNECT to the upstream rather than dialing the name', async () => {
    const upstream = await recordingUpstream()
    const proxy = await startProxy(allow, { upstream: upstreamAt(upstream.port) })
    dnsControl.fail = true
    try {
      const result = await viaConnect(proxy.port, 'target.example:443')
      expect(result.status).toBe(200)
      expect(result.echoed).toBe(true)
      expect(upstream.seen).toContain('CONNECT target.example:443')
      expect(proxy.chainedConnections()).toBe(1)
    } finally {
      dnsControl.fail = false
      await proxy.close()
      await upstream.close()
    }
  })

  it('forwards a plain-HTTP request to the upstream in absolute form', async () => {
    const upstream = await recordingUpstream()
    const proxy = await startProxy(allow, { upstream: upstreamAt(upstream.port) })
    dnsControl.fail = true
    try {
      const result = await viaProxy(proxy.port, 'http://target.example/thing')
      expect(result.status).toBe(200)
      expect(upstream.seen).toContain('REQ GET http://target.example/thing')
      expect(proxy.chainedConnections()).toBe(1)
    } finally {
      dnsControl.fail = false
      await proxy.close()
      await upstream.close()
    }
  })

  it('never lets a blocked target reach the upstream', async () => {
    const upstream = await recordingUpstream()
    const proxy = await startProxy(deny, { upstream: upstreamAt(upstream.port) })
    try {
      expect((await viaProxy(proxy.port, 'http://blocked.example/')).status).toBe(403)
      expect((await viaConnect(proxy.port, 'blocked.example:443')).status).toBe(403)
      expect(upstream.seen).toEqual([])
      expect(proxy.chainedConnections()).toBe(0)
    } finally {
      await proxy.close()
      await upstream.close()
    }
  })

  it('keeps an `ips`-scoped decision on the adjudicated address instead of chaining', async () => {
    const upstream = await recordingUpstream()
    const doc = parseRulesDocument('rules:\n  - action: allow\n    reason: pinned address\n    match:\n      network:\n        ips: [10.0.0.1]\n')
    const rule = compileRules(doc, { patternMode: 'glob', maxRules: 10, maxGlobStars: 2, caseInsensitivePaths: false }).rules[0]!
    const proxy = await startProxy(() => ({ action: 'allow', matched: true, mode: 'whitelist', rule }), { upstream: upstreamAt(upstream.port) })
    dnsControl.fail = true
    try {
      // The rules cared about the ADDRESS, so handing the name to the upstream
      // would defeat them: this must fail closed rather than chain.
      expect((await viaConnect(proxy.port, 'target.example:443')).status).toBe(502)
      expect(upstream.seen).toEqual([])
      expect(proxy.chainedConnections()).toBe(0)
    } finally {
      dnsControl.fail = false
      await proxy.close()
      await upstream.close()
    }
  })

  it('never chains a loopback target', async () => {
    const target = await origin()
    const upstream = await recordingUpstream()
    const proxy = await startProxy(allow, { upstream: upstreamAt(upstream.port) })
    try {
      expect((await viaProxy(proxy.port, `http://127.0.0.1:${target.port}/x`)).status).toBe(200)
      expect(upstream.seen).toEqual([])
      expect(proxy.chainedConnections()).toBe(0)
    } finally {
      await proxy.close()
      await upstream.close()
      await target.close()
    }
  })

  it('answers 502 rather than dialing directly when the upstream is unreachable', async () => {
    const upstream = await recordingUpstream()
    const deadPort = upstream.port
    await upstream.close()
    const proxy = await startProxy(allow, { upstream: upstreamAt(deadPort) })
    dnsControl.fail = true
    try {
      expect((await viaConnect(proxy.port, 'target.example:443')).status).toBe(502)
      expect(proxy.chainedConnections()).toBe(0)
    } finally {
      dnsControl.fail = false
      await proxy.close()
    }
  })

  it('answers 502 without echoing the upstream body when the upstream refuses the tunnel', async () => {
    const refuse = createServer()
    refuse.on('connect', (_req, socket) => {
      socket.end('HTTP/1.1 403 Forbidden\r\ncontent-length: 15\r\n\r\nupstream-secret')
    })
    await new Promise<void>(resolve => refuse.listen(0, '127.0.0.1', resolve))
    const address = refuse.address()
    if (address === null || typeof address === 'string') throw new Error('refuse bind failed')
    const proxy = await startProxy(allow, { upstream: upstreamAt(address.port) })
    dnsControl.fail = true
    try {
      const result = await viaConnect(proxy.port, 'target.example:443')
      expect(result.status).toBe(502)
      expect(result.body).not.toContain('upstream-secret')
    } finally {
      dnsControl.fail = false
      await proxy.close()
      await new Promise<void>(resolve => refuse.close(() => resolve()))
    }
  })
})
