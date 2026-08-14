/**
 * Durable session vocabulary for `dsh-permission-rules`: the
 * `permissionRules/decision` audit event, appended for every hit AND every
 * passthrough. Log-only — it never enters the model transcript; the only
 * model-visible plugin content is the deny/ask reason the tools registry
 * materializes into the denied tool result, which carries the same
 * `callId`, keeping model-visible ⟺ logged reconstructable.
 *
 * The event is appended with the envelope's `ignorable: true` marker (see
 * {@link AuditAppend}), so a harness build whose generated event vocabulary
 * does not include this out-of-repo type still loads the log — it skips the
 * audit record instead of refusing the whole session.
 * @module dsh-permission-rules/events
 */

import type { CallId } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One permission-rules decision for a pending tool call — log-only
     * audit (like `approval/asked`; NOT a surface event). `action` is
     * `'allow' | 'deny' | 'ask' | 'passthrough'`; `ruleIndex` (0-based) and
     * `reason` appear only on hits. `source` is the absolute rule file
     * path in effect, or `''` when no rule file was active.
     */
    'permissionRules/decision': {
      toolName: string
      callId?: CallId
      source: string
      action: 'allow' | 'deny' | 'ask' | 'passthrough'
      ruleIndex?: number
      reason?: string
    }
  }
}

/** Every action a decision event can carry. */
export type DecisionAction = 'allow' | 'deny' | 'ask' | 'passthrough'

/** The payload of one `permissionRules/decision` audit record. */
export interface AuditDecision {
  toolName: string
  callId?: CallId
  source: string
  action: DecisionAction
  ruleIndex?: number
  reason?: string
}

/**
 * `Session.append` narrowed to this plugin's audit event. The options bag
 * exists only on host builds that expose the `ignorable` envelope-marker
 * surface (post-rc.6 `@deepseek-ai/dsh-session`); an rc.6 host accepts and
 * ignores the third argument, appending the identical event without the
 * marker — no behavior change, no failure either way.
 */
export type AuditAppend = (
  type: 'permissionRules/decision',
  data: AuditDecision,
  options?: { ignorable?: true },
) => unknown
