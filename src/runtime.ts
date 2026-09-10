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

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import chokidar from 'chokidar'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { resolveConfig } from './config.ts'
import type { Config, ResolvedConfig } from './config.ts'
import type { CallId } from './call-id.ts'
import { insertAllowRule, isWritableHost, normalizeAllowHost, resolveAllowHostTarget } from './allow-host.ts'
import type { AllowHostInsertion } from './allow-host.ts'
import type { AllowHostRequest, AllowHostResult } from './wire.ts'
import { compileRules, compileSourceRules, describeRule, findUnreachableRules, isShellTool, matchRules, mergeCompiledRules, normalizeWorkspacePath, parseRulesDocument, PLATFORMS, RuleError } from './rules.ts'
import type { CompileOptions, CompiledRule, CompiledRuleset, MatchContext, NetworkTarget, RuleHit } from './rules.ts'
import { DESCRIBE_TOKENS, UI_PROSE } from './prose.ts'
import type { UiProse } from './prose.ts'
import { blockMessage, decideNetworkTarget, defaultDecision, networkModeForSandbox } from './network.ts'
import type { NetworkChain, NetworkDecision, NetworkMode } from './network.ts'

/** Session events with an old-host fallback: alpha.5 renamed the getter to snapshotEvents(). */
function readSessionEvents(session: { snapshotEvents?: () => readonly SessionEvent[]; events?: readonly SessionEvent[] }): readonly SessionEvent[] {
  if (typeof session.snapshotEvents === 'function') return session.snapshotEvents()
  return session.events ?? []
}
import { injectProxyEnv, NetworkProxy, readAmbientProxy, redactProxyUrl } from './proxy.ts'
import type { AmbientUpstream, NetworkBlockRecord, ProxyAttribution } from './proxy.ts'
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
 * Chokidar polling interval used when the watched path lives on a filesystem
 * whose change events are unreliable (WSL drvfs/9p mounts): polling costs a
 * stat per interval, which is negligible for a rule file and far cheaper than
 * a rule edit that silently never hot-reloads.
 */
const POLLING_WATCH_INTERVAL_MS = 300

/**
 * Whether one watched path lies under a WSL drvfs mount (`/mnt/<drive>/…`),
 * where inotify-style change events are known to be unreliable — chokidar
 * then has to poll (issue #19 item 1). The separator is normalized first so
 * the check also recognizes the path as the Windows side spells it; a
 * Windows drive path (`D:\…`) never matches.
 * @param path - the watched file or directory path.
 * @returns true when the path addresses a drvfs mount.
 */
export function isDvrfsPath(path: string): boolean {
  return /^\/mnt\/[a-z](?:\/|$)/i.test(path.replace(/\\/g, '/'))
}

/**
 * Whether the running kernel is WSL's, as `/proc/version` reports it. Every
 * WSL kernel string carries `microsoft` (`…-microsoft-standard-WSL2`), which
 * is what the issue asks the detection to key on; a non-WSL Linux kernel
 * never does, and hosts without `/proc/version` (Windows, macOS) answer
 * false.
 * @param procVersion - the `/proc/version` text, or an empty string when it cannot be read.
 * @returns true when the kernel is Microsoft's.
 */
export function isWslKernel(procVersion: string): boolean {
  return procVersion.toLowerCase().includes('microsoft')
}

/** `/proc/version` is immutable for the process lifetime: read it at most once. */
let procVersionText: string | undefined

/** Read `/proc/version`, or an empty string wherever the file is absent (Windows, macOS). */
function readProcVersion(): string {
  if (procVersionText === undefined) {
    try {
      procVersionText = readFileSync('/proc/version', 'utf8')
    } catch {
      procVersionText = ''
    }
  }
  return procVersionText
}

/** Chokidar options that switch one watch to polling (drvfs mount or WSL host). */
const POLLING_WATCH_OPTIONS = { usePolling: true, interval: POLLING_WATCH_INTERVAL_MS } as const

/**
 * State and behavior. One instance per plugin mount; disposals are owned by
 * the watcher/timer/proxy effects registered in {@link apply}.
 */
/**
 * Whether a configured upstream addresses this proxy's own bind address and
 * port, which would make every chained connection recurse into this proxy.
 */
