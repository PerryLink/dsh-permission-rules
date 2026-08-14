/**
 * Runtime of `dsh-permission-rules`: per-workspace rule loading (project
 * file by session cwd → fallback path → empty set), the `tools/pre-execute`
 * listener that turns a first-match hit into a deny/ask decision (and NEVER
 * short-circuits on allow or passthrough), the `permissionRules/decision`
 * audit event, the `/rules` session command, and Chokidar-driven reloads.
 * Every registration is an effect.
 * @module dsh-permission-rules/runtime
 */

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import chokidar from 'chokidar'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { resolveConfig } from './config.ts'
import type { Config, ResolvedConfig } from './config.ts'
import { compileRules, describeRule, matchRules, parseRulesDocument, RuleError } from './rules.ts'
import type { CompiledRuleset, RuleHit } from './rules.ts'
import type { AuditAppend } from './events.ts'

export const name = 'permission-rules'

/** Services required before the plugin mounts. */
export const inject = ['commands']

/** The rule state bound to one workspace cwd. */
interface LoadedRules {
  /** The workspace root these rules were resolved for. */
  readonly cwd: string
  /** Absolute path of the rule file in effect, or `''` for an empty rule set. */
  readonly source: string
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
  /** Loaded (or failed) rules per workspace cwd. */
  private readonly byCwd = new Map<string, LoadedRules>()

  /** Live watchers per rule-file path, with the cwds each serves. */
  private readonly watchers = new Map<string, { readonly cwds: Set<string>; readonly close: () => void }>()

  /** Debounce timers per rule-file path. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly ctx: Context,
    readonly config: ResolvedConfig,
  ) {}

  /**
   * Resolve which file serves a workspace: the project file under the
   * session cwd (or an absolute `rulesFile`), else the configured fallback,
   * else `''` (empty rule set).
   * @param cwd - the session's absolute workspace root.
   * @returns the absolute rule-file path in effect, or `''`.
   */
  resolveSource(cwd: string): string {
    const projectPath = isAbsolute(this.config.rulesFile) ? this.config.rulesFile : join(cwd, this.config.rulesFile)
    if (existsSync(projectPath)) return projectPath
    const fallback = this.config.fallbackPath
    if (fallback !== undefined) {
      const fallbackPath = isAbsolute(fallback) ? fallback : resolve(fallback)
      if (existsSync(fallbackPath)) return fallbackPath
    }
    return ''
  }

  /**
   * Read, parse, and compile the rule file serving `cwd`. Under
   * `badFilePolicy: 'ignore-with-warning'` a bad file degrades to an empty
   * rule set with a warning and keeps its source path (so a later fix is
   * watched and adopted); under `'fail'` it throws.
   * @param cwd - the workspace root.
   * @returns the loaded state.
   */
  load(cwd: string): LoadedRules {
    const source = this.resolveSource(cwd)
    if (source === '') return { cwd, source: '', compiled: { rules: [] } }
    try {
      const doc = parseRulesDocument(readFileSync(source, 'utf8'))
      const compiled = compileRules(doc, { patternMode: this.config.patternMode, maxRules: this.config.maxRules })
      return { cwd, source, compiled }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (this.config.badFilePolicy === 'ignore-with-warning') {
        this.ctx.logger.warn(`permission-rules: ignoring ${source}: ${message} (empty rule set)`)
        return { cwd, source, compiled: { rules: [] }, lastError: message }
      }
      throw error instanceof RuleError ? error : new RuleError(`cannot load ${source}: ${message}`)
    }
  }

  /**
   * The rules in effect for one cwd, loading on first use. Under
   * `badFilePolicy: 'fail'` a bad initial load throws on EVERY use (the
   * pending tool call errors loudly) while the watcher keeps observing the
   * file so a fix reloads into active rules.
   * @param cwd - the workspace root.
   * @returns the loaded rules.
   */
  rulesFor(cwd: string): LoadedRules {
    const existing = this.byCwd.get(cwd)
    if (existing !== undefined) {
      if (existing.failed === true) {
        throw new RuleError(existing.lastError ?? `rule load failed for ${cwd}`)
      }
      return existing
    }
    try {
      const loaded = this.load(cwd)
      this.byCwd.set(cwd, loaded)
      this.attachWatch(cwd, loaded.source)
      return loaded
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const source = this.resolveSource(cwd)
      this.byCwd.set(cwd, { cwd, source, compiled: { rules: [] }, lastError: message, failed: true })
      this.attachWatch(cwd, source)
      throw error
    }
  }

