/**
 * The plugin's built-in local HTTP/CONNECT proxy: the process-level
 * network gate for shell subprocess traffic. Bash/pwsh children inherit
 * `HTTP(S)_PROXY`/`ALL_PROXY` environment variables pointing here, and the
 * proxy adjudicates EVERY connection target against the loaded network
 * rules and the active policy mode — the domain decision lives in the
 * proxy layer, not in per-command wrappers.
 *
 * Boundaries (documented in the README): DSH's official `ctx.sandbox`
 * enforces FILE effects only, so network interception is entirely this
 * plugin's job; the proxy has no session context, so an `ask` decision at
 * the proxy layer cannot ride the interactive approval seam — it blocks
 * the connection with a structured message and is audit-logged instead
 * (web tools get the real approval seam at `tools/pre-execute`).
 * @module dsh-permission-rules/proxy
 */

import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect } from 'node:net'
import { lookup } from 'node:dns/promises'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import type { Server, IncomingMessage, RequestOptions, ServerResponse } from 'node:http'
import type { CallId } from './call-id.ts'
import type { NetworkDecision, NetworkMode } from './network.ts'
import { blockMessage, isLoopbackTarget } from './network.ts'
import { isIpLiteral, parseUrlTarget } from './rules.ts'
import type { NetworkTarget, SchemeName } from './rules.ts'

/** Proxy environment variable names the injector sets/restores (uppercase + lowercase for mixed-ecosystem CLIs). */
export const PROXY_ENV_NAMES: readonly string[] = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']

/** NO_PROXY names cleared (or preserved) by the injector. */
export const NO_PROXY_ENV_NAMES: readonly string[] = ['NO_PROXY', 'no_proxy']

/** How long a chained CONNECT waits for the upstream to answer before it gives up. */
const UPSTREAM_CONNECT_TIMEOUT_MS = 10_000

/** The upstream proxies the launch environment supplies, resolved per scheme. */
export interface AmbientUpstream {
  readonly http?: string
  readonly https?: string
}

/**
 * Resolve ambient upstream candidates the way the harness's own proxy policy
 * does: the scheme-specific name (lowercase first, blank treated as unset),
 * then `ALL_PROXY`, then — for https only — the http name. A value that is not
 * a parseable `http(s)://` URL is dropped here; the runtime reports those once.
 * @param lookup - reads one environment name (the launch snapshot, or `process.env`).
 * @returns the usable candidates, each absent when it is unusable.
 */
export function readAmbientProxy(lookup: (name: string) => string | undefined): AmbientUpstream {
  const pick = (names: readonly string[]): string | undefined => {
    for (const name of names) {
      const value = lookup(name)
      if (value !== undefined && value.trim().length > 0) return value.trim()
    }
    return undefined
  }
  const usable = (value: string | undefined): string | undefined => {
    if (value === undefined) return undefined
    try {
      const parsed = new URL(value)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : undefined
    } catch {
      return undefined
    }
  }
  const all = usable(pick(['ALL_PROXY', 'all_proxy']))
  const http = usable(pick(['http_proxy', 'HTTP_PROXY'])) ?? all
  const https = usable(pick(['https_proxy', 'HTTPS_PROXY'])) ?? all ?? http
  return { ...(http === undefined ? {} : { http }), ...(https === undefined ? {} : { https }) }
}

/**
 * The loggable form of a proxy URL: the password is replaced, everything else
 * is kept verbatim. An upstream URL may carry credentials, and a proxy URL is
 * printed in warnings, `/rules network` and the settings snapshot, so it must
 * never be emitted raw.
 * @param value - the configured upstream URL.
 * @returns the same URL with its password masked, or the input when unparseable.
 */
export function redactProxyUrl(value: string): string {
  try {
    const parsed = new URL(value)
    if (parsed.username === '' && parsed.password === '') return value
    const user = parsed.username
    const auth = parsed.password === '' ? `${user}@` : `${user}:***@`
    return `${parsed.protocol}//${auth}${parsed.host}`
  } catch {
    return value
  }
}

