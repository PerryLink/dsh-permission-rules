/**
 * Runtime network-policy integration: web-tool mode defaults and
 * structured denials on the `tools/pre-execute` waterfall, the sandbox
 * preset → mode mapping, proxy-block attribution into the
 * `permissionRules/network` session audit, the `/rules network` command,
 * and the settings-page Remote service (known-source-only rule
 * read/save). Uses the real harness (real session, real commands, real
 * proxy on an ephemeral loopback port; env injection disabled).
 * @module dsh-permission-rules/test/runtime-network
 */

import { describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'
import { SessionId } from '@deepseek-ai/dsh-session'
import { PermissionRulesRemoteService } from '../src/remote-service.ts'
import { PROXY_ENV_NAMES, NO_PROXY_ENV_NAMES } from '../src/proxy.ts'
import type { PermissionRulesRuntime } from '../src/runtime.ts'
import { dispatchPreExecute, makeAgent, makeExec, mountHarness, removeWorkspace, tempWorkspace } from './harness.ts'
import type { Harness } from './harness.ts'

/** One local HTTP origin for the end-to-end adjudication cases. */
async function origin(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('origin-ok')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('origin bind failed')
  return { port: address.port, close: () => new Promise<void>(resolve => server.close(() => resolve())) }
}

/** One local proxy GET that resolves with status + body even on 403s. */
function proxyGet(port: number, url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: url, method: 'GET' }, res => {
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

/** Write a rules file (creating its directory). */
function writeRules(cwd: string, text: string): void {
  mkdirSync(join(cwd, '.dsh'), { recursive: true })
  writeFileSync(join(cwd, '.dsh', 'rules.yaml'), text, 'utf8')
}

/** Mount with the network policy enabled (no env injection); `network` keys go under `config.network`. */
async function mountNetwork(config: Record<string, unknown>, options: { cwd?: string; enforce?: boolean } = {}): Promise<Harness> {
  return mountHarness({ network: { enabled: true, injectEnv: false, ...config }, ...(options.enforce === undefined ? {} : { enforce: options.enforce }) }, options)
}

/** The runtime instance a mounted harness exposes. */
function runtimeOf(harness: Harness): PermissionRulesRuntime {
  return harness.ctx.get('permissionRulesRuntime') as PermissionRulesRuntime
}

describe('web-tool mode defaults on tools/pre-execute', () => {
  it('denies an unlisted web_fetch call in deny-all mode with the structured marker', async () => {
    const harness = await mountNetwork({ mode: 'deny-all' })
    const decision = await dispatchPreExecute(harness.ctx, makeExec({ name: 'web_fetch', arguments: { url: 'https://api.github.com/x' }, agent: harness.agent }))
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') expect(decision.reason).toContain('[network: denied] network mode deny-all')
    const audit = harness.session.snapshotEvents().filter(event => event.type === 'permissionRules/decision').at(-1)
    expect(audit?.data).toMatchObject({ action: 'deny', outcome: 'deny', toolName: 'web_fetch' })
    expect((audit?.data as { reason?: string }).reason).toContain('network mode default')
  })

  it('asks in whitelist mode when unlisted is ask (the real approval seam)', async () => {
    const harness = await mountNetwork({ mode: 'whitelist', unlisted: 'ask' })
    const decision = await dispatchPreExecute(harness.ctx, makeExec({ name: 'web_search', arguments: { query: 'anything' }, agent: harness.agent }))
    expect(decision.kind).toBe('ask')
  })

  it('passes web tools through in allow-all mode', async () => {
    const harness = await mountNetwork({ mode: 'allow-all' })
    const decision = await dispatchPreExecute(harness.ctx, makeExec({ name: 'web_fetch', arguments: { url: 'https://api.github.com/x' }, agent: harness.agent }))
    expect(decision.kind).toBe('allow')
  })

  it('never gates shell tools at the tool layer (the proxy decides their traffic)', async () => {
    const harness = await mountNetwork({ mode: 'deny-all' })
    const decision = await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: { command: 'echo hello' }, agent: harness.agent }))
    expect(decision.kind).toBe('allow')
  })

  it('a deny rule on a URL in a bash command wins before the tool layer', async () => {
    const cwd = tempWorkspace()
    writeRules(cwd, 'rules:\n  - match: { tools: [bash], network: { domains: [evil.example] } }\n    action: deny\n    reason: known-bad host\n')
    const harness = await mountNetwork({ mode: 'allow-all' }, { cwd })
    try {
      const decision = await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: { command: 'curl https://evil.example/x' }, agent: harness.agent }))
      expect(decision.kind).toBe('deny')
      if (decision.kind === 'deny') expect(decision.reason).toBe('[network: denied] known-bad host')
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('dry-run delegates the mode-default deny and audits the would-be action', async () => {
    const harness = await mountNetwork({ mode: 'deny-all' }, { enforce: false })
    const decision = await dispatchPreExecute(harness.ctx, makeExec({ name: 'web_fetch', arguments: { url: 'https://api.github.com/x' }, agent: harness.agent }), () => Promise.resolve({ kind: 'allow' }))
    expect(decision.kind).toBe('allow')
    const audit = harness.session.snapshotEvents().filter(event => event.type === 'permissionRules/decision').at(-1)
    expect(audit?.data).toMatchObject({ action: 'deny', dryRun: true })
  })
})