  /**
   * Re-read the rule file for one cwd (watch-driven or `/rules reload`).
   * A bad file NEVER crashes the process: the previous rules stay active,
   * the error is logged and reported on the next `/rules` output.
   * @param cwd - the workspace root.
   */
  reload(cwd: string): void {
    const previous = this.byCwd.get(cwd)
    try {
      const loaded = this.load(cwd)
      this.byCwd.set(cwd, loaded)
      this.attachWatch(cwd, loaded.source)
      this.ctx.logger.info(`permission-rules: reloaded ${loaded.compiled.rules.length} rule(s) from ${loaded.source || '(empty rule set)'} for ${cwd}`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn(`permission-rules: reload failed for ${cwd}: ${message} (keeping previous rules)`)
      if (previous !== undefined) this.byCwd.set(cwd, { ...previous, lastError: message })
      else this.byCwd.set(cwd, { cwd, source: this.resolveSource(cwd), compiled: { rules: [] }, lastError: message, failed: true })
    }
  }

  /**
   * The `tools/pre-execute` listener. A deny/ask hit returns the decision
   * (first match wins, short-circuiting downstream listeners); an allow hit
   * and a passthrough MUST delegate via `next()` so later listeners keep
   * their say. Audit is appended before the decision is returned.
   * @param exec - the pending call (name, parsed arguments, caller agent).
   * @param next - the downstream chain.
   * @returns the pre-execute decision.
   */
  preExecute(exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> {
    const cwd = exec.agent?.session.header.cwd ?? process.cwd()
    const loaded = this.rulesFor(cwd)
    const hit = matchRules(loaded.compiled, exec.name, exec.arguments, cwd)
    this.audit(exec, loaded, hit)
    if (hit === undefined) return next()
    if (hit.rule.action === 'allow') return next()
    if (hit.rule.action === 'deny') return Promise.resolve({ kind: 'deny', reason: hit.rule.reason })
    return Promise.resolve({ kind: 'ask', reason: hit.rule.reason })
  }

  /**
   * Append the log-only `permissionRules/decision` audit event for every
   * hit AND every passthrough, requesting the envelope's `ignorable: true`
   * marker so any harness build can load the log (readers that do not know
   * the type skip the audit record instead of refusing the session).
   * Agentless calls have no session to audit; append failures are contained
   * so an audit hiccup can never change a permission decision.
   * @param exec - the pending call.
   * @param loaded - the rules in effect.
   * @param hit - the first matching rule, or undefined for passthrough.
   */
  audit(exec: ToolExecution, loaded: LoadedRules, hit: RuleHit | undefined): void {
    const agent = exec.agent
    if (agent === undefined) return
    try {
      ;(agent.session.append as unknown as AuditAppend)('permissionRules/decision', {
        toolName: exec.name,
        callId: exec.callId,
        source: loaded.source,
        action: hit === undefined ? 'passthrough' : hit.rule.action,
        ...hit !== undefined ? { ruleIndex: hit.ruleIndex, reason: hit.rule.reason } : {},
      }, { ignorable: true })
    } catch (error: unknown) {
      this.ctx.logger.warn(`permission-rules: audit append failed: ${String(error)}`)
    }
  }

  /**
   * Execute the `/rules` command: `/rules` lists the active rules and their
   * source; `/rules reload` re-reads the file. Command output stays in the
   * UI — nothing here is injected into the model context.
   * @param invocation - the received command invocation.
   * @returns the command result shown to the user.
   */
  command(invocation: CommandInvocation): CommandResult {
    const input = invocation.rawInput.trim().toLowerCase()
    const cwd = invocation.agent.session.header.cwd ?? process.cwd()
    if (input === 'reload') {
      this.reload(cwd)
      const reloaded = this.byCwd.get(cwd)
      if (reloaded?.lastError !== undefined) {
        return {
          kind: 'error',
          text: `Reload failed: ${reloaded.lastError}. The previous rules are still active.`,
        }
      }
      const rules = reloaded?.compiled.rules ?? []
      return {
        kind: 'success',
        text: `Reloaded ${rules.length} rule(s) from ${reloaded?.source || '(no rule file — empty rule set)'}.`,
      }
    }
    if (input !== '') {
      return { kind: 'error', text: `Unknown /rules argument "${invocation.rawInput.trim()}". Usage: /rules [reload]` }
    }
    let loaded: LoadedRules
    try {
      loaded = this.rulesFor(cwd)
    } catch (error: unknown) {
      return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
    }
    const lines: string[] = []
    if (loaded.source === '') {
      lines.push(`No permission rules active: no rule file found for workspace ${cwd}${this.config.fallbackPath !== undefined ? ' (and the configured fallback path is missing)' : ''}; the empty rule set passes everything through.`)
    } else {
      lines.push(`Permission rules: ${loaded.compiled.rules.length} rule(s) from ${loaded.source} (workspace ${cwd}).`)
      lines.push(...loaded.compiled.rules.map(rule => describeRule(rule)))
    }
    if (loaded.lastError !== undefined) {
      lines.push(`Warning: the last reload failed (${loaded.lastError}); the rules listed above are the previous ones.`)
    }
    lines.push('Usage: /rules [reload]')
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
      compileRules(doc, { patternMode: this.config.patternMode, maxRules: this.config.maxRules })
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
  ctx.on('tools/pre-execute', (exec, next) => runtime.preExecute(exec, next))
  ctx.commands.register({
    name: 'rules',
    description: 'list or reload the active permission rules for this workspace',
    input: { hint: '[reload]' },
    handler: invocation => runtime.command(invocation),
  })
}
