/**
 * Runtime of `dsh-permission-rules`: per-workspace rule loading (project
 * file chain by session cwd → fallback path → empty set), the
 * `tools/pre-execute` listener that turns a first-match hit into a
 * deny/ask decision (and NEVER short-circuits on allow or passthrough),
 * the `permissionRules/decision` audit event, the `/rules` session command
 * (`list | reload | decisions [n] | test [flags] <tool> <json>`), and
 * Chokidar-driven reloads. Every registration is an effect.
 * @module dsh-permission-rules/runtime
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import chokidar from 'chokidar'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { resolveConfig } from './config.ts'
import type { Config, ResolvedConfig } from './config.ts'
import { compileRules, compileRulesChain, describeRule, findUnreachableRules, matchRules, parseRulesDocument, RuleError } from './rules.ts'
import type { CompileOptions, CompiledRuleset, MatchContext, RuleHit } from './rules.ts'
import { DESCRIBE_TOKENS, UI_PROSE } from './prose.ts'
import type { UiProse } from './prose.ts'
import type { AuditAppend, AuditDecision, DecisionOutcome } from './events.ts'

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

/**
 * State and behavior. One instance per plugin mount; disposals are owned by
 * the watcher/timer effects registered in {@link apply}.
 */
export class PermissionRulesRuntime {
  /** Loaded (or failed) rules per workspace cwd, least-recently-used first for eviction. */
  private readonly byCwd = new Map<string, LoadedRules>()

  /** Live watchers per rule-file path, with the cwds each serves. */
  private readonly watchers = new Map<string, { readonly cwds: Set<string>; readonly close: () => void }>()

