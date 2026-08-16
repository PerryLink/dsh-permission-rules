/**
 * Pure network-policy orchestration shared by the `tools/pre-execute` gate
 * and the local HTTP/CONNECT proxy: the three policy modes mapped onto the
 * official sandbox presets, proxy-layer first-match evaluation over the
 * loaded rule chains, and the mode-default fallback decision. No I/O, no
 * process state — unit-testable and replayable.
 * @module dsh-permission-rules/network
 */

import type { CompiledRule, CompiledRuleset, NetworkTarget } from './rules.ts'
import { matchWhen, matchTools, targetMatchesNetwork } from './rules.ts'
import type { MatchContext } from './rules.ts'

/** The three network policy modes. */
export type NetworkMode = 'deny-all' | 'whitelist' | 'allow-all'

/** Closed mode list for runtime normalization of untrusted values. */
export const NETWORK_MODES: readonly NetworkMode[] = ['deny-all', 'whitelist', 'allow-all']

/** The official file-sandbox presets the `auto` mode maps onto. */
export type SandboxModeName = 'read-only' | 'workspace-write' | 'danger-full-access'

/** How a whitelist-mode unlisted target is handled: ask (blocked at the proxy, approval seam for web tools) or deny. */
export type UnlistedAction = 'ask' | 'deny'

/**
 * Map one official sandbox preset onto its network mode, Codex-style:
 * `read-only` defaults to no network (whitelist only), `workspace-write`
 * keeps a whitelist with ask/deny for unlisted targets, and
 * `danger-full-access` opens everything (rules can still narrow it). Any
 * other value falls back to `fallback` — hosts without the sandbox-policy
 * service therefore stay permissive, preserving pre-network behavior.
 * @param sandbox - the resolved sandbox mode, or undefined.
 * @param fallback - the mode used when the preset is unknown/absent.
 * @returns the effective network mode.
 */
export function networkModeForSandbox(sandbox: string | undefined, fallback: NetworkMode): NetworkMode {
  switch (sandbox) {
    case 'read-only': return 'deny-all'
    case 'workspace-write': return 'whitelist'
    case 'danger-full-access': return 'allow-all'
    default: return fallback
  }
}

/** One rule chain the proxy evaluates (ruleset + its source-file paths for attribution). */
export interface NetworkChain {
  readonly ruleset: CompiledRuleset
  readonly sources: readonly string[]
}

/** Proxy-layer evaluation options. */
export interface NetworkDecisionOptions {
  /** The policy mode in effect (already resolved by the runtime). */
  readonly mode: NetworkMode
  /** Whitelist-mode handling of unlisted targets. */
  readonly unlisted: UnlistedAction
  /** `allow` short-circuits loopback targets before rules; `policy` evaluates them normally. */
  readonly loopback: 'allow' | 'policy'
  /** Host facts for `when` evaluation (proxy has no agent identity). */
  readonly context?: MatchContext
}

/** One network decision: a rule hit or the mode-default fallback. */
export interface NetworkDecision {
  readonly action: 'allow' | 'deny' | 'ask'
  /** Whether a rule (true) or the mode default (false) produced the decision. */
  readonly matched: boolean
  /** The mode the fallback was computed from. */
  readonly mode: NetworkMode
  readonly ruleIndex?: number
  readonly rule?: CompiledRule
  /** Source file of the matched rule, for audit attribution. */
  readonly source?: string
}

/** The default decision a mode yields for a target no rule matched. */
export function defaultDecision(mode: NetworkMode, unlisted: UnlistedAction): NetworkDecision {
  switch (mode) {
    case 'deny-all':
      return { action: 'deny', matched: false, mode }
    case 'whitelist':
      return { action: unlisted, matched: false, mode }
    case 'allow-all':
      return { action: 'allow', matched: false, mode }
  }
}

/**
 * Evaluate the network policy for one target across the loaded rule
 * chains (nearest workspace first, first match wins). Proxy-layer tool
 * attribution: a shell subprocess connection counts as `bash`/`pwsh`
 * candidates, so a rule scoped to either shell tool can fire and one
 * scoped to web tools never does. Agent identity is unknown at the proxy,
 * so agent-scoped network rules fail closed there (the pre-execute path
 * is where agents are known). Loopback targets short-circuit before any
 * rule when `loopback: 'allow'` (Codex parity: local dev servers stay
 * reachable in the read-only default).
 * @param chains - the loaded chains, insertion (nearest) order first.
 * @param target - the parsed connection/URL target.
 * @param options - mode, unlisted handling, loopback policy, host facts.
 * @returns the decision.
 */
export function decideNetworkTarget(chains: readonly NetworkChain[], target: NetworkTarget, options: NetworkDecisionOptions): NetworkDecision {
  if (options.loopback === 'allow' && isLoopbackTarget(target)) {
    return { action: 'allow', matched: false, mode: options.mode }
  }
  const context = options.context ?? {}
  for (const chain of chains) {
    for (const rule of chain.ruleset.rules) {
      if (!rule.enabled) continue
      if (rule.network === undefined) continue
      if (!matchToolsProxy(rule)) continue
      if (rule.when !== undefined && !matchWhen(rule, context)) continue
      if (!targetMatchesNetwork(target, rule.network)) continue
      return {
        action: rule.action,
        matched: true,
        mode: options.mode,
        ruleIndex: rule.index,
        rule,
        source: chain.sources[rule.sourceIndex] ?? '',
      }
    }
  }
  return defaultDecision(options.mode, options.unlisted)
}

/**
 * Tool-scope check for proxy traffic: shell subprocess connections carry
 * the `bash`/`pwsh` identity candidates (ANY match satisfies, like the
 * agents dimension); rules scoped to other tools never fire here.
 */
function matchToolsProxy(rule: CompiledRule): boolean {
  if (rule.tools.length === 0) return true
  return matchTools(rule, 'bash') || matchTools(rule, 'pwsh')
}

/** Whether a target addresses the loopback range. */
export function isLoopbackTarget(target: NetworkTarget): boolean {
  const host = target.host
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (parts === null) return false
  return parts.slice(1).every(octet => Number(octet) <= 255) && parts[1] === '127'
}

/**
 * The short structured message a blocked proxy connection receives (403
 * body for plain HTTP, CONNECT error body for tunnels). Clients such as
 * curl print it verbatim, so the model sees the reason through the shell
 * tool output. An `ask` at the proxy layer is worded as a pending-approval
 * block because the proxy has no session context for the interactive
 * approval seam.
 * @param decision - the decision that blocked the connection.
 * @returns a short text/plain message.
 */
export function blockMessage(decision: NetworkDecision): string {
  const reason = decision.rule?.reason ?? ''
  if (decision.matched) {
    const rulePart = decision.ruleIndex !== undefined ? ` by rule ${decision.ruleIndex + 1}` : ''
    if (decision.action === 'ask') {
      return `[network: blocked pending approval${rulePart}] ${reason}\n(subprocess connections cannot ride the interactive approval seam — ask your user or add an allow rule for this target)`
    }
    return `[network: denied${rulePart}] ${reason}`
  }
  switch (decision.mode) {
    case 'deny-all':
      return '[network: denied] network mode deny-all (read-only sandbox preset): only whitelisted targets are reachable'
    case 'whitelist':
      return decision.action === 'ask'
        ? '[network: blocked pending approval] whitelist mode: the target is not matched by an allow rule'
        : '[network: denied] whitelist mode: the target is not matched by an allow rule'
    case 'allow-all':
      return '[network: denied]'
  }
}
