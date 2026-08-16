/**
 * The client-side Remote face of the `permissionRules` namespace: the
 * hand-written `TypertRemoteContribution` mounted through
 * `ctx.remote.$mount`, plus the declaration merging that types
 * `ctx.remote.permissionRules`. The descriptor list is shared with the
 * host `./typert` manifest (`../wire.ts`), so the two faces can never
 * drift.
 * @module dsh-permission-rules/client/remote
 */

import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { PERMISSION_RULES_INVOCATIONS } from '../wire.ts'
import type { PermissionRulesSnapshot, RulesReadResult, RulesReloadResult, RulesSaveResult } from '../wire.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$permissionRules {
    /** Read the network-policy snapshot (mode, counters, recent blocks, editable rule sources). */
    networkStatus: () => Promise<RemoteResult<PermissionRulesSnapshot>>
    /** Read one known rule file for the editor. */
    rulesRead: (path: string) => Promise<RemoteResult<RulesReadResult>>
    /** Validate and write one known rule file. */
    rulesSave: (path: string, text: string) => Promise<RemoteResult<RulesSaveResult>>
    /** Re-read every cached workspace chain. */
    reload: () => Promise<RemoteResult<RulesReloadResult>>
  }
  interface TypertRemoteMap {
    'permissionRules/networkStatus': () => Promise<RemoteResult<PermissionRulesSnapshot>>
    'permissionRules/rulesRead': (path: string) => Promise<RemoteResult<RulesReadResult>>
    'permissionRules/rulesSave': (path: string, text: string) => Promise<RemoteResult<RulesSaveResult>>
    'permissionRules/reload': () => Promise<RemoteResult<RulesReloadResult>>
  }
  interface TypertRemoteNamespaceMap {
    permissionRules: TypertRemoteNamespace$permissionRules
  }
}

/** The client Remote contribution for the `permissionRules` namespace. */
export const PERMISSION_RULES_REMOTE = Object.freeze({
  package: 'dsh-permission-rules',
  descriptors: PERMISSION_RULES_INVOCATIONS,
} satisfies TypertRemoteContribution)
