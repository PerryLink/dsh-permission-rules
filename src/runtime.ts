/**
 * Runtime of `dsh-permission-rules`: per-workspace rule loading (project
 * file chain by session cwd → fallback path → empty set), the
 * `tools/pre-execute` listener that turns a first-match hit into a
 * deny/ask decision (and NEVER short-circuits on allow or passthrough),
 * the `permissionRules/decision` audit event, the `/rules` session command
 * (`list | reload | decisions [n] | test [flags] <tool> <json>`), and
 * Chokidar-driven reloads (effective rule files plus candidate watches on
 * expected-but-absent files, so mid-session creation is adopted). Every
 * registration is an effect.
 * @module dsh-permission-rules/runtime
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import chokidar from 'chokidar'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { resolveConfig } from './config.ts'
import type { Config, ResolvedConfig } from './config.ts'
import { compileRules, compileRulesChain, describeRule, findUnreachableRules, isShellTool, matchRules, normalizeWorkspacePath, parseRulesDocument, PLATFORMS, RuleError } from './rules.ts'
import type { CompileOptions, CompiledRuleset, MatchContext, NetworkTarget, RuleHit } from './rules.ts'
import { DESCRIBE_TOKENS, UI_PROSE } from './prose.ts'
import type { UiProse } from './prose.ts'
import { blockMessage, decideNetworkTarget, defaultDecision, networkModeForSandbox } from './network.ts'
import type { NetworkChain, NetworkDecision, NetworkMode } from './network.ts'
import { injectProxyEnv, NetworkProxy } from './proxy.ts'
import type { NetworkBlockRecord, ProxyAttribution } from './proxy.ts'
import { PermissionRulesRemoteService } from './remote-service.ts'
import { attachSettingsSection } from './settings.ts'
import { isMarkedAuditEvent } from './events.ts'
import type { AuditAppend, AuditDecision, AuditNetworkBlock, DecisionOutcome } from './events.ts'

export const name = 'permission-rules'

/** Services required before the plugin mounts. */
export const inject = ['commands', 'tools']

/** The rule state bound to one workspace cwd. */
interface LoadedRules {
  /** The workspace root these rules were resolved for. */
  readonly cwd: string
  /** Absolute paths of the rule files in effect, nearest first; `[]` = empty rule set. */
  readonly sources: readonly string[]
  readonly compiled: CompiledRuleset
  /** Last load error, when one is being reported (see {@link PermissionRulesRuntime.rulesFor}). */
  readonly lastError?: string
  /** `true` when the last initial load threw under `badFilePolicy: 'fail'`. */
  readonly failed?: true
}

/** One live watcher: rule-file watchers key by the file path; candidate watchers key by an ancestor directory and map each cwd to the absent file they are waiting for. */
interface WatcherEntry {
  readonly cwds: Set<string>
  readonly close: () => void
  readonly candidates?: Map<string, string>
}

/** One in-flight shell execution, for proxy-block attribution (newest first). */
interface InFlightShell {
  readonly tool: string
  readonly callId: unknown
  readonly startedAt: number
  readonly agent?: ToolExecution['agent']
}

/** The network-capable tools whose unlisted calls fall back to the mode default at `tools/pre-execute`. */
const WEB_TOOLS: readonly string[] = ['web_fetch', 'web_search']

/** Stale in-flight entries are dropped after this many milliseconds (attribution is best-effort). */
const IN_FLIGHT_TTL_MS = 10 * 60 * 1000

/**
 * State and behavior. One instance per plugin mount; disposals are owned by
 * the watcher/timer/proxy effects registered in {@link apply}.
 */
export class PermissionRulesRuntime {
  /** Loaded (or failed) rules per workspace cwd, least-recently-used first for eviction. */
  private readonly byCwd = new Map<string, LoadedRules>()

  /** Live watchers per watched path (rule file or candidate ancestor directory), with the cwds each serves. */
  private readonly watchers = new Map<string, WatcherEntry>()

  /** Debounce timers per rule-file path. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  /** Whether the host honors the audit envelope's `ignorable` marker: unknown until the first decision (or peer-version check). */
  private auditSupport: 'unknown' | 'supported' | 'unsupported' = 'unknown'

  /** In-flight bash/pwsh executions (insertion order = start order), for proxy-block attribution. */
  private readonly inFlight = new Map<string, InFlightShell>()

  /** The network proxy, when the policy is enabled and mounted. */
  private networkProxy: NetworkProxy | undefined

  /** Restores the injected proxy environment (set after a successful bind). */
  private envRestore: (() => void) | undefined

  /** The authoritative config source: the composition entry, replaced by the settings scope while attached. */
  private configSource: () => ResolvedConfig

  constructor(
    private readonly ctx: Context,
    config: ResolvedConfig,
  ) {
    this.configSource = () => config
  }

  /** The currently authoritative config (settings scope or composition entry). */
  get config(): ResolvedConfig {
    return this.configSource()
  }

  /** Rebind the config source (the settings section hooks call this on attach/detach/change). */
  setConfigSource(source: () => ResolvedConfig): void {
    this.configSource = source
  }

  /** The shared compile options derived from config. */
  private compileOptions(): CompileOptions {
    const config = this.configSource()
    return {
      patternMode: config.patternMode,
      maxRules: config.maxRules,
      maxGlobStars: config.maxGlobStars,
      caseInsensitivePaths: config.caseInsensitivePaths,
    }
  }

  /**
   * Resolve which files serve a workspace, nearest first: the project file
   * under the session cwd (or an absolute `rulesFile`), with `searchUp`
   * also merging every parent directory's file on the way to the root,
   * else the configured fallback, else `[]` (empty rule set). Nearer files
   * evaluate first, so a child can override a parent rule.
   * @param cwd - the session's absolute workspace root.
   * @returns the absolute rule-file paths in effect, nearest first.
   */
  resolveSources(cwd: string): string[] {
    if (this.config.searchUp) {
      const sources: string[] = []
      let dir = cwd
      for (;;) {
        const candidate = join(dir, this.config.rulesFile)
        if (existsSync(candidate)) sources.push(candidate)
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
      }
      return sources.length === 0 ? this.resolveFallback() : sources
    }
    const projectPath = isAbsolute(this.config.rulesFile) ? this.config.rulesFile : join(cwd, this.config.rulesFile)
    if (existsSync(projectPath)) return [projectPath]
    return this.resolveFallback()
  }

  /** The configured fallback file when it exists, else `[]`. */
  private resolveFallback(): string[] {
    const fallback = this.config.fallbackPath
    if (fallback !== undefined) {
      const fallbackPath = isAbsolute(fallback) ? fallback : resolve(fallback)
      if (existsSync(fallbackPath)) return [fallbackPath]
    }
    return []
  }

