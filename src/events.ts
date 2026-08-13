/**
 * Durable session vocabulary for `dsh-permission-rules`: the
 * `permissionRules/decision` audit event, appended for every hit AND every
 * passthrough. Log-only — it never enters the model transcript; the only
 * model-visible plugin content is the deny/ask reason the tools registry
 * materializes into the denied tool result, which carries the same
 * `callId`, keeping model-visible ⟺ logged reconstructable.
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