function isSelfUpstream(value: string, bind: string, port: number): boolean {
  try {
    const parsed = new URL(value)
    const bindIsLocal = bind === '127.0.0.1' || bind === 'localhost' || bind === '::1' || bind === '0.0.0.0'
    const host = parsed.hostname
    const valueIsLocal = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
    const valuePort = parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : Number(parsed.port)
    return bindIsLocal && valueIsLocal && valuePort === port
  } catch {
    return false
  }
}

export class PermissionRulesRuntime {
  /** Loaded (or failed) rules per workspace cwd, least-recently-used first for eviction. */
  private readonly byCwd = new Map<string, LoadedRules>()

  /** Compiled per-source rules keyed by absolute path, with the content hash they were compiled from (LRU-refreshed). */
  private readonly compileCache = new Map<string, { hash: string; rules: CompiledRule[] }>()

  /** Live watchers per watched path (rule file or candidate ancestor directory), with the cwds each serves. */
  private readonly watchers = new Map<string, WatcherEntry>()

  /** The configured chain session-less proxy connections are judged against (see {@link hostChain}); never a `byCwd` member. */
  private hostLoaded: LoadedRules | undefined

  /** Whether the one-time "configured chain unusable" warning was already logged. */
  private hostChainWarned = false

  /** Debounce timers per rule-file path. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  /** Whether the host honors the audit envelope's `ignorable` marker: unknown until the first decision (or peer-version check). */
  private auditSupport: 'unknown' | 'supported' | 'unsupported' = 'unknown'

  /** In-flight bash/pwsh executions (insertion order = start order), for proxy-block attribution. */
  private readonly inFlight = new Map<string, InFlightShell>()

  /** The network proxy, when the policy is enabled and mounted. */
  private networkProxy: NetworkProxy | undefined
  /** Ambient upstream candidates, captured ONCE before this plugin injects its own (see {@link captureAmbientUpstream}). */
  private ambientUpstream: AmbientUpstream | undefined
  private ambientCaptured = false
  private upstreamWarned = false
  private selfLoopWarned = false

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
   * Resolve which files serve a workspace, nearest first: the USER rule
   * files (project file under the session cwd — or an absolute `rulesFile`
   * — with `searchUp` also merging every parent directory's file on the
   * way to the root, else the configured fallback, else `[]`), followed by
   * the built-in high-risk baseline when enabled. The baseline sits LAST so
   * first-match semantics let any nearer user rule override it; with no
   * user files it applies alone. Nearer files evaluate first, so a child
   * can override a parent rule.
   * @param cwd - the session's absolute workspace root.
   * @returns the absolute rule-file paths in effect, nearest first.
   */
  resolveSources(cwd: string): string[] {
    const user = this.resolveUserSources(cwd)
    const builtin = this.builtinSource()
    return builtin === undefined ? user : [...user, builtin]
  }

  /** The built-in baseline path when enabled, else `undefined`. */
  private builtinSource(): string | undefined {
    return this.config.builtin.enabled ? this.config.builtin.path : undefined
  }