describe('sandbox preset → network mode mapping', () => {
  it('maps read-only/workspace-write/danger-full-access through auto mode', async () => {
    const harness = await mountNetwork({ mode: 'auto' })
    const runtime = runtimeOf(harness)
    // Cordis forbids re-providing a service on one ctx, so the preset is
    // one mutable object whose field the runtime re-reads per resolution.
    const policy = { defaultMode: 'read-only' }
    harness.ctx.provide('sandboxPolicy', policy as never)
    expect(runtime.resolveNetworkMode().mode).toBe('deny-all')
    policy.defaultMode = 'workspace-write'
    expect(runtime.resolveNetworkMode().mode).toBe('whitelist')
    policy.defaultMode = 'danger-full-access'
    expect(runtime.resolveNetworkMode().mode).toBe('allow-all')
  })

  it('falls back to autoFallback when the sandbox-policy service is absent', async () => {
    const harness = await mountNetwork({ mode: 'auto', autoFallback: 'allow-all' })
    expect(runtimeOf(harness).resolveNetworkMode().mode).toBe('allow-all')
  })
})

describe('proxy-layer blocks with attribution audit', () => {
  it('appends permissionRules/network to the owning session for a denied connection', async () => {
    const harness = await mountNetwork({ mode: 'deny-all' })
    const runtime = runtimeOf(harness)
    const port = runtime.networkSnapshot().proxyPort
    expect(port).toBeGreaterThan(0)
    // Put a shell execution in flight so the block is attributable to it.
    await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: { command: 'sleep 1' }, agent: harness.agent }))
    const result = await proxyGet(port, 'http://denied.example/')
    expect(result.status).toBe(403)
    expect(result.body).toContain('[network: denied] network mode deny-all')
    const events = harness.session.snapshotEvents().filter(event => event.type === 'permissionRules/network')
    expect(events).toHaveLength(1)
    expect(events[0]?.data).toMatchObject({ kind: 'block', tool: 'bash', attributed: true, domain: 'denied.example', action: 'deny', mode: 'deny-all', matched: false })
    expect(runtime.networkSnapshot().denied).toBe(1)
  })
})

/**
 * Issue #18: host-level, session-less proxy traffic (the plugin market's own
 * catalog/update/npm lookups at boot) was adjudicated against the per-cwd
 * chain map while that map was still empty, so an allow rule that was ALREADY
 * configured did not permit the fetch until some session had run a tool call.
 */
