/**
 * Durable session vocabulary for `dsh-permission-rules`: the
 * `permissionRules/decision` audit event, appended for every hit AND every
 * passthrough. Log-only — it never enters the model transcript; the only
 * model-visible plugin content is the deny/ask reason the tools registry
 * materializes into the denied tool result, which carries the same
 * `callId`, keeping model-visible ⟺ logged reconstructable.
 *
 * `outcome` records the FINAL pre-execute decision: on a deny/ask hit it
 * equals `action` (the plugin short-circuits); on an allow hit or a
 * passthrough it carries the downstream listeners' decision, so the audit
 * never claims a call was allowed when a later listener denied it.
 *
 * Under `enforce: false` (dry-run mode) the plugin matches but NEVER
 * short-circuits: the record keeps the WOULD-BE `action` and marks
 * `dryRun: true`, while `outcome` carries what actually happened
 * downstream — an auditable "what would the policy have done" trail.
 *
 * The event is appended with the envelope's `ignorable: true` marker (see
 * {@link AuditAppend}). Harness builds that honor the marker (post-rc.6)
 * stamp it on the envelope and skip unknown ignorable records when loading,
 * so the audit can never refuse a session. Builds whose `Session.append`
 * predates the marker — the `0.1.0-rc.6` line — silently DROP the options
 * bag: the event then lands UNMARKED and makes the session unresumable on
 * hosts with required-on-read semantics (`SessionFormatUnsupportedError`).
 * The runtime detects this at first use (peer version pre-check plus a
 * probe of the appended envelope) and disables session-log audit on such
 * hosts with a one-time warning; `allowUnmarkedAudit: true` opts back in,
 * and `scripts/repair-session-logs.mjs` repairs already-polluted logs.
 * @module dsh-permission-rules/events
 */

import type { CallId } from '@deepseek-ai/dsh-llm'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One permission-rules decision for a pending tool call — log-only
     * audit (like `approval/asked`; NOT a surface event). `action` is
     * `'allow' | 'deny' | 'ask' | 'passthrough'`; `ruleIndex` (0-based) and
     * `reason` appear only on hits. `source` is the absolute rule file of
     * the matched rule, or the nearest effective file on a passthrough, or
     * `''` when no rule file was active. `outcome` is the final pre-execute
     * decision the waterfall settled on. `cwd` names the workspace the
     * rules were resolved for. `dryRun` marks audit-only dry-run records
     * (`enforce: false`): the plugin matched but did not enforce.
     */
    'permissionRules/decision': {
      toolName: string
      callId?: CallId
      source: string
      action: 'allow' | 'deny' | 'ask' | 'passthrough'
      outcome?: 'allow' | 'deny' | 'ask'
      ruleIndex?: number
      reason?: string
      cwd: string
      dryRun?: true
    }
  }
}

/** Every action a decision event can carry. */
export type DecisionAction = 'allow' | 'deny' | 'ask' | 'passthrough'

/** The final pre-execute decision kinds a host can settle on. */
export type DecisionOutcome = PreToolDecision['kind']

/** The payload of one `permissionRules/decision` audit record. */
export interface AuditDecision {
  toolName: string
  callId?: CallId
  source: string
  action: DecisionAction
  outcome?: DecisionOutcome
  ruleIndex?: number
  reason?: string
  /** The workspace cwd the rule chain was resolved for. */
  cwd: string
  /** `true` on dry-run records (`enforce: false`) — matched but never enforced. */
  dryRun?: true
}

/**
 * `Session.append` narrowed to this plugin's audit event. The options bag
 * exists only on host builds that expose the `ignorable` envelope-marker
 * surface (post-rc.6 `@deepseek-ai/dsh-session`); an rc.6 host accepts the
 * call but silently drops the third argument — the event is appended
 * WITHOUT the marker, which is exactly what breaks later resume on stricter
 * hosts. The runtime treats the marker as optional-but-probed: see
 * {@link isMarkedAuditEvent}.
 */
export type AuditAppend = (
  type: 'permissionRules/decision',
  data: AuditDecision,
  options?: { ignorable?: true },
) => unknown

/**
 * Whether an `append` call actually honored the `ignorable` marker: the
 * logged event returned by the host carries `ignorable === true` on
 * marker-aware builds and nothing on pre-marker builds. `false` (or any
 * non-event return) means the host dropped the marker and the event landed
 * unmarked — the runtime then degrades instead of polluting further logs.
 * @param result - the return value of the audit append.
 * @returns true only when the marker is present on the returned envelope.
 */
export function isMarkedAuditEvent(result: unknown): boolean {
  return typeof result === 'object' && result !== null && (result as { ignorable?: unknown }).ignorable === true
}