  /** Debounce timers per rule-file path. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly ctx: Context,
    readonly config: ResolvedConfig,
  ) {}

  /** The shared compile options derived from config. */
  private compileOptions(): CompileOptions {
    return {
      patternMode: this.config.patternMode,
      maxRules: this.config.maxRules,
      maxGlobStars: this.config.maxGlobStars,
      caseInsensitivePaths: this.config.caseInsensitivePaths,
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
    const existing = this.byCwd.get(cwd)
    if (existing !== undefined) {
      if (existing.failed === true) {
        throw new RuleError(existing.lastError ?? `rule load failed for ${cwd}`)
      }
      this.byCwd.delete(cwd)
      this.byCwd.set(cwd, existing)
      return existing
    }
    this.evictIfFull(cwd)
    try {
      const loaded = this.load(cwd)
      this.byCwd.set(cwd, loaded)
      this.reconcileWatch(cwd, loaded.sources)
      return loaded
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const sources = this.resolveSources(cwd)
      this.byCwd.set(cwd, { cwd, sources, compiled: { rules: [], caseInsensitivePaths: this.config.caseInsensitivePaths }, lastError: message, failed: true })
      this.reconcileWatch(cwd, sources)
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
    const previous = this.byCwd.get(cwd)
    try {
      const loaded = this.load(cwd)
      this.byCwd.set(cwd, loaded)
      this.reconcileWatch(cwd, loaded.sources)
      this.ctx.logger.info(`permission-rules: reloaded ${loaded.compiled.rules.length} rule(s) from ${loaded.sources.join(', ') || '(empty rule set)'} for ${cwd}`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn(`permission-rules: reload failed for ${cwd}: ${message} (keeping previous rules)`)
      if (previous !== undefined) this.byCwd.set(cwd, { ...previous, lastError: message })
      else this.byCwd.set(cwd, { cwd, sources: this.resolveSources(cwd), compiled: { rules: [], caseInsensitivePaths: this.config.caseInsensitivePaths }, lastError: message, failed: true })
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
   * their say. Under `enforce: false` (dry-run) a deny/ask hit also
   * delegates — the record keeps the would-be action with `dryRun: true`
   * and the actual downstream outcome. Audit is appended once the final
   * outcome is known, so the recorded `outcome` matches what the waterfall
   * settled on.
   * @param exec - the pending call (name, parsed arguments, caller agent).
   * @param next - the downstream chain.
   * @returns the pre-execute decision.
   */
  async preExecute(exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> {
    const cwd = exec.agent?.session.header.cwd ?? process.cwd()
    const loaded = this.rulesFor(cwd)
    const hit = matchRules(loaded.compiled, exec.name, exec.arguments, cwd, this.matchContext(exec))
    if (hit === undefined || hit.rule.action === 'allow') {
      const decision = await next()
      this.audit(exec, loaded, hit, decision.kind)
      return decision
    }
    if (!this.config.enforce) {
      // Dry-run: match the rule, log what it WOULD do, and delegate.
      const decision = await next()
      this.audit(exec, loaded, hit, decision.kind, true)
      return decision
    }
    const outcome: DecisionOutcome = hit.rule.action
    this.audit(exec, loaded, hit, outcome)
    if (outcome === 'deny') return { kind: 'deny', reason: hit.rule.reason }
    return { kind: 'ask', reason: hit.rule.reason }
  }

  /**
   * Append the log-only `permissionRules/decision` audit event for every
   * decision (passthrough included unless `audit: 'hits'`), requesting the
   * envelope's `ignorable: true` marker so any harness build can load the
   * log (readers that do not know the type skip the audit record instead of
   * refusing the session). `source` names the matched rule's file, or the
   * nearest effective file on a passthrough; `cwd` names the workspace the
   * rules were resolved for; `dryRun` marks would-be deny/ask hits under
   * `enforce: false`. Agentless calls have no session to audit; append
   * failures are contained so an audit hiccup can never change a
   * permission decision.
   * @param exec - the pending call.
   * @param loaded - the rules in effect.
   * @param hit - the first matching rule, or undefined for passthrough.
   * @param outcome - the final pre-execute decision.
   * @param dryRun - mark the record as a would-be decision (dry-run mode).
   */
  audit(exec: ToolExecution, loaded: LoadedRules, hit: RuleHit | undefined, outcome: DecisionOutcome, dryRun = false): void {
    if (this.config.audit === 'hits' && hit === undefined) return
    const agent = exec.agent
    if (agent === undefined) return
    try {
      ;(agent.session.append as unknown as AuditAppend)('permissionRules/decision', {
        toolName: exec.name,
        callId: exec.callId,
        source: hit === undefined ? (loaded.sources[0] ?? '') : (loaded.sources[hit.rule.sourceIndex] ?? ''),
        action: hit === undefined ? 'passthrough' : hit.rule.action,
        outcome,
        cwd: loaded.cwd,
        ...hit !== undefined ? { ruleIndex: hit.ruleIndex, reason: hit.rule.reason } : {},
        ...dryRun ? { dryRun: true as const } : {},
      }, { ignorable: true })
    } catch (error: unknown) {
      this.ctx.logger.warn(`permission-rules: audit append failed: ${String(error)}`)
    }
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
      const reloaded = this.byCwd.get(cwd)
      if (reloaded?.lastError !== undefined) return { kind: 'error', text: prose.reloadFailed(reloaded.lastError) }
      const rules = reloaded?.compiled.rules ?? []
      const source = reloaded === undefined || reloaded.sources.length === 0 ? prose.emptySource : reloaded.sources.join(', ')
      return { kind: 'success', text: prose.reloaded(rules.length, source) }
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
    if (verb !== '') return { kind: 'error', text: prose.unknownArg(invocation.rawInput.trim()) }
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
      lines.push(...loaded.compiled.rules.map(rule => describeRule(rule, DESCRIBE_TOKENS[this.config.language])))
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
   * `when.env` matching, and `--agent <selector>` (repeatable) supplies
   * agent-identity candidates for the `agents` dimension. The JSON
   * argument tail is kept verbatim, so quoted JSON survives unchanged.
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
      platform: process.platform,
      env: Object.keys(envOverrides).length === 0 ? process.env : { ...process.env, ...envOverrides },
      agents: agentSelectors.length > 0 ? agentSelectors : agentCandidates(invocation.agent),
    }
    const hit = matchRules(loaded.compiled, tool, args, evalCwd, context)
    return {
      kind: 'success',
      text: hit === undefined ? prose.testNoMatch(tool) : prose.testHit(tool, hit.ruleIndex, hit.rule.action, hit.rule.reason),
    }
  }

  /** Render the session's `permissionRules/decision` audit trail, newest last. */
  private decisionsCommand(invocation: CommandInvocation, count: number, prose: UiProse): CommandResult {
    const decisions = invocation.agent.session.events.filter(event => event.type === 'permissionRules/decision')
    if (decisions.length === 0) return { kind: 'success', text: prose.noDecisions }
    const shown = decisions.slice(-count)
    const lines = [prose.decisionsHeader(shown.length, decisions.length)]
    for (const event of shown) {
      const data = event.data as AuditDecision
      lines.push(prose.decisionLine(event.seq, data.action, data.toolName, data.ruleIndex, data.reason, data.dryRun === true, data.outcome))
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
   * long-running hosts cannot accumulate stale watchers. An empty chain (no
   * rule file in effect) keeps the previous watchers alive: they own the
   * "file recreated → adopted" signal, and the workspace-cache bound keeps
   * the set of such watchers finite.
   */
  private reconcileWatch(cwd: string, sources: readonly string[]): void {
    if (sources.length === 0) return
    for (const [watchedSource, entry] of this.watchers) {
      if (!sources.includes(watchedSource)) entry.cwds.delete(cwd)
    }
    this.pruneWatchers()
    for (const source of sources) this.attachWatch(cwd, source)
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
    for (const entry of this.watchers.values()) entry.cwds.delete(oldest)
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

  /** Debounce watch events into one reload per stability window. */
  private scheduleReload(source: string): void {
    const existing = this.timers.get(source)
    if (existing !== undefined) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.timers.delete(source)
      for (const cwd of this.watchers.get(source)?.cwds ?? []) this.reload(cwd)
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
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const runtime = new PermissionRulesRuntime(ctx, resolved)
  runtime.validateDeploymentFiles()
  ctx.provide('permissionRulesRuntime', runtime)
  ctx.on('tools/pre-execute', (exec, next) => runtime.preExecute(exec, next))
  ctx.commands.register({
    name: 'rules',
    description: 'list, reload, audit, or dry-test the active permission rules for this workspace',
    input: { hint: '[reload | decisions [n] | test [--cwd <dir>] [--env K=V] [--agent <sel>] <tool> <json-args>]' },
    handler: invocation => runtime.command(invocation),
  })
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