describe('session-less host-level connections (issue #18)', () => {
  /** Mount with whitelist mode and a loopback target that must match a rule. */
  async function mountWithConfiguredRules(rulesFilePath: string): Promise<Harness> {
    return mountHarness({
      rulesFile: rulesFilePath,
      network: { enabled: true, injectEnv: false, mode: 'whitelist', unlisted: 'ask', loopback: 'policy' },
    }, {})
  }

  it('honours an already-configured allow rule before any session chain is loaded', async () => {
    const upstream = await origin()
    const rulesDir = tempWorkspace('sessionless')
    const rulesFilePath = join(rulesDir, 'rules.yaml')
    writeFileSync(rulesFilePath, `rules:\n  - action: allow\n    reason: pinned local origin\n    match:\n      network:\n        ips: [127.0.0.1]\n        ports: [${upstream.port}]\n`, 'utf8')
    const harness = await mountWithConfiguredRules(rulesFilePath)
    try {
      const port = runtimeOf(harness).networkSnapshot().proxyPort
      expect(port).toBeGreaterThan(0)
      // No tool call has run yet: the per-cwd chain map is still empty, which
      // is exactly the state the harness's own boot-time fetches see.
      const result = await proxyGet(port, `http://127.0.0.1:${upstream.port}/catalog.json`)
      expect(result.status).toBe(200)
      expect(result.body).toBe('origin-ok')
    } finally {
      await upstream.close()
      removeWorkspace(rulesDir)
    }
  })

  it('still applies the mode default when no configured rule matches', async () => {
    const upstream = await origin()
    const rulesDir = tempWorkspace('sessionless')
    const rulesFilePath = join(rulesDir, 'rules.yaml')
    writeFileSync(rulesFilePath, 'rules:\n  - action: allow\n    reason: some other host\n    match: { network: { domains: [allowed.example] } }\n', 'utf8')
    const harness = await mountWithConfiguredRules(rulesFilePath)
    try {
      const result = await proxyGet(runtimeOf(harness).networkSnapshot().proxyPort, `http://127.0.0.1:${upstream.port}/catalog.json`)
      expect(result.status).toBe(403)
      expect(result.body).toContain('[network: blocked pending approval] whitelist mode')
    } finally {
      await upstream.close()
      removeWorkspace(rulesDir)
    }
  })

  it('stops consulting the configured chain once a session workspace chain is loaded', async () => {
    const upstream = await origin()
    const hostDir = tempWorkspace('sessionless-host')
    const rulesFilePath = join(hostDir, '.dsh', 'rules.yaml')
    mkdirSync(join(hostDir, '.dsh'), { recursive: true })
    writeFileSync(rulesFilePath, `rules:\n  - action: allow\n    reason: pinned local origin\n    match:\n      network:\n        ips: [127.0.0.1]\n        ports: [${upstream.port}]\n`, 'utf8')
    // The configured chain is the one for the host process's own working
    // directory; it is stubbed here because a test must not depend on the
    // repository checkout's own cwd.
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(hostDir)
    const harness = await mountHarness({
      network: { enabled: true, injectEnv: false, mode: 'whitelist', unlisted: 'ask', loopback: 'policy' },
    }, {})
    // A session in a workspace with no rule file of its own: its (empty)
    // chain is what later connections are judged against — the configured
    // chain never outranks a session workspace chain.
    const otherWorkspace = tempWorkspace('sessionless-ws')
    try {
      const port = runtimeOf(harness).networkSnapshot().proxyPort
      expect((await proxyGet(port, `http://127.0.0.1:${upstream.port}/catalog.json`)).status).toBe(200)
      const session = harness.ctx.sessions.create(SessionId('sessionless-other'), { meta: { cwd: otherWorkspace } })
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: makeAgent(session) }))
      expect((await proxyGet(port, `http://127.0.0.1:${upstream.port}/catalog.json`)).status).toBe(403)
    } finally {
      cwdSpy.mockRestore()
      await upstream.close()
      removeWorkspace(hostDir)
      removeWorkspace(otherWorkspace)
    }
  })

  it('re-reads the configured chain after an explicit reload, so a corrected rule needs no restart', async () => {
    const upstream = await origin()
    const rulesDir = tempWorkspace('sessionless-reload')
    const rulesFilePath = join(rulesDir, 'rules.yaml')
    // Boot with a rule that does NOT cover the target.
    writeFileSync(rulesFilePath, 'rules:\n  - action: allow\n    reason: some other host\n    match: { network: { domains: [allowed.example] } }\n', 'utf8')
    const harness = await mountWithConfiguredRules(rulesFilePath)
    try {
      const runtime = runtimeOf(harness)
      const port = runtime.networkSnapshot().proxyPort
      const target = `http://127.0.0.1:${upstream.port}/catalog.json`
      expect((await proxyGet(port, target)).status).toBe(403)
      // The operator corrects the rule file — or the settings page writes it.
      writeFileSync(rulesFilePath, `rules:\n  - action: allow\n    reason: pinned local origin\n    match:\n      network:\n        ips: [127.0.0.1]\n        ports: [${upstream.port}]\n`, 'utf8')
      // Still the boot-time chain: the session-less chain is cached, is not a
      // `byCwd` member, and is not watched, so nothing had re-read it yet.
      expect((await proxyGet(port, target)).status).toBe(403)
      // An explicit reload (the settings-page action, usable with no session)
      // must reach it, so the fix does not require a process restart.
      runtime.reloadAll()
      expect((await proxyGet(port, target)).status).toBe(200)
    } finally {
      await upstream.close()
      removeWorkspace(rulesDir)
    }
  })
})

describe('/rules network command', () => {
  it('renders the mode, counters, and recent blocks', async () => {
    const harness = await mountNetwork({ mode: 'deny-all' })
    const execution = await harness.ctx.commands.execute(harness.agent, '/rules network', [], new AbortController().signal)
    expect(execution?.result.kind).toBe('success')
    const text = execution?.result.kind === 'success' ? execution.result.text ?? '' : ''
    expect(text).toContain('mode deny-all')
    expect(text).toContain('proxy active on 127.0.0.1:')
  })
})