/** The `Proxy-Authorization` value for an upstream URL carrying userinfo. */
function proxyAuthorization(url: URL): string | undefined {
  if (url.username === '' && url.password === '') return undefined
  const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`
  return `Basic ${Buffer.from(credentials).toString('base64')}`
}

/** One recorded proxy-layer block (settings-page list + session audit + logger). */
export interface NetworkBlockRecord {
  readonly time: number
  readonly tool: string
  readonly attributed: boolean
  readonly callId?: CallId
  readonly domain: string
  readonly scheme?: SchemeName
  readonly port?: number
  readonly action: 'deny' | 'ask'
  readonly mode: NetworkMode
  readonly matched: boolean
  readonly source: string
  readonly ruleIndex?: number
  readonly reason?: string
}

/** Cumulative proxy-layer block counters. */
export interface NetworkStats {
  denied: number
  askBlocked: number
}

/** The attribution the runtime supplies for one connection (the newest in-flight shell execution). */
export interface ProxyAttribution {
  readonly tool: string
  readonly callId?: CallId
  readonly agent?: {
    readonly session: { append(type: 'permissionRules/network', data: unknown, options?: { ignorable?: true }): unknown }
  }
}

/** Construction options for {@link NetworkProxy}. */
export interface NetworkProxyOptions {
  /** Bind address (loopback by config). */
  readonly bind: string
  /** Requested port; `0` binds an ephemeral port. */
  readonly port: number
  /** Cap on recent-block records kept in memory. */
  readonly maxRecent: number
  /** Decision function supplied by the runtime (rules + mode). */
  readonly decide: (target: NetworkTarget) => NetworkDecision
  /** Current attribution (newest in-flight shell execution), or undefined. */
  readonly attribution?: () => ProxyAttribution | undefined
  /** Called for every blocked connection, after the response is sent. */
  readonly onBlock?: (record: NetworkBlockRecord, attribution: ProxyAttribution | undefined) => void
  /** Logger sink (proxy failures must never crash the host). */
  readonly logger: { warn(message: string): void }
  /**
   * The upstream proxies an ALLOWED connection may be chained through, or
   * undefined to dial directly. A getter, so a live settings change takes
   * effect on the next connection.
   */
  readonly upstream?: () => AmbientUpstream | undefined
}

/**
 * The local HTTP/CONNECT policy proxy. Binds on demand (the plugin calls
 * {@link start} inside an effect and {@link close} from its disposer);
 * every live tunnel socket is tracked and destroyed on close so updates
 * and uninstalls leave no orphaned connections.
 */
export class NetworkProxy {
  private server: Server | undefined
  private readonly sockets = new Set<Duplex>()
  private readonly recent: NetworkBlockRecord[] = []
  private readonly stats: NetworkStats = { denied: 0, askBlocked: 0 }
  private actualPort = 0
  private chained = 0

  constructor(private readonly options: NetworkProxyOptions) {}

  /** Connections dispatched through the configured upstream since mount. */
  chainedConnections(): number {
    return this.chained
  }

  /** The bound port (valid after {@link start} resolves). */
  get port(): number {
    return this.actualPort
  }

  /** Deny/ask blocks recorded since mount, newest first (settings-page list). */
  recentBlocks(): readonly NetworkBlockRecord[] {
    return this.recent
  }

  /** Cumulative block counters. */
  blockStats(): NetworkStats {
    return { ...this.stats }
  }

  /** Bind the server and return the actual port. */
  start(): Promise<number> {
    const server = createServer((req, res) => {
      void this.handleRequest(req, res)
    })
    server.on('connect', (req, socket, head) => {
      void this.handleConnect(req, socket, head)
    })
    server.on('error', (error: unknown) => {
      this.options.logger.warn(`permission-rules: proxy server error: ${String(error)}`)
    })
    this.server = server
    return new Promise((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = (): void => {
        server.off('error', onError)
        const address = server.address() as AddressInfo
        this.actualPort = address.port
        resolve(address.port)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.options.port, this.options.bind)
    })
  }

  /** Stop the server and destroy every tunnel; resolves when sockets are closed. */
  close(): Promise<void> {
    const server = this.server
    this.server = undefined
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    if (server === undefined) return Promise.resolve()
    return new Promise(resolve => {
      server.close(() => resolve())
    })
  }

  /**
   * The upstream one ALLOWED connection may be chained through, or undefined to
   * dial directly. Three vetoes, in order:
   *
   * 1. a loopback target never chains — a proxy outside this host cannot route
   *    its loopback, and the harness's own policy bypasses loopback for the same
   *    reason;
   * 2. an `ips`-scoped decision never chains — chaining hands the hostname to
   *    the upstream, so "the connection lands on an address the rules saw"
   *    (the issue #21 invariant) would stop holding exactly where the rules
   *    cared about the address;
   * 3. no usable upstream for the target's scheme.
   *
   * A blocked connection never reaches this method: it is called only on the
   * `allow` branch, after the decision is final.
   * @param target - the adjudicated target.
   * @param decision - the decision that allowed it.
   * @returns the upstream URL to chain through, or undefined.
   */
  private upstreamRouteFor(target: NetworkTarget, decision: NetworkDecision): string | undefined {
    const ambient = this.options.upstream?.()
    if (ambient === undefined) return undefined
    if (isLoopbackTarget(target)) return undefined
    const ipsScope = decision.rule?.source.match.network?.ips
    if (ipsScope !== undefined && ipsScope.length > 0) return undefined
    return (target.scheme ?? 'http') === 'https' ? ambient.https : ambient.http
  }

  /**
   * Open a tunnel by asking the upstream for one, and hand back the socket it
   * established. The upstream's own hostname is resolved by the system: it is
   * operator configuration, not agent input, so it takes no part in rule
   * adjudication and is outside the adjudicated-address invariant.
   * @param upstream - the upstream proxy URL.
   * @param authority - the `host:port` to ask for (IPv6 already bracketed).
   * @returns the established tunnel socket.
   */
  private connectViaUpstream(upstream: string, authority: string): Promise<Duplex> {
    return new Promise((resolve, reject) => {
      const via = new URL(upstream)
      const send = via.protocol === 'https:' ? httpsRequest : httpRequest
      const headers: Record<string, string> = { host: authority }
      const auth = proxyAuthorization(via)
      if (auth !== undefined) headers['proxy-authorization'] = auth
      const req = send({
        host: via.hostname,
        port: via.port === '' ? (via.protocol === 'https:' ? 443 : 80) : Number(via.port),
        method: 'CONNECT',
        path: authority,
        headers,
      })
      req.setTimeout(UPSTREAM_CONNECT_TIMEOUT_MS, () => { req.destroy(new Error('upstream CONNECT timed out')) })
      req.on('connect', (response, socket) => {
        const status = response.statusCode ?? 0
        if (status >= 200 && status < 300) resolve(socket)
        else {
          socket.destroy()
          reject(new Error(`upstream answered ${String(status)}`))
        }
      })
      // A non-2xx CONNECT answer arrives as a plain response, not as 'connect'.
      req.on('response', response => {
        response.resume()
        reject(new Error(`upstream answered ${String(response.statusCode ?? 0)}`))
      })
      req.on('error', reject)
      req.end()
    })
  }

  /** Plain-HTTP proxying: absolute-form requests are adjudicated and forwarded (or blocked with a structured 403). */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const target = parseUrlTarget(req.url ?? '')
    if (target === undefined || target.scheme === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('permission-rules proxy: only absolute-form proxy requests are served here\n')
      return
    }
    const { decision, target: adjudicated } = await this.decideWithResolution(target)
    if (decision.action !== 'allow') {
      this.recordBlock(decision, target)
      const body = blockMessage(decision)
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body) })
      res.end(body)
      return
    }
    const upstream = new URL(req.url as string)
    const onResponse = (proxyRes: IncomingMessage): void => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
      proxyRes.pipe(res)
    }
    const chained = this.upstreamRouteFor(adjudicated, decision)
    let proxyReq: ReturnType<typeof httpRequest>
    if (chained === undefined) {
      // The forwarded connection is pinned to the addresses the decision was
      // made on, so a hostname that re-resolves between adjudication and
      // connect (DNS rebinding) cannot reach an address the rules never
      // approved.
      const pinned = pinnedAddresses(adjudicated)
      const options: RequestOptions = {
        method: req.method,
        headers: req.headers,
        ...(pinned.length === 0 ? {} : { lookup: pinnedLookup(pinned) }),
      }
      proxyReq = (upstream.protocol === 'https:' ? httpsRequest : httpRequest)(upstream, options, onResponse)
    } else {
      // Chained: the upstream does the resolving, which is exactly why an
      // `ips`-scoped decision never takes this branch (see upstreamRouteFor).
      const via = new URL(chained)
      const headers: Record<string, string | string[] | undefined> = { ...req.headers }
      const auth = proxyAuthorization(via)
      if (auth !== undefined) headers['proxy-authorization'] = auth
      proxyReq = (via.protocol === 'https:' ? httpsRequest : httpRequest)({
        host: via.hostname,
        port: via.port === '' ? (via.protocol === 'https:' ? 443 : 80) : Number(via.port),
        method: req.method,
        path: req.url, // absolute form, which is what a proxy expects
        headers,
      }, onResponse)
      this.chained += 1
    }
    proxyReq.on('error', (error: unknown) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain' })
        res.end(`[network: upstream error] ${String(error)}\n`)
      } else {
        res.destroy()
      }
    })
    req.pipe(proxyReq)
  }

  /**
   * Connect to the first adjudicated address that accepts, so the tunnel lands
   * on an address the decision approved. Each candidate is tried in order so a
   * multi-address host does not lose its fallback.
   *
   * A target whose adjudication resolved no address FAILS here instead of
   * dialing the hostname (issue #21): dialing the name would be a second DNS
   * resolution — the answer could differ from the one the rules were evaluated
   * against — and it is the one remaining path where Node's happy-eyeballs
   * race applies, with its 250 ms `autoSelectFamilyAttemptTimeout` default
   * that kills any endpoint further away than that. Dialing an already-
   * resolved literal skips that algorithm entirely (net.js connects an IP
   * without a lookup), so the tunnel only ever reaches an adjudicated
   * address; the client's retry resolves and adjudicates again.
   */
  private async connectUpstream(target: NetworkTarget, port: number): Promise<Duplex> {
    const pinned = pinnedAddresses(target)
    if (pinned.length === 0) throw new Error(`no adjudicated address for ${target.host}`)
    let lastError: unknown
    for (const address of pinned) {
      try {
        return await new Promise<Duplex>((resolve, reject) => {
          const socket = connect(port, address)
          socket.once('connect', () => resolve(socket))
          socket.once('error', (error: unknown) => {
            socket.destroy()
            reject(error instanceof Error ? error : new Error(String(error)))
          })
        })
      } catch (error) {
        lastError = error
      }
    }
    throw lastError instanceof Error ? lastError : new Error('no adjudicated address accepted the connection')
  }

  /** CONNECT tunneling (HTTPS and friends): adjudicate, then either 403 or an established TCP tunnel. */
  private async handleConnect(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    // Guard first (issue #12): a CONNECT socket is a raw Duplex handed over
    // by the HTTP server with no default 'error' handling, so a client reset
    // in any window — the decision await, the 400 early return, or the 403
    // early return — would emit an unhandled 'error' and crash the host
    // process. The handler closes over the tunnel holder so the same guard
    // doubles as tunnel teardown once an upstream exists.
    const tunnelHolder: { tunnel?: Duplex } = {}
    socket.on('error', (error: unknown) => {
      this.options.logger.warn(`permission-rules: CONNECT socket error: ${String(error)}`)
      tunnelHolder.tunnel?.destroy()
      socket.destroy()
    })
    const target = connectTarget(req.url ?? '')
    if (target === undefined) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
      return
    }
    const { decision, target: adjudicated } = await this.decideWithResolution(target)
    if (decision.action !== 'allow') {
      this.recordBlock(decision, target)
      const body = blockMessage(decision)
      socket.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
      return
    }
    let tunnel: Duplex
    const chained = this.upstreamRouteFor(adjudicated, decision)
    try {
      tunnel = chained === undefined
        ? await this.connectUpstream(adjudicated, target.port ?? 443)
        : await this.connectViaUpstream(chained, target.host.includes(':') ? `[${target.host}]:${String(target.port ?? 443)}` : `${target.host}:${String(target.port ?? 443)}`)
      if (chained !== undefined) this.chained += 1
    } catch (error) {
      this.options.logger.warn(`permission-rules: upstream connect failed for ${target.host}: ${String(error)}${chained === undefined ? '' : ` (via ${redactProxyUrl(chained)})`}`)
      socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')
      return
    }
    tunnelHolder.tunnel = tunnel
    this.sockets.add(socket)
    this.sockets.add(tunnel)
    const cleanup = (): void => {
      this.sockets.delete(socket)
      this.sockets.delete(tunnel)
    }
    socket.on('close', cleanup)
    tunnel.on('close', cleanup)
    tunnel.on('error', () => socket.destroy())
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length > 0) tunnel.write(head)
    tunnel.pipe(socket)
    socket.pipe(tunnel)
  }

  /** Resolve a hostname once so `ips`-scoped rules see the real addresses, then decide. */
  private async decideWithResolution(target: NetworkTarget): Promise<{ decision: NetworkDecision; target: NetworkTarget }> {
    if (!isIpLiteral(target.host)) {
      try {
        const addresses = await lookup(target.host, { all: true, verbatim: true })
        const resolved = addresses.map(entry => entry.address)
        if (resolved.length > 0) {
          const effective: NetworkTarget = { ...target, ips: [...target.ips, ...resolved] }
          return { decision: await this.options.decide(effective), target: effective }
        }
      } catch {
        // Unresolvable target: decide on the literal name (ip-scoped rules simply cannot fire).
      }
    }
    return { decision: await this.options.decide(target), target }
  }

  /** Record a block: counters, recent ring, and the runtime hook (logger + session audit). */
  private recordBlock(decision: NetworkDecision, target: NetworkTarget): void {
    const attribution = this.options.attribution?.()
    const record: NetworkBlockRecord = {
      time: Date.now(),
      tool: attribution?.tool ?? 'subprocess',
      attributed: attribution !== undefined,
      ...(attribution?.callId !== undefined ? { callId: attribution.callId } : {}),
      domain: target.host,
      ...(target.scheme !== undefined ? { scheme: target.scheme } : {}),
      ...(target.port !== undefined ? { port: target.port } : {}),
      action: decision.action === 'ask' ? 'ask' : 'deny',
      mode: decision.mode,
      matched: decision.matched,
      source: decision.source ?? '',
      ...(decision.ruleIndex !== undefined ? { ruleIndex: decision.ruleIndex } : {}),
      ...(decision.rule !== undefined ? { reason: decision.rule.reason } : {}),
    }
    if (record.action === 'deny') this.stats.denied += 1
    else this.stats.askBlocked += 1
    this.recent.unshift(record)
    if (this.recent.length > this.options.maxRecent) this.recent.length = this.options.maxRecent
    this.options.logger.warn(`permission-rules: network ${record.action === 'deny' ? 'denied' : 'ask-blocked'} ${target.scheme ?? '?'}://${target.host}${target.port !== undefined ? `:${target.port}` : ''} (mode ${decision.mode}${decision.matched ? `, rule ${(decision.ruleIndex ?? 0) + 1}` : ', mode default'})`)
    try {
      this.options.onBlock?.(record, attribution)
    } catch (error: unknown) {
      this.options.logger.warn(`permission-rules: network block hook failed: ${String(error)}`)
    }
  }
}