  /**
   * Read, parse, and compile the rule-file chain serving `cwd`. Under
   * `badFilePolicy: 'ignore-with-warning'` a bad file degrades to an empty
   * rule set with a warning and keeps its source paths (so a later fix is
   * watched and adopted); under `'fail'` it throws.
   * @param cwd - the workspace root.
   * @returns the loaded state.
   */
  load(cwd: string): LoadedRules {
    const sources = this.resolveSources(cwd)
    if (sources.length === 0) return { cwd, sources: [], compiled: { rules: [], caseInsensitivePaths: this.config.caseInsensitivePaths } }
    try {
      const entries = sources.map(path => ({ path, text: readFileSync(path, 'utf8') }))
      const { ruleset } = compileRulesChain(entries, this.compileOptions())
      return { cwd, sources, compiled: ruleset }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (this.config.badFilePolicy === 'ignore-with-warning') {
        this.ctx.logger.warn(`permission-rules: ignoring ${sources.join(', ')}: ${message} (empty rule set)`)
        return { cwd, sources, compiled: { rules: [], caseInsensitivePaths: this.config.caseInsensitivePaths }, lastError: message }
      }
      throw error instanceof RuleError ? error : new RuleError(`cannot load ${sources.join(', ')}: ${message}`)
    }
  }

  /**
   * Canonical per-workspace cache key: the resolved root, case-folded on
   * Windows so differently-spelled paths to the same workspace share one
   * cache entry and one watcher set instead of doubling both.
   * @param cwd - the session's absolute workspace root.
   * @returns the canonical key.
   */
  private cacheKey(cwd: string): string {
    const resolved = resolve(cwd)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }

  /**
   * The rules in effect for one cwd, loading on first use. Under
   * `badFilePolicy: 'fail'` a bad initial load throws on EVERY use (the
   * pending tool call errors loudly) while the watcher keeps observing the
   * files so a fix reloads into active rules. Cache hits refresh the
   * least-recently-used position, so eviction drops the workspace that
   * went longest without a decision.
   * @param cwd - the workspace root.
   * @returns the loaded rules.
   */
  rulesFor(cwd: string): LoadedRules {
    const key = this.cacheKey(cwd)
    const existing = this.byCwd.get(key)
    if (existing !== undefined) {
      if (existing.failed === true) {
        throw new RuleError(existing.lastError ?? `rule load failed for ${cwd}`)
      }
      this.byCwd.delete(key)
      this.byCwd.set(key, existing)
      return existing
    }
    this.evictIfFull(key)
    try {
      const loaded = this.load(cwd)
      this.byCwd.set(key, loaded)
      this.reconcileWatch(key, loaded.sources)
      return loaded
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const sources = this.resolveSources(cwd)
      this.byCwd.set(key, { cwd, sources, compiled: { rules: [], caseInsensitivePaths: this.config.caseInsensitivePaths }, lastError: message, failed: true })
      this.reconcileWatch(key, sources)
      throw error
    }
  }