describe('settings-page Remote service', () => {
  it('serves the snapshot, the known-source rule editor, and validated saves', async () => {
    const cwd = tempWorkspace()
    const harness = await mountNetwork({ mode: 'allow-all' }, { cwd })
    // The plugin's apply() already mounts the Remote service on the harness
    // ctx; mounting it again would re-provide the `permissionRules` service.
    // Resolve the workspace once so the runtime knows its project file (the
    // editor only ever touches KNOWN sources).
    runtimeOf(harness).rulesFor(cwd)
    const remote = harness.ctx.get('permissionRules') as PermissionRulesRemoteService
    try {
      const snapshot = remote.networkStatus()
      expect(snapshot.mode).toBe('allow-all')
      expect(snapshot.proxyActive).toBe(true)
      const projectFile = join(cwd, '.dsh', 'rules.yaml')
      expect(snapshot.sources.map(source => source.path)).toContain(projectFile)

      // A new (not-yet-existing) project file is editable.
      const read = remote.rulesRead(projectFile)
      expect(read.exists).toBe(false)

      // An invalid document is rejected before anything touches disk.
      const bad = remote.rulesSave(projectFile, 'rules: [not a list')
      expect(bad.ok).toBe(false)
      expect(existsSync(projectFile)).toBe(false)

      // A valid document is written and adopted.
      const good = remote.rulesSave(projectFile, 'rules:\n  - match: { network: { domains: [allowed.example] } }\n    action: allow\n    reason: pinned\n')
      expect(good.ok).toBe(true)
      expect(readFileSync(projectFile, 'utf8')).toContain('allowed.example')

      // Arbitrary paths are refused.
      expect(remote.rulesSave(join(cwd, 'outside.yaml'), 'rules: []').ok).toBe(false)
    } finally {
      removeWorkspace(cwd)
    }
  })
})

/**
 * Issue #19 item 2, runtime half: the ambient capture, the snapshot the
 * settings page and `/rules network` render, and the self-loop guard.
 *
 * Every case clears ALL proxy names for its duration: each mount injects the
 * plugin's own address into the process environment (and the harness is not
 * disposed between cases), so an earlier case's injection would otherwise be
 * captured as if the operator had exported it — the very trap the capture's
 * memoization exists for.
 */
describe('upstream chaining, runtime side (issue #19 item 2)', () => {
  /** Run one body with every proxy name cleared, then the given ones applied. */
  async function withProxyEnv(values: Record<string, string>, body: () => Promise<void>): Promise<void> {
    const saved = new Map<string, string | undefined>()
    for (const name of [...PROXY_ENV_NAMES, ...NO_PROXY_ENV_NAMES]) {
      saved.set(name, process.env[name])
      delete process.env[name]
    }
    for (const [name, value] of Object.entries(values)) process.env[name] = value
    try {
      await body()
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  }

  it('reports the upstream state in the network snapshot, with the password masked', async () => {
    await withProxyEnv({ http_proxy: 'http://user:secret@ambient.example:3128' }, async () => {
      const off = await mountHarness({ network: { enabled: true, injectEnv: false, mode: 'allow-all', upstreamProxy: 'off' } }, {})
      expect(runtimeOf(off).networkSnapshot().upstream).toEqual({ mode: 'off', http: null, https: null, active: false, chained: 0 })

      const inherit = await mountHarness({ network: { enabled: true, injectEnv: false, mode: 'allow-all', upstreamProxy: 'inherit' } }, {})
      const upstream = runtimeOf(inherit).networkSnapshot().upstream
      expect(upstream.mode).toBe('inherit')
      expect(upstream.active).toBe(true)
      expect(upstream.http).toBe('http://user:***@ambient.example:3128')
      // The credential never leaves the plugin in the clear, in any field.
      expect(JSON.stringify(upstream)).not.toContain('secret')
    })
  })

  it('disables chaining when the configured upstream is this proxy itself', async () => {
    // Reserve a port, release it, then make the proxy bind to it AND name it as
    // the ambient upstream: a self-loop, which would otherwise recurse forever.
    const probe = createServer()
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
    const address = probe.address()
    if (address === null || typeof address === 'string') throw new Error('probe bind failed')
    const port = address.port
    await new Promise<void>(resolve => probe.close(() => resolve()))

    await withProxyEnv({ http_proxy: `http://127.0.0.1:${port}` }, async () => {
      const harness = await mountHarness({ network: { enabled: true, injectEnv: false, mode: 'allow-all', proxyPort: port, upstreamProxy: 'inherit' } }, {})
      const snapshot = runtimeOf(harness).networkSnapshot()
      expect(snapshot.proxyPort).toBe(port)
      expect(snapshot.upstream.http).toBe(`http://127.0.0.1:${port}`)
      expect(snapshot.upstream.active).toBe(false)
      expect(snapshot.upstream.chained).toBe(0)
    })
  })

  it('renders the upstream line in /rules network', async () => {
    const harness = await mountNetwork({ mode: 'allow-all' })
    const execution = await harness.ctx.commands.execute(harness.agent, '/rules network', [], new AbortController().signal)
    const text = execution?.result.kind === 'success' ? execution.result.text ?? '' : ''
    expect(text).toContain('Upstream:')
  })
})