/** Parse a CONNECT authority (`host:port`) into an https target with an explicit port. */
function connectTarget(authority: string): NetworkTarget | undefined {
  const colon = authority.lastIndexOf(':')
  if (colon <= 0) return undefined
  const host = authority.slice(0, colon).replace(/^\[|\]$/g, '').toLowerCase().replace(/\.+$/, '')
  const port = Number(authority.slice(colon + 1))
  if (host.length === 0 || !Number.isInteger(port) || port < 1 || port > 65535) return undefined
  return { scheme: 'https', host, port, ips: isIpLiteral(host) ? [host] : [] }
}

/**
 * The literal addresses a connection may use — everything the decision was
 * made on. Returning them keeps the connection on an adjudicated address
 * instead of letting a second DNS lookup pick a different one.
 * @param target - the adjudicated target.
 * @returns the adjudicated literal addresses, in decision order.
 */
function pinnedAddresses(target: NetworkTarget): readonly string[] {
  return target.ips.filter(candidate => isIpLiteral(candidate))
}

/**
 * A `lookup` that answers from the adjudicated address list without a second
 * DNS query. Node's happy-eyeballs path asks with `all: true` and tries the
 * returned addresses in order, so a multi-address host keeps its fallbacks.
 * @param addresses - the adjudicated literal addresses.
 * @returns the lookup function handed to `http(s).request`.
 */