  /**
   * Re-read the rule-file chain for one cwd (watch-driven or
   * `/rules reload`). A bad file NEVER crashes the process: the previous
   * rules stay active, the error is logged and reported on the next
   * `/rules` output.
   * @param cwd - the workspace root.
   */
  reload(cwd: string): void {
    const key = this.cacheKey(cwd)
    const previous = this.byCwd.get(key)
    try {
      const loaded = this.load(cwd)
      this.byCwd.set(key, loaded)
      this.reconcileWatch(key, loaded.sources)
      this.ctx.logger.info(`permission-rules: reloaded ${loaded.compiled.rules.length} rule(s) from ${loaded.sources.join(', ') || '(empty rule set)'} for ${cwd}`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn(`permission-rules: reload failed for ${cwd}: ${message} (keeping previous rules)`)
      if (previous !== undefined) this.byCwd.set(key, { ...previous, lastError: message })
      else {
        const sources = this.resolveSources(cwd)
        this.byCwd.set(key, { cwd, sources, compiled: { rules: [], caseInsensitivePaths: this.config.caseInsensitivePaths }, lastError: message, failed: true })
        this.reconcileWatch(key, sources)
      }
    }
  }

  /**
   * The match context `when`/`agents` conditions evaluate against: host
   * facts plus the caller's agent-identity candidates derived from the
   * session header (`main` for top-level sessions, `subagent` for
   * subagent children, `preset:<name>` when a preset composed the agent).
   * @param exec - the pending call whose caller supplies the identity.
   */
  private matchContext(exec?: ToolExecution): MatchContext {
    return { platform: process.platform, env: process.env, agents: agentCandidates(exec?.agent) }
  }

  /**
   * The `tools/pre-execute` listener. A deny/ask hit returns the decision
   * (first match wins, short-circuiting downstream listeners); an allow hit
   * and a passthrough MUST delegate via `next()` so later listeners keep
   * their say. Network-scoped rule hits on tool calls carry the structured
   * `[network: …]` marker; when NO rule matches a web tool
   * (`web_fetch`/`web_search`) the network mode default applies (deny-all
   * denies, whitelist asks/denies, allow-all passes) — shell tools are
   * NOT gated here, the proxy enforces their traffic per connection.
   * Under `enforce: false` (dry-run) a deny/ask hit also delegates — the
   * record keeps the would-be action with `dryRun: true` and the actual
   * downstream outcome. Audit is appended once the final outcome is
   * known, so the recorded `outcome` matches what the waterfall settled
   * on.
   * @param exec - the pending call (name, parsed arguments, caller agent).
   * @param next - the downstream chain.
   * @returns the pre-execute decision.
   */
  async preExecute(exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> {
    const cwd = exec.agent?.session.header.cwd ?? process.cwd()
    const loaded = this.rulesFor(cwd)
    const hit = matchRules(loaded.compiled, exec.name, exec.arguments, cwd, this.matchContext(exec))
    if (hit !== undefined && hit.rule.action !== 'allow') {
      const structured = hit.rule.network !== undefined
      const reason = structured ? `${hit.rule.action === 'deny' ? '[network: denied]' : '[network: approval required]'} ${hit.rule.reason}` : hit.rule.reason
      if (!this.config.enforce) {
        // Dry-run: match the rule, log what it WOULD do, and delegate.
        const decision = await next()
        this.audit(exec, loaded, hit, decision.kind, true)
        return decision
      }
      const outcome: DecisionOutcome = hit.rule.action
      this.audit(exec, loaded, hit, outcome)
      return { kind: outcome, reason }
    }
    if (hit === undefined) {
      const fallback = this.webToolFallback(exec)
      if (fallback !== undefined) {
        if (!this.config.enforce) {
          const decision = await next()
          this.audit(exec, loaded, undefined, decision.kind, true, fallback)
          return decision
        }
        this.audit(exec, loaded, undefined, fallback, false, fallback)
        return { kind: fallback, reason: blockMessage(defaultDecision(this.resolveNetworkMode(exec.agent?.session).mode, this.config.network.unlisted)) }
      }
    }
    if (isShellTool(exec.name)) this.markShell(exec)
    const decision = await next()
    this.audit(exec, loaded, hit, decision.kind)
    return decision
  }

  /**
   * The mode-default decision for an unlisted web-tool call, or undefined
   * when the policy is disabled, the tool is not a web tool, or the mode
   * allows. Shell tools always yield undefined here (the proxy decides
   * their traffic per connection).
   */
  private webToolFallback(exec: ToolExecution): 'deny' | 'ask' | undefined {
    const network = this.config.network
    if (!network.enabled || isShellTool(exec.name) || !WEB_TOOLS.includes(exec.name)) return undefined
    const { mode } = this.resolveNetworkMode(exec.agent?.session)
    const fallback = defaultDecision(mode, network.unlisted)
    return fallback.action === 'allow' ? undefined : fallback.action
  }

  /**
   * Append the log-only `permissionRules/decision` audit event for every
   * decision (passthrough included unless `audit: 'hits'`), requesting the
   * envelope's `ignorable: true` marker so any harness build can load the
   * log. Hosts whose `Session.append` predates the marker (the rc.6 line)
   * silently drop it, leaving sessions unresumable on stricter hosts — the
   * runtime therefore detects such hosts BEFORE the first append (peer
   * version) and re-checks after the first append (returned envelope), then
   * degrades: session-log audit is disabled with a one-time warning unless
   * `allowUnmarkedAudit: true` opts back in. `source` names the matched
   * rule's file, or the nearest effective file on a passthrough; `cwd`
   * names the workspace the rules were resolved for; `dryRun` marks
   * would-be deny/ask hits under `enforce: false`; `modeDefault` records a
   * network mode-default decision on a web tool (no rule fired).
   * Agentless calls have no session to audit; append failures are
   * contained so an audit hiccup can never change a permission decision.
   * @param exec - the pending call.
   * @param loaded - the rules in effect.
   * @param hit - the first matching rule, or undefined for passthrough.
   * @param outcome - the final pre-execute decision.
   * @param dryRun - mark the record as a would-be decision (dry-run mode).
   * @param modeDefault - the network mode-default action when no rule fired.
   */
  audit(exec: ToolExecution, loaded: LoadedRules, hit: RuleHit | undefined, outcome: DecisionOutcome, dryRun = false, modeDefault?: 'deny' | 'ask'): void {
    if (this.config.audit === 'hits' && hit === undefined && modeDefault === undefined) return
    const agent = exec.agent
    if (agent === undefined) return
    if (this.auditSupport === 'unsupported') return
    if (this.auditSupport === 'unknown' && !this.config.allowUnmarkedAudit) {
      const version = this.peerVersion()
      if (version !== null && isUnmarkedHostVersion(version)) {
        this.auditSupport = 'unsupported'
        this.warnUnmarkedAuditHost()
        return
      }
    }
    try {
      const action = hit === undefined ? (modeDefault ?? 'passthrough') : hit.rule.action
      const result = this.appendAudit(agent, {
        toolName: exec.name,
        callId: exec.callId,
        source: hit === undefined ? (loaded.sources[0] ?? '') : (loaded.sources[hit.rule.sourceIndex] ?? ''),
        action,
        outcome,
        cwd: loaded.cwd,
        ...hit !== undefined ? { ruleIndex: hit.ruleIndex, reason: hit.rule.reason } : {},
        ...modeDefault !== undefined ? { reason: `${modeDefault === 'deny' ? '[network: denied]' : '[network: approval required]'} network mode default (no rule matched)` } : {},
        ...dryRun ? { dryRun: true as const } : {},
      })
      this.probeAuditResult(result)
    } catch (error: unknown) {
      this.ctx.logger.warn(`permission-rules: audit append failed: ${String(error)}`)
    }
  }

  /** After the first append, probe the returned envelope for the ignorable marker (host capability detection). */
  private probeAuditResult(result: unknown): void {
    if (this.auditSupport === 'unknown' && !this.config.allowUnmarkedAudit) {
      if (isMarkedAuditEvent(result)) {
        this.auditSupport = 'supported'
      } else {
        this.auditSupport = 'unsupported'
        this.warnUnmarkedAuditHost()
      }
    }
  }

  /** Append one audit event through the session surface; the probe seam for host-capability detection. */
  private appendAudit(agent: NonNullable<ToolExecution['agent']>, data: AuditDecision): unknown {
    return (agent.session.append as unknown as AuditAppend)('permissionRules/decision', data, { ignorable: true })
  }

  // --- Network policy ------------------------------------------------------

  /**
   * Resolve the network policy mode. An explicit config mode wins; `auto`
   * maps the official sandbox preset (`read-only` → deny-all,
   * `workspace-write` → whitelist, `danger-full-access` → allow-all) with
   * `network.autoFallback` covering hosts without the sandbox-policy
   * service (rc.6 and friends stay permissive until configured). For web
   * tools the SESSION's resolved mode is used; the proxy resolves without
   * a session (its connections carry no session context).
   * @param session - optional session whose override outranks the default.
   * @returns the resolved mode plus the sandbox preset it came from.
   */
  resolveNetworkMode(session?: { events?: unknown }): { mode: NetworkMode; sandboxMode: string | undefined } {
    const cfg = this.config.network
    if (cfg.mode !== 'auto') return { mode: cfg.mode, sandboxMode: undefined }
    const policy = this.ctx.get('sandboxPolicy') as { defaultMode?: string; resolve?: (request?: { session?: unknown }) => { mode?: string } } | undefined
    if (policy === undefined) return { mode: cfg.autoFallback, sandboxMode: undefined }
    const sandboxMode = session === undefined ? policy.defaultMode : policy.resolve?.({ session })?.mode ?? policy.defaultMode
    return { mode: networkModeForSandbox(sandboxMode, cfg.autoFallback), sandboxMode }
  }

  /**
   * The proxy-layer decision for one connection target: first-match
   * network rules across every loaded workspace chain (insertion order),
   * then the mode default. Shell subprocess traffic counts as `bash`/
   * `pwsh` tool candidates; loopback handling follows config.
   */
  private decideProxyTarget(target: NetworkTarget): NetworkDecision {
    const { mode } = this.resolveNetworkMode()
    return decideNetworkTarget(this.proxyChains(), target, {
      mode,
      unlisted: this.config.network.unlisted,
      loopback: this.config.network.loopback,
    })
  }

  /** The loaded rule chains in cache order, nearest workspace first. */
  private proxyChains(): NetworkChain[] {
    const chains: NetworkChain[] = []
    for (const loaded of this.byCwd.values()) {
      chains.push({ ruleset: loaded.compiled, sources: loaded.sources })
    }
    return chains
  }

  /** Mark one delegated shell execution as in-flight (newest attribution wins). */
  private markShell(exec: ToolExecution): void {
    this.inFlight.set(String(exec.callId), { tool: exec.name, callId: exec.callId, startedAt: Date.now(), agent: exec.agent })
  }

  /** Drop one shell execution when it settles. */
  unmarkShell(exec: ToolExecution): void {
    this.inFlight.delete(String(exec.callId))
  }

  /** The newest in-flight shell execution within the TTL, or undefined (best-effort attribution). */
  private proxyAttribution(): ProxyAttribution | undefined {
    const cutoff = Date.now() - IN_FLIGHT_TTL_MS
    let newest: InFlightShell | undefined
    for (const entry of this.inFlight.values()) {
      if (entry.startedAt < cutoff) {
        this.inFlight.delete(String(entry.callId))
        continue
      }
      if (newest === undefined || entry.startedAt > newest.startedAt) newest = entry
    }
    if (newest === undefined) return undefined
    return {
      tool: newest.tool,
      ...(newest.callId !== undefined ? { callId: newest.callId as CallId } : {}),
      ...(newest.agent !== undefined ? { agent: newest.agent } : {}),
    }
  }

  /**
   * Audit one proxy-layer block: the in-memory record is always kept
   * (settings page), the logger always warns, and when the block can be
   * attributed to an agent the `permissionRules/network` event is appended
   * with the same ignorable-marker discipline as the decision audit.
   */
  private auditNetworkBlock(record: NetworkBlockRecord, attribution: ProxyAttribution | undefined): void {
    const agent = attribution?.agent
    if (agent === undefined || this.auditSupport === 'unsupported') return
    if (this.auditSupport === 'unknown' && !this.config.allowUnmarkedAudit) {
      const version = this.peerVersion()
      if (version !== null && isUnmarkedHostVersion(version)) {
        this.auditSupport = 'unsupported'
        this.warnUnmarkedAuditHost()
        return
      }
    }
    const data: AuditNetworkBlock = {
      kind: 'block',
      tool: record.tool,
      attributed: record.attributed,
      ...(record.callId !== undefined ? { callId: record.callId } : {}),
      domain: record.domain,
      ...(record.scheme !== undefined ? { scheme: record.scheme } : {}),
      ...(record.port !== undefined ? { port: record.port } : {}),
      action: record.action,
      mode: record.mode,
      matched: record.matched,
      source: record.source,
      ...(record.ruleIndex !== undefined ? { ruleIndex: record.ruleIndex } : {}),
      ...(record.reason !== undefined ? { reason: record.reason } : {}),
      time: record.time,
    }
    try {
      const result = (agent.session.append as unknown as (type: 'permissionRules/network', data: AuditNetworkBlock, options?: { ignorable?: true }) => unknown)('permissionRules/network', data, { ignorable: true })
      this.probeAuditResult(result)
    } catch (error: unknown) {
      this.ctx.logger.warn(`permission-rules: network audit append failed: ${String(error)}`)
    }
  }

  /**
   * Mount the network proxy and the subprocess environment injection.
   * Called from {@link apply}; the proxy binds an ephemeral (or
   * configured) loopback port, the env injection only happens after a
   * successful bind, and every side effect is owned by an effect
   * disposer. A bind failure degrades loudly (file rules stay active,
   * the settings page and `/rules network` show the inactive proxy)
   * instead of taking the permission plugin down.
   */
  async attachNetworkProxy(): Promise<void> {
    const cfg = this.config.network
    const proxy = new NetworkProxy({
      bind: cfg.proxyBind,
      port: cfg.proxyPort,
      maxRecent: cfg.proxyMaxRecent,
      decide: target => this.decideProxyTarget(target),
      attribution: () => this.proxyAttribution(),
      onBlock: (record, attribution) => this.auditNetworkBlock(record, attribution),
      logger: this.ctx.logger,
    })
    this.networkProxy = proxy
    this.ctx.effect(() => () => {
      void proxy.close()
      this.networkProxy = undefined
    })
    try {
      const port = await proxy.start()
      if (cfg.injectEnv) {
        this.envRestore = injectProxyEnv(port, cfg.noProxy)
        this.ctx.effect(() => {
          const restore = this.envRestore
          this.envRestore = undefined
          return () => restore?.()
        })
      }
      const { mode, sandboxMode } = this.resolveNetworkMode()
      this.ctx.logger.info(`permission-rules: network proxy listening on ${cfg.proxyBind}:${port} (mode ${mode}${sandboxMode !== undefined ? `, sandbox ${sandboxMode}` : ''})`)
    } catch (error: unknown) {
      this.ctx.logger.warn(`permission-rules: network proxy failed to bind on ${cfg.proxyBind}:${cfg.proxyPort} (${String(error)}) — shell network policy is INACTIVE; file/command rules stay active`)
    }
  }

  /**
   * Apply a live settings change to the network policy: rebind the proxy
   * when a bind/env-relevant knob changed (old proxy closed, old env
   * restored, new proxy + env installed). Web-tool gating and the decision
   * path read the config per call, so they need no rebind.
   */
  async onNetworkConfigChanged(): Promise<void> {
    if (!this.config.network.enabled) return
    await this.networkProxy?.close()
    this.envRestore?.()
    this.envRestore = undefined
    await this.attachNetworkProxy()
  }

  /** The network snapshot the settings page and `/rules network` render. */
  networkSnapshot(): {
    readonly enabled: boolean
    readonly mode: NetworkMode
    readonly configuredMode: 'auto' | NetworkMode
    readonly sandboxMode: string | undefined
    readonly proxyPort: number
    readonly proxyActive: boolean
    readonly denied: number
    readonly askBlocked: number
    readonly recent: readonly NetworkBlockRecord[]
  } {
    const cfg = this.config.network
    const { mode, sandboxMode } = this.resolveNetworkMode()
    const proxy = this.networkProxy
    const stats = proxy?.blockStats() ?? { denied: 0, askBlocked: 0 }
    return {
      enabled: cfg.enabled,
      mode,
      configuredMode: cfg.mode,
      sandboxMode,
      proxyPort: proxy?.port ?? 0,
      proxyActive: proxy !== undefined && proxy.port > 0,
      denied: stats.denied,
      askBlocked: stats.askBlocked,
      recent: proxy?.recentBlocks() ?? [],
    }
  }

  /**
   * The rule-file paths the settings-page editor may read or write: every
   * currently loaded source plus the per-workspace project files and the
   * configured fallback (so a not-yet-existing project file can be
   * created). The editor never touches arbitrary paths.
   */
  knownRuleSources(): readonly string[] {
    const cfg = this.config
    const set = new Set<string>()
    for (const loaded of this.byCwd.values()) {
      for (const source of loaded.sources) set.add(source)
      if (!isAbsolute(cfg.rulesFile)) set.add(join(loaded.cwd, cfg.rulesFile))
    }
    if (cfg.fallbackPath !== undefined) set.add(isAbsolute(cfg.fallbackPath) ? cfg.fallbackPath : resolve(cfg.fallbackPath))
    if (isAbsolute(cfg.rulesFile)) set.add(cfg.rulesFile)
    return [...set]
  }

  /** Read one known rule file for the editor: `{ exists, text, error }`. */
  readRuleFile(path: string): { path: string; exists: boolean; text: string; error?: string } {
    if (!this.knownRuleSources().includes(path)) {
      return { path, exists: false, text: '', error: `refusing to read ${path}: not a known rule source` }
    }
    if (!existsSync(path)) return { path, exists: false, text: '' }
    try {
      return { path, exists: true, text: readFileSync(path, 'utf8') }
    } catch (error: unknown) {
      return { path, exists: true, text: '', error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** The workspace a rule source belongs to (for the editor's file list), or undefined for the fallback. */
  sourceOwner(path: string): string | undefined {
    for (const loaded of this.byCwd.values()) {
      if (loaded.sources.includes(path) || (!isAbsolute(this.config.rulesFile) && join(loaded.cwd, this.config.rulesFile) === path)) return loaded.cwd
    }
    return undefined
  }

  /** Re-read every cached workspace chain (the settings-page reload action). */
  reloadAll(): void {
    for (const cwd of [...this.byCwd.keys()]) this.reload(cwd)
  }

  /**
   * Validate and write one known rule file. The document must parse and
   * compile (same checks as a load) BEFORE anything is written — an
   * invalid edit is rejected with its error and the file stays untouched.
   * After a successful write every cached workspace reloads so the edit
   * is in effect immediately.
   */
  saveRuleFile(path: string, text: string): { ok: boolean; error?: string; reloaded?: number } {
    if (!this.knownRuleSources().includes(path)) {
      return { ok: false, error: `refusing to write ${path}: not a known rule source` }
    }
    try {
      const doc = parseRulesDocument(text)
      compileRules(doc, this.compileOptions())
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
    try {
      // A not-yet-existing project file lives in a possibly missing parent
      // directory (a fresh workspace has no `.dsh/`); create it so the first
      // save from the settings editor succeeds.
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, text, 'utf8')
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    let reloaded = 0
    for (const cwd of [...this.byCwd.keys()]) {
      this.reload(cwd)
      reloaded += 1
    }
    return { ok: true, reloaded }
  }

  /** The installed `@deepseek-ai/dsh-session` version, or `null` when unresolvable (falls back to the append probe). */
  private peerVersion(): string | null {
    try {
      const pkg = createRequire(import.meta.url)('@deepseek-ai/dsh-session/package.json') as { version?: unknown }
      return typeof pkg.version === 'string' ? pkg.version : null
    } catch {
      return null
    }
  }

  /** One-time warning that session-log audit was disabled to keep session logs loadable. */
  private warnUnmarkedAuditHost(): void {
    this.ctx.logger.warn(
      'permission-rules: this host drops the ignorable marker on audit events (Session.append predates it), which would make sessions unresumable on stricter harness builds — session-log audit is disabled; set allowUnmarkedAudit: true to opt back in, and repair existing logs with scripts/repair-session-logs.mjs (see https://github.com/PerryLink/dsh-permission-rules/issues/2)',
    )
  }

  /**
   * Execute the `/rules` command: bare `/rules` lists the active rules and
   * their sources; `/rules reload` re-reads the chain; `/rules decisions
   * [n]` shows the session's audit trail; `/rules test [flags] <tool>
   * <json>` dry-evaluates the rules against a hypothetical call (flags
   * override the workspace, host env, and agent identity). Command output
   * stays in the UI — nothing here is injected into the model context.
   * @param invocation - the received command invocation.
   * @returns the command result shown to the user.
   */
  command(invocation: CommandInvocation): CommandResult {
    const prose = UI_PROSE[this.config.language]
    const raw = invocation.rawInput.trim()
    const [verbRaw, ...rest] = raw.split(/\s+/)
    const verb = (verbRaw ?? '').toLowerCase()
    const cwd = invocation.agent.session.header.cwd ?? process.cwd()
    if (verb === 'reload') {
      if (rest.length > 0) return { kind: 'error', text: prose.unknownArg(invocation.rawInput.trim()) }
      this.reload(cwd)
      const reloaded = this.byCwd.get(this.cacheKey(cwd))
      if (reloaded?.lastError !== undefined) return { kind: 'error', text: prose.reloadFailed(reloaded.lastError) }
      const rules = reloaded?.compiled.rules ?? []
      const source = reloaded === undefined || reloaded.sources.length === 0 ? prose.emptySource : reloaded.sources.join(', ')
      return { kind: 'success', text: prose.reloaded(rules.length, source) }
    }
    if (verb === 'list' && rest.length > 0) return { kind: 'error', text: prose.unknownArg(invocation.rawInput.trim()) }
    if (verb === 'network') {
      if (rest.length > 0) return { kind: 'error', text: prose.unknownArg(invocation.rawInput.trim()) }
      return this.networkCommand(prose)
    }
    if (verb === 'decisions') {
      if (rest.length > 1) return { kind: 'error', text: prose.unknownArg(invocation.rawInput.trim()) }
      let count = 10
      if (rest.length === 1) {
        const parsed = Number(rest[0])
        if (!Number.isSafeInteger(parsed) || parsed <= 0) return { kind: 'error', text: prose.invalidDecisionsCount(rest[0] as string) }
        count = parsed
      }
      return this.decisionsCommand(invocation, count, prose)
    }
    if (verb === 'test') {
      return this.testCommand(raw, verbRaw ?? '', invocation, cwd, prose)
    }
    if (verb !== '' && verb !== 'list') return { kind: 'error', text: prose.unknownArg(invocation.rawInput.trim()) }
    let loaded: LoadedRules
    try {
      loaded = this.rulesFor(cwd)
    } catch (error: unknown) {
      return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
    }
    const lines: string[] = []
    if (loaded.sources.length === 0) {
      lines.push(prose.noRules(cwd, this.config.fallbackPath !== undefined ? prose.fallbackMissing : ''))
    } else {
      lines.push(prose.rulesHeader(loaded.compiled.rules.length, loaded.sources, cwd))
      const multiSource = loaded.sources.length > 1
      lines.push(...loaded.compiled.rules.map(rule => describeRule(rule, DESCRIBE_TOKENS[this.config.language], multiSource ? this.displaySource(loaded.sources[rule.sourceIndex] ?? '', cwd) : undefined)))
      const unreachable = findUnreachableRules(loaded.compiled)
      if (unreachable.length > 0) lines.push(prose.unreachableWarning(unreachable.map(index => index + 1)))
    }
    if (loaded.lastError !== undefined) {
      lines.push(prose.lastReloadWarning(loaded.lastError))
    }
    if (!this.config.enforce) {
      lines.push(prose.dryRunNotice)
    }
    lines.push(prose.usage)
    return { kind: 'success', text: lines.join('\n') }
  }

  /**
   * Execute `/rules test` with optional leading flags: `--cwd <dir>`
   * evaluates against that workspace (rule discovery AND path
   * normalization), `--env KEY=VALUE` (repeatable) overrides host env for
   * `when.env` matching, `--agent <selector>` (repeatable) supplies
   * agent-identity candidates for the `agents` dimension, and
   * `--platform <name>` overrides the host platform for `when.platform`.
   * The JSON argument tail is kept verbatim, so quoted JSON survives
   * unchanged.
   * @param raw - the full raw command input.
   * @param verbRaw - the verb as typed.
   * @param invocation - the received command invocation (session agent).
   * @param sessionCwd - the session's workspace root.
   * @param prose - localized output vocabulary.
   * @returns the dry-evaluation result.
   */
  private testCommand(raw: string, verbRaw: string, invocation: CommandInvocation, sessionCwd: string, prose: UiProse): CommandResult {
    let rest = raw.length > verbRaw.length ? raw.slice(verbRaw.length).trim() : ''
    const envOverrides: Record<string, string> = {}
    const agentSelectors: string[] = []
    let testCwd: string | undefined
    let testPlatform: string | undefined
    let parsed = nextToken(rest)
    while (parsed !== undefined && parsed.token.startsWith('--')) {
      const flag = parsed.token
      const value = nextToken(parsed.rest)
      if (value === undefined || value.token.startsWith('--')) {
        return { kind: 'error', text: prose.testBadFlag(flag) }
      }
      if (flag === '--cwd') {
        testCwd = isAbsolute(value.token) ? value.token : resolve(sessionCwd, value.token)
      } else if (flag === '--env') {
        const equals = value.token.indexOf('=')
        if (equals <= 0) return { kind: 'error', text: prose.testBadFlag(`${flag} ${value.token}`) }
        envOverrides[value.token.slice(0, equals)] = value.token.slice(equals + 1)
      } else if (flag === '--agent') {
        agentSelectors.push(value.token)
      } else if (flag === '--platform') {
        if (!PLATFORMS.includes(value.token)) return { kind: 'error', text: prose.testBadPlatform(value.token) }
        testPlatform = value.token
      } else {
        return { kind: 'error', text: prose.testUnknownFlag(flag) }
      }
      rest = value.rest
      parsed = nextToken(rest)
    }
    const tool = parsed?.token
    const jsonText = parsed === undefined ? '' : parsed.rest.trim()
    if (tool === undefined || tool.length === 0) return { kind: 'error', text: prose.testUsage }
    let args: unknown
    try {
      args = jsonText.length > 0 ? JSON.parse(jsonText) : {}
    } catch {
      return { kind: 'error', text: prose.testBadJson(jsonText) }
    }
    const evalCwd = testCwd ?? sessionCwd
    let loaded: LoadedRules
    try {
      loaded = this.rulesFor(evalCwd)
    } catch (error: unknown) {
      return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
    }
    const context: MatchContext = {
      platform: testPlatform ?? process.platform,
      env: Object.keys(envOverrides).length === 0 ? process.env : { ...process.env, ...envOverrides },
      agents: agentSelectors.length > 0 ? agentSelectors : agentCandidates(invocation.agent),
    }
    const hit = matchRules(loaded.compiled, tool, args, evalCwd, context)
    return {
      kind: 'success',
      text: hit === undefined ? prose.testNoMatch(tool) : prose.testHit(tool, hit.ruleIndex, hit.rule.action, hit.rule.reason),
    }
  }

  /** Render one rule-file source for per-rule attribution: workspace-relative when inside the cwd, raw otherwise. */
  private displaySource(source: string, cwd: string): string {
    if (source.length === 0) return ''
    const relative = normalizeWorkspacePath(cwd, source, this.config.caseInsensitivePaths)
    return relative.length > 0 ? relative : source
  }

  /** Render the session's `permissionRules/decision` audit trail, newest last. */
  private decisionsCommand(invocation: CommandInvocation, count: number, prose: UiProse): CommandResult {
    const decisions = invocation.agent.session.events.filter(event => event.type === 'permissionRules/decision')
    const lines: string[] = []
    if (decisions.length === 0) {
      lines.push(prose.noDecisions)
    } else {
      const shown = decisions.slice(-count)
      lines.push(prose.decisionsHeader(shown.length, decisions.length))
      for (const event of shown) {
        const data = event.data as AuditDecision
        lines.push(prose.decisionLine(event.seq, data.action, data.toolName, data.ruleIndex, data.reason, data.dryRun === true, data.outcome))
      }
    }
    if (this.auditSupport === 'unsupported') lines.push(prose.auditDisabledNotice)
    return { kind: 'success', text: lines.join('\n') }
  }

  /** Render the network policy state: mode mapping, proxy liveness, counters, recent blocks. */
  private networkCommand(prose: UiProse): CommandResult {
    const snapshot = this.networkSnapshot()
    const lines: string[] = []
    if (!snapshot.enabled) {
      lines.push(prose.networkDisabled)
      return { kind: 'success', text: lines.join('\n') }
    }
    lines.push(prose.networkHeader(snapshot.mode, snapshot.sandboxMode, snapshot.configuredMode, snapshot.proxyActive, snapshot.proxyPort))
    lines.push(prose.networkCounters(snapshot.denied, snapshot.askBlocked))
    if (snapshot.recent.length === 0) {
      lines.push(prose.noNetworkBlocks)
    } else {
      for (const block of snapshot.recent.slice(0, 10)) {
        lines.push(prose.networkBlockLine(block.time, block.tool, block.attributed, block.domain, block.scheme, block.port, block.action, block.matched, block.ruleIndex, block.reason))
      }
    }
    return { kind: 'success', text: lines.join('\n') }
  }

  /**
   * Validate deployment-level file references at mount — the earliest
   * resolvable point. An absolute `rulesFile` or a configured
   * `fallbackPath` must exist and parse; a missing referent fails the mount
   * loudly instead of silently degrading later.
   * @throws when a mandated file is missing or invalid.
   */
  validateDeploymentFiles(): void {
    if (isAbsolute(this.config.rulesFile)) {
      this.loadForValidation(this.config.rulesFile)
    }
    if (this.config.fallbackPath !== undefined) {
      const fallbackPath = isAbsolute(this.config.fallbackPath) ? this.config.fallbackPath : resolve(this.config.fallbackPath)
      if (!existsSync(fallbackPath)) {
        throw new RuleError(`permission-rules: fallbackPath ${JSON.stringify(this.config.fallbackPath)} does not exist`)
      }
      this.loadForValidation(fallbackPath)
    }
  }

  /** Parse and compile one mandated file, rethrowing as a mount failure. */
  private loadForValidation(filePath: string): void {
    try {
      const doc = parseRulesDocument(readFileSync(filePath, 'utf8'))
      compileRules(doc, this.compileOptions())
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      throw error instanceof RuleError ? error : new RuleError(`permission-rules: cannot load ${filePath}: ${message}`)
    }
  }

  /** Attach (once per file path) the Chokidar watcher feeding {@link reload}. */
  private attachWatch(cwd: string, source: string): void {
    if (!this.config.watch || source === '') return
    const existing = this.watchers.get(source)
    if (existing !== undefined) {
      existing.cwds.add(cwd)
      return
    }
    const cwds = new Set([cwd])
    const watcher = chokidar.watch(source, { persistent: true, ignoreInitial: true })
    const onEvent = (): void => this.scheduleReload(source)
    watcher.on('add', onEvent)
    watcher.on('change', onEvent)
    watcher.on('unlink', onEvent)
    watcher.on('error', (error: unknown) => {
      this.ctx.logger.warn(`permission-rules: watcher error on ${source}: ${String(error)}`)
    })
    this.watchers.set(source, {
      cwds,
      close: () => {
        void watcher.close().catch((error: unknown) => {
          this.ctx.logger.warn(`permission-rules: failed to close watcher on ${source}: ${String(error)}`)
        })
      },
    })
    this.ctx.effect(() => () => {
      this.watchers.get(source)?.close()
      this.watchers.delete(source)
      const timer = this.timers.get(source)
      if (timer !== undefined) {
        clearTimeout(timer)
        this.timers.delete(source)
      }
    })
  }

  /**
   * Rebind `cwd` to its current rule-source chain. When a concrete source
   * left the chain (deleted file, fallback switch), detach the workspace
   * from watchers serving other sources and close the ones left empty, so
   * long-running hosts cannot accumulate stale watchers. Expected-but-absent
   * rule files (the project file when it is not effective, and a configured
   * fallback that does not exist) are covered by candidate watchers on
   * their deepest existing ancestor directory, so a file created
   * mid-session is adopted without a manual `/rules reload`. With
   * `searchUp`, only the immediate cwd-level candidate is watched —
   * deeper ancestors are discovered on the next load.
   */
  private reconcileWatch(cwd: string, sources: readonly string[]): void {
    for (const [watchedSource, entry] of this.watchers) {
      if (!sources.includes(watchedSource)) {
        entry.cwds.delete(cwd)
        entry.candidates?.delete(cwd)
      }
    }
    this.pruneWatchers()
    for (const source of sources) this.attachWatch(cwd, source)
    for (const candidate of this.candidateSources(cwd)) {
      if (sources.includes(candidate) || existsSync(candidate)) continue
      this.attachCandidateWatch(cwd, candidate)
    }
  }

  /**
   * The rule-file paths a workspace COULD be served by: the project file
   * (an absolute `rulesFile`, or `<cwd>/<rulesFile>` — the immediate level
   * only under `searchUp`) plus the configured fallback.
   */
  private candidateSources(cwd: string): string[] {
    const candidates: string[] = [isAbsolute(this.config.rulesFile) ? this.config.rulesFile : join(cwd, this.config.rulesFile)]
    const fallback = this.config.fallbackPath
    if (fallback !== undefined) candidates.push(isAbsolute(fallback) ? fallback : resolve(fallback))
    return candidates
  }

  /**
   * Watch one expected-but-absent rule file through its deepest existing
   * ancestor directory. Chokidar cannot reliably watch a missing path when
   * its parent is also missing, but directory watching is dependable; every
   * relevant event re-checks existence and only triggers a reload once the
   * candidate actually appeared, so unrelated workspace activity while the
   * file is absent costs a stat, not a reload.
   */
  private attachCandidateWatch(cwd: string, candidate: string): void {
    if (!this.config.watch) return
    const dir = this.deepestExistingDir(dirname(candidate))
    const existing = this.watchers.get(dir)
    if (existing !== undefined) {
      existing.cwds.add(cwd)
      existing.candidates?.set(cwd, candidate)
      return
    }
    const cwds = new Set([cwd])
    const candidates = new Map([[cwd, candidate]])
    const watcher = chokidar.watch(dir, { persistent: true, ignoreInitial: true })
    const onEvent = (): void => this.scheduleReload(dir)
    watcher.on('add', onEvent)
    watcher.on('addDir', onEvent)
    watcher.on('change', onEvent)
    watcher.on('unlink', onEvent)
    watcher.on('unlinkDir', onEvent)
    watcher.on('error', (error: unknown) => {
      this.ctx.logger.warn(`permission-rules: watcher error on ${dir}: ${String(error)}`)
    })
    this.watchers.set(dir, {
      cwds,
      candidates,
      close: () => {
        void watcher.close().catch((error: unknown) => {
          this.ctx.logger.warn(`permission-rules: failed to close watcher on ${dir}: ${String(error)}`)
        })
      },
    })
    this.ctx.effect(() => () => {
      this.watchers.get(dir)?.close()
      this.watchers.delete(dir)
      const timer = this.timers.get(dir)
      if (timer !== undefined) {
        clearTimeout(timer)
        this.timers.delete(dir)
      }
    })
  }

  /** The deepest existing ancestor directory of `dir` (candidate watchers target directories, never missing files). */
  private deepestExistingDir(dir: string): string {
    let current = dir
    for (;;) {
      if (existsSync(current)) return current
      const parent = dirname(current)
      if (parent === current) return current
      current = parent
    }
  }

  /** Close and drop watchers whose workspace sets are empty, clearing their debounce timers. */
  private pruneWatchers(): void {
    for (const [source, entry] of this.watchers) {
      if (entry.cwds.size > 0) continue
      entry.close()
      this.watchers.delete(source)
      const timer = this.timers.get(source)
      if (timer !== undefined) {
        clearTimeout(timer)
        this.timers.delete(source)
      }
    }
  }

  /**
   * Bound the per-workspace cache: when a NEW workspace would exceed
   * `maxCachedWorkspaces`, evict the least-recently-used entry (the Map
   * head, refreshed by every {@link rulesFor} hit) and release its watcher
   * slots. Long-lived hosts that visit many workspaces therefore keep a
   * bounded memory footprint.
   */
  private evictIfFull(cwd: string): void {
    if (this.byCwd.size < this.config.maxCachedWorkspaces || this.byCwd.has(cwd)) return
    const oldest = this.byCwd.keys().next().value
    if (oldest === undefined) return
    this.byCwd.delete(oldest)
    for (const entry of this.watchers.values()) {
      entry.cwds.delete(oldest)
      entry.candidates?.delete(oldest)
    }
    this.pruneWatchers()
  }

  /** Number of live watchers, for observability and tests. */
  activeWatcherCount(): number {
    return this.watchers.size
  }

  /** Number of pending debounce timers, for observability and tests. */
  pendingReloadCount(): number {
    return this.timers.size
  }

  /**
   * Debounce watch events into one reload per stability window. A
   * candidate (directory) watcher only reloads a cwd once its expected
   * file actually exists — unrelated events while the file is absent are
   * dropped before any re-read.
   */
  private scheduleReload(source: string): void {
    const existing = this.timers.get(source)
    if (existing !== undefined) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.timers.delete(source)
      const entry = this.watchers.get(source)
      if (entry === undefined) return
      for (const cwd of entry.cwds) {
        const candidate = entry.candidates?.get(cwd)
        if (candidate !== undefined && !existsSync(candidate)) continue
        this.reload(cwd)
      }
    }, this.config.watchStabilityThresholdMs)
    this.timers.set(source, timer)
  }
}

/**
 * Mount the plugin: resolve config, validate deployment-level rule files,
 * register the pre-execute listener and the `/rules` command.
 * @param ctx - the host context.
 * @param config - raw plugin config.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = resolveConfig(config)
  const runtime = new PermissionRulesRuntime(ctx, resolved)
  runtime.validateDeploymentFiles()
  ctx.provide('permissionRulesRuntime', runtime)
  ctx.on('tools/pre-execute', (exec, next) => runtime.preExecute(exec, next))
  ctx.on('tools/post-execute', (exec, _result, next) => {
    runtime.unmarkShell(exec)
    return next()
  })
  attachSettingsSection(ctx, runtime, config)
  if (resolved.network.enabled) await runtime.attachNetworkProxy()
  ctx.inject(['systemPrompt'], (scope) => {
    const systemPrompt = scope.get('systemPrompt') as { context?: (entry: { name: string; order?: number; text: string }) => void } | undefined
    if (systemPrompt?.context === undefined) return
    systemPrompt.context({
      name: 'network:policy',
      order: 115,
      text: 'Network policy (permission-rules): shell commands reach the network only through a local policy proxy, and web tools are gated the same way — every target is allowed or blocked per the active rules and sandbox mode, and a blocked connection fails with a [network: …] message. Follow the denial messages and do not attempt to bypass the proxy.',
    })
  })
  await ctx.plugin(PermissionRulesRemoteService, { runtime })
  ctx.commands.register({
    name: 'rules',
    description: 'list, reload, audit, dry-test, or inspect the network policy of the active permission rules for this workspace',
    input: { hint: '[list | reload | network | decisions [n] | test [--cwd <dir>] [--env K=V] [--agent <sel>] [--platform <name>] <tool> <json-args>]' },
    handler: invocation => runtime.command(invocation),
  })
}

/**
 * Whether a `@deepseek-ai/dsh-session` version line predates the
 * `ignorable` envelope-marker surface: the `0.1.0-rc.6` line and earlier
 * silently drop the marker from `Session.append` options, so audit events
 * written by those builds land unmarked and break resume on stricter
 * hosts. Non-matching (post-rc.6, stable, or unresolvable) versions are
 * treated as possibly-marker-aware and verified by the append probe.
 * @param version - the installed peer version string.
 * @returns true for the known-unmarked rc.1–rc.6 lines.
 */
export function isUnmarkedHostVersion(version: string): boolean {
  const match = /^0\.1\.0-rc\.(\d+)$/.exec(version.trim())
  if (match === null) return false
  return Number(match[1]) <= 6
}

/**
 * Identity candidates for the `agents` match dimension, derived from the
 * caller agent's session header: `main` for top-level sessions, `subagent`
 * for subagent children (`header.origin === 'subagent'`), and
 * `preset:<name>` when a preset composed the agent. No agent (or an
 * unidentifiable one) yields no candidates, so agent-scoped rules fail
 * closed instead of matching an unknown caller.
 * @param agent - the calling agent, when the call has one.
 * @returns the candidate strings, in a stable order.
 */
function agentCandidates(agent: ToolExecution['agent']): string[] {
  if (agent === undefined) return []
  const header = agent.session.header
  const candidates = [header.origin === 'subagent' ? 'subagent' : 'main']
  if (typeof header.agentPreset === 'string' && header.agentPreset.length > 0) candidates.push(`preset:${header.agentPreset}`)
  return candidates
}

/**
 * Pull the next whitespace-delimited argument from a command tail,
 * honoring single/double quotes (with backslash escapes) so JSON blobs and
 * paths with spaces survive. The remainder is returned verbatim — the JSON
 * argument tail of `/rules test` is never re-tokenized.
 * @param text - the remaining command tail.
 * @returns the token plus the untouched remainder, or undefined when only
 *   whitespace remains.
 */
function nextToken(text: string): { token: string; rest: string } | undefined {
  let i = 0
  while (i < text.length && /\s/.test(text[i] as string)) i += 1
  if (i >= text.length) return undefined
  const quote = text[i] as string
  if (quote === '"' || quote === "'") {
    let end = i + 1
    while (end < text.length && text[end] !== quote) {
      if (text[end] === '\\') end += 1
      end += 1
    }
    if (end >= text.length) return { token: text.slice(i + 1), rest: '' }
    return { token: text.slice(i + 1, end), rest: text.slice(end + 1) }
  }
  let end = i
  while (end < text.length && !/\s/.test(text[end] as string)) end += 1
  return { token: text.slice(i, end), rest: text.slice(end) }
}
