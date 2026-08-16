/**
 * The settings-page Remote service: exposes the `permissionRules` Typert
 * namespace (network snapshot + rule-file read/save/reload) to the
 * browser half. All state lives in the {@link PermissionRulesRuntime}
 * this service delegates to; the service itself only bridges the wire
 * vocabulary. The rule editor only ever touches KNOWN rule sources —
 * arbitrary paths are refused by the runtime.
 * @module dsh-permission-rules/remote-service
 */

import { existsSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { PermissionRulesRuntime } from './runtime.ts'
import type { PermissionRulesSnapshot, RulesReadResult, RulesReloadResult, RulesSaveResult } from './wire.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Settings-page snapshot + rule-editor bridge (this package). */
    permissionRules: PermissionRulesRemoteService
  }
}

/** Service config: the runtime instance whose state the wire exposes. */
export interface PermissionRulesRemoteServiceConfig {
  /** The runtime holding the loaded rules, proxy state, and block records. */
  runtime: PermissionRulesRuntime
}

/**
 * The Typert Remote service behind the settings page. Registered through
 * `ctx.plugin(PermissionRulesRemoteService, { runtime })` in
 * {@link apply}; the typert gateway binds its public methods to the
 * invocation descriptors in `./wire.ts`.
 */
export class PermissionRulesRemoteService extends TypertRemoteService {
  static inject = [] as string[]

  constructor(ctx: Context, private readonly config: PermissionRulesRemoteServiceConfig) {
    super(ctx, 'permissionRules')
  }

  /** The settings-page snapshot: mode mapping, proxy liveness, counters, recent blocks, editable rule sources. */
  networkStatus(): PermissionRulesSnapshot {
    const snapshot = this.config.runtime.networkSnapshot()
    const sources = this.config.runtime.knownRuleSources().map(path => {
      const owner = this.config.runtime.sourceOwner(path)
      return { path, exists: existsSync(path), cwd: owner ?? null }
    })
    return {
      enabled: snapshot.enabled,
      mode: snapshot.mode,
      configuredMode: snapshot.configuredMode,
      sandboxMode: snapshot.sandboxMode ?? null,
      proxyPort: snapshot.proxyPort,
      proxyActive: snapshot.proxyActive,
      denied: snapshot.denied,
      askBlocked: snapshot.askBlocked,
      recent: snapshot.recent.map(block => ({
        time: block.time,
        tool: block.tool,
        attributed: block.attributed,
        domain: block.domain,
        scheme: block.scheme ?? null,
        port: block.port ?? null,
        action: block.action,
        mode: block.mode,
        matched: block.matched,
        source: block.source,
        ruleIndex: block.ruleIndex ?? null,
        reason: block.reason ?? null,
      })),
      sources,
    }
  }

  /** Read one known rule file for the editor. */
  rulesRead(path: string): RulesReadResult {
    const result = this.config.runtime.readRuleFile(path)
    return {
      path: result.path,
      exists: result.exists,
      text: result.text,
      error: result.error ?? null,
    }
  }

  /** Validate and write one known rule file; invalid edits are rejected before anything touches disk. */
  rulesSave(path: string, text: string): RulesSaveResult {
    const result = this.config.runtime.saveRuleFile(path, text)
    return {
      ok: result.ok,
      error: result.error ?? null,
      reloaded: result.reloaded ?? null,
    }
  }

  /** Re-read every cached workspace chain (after an external edit). */
  reload(): RulesReloadResult {
    try {
      this.config.runtime.reloadAll()
      return { ok: true, error: null }
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}

export default PermissionRulesRemoteService
