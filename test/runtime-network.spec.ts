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
import { allowHostReason } from '../src/allow-host.ts'
import { allowHostNotice, allowHostWorkspaces } from '../src/allow-host-notice.ts'
import { parseRulesDocument } from '../src/rules.ts'
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
 * Issue #19 item 3: the settings-page "allow this host" action. Every case
 * here asserts a SAFETY property of the action rather than that a method ran:
 * index-0 insertion (first-match), comment preservation, the session-less
 * host file, the recomputed outcome, refusal with the disk untouched, and
 * idempotence.
 */
describe('settings-page allow-host action (issue #19 item 3)', () => {
  /** The blocked target every case uses: a literal, so no DNS is involved. */
  const HOST = '127.0.0.1'

  /** A deny rule for one host, as an operator would have written it. */
  function denyRule(host: string, reason: string): string {
    return `rules:\n  - match: { network: { domains: [${host}] } }\n    action: deny\n    reason: ${JSON.stringify(reason)}\n`
  }

  /** Mount whitelist mode with loopback judged by the rules, so a local origin can be blocked. */
  async function mountPolicy(config: Record<string, unknown>, cwd: string): Promise<Harness> {
    return mountNetwork({ mode: 'whitelist', unlisted: 'ask', loopback: 'policy', ...config }, { cwd })
  }

  /** The settings-page Remote service the plugin's `apply` mounted. */
  function remoteOf(harness: Harness): PermissionRulesRemoteService {
    return harness.ctx.get('permissionRules') as PermissionRulesRemoteService
  }

  /** Put one shell execution in flight so a proxy block is attributed to the workspace. */
  async function attributeShell(harness: Harness): Promise<void> {
    await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: { command: 'sleep 5' }, agent: harness.agent }))
  }

  it('inserts the rule at index 0 of the project file and unblocks the connection with no reload', async () => {
    const upstream = await origin()
    const cwd = tempWorkspace()
    const projectFile = join(cwd, '.dsh', 'rules.yaml')
    writeRules(cwd, denyRule(HOST, 'maintenance window'))
    const harness = await mountPolicy({}, cwd)
    const runtime = runtimeOf(harness)
    const port = runtime.networkSnapshot().proxyPort
    const target = `http://${HOST}:${upstream.port}/catalog.json`
    try {
      await attributeShell(harness)
      expect((await proxyGet(port, target)).status).toBe(403)
      // The block carries the attributed workspace, which is what the page sends back.
      expect(runtime.networkSnapshot().recent[0]).toMatchObject({ domain: HOST, cwd })
      const audits = (): number => harness.session.snapshotEvents().filter(event => String(event.type).startsWith('permissionRules/')).length
      const auditsBefore = audits()

      const result = remoteOf(harness).allowHost({ host: HOST, scheme: 'http', port: upstream.port, cwd })
      expect(result).toMatchObject({ ok: true, outcome: 'allow', alreadyAllowed: false, created: false, error: null })
      expect(result.path).toBe(projectFile)
      expect(result.reloaded).toBeGreaterThanOrEqual(1)

      // ② the FIRST rule of the file is the generated allow; the operator's deny survives after it.
      const text = readFileSync(projectFile, 'utf8')
      const doc = parseRulesDocument(text)
      expect(doc.rules[0]).toMatchObject({ action: 'allow', match: { network: { domains: [HOST] } } })
      expect(doc.rules[1]?.action).toBe('deny')
      expect(text.indexOf(allowHostReason(HOST))).toBeLessThan(text.indexOf('maintenance window'))

      // ③ the next connection goes through — the write itself reloaded the chain.
      expect((await proxyGet(port, target)).status).toBe(200)

      // ⑧ the action audits nothing: no fabricated permissionRules/* rows.
      expect(audits()).toBe(auditsBefore)
    } finally {
      await upstream.close()
      removeWorkspace(cwd)
    }
  })

  it('preserves comments and the untouched rules of the file it edits', async () => {
    const cwd = tempWorkspace()
    const projectFile = join(cwd, '.dsh', 'rules.yaml')
    const original = [
      '# workspace rules — keep this header',
      'rules:',
      '  # a pinned deny, with a reason that must survive verbatim',
      '  - match: { network: { domains: [evil.example] } }',
      '    action: deny',
      '    reason: "known bad"',
      '',
    ].join('\n')
    writeRules(cwd, original)
    const harness = await mountPolicy({ loopback: 'allow' }, cwd)
    runtimeOf(harness).rulesFor(cwd)
    const remote = remoteOf(harness)
    try {
      const result = remote.allowHost({ host: 'Registry.NPMJS.org.', scheme: 'https', port: 443, cwd })
      expect(result).toMatchObject({ ok: true, outcome: 'allow', created: false })
      const text = readFileSync(projectFile, 'utf8')
      expect(text.startsWith('# workspace rules — keep this header\nrules:\n')).toBe(true)
      expect(text).toContain('  # a pinned deny, with a reason that must survive verbatim\n')
      expect(text).toContain('  - match: { network: { domains: [ evil.example ] } }\n    action: deny\n    reason: "known bad"\n')
      // The host was normalized before it reached the document.
      expect(parseRulesDocument(text).rules[0]?.match.network?.domains).toEqual(['registry.npmjs.org'])
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('writes the session-less host chain file for a block with no cwd, and unblocks a later host-level fetch', async () => {
    const upstream = await origin()
    // A test must never write into the repository: the host process's cwd is the
    // session-less workspace, so it is stubbed onto a temp directory AND the
    // fallback is configured, which is the file the host chain then resolves.
    const hostDir = tempWorkspace('allow-host-cwd')
    const fallbackDir = tempWorkspace('allow-host-fallback')
    const fallbackPath = join(fallbackDir, 'fallback.yaml')
    writeFileSync(fallbackPath, '', 'utf8')
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(hostDir)
    const harness = await mountHarness({
      fallbackPath,
      network: { enabled: true, injectEnv: false, mode: 'whitelist', unlisted: 'ask', loopback: 'policy' },
    }, {})
    const runtime = runtimeOf(harness)
    const port = runtime.networkSnapshot().proxyPort
    const target = `http://${HOST}:${upstream.port}/catalog.json`
    try {
      // No tool call has run: byCwd is empty, so the host chain judges this — the
      // exact state the issue's boot-time fetch is in.
      expect((await proxyGet(port, target)).status).toBe(403)
      const result = remoteOf(harness).allowHost({ host: HOST, scheme: 'http', port: upstream.port, cwd: null })
      expect(result).toMatchObject({ ok: true, outcome: 'allow', created: false, alreadyAllowed: false, error: null })
      expect(result.path).toBe(fallbackPath)
      // The cached session-less chain was dropped and re-read: +1 over the (zero) workspace chains.
      expect(result.reloaded).toBe(1)
      expect(existsSync(join(hostDir, '.dsh', 'rules.yaml'))).toBe(false)
      expect(readFileSync(fallbackPath, 'utf8')).toContain(allowHostReason(HOST))
      // No /rules reload, no restart: the next session-less fetch is allowed.
      expect((await proxyGet(port, target)).status).toBe(200)

      // The settings-page Reload action reaches the host chain too: drop the rule
      // behind the plugin's back and the connection is blocked again.
      writeFileSync(fallbackPath, '', 'utf8')
      expect((await proxyGet(port, target)).status).toBe(200)
      expect(remoteOf(harness).reload()).toEqual({ ok: true, error: null })
      expect((await proxyGet(port, target)).status).toBe(403)
    } finally {
      cwdSpy.mockRestore()
      await upstream.close()
      removeWorkspace(hostDir)
      removeWorkspace(fallbackDir)
    }
  })

  it('refuses an unparseable file and a non-list "rules" without changing a byte', async () => {
    const cwd = tempWorkspace()
    const projectFile = join(cwd, '.dsh', 'rules.yaml')
    // `ignore-with-warning` keeps the workspace loaded (and its file a known
    // source) while the document itself stays broken — exactly the state in
    // which a "helpful" action would overwrite the user's file. `badFilePolicy`
    // is a top-level key, not a network one.
    const harness = await mountHarness({ badFilePolicy: 'ignore-with-warning', network: { enabled: true, injectEnv: false, mode: 'whitelist', unlisted: 'ask' } }, { cwd })
    const remote = remoteOf(harness)
    try {
      for (const broken of ['rules: [not a list\n', 'rules:\n  domains: [a.example]\n']) {
        writeRules(cwd, broken)
        runtimeOf(harness).rulesFor(cwd)
        const result = remote.allowHost({ host: 'blocked.example', scheme: 'http', port: 80, cwd })
        expect(result.ok).toBe(false)
        expect(result.error).toMatch(/cannot edit the rule file/)
        expect(result.outcome).toBeNull()
        expect(readFileSync(projectFile, 'utf8')).toBe(broken)
      }
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('never writes the built-in baseline', async () => {
    const dir = tempWorkspace('allow-host-builtin')
    const builtinPath = join(dir, 'builtin-high-risk.yaml')
    const baseline = 'rules:\n  - match: { network: { domains: [metadata.example] } }\n    action: deny\n    reason: shipped baseline\n'
    writeFileSync(builtinPath, baseline, 'utf8')
    // An absolute rulesFile that IS the baseline: both the workspace path and the
    // host path resolve onto it, and both must be refused.
    const harness = await mountHarness({
      rulesFile: builtinPath,
      builtin: { enabled: true, path: builtinPath },
      network: { enabled: true, injectEnv: false, mode: 'whitelist', unlisted: 'ask' },
    }, {})
    const remote = remoteOf(harness)
    try {
      for (const cwd of [null, harness.cwd]) {
        // The workspace path needs the workspace loaded; the target is its project
        // file, which the absolute `rulesFile` points at the baseline.
        if (cwd !== null) runtimeOf(harness).rulesFor(cwd)
        const result = remote.allowHost({ host: 'blocked.example', scheme: 'http', port: 80, cwd })
        expect(result.ok).toBe(false)
        expect(result.error).toMatch(/built-in ruleset is read-only/)
      }
      expect(readFileSync(builtinPath, 'utf8')).toBe(baseline)
    } finally {
      removeWorkspace(dir)
    }
  })

  it('refuses a host that is not exactly one host name or IP literal', async () => {
    const cwd = tempWorkspace()
    const projectFile = join(cwd, '.dsh', 'rules.yaml')
    const original = denyRule('blocked.example', 'policy')
    writeRules(cwd, original)
    const harness = await mountPolicy({}, cwd)
    const remote = remoteOf(harness)
    runtimeOf(harness).rulesFor(cwd)
    try {
      const attempts = [
        '',
        'blocked.example\nrules:\n  - match: {}\n    action: allow\n    reason: injected\n',
        '*.example.com',
        'http://blocked.example',
        'blocked.example:443',
        'blocked example',
      ]
      for (const host of attempts) {
        const result = remote.allowHost({ host, scheme: 'http', port: 80, cwd })
        expect(result.ok, JSON.stringify(host)).toBe(false)
        expect(result.error).toMatch(/not a host name or IP literal/)
      }
      // No injection reached the document.
      expect(readFileSync(projectFile, 'utf8')).toBe(original)
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('refuses an unknown workspace and reports the switch in the snapshot', async () => {
    const cwd = tempWorkspace()
    const projectFile = join(cwd, '.dsh', 'rules.yaml')
    const original = denyRule('blocked.example', 'policy')
    writeRules(cwd, original)
    const harness = await mountPolicy({}, cwd)
    const remote = remoteOf(harness)
    runtimeOf(harness).rulesFor(cwd)
    try {
      const unknown = remote.allowHost({ host: 'blocked.example', scheme: 'http', port: 80, cwd: join(cwd, 'not-loaded') })
      expect(unknown.ok).toBe(false)
      expect(unknown.error).toMatch(/not a workspace whose rules are loaded/)
      expect(readFileSync(projectFile, 'utf8')).toBe(original)
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('refuses the whole action when network.allowHostAction is false', async () => {
    const cwd = tempWorkspace()
    const projectFile = join(cwd, '.dsh', 'rules.yaml')
    const original = denyRule('blocked.example', 'policy')
    writeRules(cwd, original)
    const harness = await mountPolicy({ allowHostAction: false }, cwd)
    const remote = remoteOf(harness)
    runtimeOf(harness).rulesFor(cwd)
    try {
      expect(remote.networkStatus().allowHostAction).toBe(false)
      const result = remote.allowHost({ host: 'blocked.example', scheme: 'http', port: 80, cwd })
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/disabled by network.allowHostAction/)
      expect(readFileSync(projectFile, 'utf8')).toBe(original)
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('is idempotent: an already-allowed target is never written twice', async () => {
    const upstream = await origin()
    const cwd = tempWorkspace()
    const projectFile = join(cwd, '.dsh', 'rules.yaml')
    writeRules(cwd, denyRule(HOST, 'maintenance window'))
    const harness = await mountPolicy({}, cwd)
    const runtime = runtimeOf(harness)
    const port = runtime.networkSnapshot().proxyPort
    const target = `http://${HOST}:${upstream.port}/catalog.json`
    try {
      await attributeShell(harness)
      expect((await proxyGet(port, target)).status).toBe(403)
      const first = remoteOf(harness).allowHost({ host: HOST, scheme: 'http', port: upstream.port, cwd })
      expect(first).toMatchObject({ ok: true, outcome: 'allow', alreadyAllowed: false })
      const written = readFileSync(projectFile, 'utf8')
      const second = remoteOf(harness).allowHost({ host: HOST, scheme: 'http', port: upstream.port, cwd })
      // The decision is already allow, so the second click resolves no target at
      // all and touches nothing.
      expect(second).toMatchObject({ ok: true, alreadyAllowed: true, outcome: 'allow', path: null, created: false, reloaded: 0, error: null })
      expect(readFileSync(projectFile, 'utf8')).toBe(written)
      expect(allowHostNotice(second)).toMatchObject({ ok: true, key: 'allowHostAlready' })
    } finally {
      await upstream.close()
      removeWorkspace(cwd)
    }
  })

  it('reports the REAL outcome when a nearer chain still blocks, and adds no duplicate rule', async () => {
    const upstream = await origin()
    const nearer = tempWorkspace('allow-host-nearer')
    const target = tempWorkspace('allow-host-target')
    writeRules(nearer, denyRule(HOST, 'nearer chain denies'))
    const targetFile = join(target, '.dsh', 'rules.yaml')
    writeRules(target, denyRule(HOST, 'target chain denies'))
    // `nearer` is loaded first, so it outranks `target` in the proxy's chain order.
    const harness = await mountPolicy({}, nearer)
    const runtime = runtimeOf(harness)
    const port = runtime.networkSnapshot().proxyPort
    const session = harness.ctx.sessions.create(SessionId('allow-host-other'), { meta: { cwd: target } })
    const other = makeAgent(session)
    try {
      await attributeShell(harness)
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: { command: 'sleep 5' }, agent: other }))
      const url = `http://${HOST}:${upstream.port}/catalog.json`
      expect((await proxyGet(port, url)).status).toBe(403)

      // The page's workspace choices come from the snapshot's sources, one per loaded workspace.
      const snapshot = remoteOf(harness).networkStatus()
      expect(snapshot.sources.length).toBeGreaterThan(1)
      expect(allowHostWorkspaces(snapshot.sources)).toEqual(expect.arrayContaining([nearer, target]))

      const result = remoteOf(harness).allowHost({ host: HOST, scheme: 'http', port: upstream.port, cwd: target })
      expect(result).toMatchObject({ ok: true, outcome: 'deny', alreadyAllowed: false })
      expect(result.path).toBe(targetFile)
      // The write itself succeeded — the honest outcome, and the honest notice.
      const written = readFileSync(targetFile, 'utf8')
      expect(parseRulesDocument(written).rules[0]?.action).toBe('allow')
      expect(allowHostNotice(result)).toMatchObject({ ok: false, key: 'allowHostStillBlocked', vars: { outcome: 'deny' } })
      expect((await proxyGet(port, url)).status).toBe(403)

      // Clicking again writes nothing: the file already leads with this exact rule.
      const again = remoteOf(harness).allowHost({ host: HOST, scheme: 'http', port: upstream.port, cwd: target })
      expect(again).toMatchObject({ ok: true, alreadyAllowed: true, outcome: 'deny' })
      expect(readFileSync(targetFile, 'utf8')).toBe(written)
      expect(allowHostNotice(again)).toMatchObject({ ok: false, key: 'allowHostStillBlocked' })
    } finally {
      await upstream.close()
      removeWorkspace(nearer)
      removeWorkspace(target)
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
