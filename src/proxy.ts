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
import type { Server, IncomingMessage, ServerResponse } from 'node:http'
import type { CallId } from './call-id.ts'
import type { NetworkDecision, NetworkMode } from './network.ts'
import { blockMessage } from './network.ts'
import { isIpLiteral, parseUrlTarget } from './rules.ts'
import type { NetworkTarget, SchemeName } from './rules.ts'

/** Proxy environment variable names the injector sets/restores (uppercase + lowercase for mixed-ecosystem CLIs). */
export const PROXY_ENV_NAMES: readonly string[] = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']

/** NO_PROXY names cleared (or preserved) by the injector. */
export const NO_PROXY_ENV_NAMES: readonly string[] = ['NO_PROXY', 'no_proxy']

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

  constructor(private readonly options: NetworkProxyOptions) {}

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

  /** Plain-HTTP proxying: absolute-form requests are adjudicated and forwarded (or blocked with a structured 403). */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const target = parseUrlTarget(req.url ?? '')
    if (target === undefined || target.scheme === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('permission-rules proxy: only absolute-form proxy requests are served here\n')
      return
    }
    await this.forwardOrBlock(res, target, () => {
      const upstream = new URL(req.url as string)
      const send = upstream.protocol === 'https:' ? httpsRequest : httpRequest
      const proxyReq = send(upstream, { method: req.method, headers: req.headers }, proxyRes => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
        proxyRes.pipe(res)
      })
      proxyReq.on('error', (error: unknown) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'text/plain' })
          res.end(`[network: upstream error] ${String(error)}\n`)
        } else {
          res.destroy()
        }
      })
      req.pipe(proxyReq)
    })
  }

  /** CONNECT tunneling (HTTPS and friends): adjudicate, then either 403 or an established TCP tunnel. */
  private async handleConnect(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const target = connectTarget(req.url ?? '')
    if (target === undefined) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
      return
    }
    const decision = await this.decideWithResolution(target)
    if (decision.action !== 'allow') {
      this.recordBlock(decision, target)
      const body = blockMessage(decision)
      socket.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
      return
    }
    const upstream = connect(target.port ?? 443, target.host)
    this.sockets.add(socket)
    this.sockets.add(upstream)
    const cleanup = (): void => {
      this.sockets.delete(socket)
      this.sockets.delete(upstream)
    }
    socket.on('close', cleanup)
    upstream.on('close', cleanup)
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    upstream.once('connect', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length > 0) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
  }

  /** Adjudicate one plain-HTTP request; deny/ask blocks with a structured 403 before any forwarding. */
  private async forwardOrBlock(res: ServerResponse, target: NetworkTarget, forward: () => void): Promise<void> {
    const decision = await this.decideWithResolution(target)
    if (decision.action !== 'allow') {
      this.recordBlock(decision, target)
      const body = blockMessage(decision)
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body) })
      res.end(body)
      return
    }
    forward()
  }

  /** Resolve a hostname once so `ips`-scoped rules see the real addresses, then decide. */
  private async decideWithResolution(target: NetworkTarget): Promise<NetworkDecision> {
    if (!isIpLiteral(target.host)) {
      try {
        const addresses = await lookup(target.host, { all: true, verbatim: true })
        const resolved = addresses.map(entry => entry.address)
        if (resolved.length > 0) return this.options.decide({ ...target, ips: [...target.ips, ...resolved] })
      } catch {
        // Unresolvable target: decide on the literal name (ip-scoped rules simply cannot fire).
      }
    }
    return this.options.decide(target)
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