function pinnedLookup(addresses: readonly string[]): NonNullable<RequestOptions['lookup']> {
  const resolved = addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4 }))
  return (_hostname, options, callback) => {
    if (options.all === true) callback(null, resolved)
    else callback(null, resolved[0]!.address, resolved[0]!.family)
  }
}

/**
 * Inject the proxy environment variables for subprocesses and return a
 * disposer restoring every previous value exactly (so updates and
 * uninstalls leave the host environment untouched). `noProxy: 'clear'`
 * empties NO_PROXY so the policy cannot be bypassed through ambient
 * exclusions; `preserve` keeps ambient values.
 *
 * The snapshot pass covers EVERY name BEFORE any write: on Windows
 * `process.env` is case-insensitive, so the uppercase/lowercase spellings
 * share one variable — writing `HTTP_PROXY` mid-loop would otherwise
 * poison the later snapshot of `http_proxy` and make the restore write
 * the proxy address back over the original.
 * @param port - the bound proxy port.
 * @param noProxy - the configured NO_PROXY handling.
 * @returns the restore disposer.
 */
export function injectProxyEnv(port: number, noProxy: 'clear' | 'preserve'): () => void {
  const previous = new Map<string, string | undefined>()
  const value = `http://127.0.0.1:${port}`
  for (const name of PROXY_ENV_NAMES) previous.set(name, process.env[name])
  if (noProxy === 'clear') {
    for (const name of NO_PROXY_ENV_NAMES) previous.set(name, process.env[name])
  }
  for (const name of PROXY_ENV_NAMES) process.env[name] = value
  if (noProxy === 'clear') {
    for (const name of NO_PROXY_ENV_NAMES) process.env[name] = ''
  }
  return () => {
    for (const name of PROXY_ENV_NAMES) {
      const old = previous.get(name)
      if (old === undefined) delete process.env[name]
      else process.env[name] = old
    }
    if (noProxy === 'clear') {
      for (const name of NO_PROXY_ENV_NAMES) {
        const old = previous.get(name)
        if (old === undefined) delete process.env[name]
        else process.env[name] = old
      }
    }
  }
}