  /** The user rule files serving a workspace (project chain → fallback → empty), nearest first. */
  private resolveUserSources(cwd: string): string[] {
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
      const compiledSources = sources.map(path => this.compileSourceFile(path))
      const ruleset = mergeCompiledRules(compiledSources, this.compileOptions())
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
   * Compile one source file, reusing the cached compiled rules when the
   * file's content hash is unchanged. The cache key is the source path plus
   * the content hash, so the same file read by many workspaces (the
   * built-in baseline and any shared fallback/absolute `rulesFile`) is
   * parsed and compiled ONCE, not once per cwd.
   * @param path - the absolute source path.
   * @returns that source's compiled rules (source-local index, sourceIndex 0).
   */
  private compileSourceFile(path: string): CompiledRule[] {
    const text = readFileSync(path, 'utf8')
    const hash = createHash('sha256').update(text).digest('hex')
    const cached = this.compileCache.get(path)
    if (cached !== undefined && cached.hash === hash) {
      this.compileCache.delete(path)
      this.compileCache.set(path, cached)
      return cached.rules
    }
    const rules = compileSourceRules(parseRulesDocument(text), this.compileOptions())
    this.compileCache.set(path, { hash, rules })
    this.evictCompileCache()
    return rules
  }

  /** Bound the compile cache: drop the least-recently-used source beyond the workspace cap (compile results are cheap to rebuild). */
  private evictCompileCache(): void {
    const cap = this.config.maxCachedWorkspaces
    while (this.compileCache.size > cap) {
      const oldest = this.compileCache.keys().next().value
      if (oldest === undefined) return
      this.compileCache.delete(oldest)
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
   * or keeps the later surface-only signature (the `0.1.2-rc`, `0.1.3-alpha`
   * and `0.1.5-alpha` lines) silently drop the options bag, leaving the
   * event unmarked and sessions unresumable on stricter hosts — the runtime
   * therefore detects such hosts BEFORE the first append (peer version) and
   * re-checks after the first append (returned envelope), then degrades:
   * session-log audit is disabled with a one-time warning unless
   * `allowUnmarkedAudit: true` opts back in. The `0.1.2-alpha` line refuses
   * plugin event types on read even when marked, so its version gate
   * disables audit the same way (see `isUnmarkedHostVersion`). `source`
   * names the matched rule's file, or the nearest effective file on a
   * passthrough; `cwd`
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
  resolveNetworkMode(session?: unknown): { mode: NetworkMode; sandboxMode: string | undefined } {
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
    if (chains.length === 0) {
      const host = this.hostChain()
      if (host !== undefined) chains.push(host)
    }
    return chains
  }

  /**
   * The CONFIGURED chain a session-less connection is judged against: the
   * chain for the host process's own working directory (project rule file →
   * an absolute `rulesFile` → the configured fallback → the shipped
   * baseline), loaded on first use. Proxy traffic that carries no session —
   * the harness's own plugin-market catalog/update/npm lookups at boot — used
   * to be judged against an empty chain and therefore always hit the mode
   * default, so a target an already-configured allow rule permits stayed
   * blocked until some session had run a tool call (issue #18). The chain is
   * kept OUT of `byCwd` on purpose: it must never outrank a session workspace
   * chain, and it stops being consulted as soon as one is loaded (a host-level
   * connection is then judged exactly as before, against the loaded workspace
   * chains). It is not watched either: the session-less window is the boot
   * window, and the first tool call of any session takes over with the normal
   * per-workspace chain, which is watched. An EXPLICIT reload still drops this
   * cache ({@link invalidateHostChain}) — `/rules reload`, the settings-page
   * reload and a settings save all reach it — because during the boot window a
   * corrected rule otherwise had no effect short of restarting the process.
   * @returns the configured chain, or undefined when it cannot be loaded (the mode default then applies).
   */
  private hostChain(): NetworkChain | undefined {
    if (this.hostLoaded === undefined) {
      try {
        this.hostLoaded = this.load(process.cwd())
      } catch (error: unknown) {
        // Never throw into the proxy: an unusable configured chain degrades to
        // the mode default (fail closed), with one warning per mount.
        if (!this.hostChainWarned) {
          this.hostChainWarned = true
          this.ctx.logger.warn(`permission-rules: cannot load the configured rules for session-less connections at ${process.cwd()}: ${String(error)} (the network mode default applies)`)
        }
        return undefined
      }
    }
    return { ruleset: this.hostLoaded.compiled, sources: this.hostLoaded.sources }
  }

  /**
   * Drop the cached session-less chain so the next proxy decision re-reads it,
   * and re-arm the one-shot warning so a file that has since become loadable
   * can report a failure again. Without this the cache was permanent: the
   * session-less chain is deliberately not a `byCwd` member and is not watched,
   * so neither `reloadAll()` nor a settings save ever reached it and a
   * corrected rule needed a process restart (issue #18 follow-up).
   */
  private invalidateHostChain(): void {
    this.hostLoaded = undefined
    this.hostChainWarned = false
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
    // Capture the ambient proxy BEFORE injectProxyEnv() rewrites the
    // environment: afterwards the only proxy this process can still see is ours.
    this.captureAmbientUpstream()
    const proxy = new NetworkProxy({
      bind: cfg.proxyBind,
      port: cfg.proxyPort,
      maxRecent: cfg.proxyMaxRecent,
      decide: target => this.decideProxyTarget(target),
      attribution: () => this.proxyAttribution(),
      onBlock: (record, attribution) => this.auditNetworkBlock(record, attribution),
      logger: this.ctx.logger,
      upstream: () => this.upstreamFor(),
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
    // The chain inputs (rulesFile, fallbackPath, …) may have changed with the
    // config, so the session-less chain must be re-read rather than reused.
    this.invalidateHostChain()
    await this.networkProxy?.close()
    this.envRestore?.()
    this.envRestore = undefined
    await this.attachNetworkProxy()
  }

  /**
   * Capture the launch environment's proxy names exactly ONCE, before this
   * plugin injects its own. `onNetworkConfigChanged()` closes the old proxy and
   * restores the environment around a rebind, so a second capture could read
   * this plugin's own address back as if the operator had exported it — hence
   * the memo. The launch snapshot is immutable and preferred; `process.env` is
   * the fallback for hosts that expose no snapshot.
   */
  private captureAmbientUpstream(): void {
    if (this.ambientCaptured) return
    this.ambientCaptured = true
    const launch = this.ctx.get('launchEnvironment') as { get(name: string): { value: string } | undefined } | undefined
    const lookup = (name: string): string | undefined => launch?.get(name)?.value ?? process.env[name]
    this.ambientUpstream = readAmbientProxy(lookup)
    this.warnAboutUpstream()
  }

  /** The one-shot upstream diagnostics: a discarded ambient proxy, or an `inherit` with nothing to inherit. */
  private warnAboutUpstream(): void {
    if (this.upstreamWarned) return
    this.upstreamWarned = true
    const cfg = this.config.network
    const ambient = this.ambientUpstream
    const has = ambient !== undefined && (ambient.http !== undefined || ambient.https !== undefined)
    if (cfg.upstreamProxy === 'off' && cfg.injectEnv && has) {
      this.ctx.logger.warn(`permission-rules: an ambient proxy (${redactProxyUrl(ambient.https ?? ambient.http ?? '')}) is discarded for traffic through this proxy; set network.upstreamProxy to "inherit" to chain through it, or leave it to subprocesses only`)
    }
    if (cfg.upstreamProxy === 'inherit' && !cfg.injectEnv) {
      this.ctx.logger.warn('permission-rules: network.upstreamProxy is only consulted for connections that reach this proxy; with injectEnv false, subprocess traffic keeps its own route')
    }
    if (cfg.upstreamProxy === 'inherit' && !has) {
      this.ctx.logger.warn('permission-rules: network.upstreamProxy is "inherit" but the launch environment named no usable http(s) proxy (a SOCKS or malformed value is ignored; Node has no SOCKS client)')
    }
  }

  /**
   * The upstream getter the proxy consults per connection. Undefined when the
   * setting is `off`, when no candidate is usable, or when the candidate points
   * back into this very proxy — a self-loop would recurse forever, so chaining
   * is disabled for it and warned about once.
   */
  private upstreamFor(): AmbientUpstream | undefined {
    if (this.config.network.upstreamProxy === 'off') return undefined
    const ambient = this.ambientUpstream
    if (ambient === undefined) return undefined
    const selfPort = this.networkProxy?.port ?? 0
    const selfHost = this.config.network.proxyBind
    const usable = (value: string | undefined): string | undefined => {
      if (value === undefined) return undefined
      if (selfPort > 0 && isSelfUpstream(value, selfHost, selfPort)) {
        if (!this.selfLoopWarned) {
          this.selfLoopWarned = true
          this.ctx.logger.warn(`permission-rules: network.upstreamProxy points at this proxy itself (${redactProxyUrl(value)}); chaining is disabled for it`)
        }
        return undefined
      }
      return value
    }
    const http = usable(ambient.http)
    const https = usable(ambient.https)
    if (http === undefined && https === undefined) return undefined
    return { ...(http === undefined ? {} : { http }), ...(https === undefined ? {} : { https }) }
  }

  /** The upstream block of the network snapshot, already redacted. */
  private upstreamSnapshot(): {
    readonly mode: 'off' | 'inherit' | 'url'
    readonly http: string | null
    readonly https: string | null
    readonly active: boolean
    readonly chained: number
  } {
    const setting = this.config.network.upstreamProxy
    const mode: 'off' | 'inherit' | 'url' = setting === 'off' ? 'off' : setting === 'inherit' ? 'inherit' : 'url'
    const http = mode === 'off' ? undefined : mode === 'url' ? setting : this.ambientUpstream?.http
    const https = mode === 'off' ? undefined : mode === 'url' ? setting : this.ambientUpstream?.https
    return {
      mode,
      http: http === undefined ? null : redactProxyUrl(http),
      https: https === undefined ? null : redactProxyUrl(https),
      active: mode !== 'off' && this.upstreamFor() !== undefined,
      chained: this.networkProxy?.chainedConnections() ?? 0,
    }
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
    readonly upstream: {
      readonly mode: 'off' | 'inherit' | 'url'
      readonly http: string | null
      readonly https: string | null
      readonly active: boolean
      readonly chained: number
    }
    /** Whether the settings page may offer the per-block allow action. */
    readonly allowHostAction: boolean
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
      upstream: this.upstreamSnapshot(),
      allowHostAction: cfg.allowHostAction,
    }
  }

  /** The rule-file paths the settings-page editor may read or write: every
   * currently loaded source plus the per-workspace project files, the
   * configured fallback, and the host-level project file the session-less
   * chain resolves (so a not-yet-existing project file can be created). The
   * editor never touches arbitrary paths — and the built-in baseline is
   * excluded entirely (it is a shipped, read-only baseline, shown via
   * `/rules` attribution instead).
   */
  knownRuleSources(): readonly string[] {
    const cfg = this.config
    const builtin = cfg.builtin.enabled ? cfg.builtin.path : undefined
    const set = new Set<string>()
    for (const loaded of this.byCwd.values()) {
      for (const source of loaded.sources) {
        if (source === builtin) continue
        set.add(source)
      }
      if (!isAbsolute(cfg.rulesFile)) set.add(join(loaded.cwd, cfg.rulesFile))
    }
    if (cfg.fallbackPath !== undefined) set.add(isAbsolute(cfg.fallbackPath) ? cfg.fallbackPath : resolve(cfg.fallbackPath))
    if (isAbsolute(cfg.rulesFile)) set.add(cfg.rulesFile)
    // The host-level chain (see hostChain) resolves its project file against
    // the process cwd; it must be editable and allow-able even while no
    // workspace chain is loaded, or the settings page could show a block the
    // operator can see but not act on.
    else set.add(join(process.cwd(), cfg.rulesFile))
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

  /**
   * Re-read every cached workspace chain and drop the session-less host chain
   * (the settings-page reload action). The host chain matters here because the
   * settings page is a web-client surface: it can be used while no session has
   * run a tool call, which is exactly the window in which the host chain is
   * what judges traffic.
   */
  reloadAll(): void {
    this.invalidateHostChain()
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
    if (this.config.builtin.enabled && path === this.config.builtin.path) {
      return { ok: false, error: `refusing to write ${path}: the built-in ruleset is read-only` }
    }
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
    this.invalidateHostChain()
    for (const cwd of [...this.byCwd.keys()]) {
      this.reload(cwd)
      reloaded += 1
    }
    return { ok: true, reloaded }
  }

  /**
   * The settings-page "allow this host" action (issue #19 item 3): write ONE
   * minimal `match.network.domains` allow rule for a blocked target into the
   * nearest effective rule file, at index 0, then report the decision the
   * runtime makes for that target afterwards.
   *
   * Why index 0: rules are first-match-wins, so appending the rule after an
   * existing `deny` would leave the connection blocked — the rule would be
   * dead text the operator cannot see the reason for.
   *
   * Why `domains` only: that dimension is subdomain-inclusive and
   * port/scheme-agnostic; narrowing the generated rule to the blocked port
   * would re-block the same host on its next connection from another port.
   * The rule can never widen TOOL permissions either — an allow hit on
   * `tools/pre-execute` is delegated downstream, never claimed.
   *
   * Failure modes are fail-closed and leave the disk untouched: the action is
   * disabled, the host is not a host name/IP literal, the request names an
   * unknown workspace, the target resolves outside the known rule sources or
   * onto the built-in baseline, the file cannot be read, the document does
   * not parse / has no `rules` list, or the written text fails the same
   * `parseRulesDocument` + `compileRules` gate every hand edit passes.
   *
   * The write goes through {@link saveRuleFile}, so the per-workspace chains
   * AND the session-less host chain are re-read — no restart, no
   * `/rules reload` — and the returned `outcome` is the REAL decision
   * recomputed after the write (with the target as given, no DNS: an
   * `ips`-scoped allow rule cannot be seen here). Cross-process concurrent
   * writes to one rule file are out of scope: last writer wins.
   *
   * @param request - the blocked target plus the workspace it belongs to.
   * @returns the action result, never a throw.
   */
  allowHost(request: AllowHostRequest): AllowHostResult {
    const fail = (error: string, path: string | null = null): AllowHostResult => ({
      ok: false,
      path,
      created: false,
      reloaded: 0,
      outcome: null,
      alreadyAllowed: false,
      error,
    })
    if (!this.config.network.allowHostAction) {
      return fail('the allow-host action is disabled by network.allowHostAction')
    }
    const host = normalizeAllowHost(request.host)
    if (!isWritableHost(host)) {
      return fail(`refusing to allow ${JSON.stringify(request.host)}: not a host name or IP literal`)
    }
    const target: NetworkTarget = { scheme: request.scheme ?? undefined, host, port: request.port ?? undefined, ips: [] }
    if (this.decideProxyTarget(target).action === 'allow') {
      return { ok: true, path: null, created: false, reloaded: 0, outcome: 'allow', alreadyAllowed: true, error: null }
    }
    let path: string
    try {
      path = resolveAllowHostTarget({
        cwd: request.cwd,
        loadedCwds: [...this.byCwd.values()].map(loaded => loaded.cwd),
        knownSources: this.knownRuleSources(),
        rulesFile: this.config.rulesFile,
        fallbackPath: this.config.fallbackPath,
        processCwd: process.cwd(),
        builtinPath: this.builtinSource(),
        exists: existsSync,
      })
    } catch (error: unknown) {
      return fail(error instanceof Error ? error.message : String(error))
    }
    const existed = existsSync(path)
    let existing = ''
    if (existed) {
      try {
        existing = readFileSync(path, 'utf8')
      } catch (error: unknown) {
        return fail(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`, path)
      }
    }
    let edit: AllowHostInsertion
    try {
      edit = insertAllowRule(existing, host)
    } catch (error: unknown) {
      return fail(error instanceof Error ? error.message : String(error), path)
    }
    if (!edit.inserted) {
      // The file already leads with this exact allow rule: first-match
      // semantics make a second copy a no-op, so the file stays untouched.
      return { ok: true, path, created: false, reloaded: 0, outcome: this.decideProxyTarget(target).action, alreadyAllowed: true, error: null }
    }
    const hadHostChain = this.hostLoaded !== undefined
    const saved = this.saveRuleFile(path, edit.text)
    if (!saved.ok) return fail(saved.error ?? `refusing to write ${path}`, path)
    return {
      ok: true,
      path,
      created: !existed,
      reloaded: (saved.reloaded ?? 0) + (hadHostChain ? 1 : 0),
      outcome: this.decideProxyTarget(target).action,
      alreadyAllowed: false,
      error: null,
    }
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
      'permission-rules: this host cannot safely persist ignorable-marked audit events (its Session.append predates the marker, or its read path refuses plugin events), which would make sessions unresumable on stricter harness builds — session-log audit is disabled; set allowUnmarkedAudit: true to opt back in, and repair existing logs with scripts/repair-session-logs.mjs (see https://github.com/PerryLink/dsh-permission-rules/issues/2)',
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
    const decisions = readSessionEvents(invocation.agent.session).filter(event => event.type === 'permissionRules/decision')
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
    lines.push(prose.networkUpstream(snapshot.upstream.mode, snapshot.upstream.http, snapshot.upstream.https, snapshot.upstream.active, snapshot.upstream.chained))
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
    if (this.config.builtin.enabled) {
      if (!existsSync(this.config.builtin.path)) {
        throw new RuleError(`permission-rules: builtin ruleset ${JSON.stringify(this.config.builtin.path)} does not exist`)
      }
      this.loadForValidation(this.config.builtin.path)
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

  /**
   * Whether one watched path must be polled instead of trusting the platform's
   * change events. WSL is the case issue #19 item 1 reports: a rule file under
   * `/mnt/<drive>` (drvfs/9p) or any file on a WSL host can stop delivering
   * chokidar change events with no error at all, so the watcher edits would
   * silently stop hot-reloading. Polling is the documented chokidar remedy;
   * everywhere else the native watcher stays in place.
   * @param path - the watched rule file or candidate directory.
   * @returns true when the watch should run in polling mode.
   */
  watchPollingFor(path: string): boolean {
    return isDvrfsPath(path) || isWslKernel(readProcVersion())
  }

  /** Attach (once per file path) the Chokidar watcher feeding {@link reload}. */
  private attachWatch(cwd: string, source: string): void {
    if (!this.config.watch || source === '' || (this.config.builtin.enabled && source === this.config.builtin.path)) return
    const existing = this.watchers.get(source)
    if (existing !== undefined) {
      existing.cwds.add(cwd)
      return
    }
    const cwds = new Set([cwd])
    const polling = this.watchPollingFor(source)
    const watcher = chokidar.watch(source, { persistent: true, ignoreInitial: true, ...(polling ? POLLING_WATCH_OPTIONS : {}) })
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
   *
   * Candidate watchers never recurse past the immediate children of that
   * ancestor: when the walk-up landed on the workspace root (the
   * candidate's parent chain is missing, e.g. no `.dsh/` directory),
   * recursion would watch the entire workspace tree — issue #13 measured
   * 245k inotify watches and multi-GiB RSS from exactly this path. The
   * watcher therefore runs with `depth: 0` plus `node_modules`/`.git`
   * ignores in that case, and the `addDir` handler upgrades the watch to
   * the newly appeared ancestor level, preserving mid-session adoption.
   * A candidate watcher whose directory itself disappears closes instead
   * of lingering on a dead path.
   */
  private attachCandidateWatch(cwd: string, candidate: string): void {
    if (!this.config.watch) return
    const parent = dirname(candidate)
    const dir = this.deepestExistingDir(parent)
    const existing = this.watchers.get(dir)
    if (existing !== undefined) {
      existing.cwds.add(cwd)
      existing.candidates?.set(cwd, candidate)
      return
    }
    const cwds = new Set([cwd])
    const candidates = new Map([[cwd, candidate]])
    const polling = this.watchPollingFor(candidate)
    const watchOptions = {
      persistent: true,
      ignoreInitial: true,
      ...(polling ? POLLING_WATCH_OPTIONS : {}),
      ignored: (path: string): boolean => path.split(sep).includes('node_modules') || path.split(sep).includes('.git'),
    }
    const watcher = dir === parent
      ? chokidar.watch(dir, watchOptions)
      : chokidar.watch(dir, { ...watchOptions, depth: 0 })
    // Windows paths may reach the watcher with a different ASCII case than
    // the header-derived candidate paths (the session layer case-folds the
    // cache key); compare case-insensitively there or the upgrade/close
    // handlers silently never fire.
    const samePath = (a: string, b: string): boolean => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
    const startsWithPath = (a: string, b: string): boolean => (process.platform === 'win32' ? a.toLowerCase().startsWith(b.toLowerCase()) : a.startsWith(b))
    const onEvent = (event: string, path: string): void => {
      if (event === 'unlinkDir' && samePath(path, dir)) {
        this.watchers.delete(dir)
        const timer = this.timers.get(dir)
        if (timer !== undefined) {
          clearTimeout(timer)
          this.timers.delete(dir)
        }
        void watcher.close().catch((error: unknown) => {
          this.ctx.logger.warn(`permission-rules: failed to close watcher on ${dir}: ${String(error)}`)
        })
        return
      }
      if (dir !== parent && event === 'addDir' && (samePath(path, parent) || startsWithPath(path, parent + sep))) {
        this.attachCandidateWatch(cwd, candidate)
      }
      this.scheduleReload(dir)
    }
    watcher.on('add', (path: string) => onEvent('add', path))
    watcher.on('addDir', (path: string) => onEvent('addDir', path))
    watcher.on('change', (path: string) => onEvent('change', path))
    watcher.on('unlink', (path: string) => onEvent('unlink', path))
    watcher.on('unlinkDir', (path: string) => onEvent('unlinkDir', path))
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

  /** Number of cached compiled source files, for observability and tests. */
  compiledSourceCount(): number {
    return this.compileCache.size
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
      text: 'You are a helpful assistant. Network policy (permission-rules): shell commands reach the network only through a local policy proxy, and web tools are gated the same way — every target is allowed or blocked per the active rules and sandbox mode, and a blocked connection fails with a [network: …] message. Follow the denial messages and do not attempt to bypass the proxy.',
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
 * Whether a `@deepseek-ai/dsh-session` version line cannot safely persist
 * plugin audit events, either because it predates the `ignorable`
 * envelope-marker surface or because its read path refuses out-of-vocabulary
 * event types even when marked:
 * - The released `0.1.0-rc.1`–`0.1.0-rc.7` lines silently drop the marker
 *   from `Session.append` options, so audit events written by those builds
 *   land unmarked and break resume on stricter hosts. `0.1.0-rc.8` and
 *   later stamp the marker. The `0.1.1-rc` line regressed the same way
 *   (verified on `0.1.1-rc.2` — the stamping fix exists only on harness
 *   master), so `0.1.1-rc.1`–`0.1.1-rc.7` are treated as unmarked too.
 * - The `0.1.2-rc` line ships the alpha.5 surface: the third
 *   `Session.append` parameter is `SurfaceIntent` for surface event types
 *   only, so no rc build in the `0.1.2` minor stamps the marker either
 *   (verified against the `dsh-v0.1.2-rc.1` tag). The whole rc line is
 *   treated as unmarked.
 * - The `0.1.3-alpha` line keeps that surface-only append signature
 *   (verified against the `dsh-v0.1.3-alpha.1` tag), so its builds stamp
 *   the marker no more than rc.1 does and the line is treated as unmarked.
 * - The `0.1.5-alpha` line drops the third `Session.append` argument the
 *   same way (verified on the published `0.1.5-alpha.1` package: the
 *   returned envelope carries no `ignorable` field, and the field survives
 *   only on the stored-log READ path), so its builds append unmarked audit
 *   rows and the whole line is treated as unmarked too. Every later
 *   `0.1.N-alpha` line shares that surface until proven otherwise.
 * - The `0.1.2-alpha` line refuses to interpret logs containing plugin
 *   event types even when the envelope carries `ignorable: true` (verified
 *   on `0.1.2-alpha-1`, reported by @rgw87 in issue #15), so audit events
 *   written there make the session unresumable on that host itself. The
 *   whole alpha line is treated as unsafe; over-refusal is harmless because
 *   `allowUnmarkedAudit: true` opts back in, and
 *   `scripts/repair-session-logs.mjs strip` removes already-written audit
 *   rows for hosts where the marker cannot help. On `0.1.2-alpha.2` the
 *   envelope field is restored for stored-log read compatibility only — its
 *   `Session.append` still cannot stamp the marker, so the gate behavior is
 *   unchanged.
 * - Every rc build in minor 2 and later is treated as unmarked too
 *   (defensive: a future `0.1.3-rc` line would ship at least the same
 *   surface, and over-refusal is harmless for the reasons above), and so is
 *   every alpha build in minor 2 and later (`0.1.2-alpha` through
 *   `0.1.5-alpha` and any later line: the marker surface was reintroduced
 *   for stored-log reads, never for `Session.append`).
 *   Non-matching (later stable or unresolvable) versions are treated as
 *   possibly-marker-aware and verified by the append probe.
 * @param version - the installed peer version string.
 * @returns true for the known-unsafe rc.1–rc.7 lines of `0.1.0` and
 *   `0.1.1`, every rc build in minor 2 and later, and every alpha build in
 *   minor 2 and later (`0.1.2-alpha` through `0.1.5-alpha`).
 */
export function isUnmarkedHostVersion(version: string): boolean {
  const v = version.trim()
  const rc = /^0\.1\.([0-9]+)-rc\.(\d+)$/.exec(v)
  if (rc !== null) return Number(rc[1]) >= 2 || Number(rc[2]) <= 7
  return /^0\.1\.(?:[2-9]|[1-9]\d)-alpha[.-]\d+$/.test(v)
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
