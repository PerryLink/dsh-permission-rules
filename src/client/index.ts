/**
 * `dsh-permission-rules`, browser half: mounts the `permissionRules`
 * Remote contribution, then registers the "Permission Rules" settings
 * page (`settings.section`, id `permission-rules`) with the network-policy
 * summary, block counters, the recent interception list, and the rule
 * editor. All data arrives through the `remote.permissionRules`
 * namespace — the page issues no other RPC.
 *
 * The slot and remote services are accessed structurally (through
 * `ctx.get`/`ctx.inject`) so this bundle compiles against the published
 * rc.6 client peers without hard value imports beyond the platform
 * modules.
 * @module dsh-permission-rules/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { PERMISSION_RULES_REMOTE } from './remote.ts'
import { PermissionRulesSection } from './section.ts'
import type { PermissionRulesSectionInjected } from './section.ts'
import { en, zh, type PermissionRulesLocaleKey } from './locales.ts'
import type { PermissionRulesSnapshot, RulesReadResult, RulesReloadResult, RulesSaveResult } from '../wire.ts'

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.permissionRules'

/** Plugin name: matches the package name, the graph row id, and the bundle id. */
export const name = 'dsh-permission-rules'

/** Services the page reads; `remote.permissionRules` appears once this plugin mounts its contribution. */
export const inject = ['slots', 'locale', 'remote']

/** The locale registry face (structural; the real `ctx.locale` satisfies it). */
interface LocaleLike {
  register(namespace: string, dictionaries: { en: Record<string, string>; zh: Record<string, string> }): void
  bind(namespace: string): (key: PermissionRulesLocaleKey, vars?: Record<string, string | number>) => string
}

/** The remote-contribution host face (structural; the real `ctx.remote` satisfies it). */
interface RemoteLike {
  $mount(contribution: unknown): Promise<void>
}

/** The slots registry face (structural; the real `ctx.slots` satisfies it). */
interface SlotsLike {
  inject(slot: string, register: () => unknown): void
  register(options: object, component: unknown): unknown
}

/**
 * Browser plugin body: dictionaries, the Remote contribution mount, and
 * the settings-section registration.
 * @param ctx - client root context.
 */
export async function apply(ctx: Context): Promise<void> {
  const locale = ctx.get('locale') as LocaleLike | undefined
  const remote = ctx.get('remote') as RemoteLike | undefined
  const slots = ctx.get('slots') as SlotsLike | undefined
  if (locale === undefined || remote === undefined || slots === undefined) return

  ctx.effect(() => {
    locale.register(NS, { zh, en })
    return () => {}
  })

  // $mount registers the 'remote.permissionRules' namespace service and owns
  // its removal for this fiber's lifetime.
  await remote.$mount(PERMISSION_RULES_REMOTE)

  ctx.inject(['remote.permissionRules'], (scope) => {
    const t = locale.bind(NS)
    const bridge = scope.get('remote.permissionRules') as {
      networkStatus: () => Promise<RemoteResult<PermissionRulesSnapshot>>
      rulesRead: (path: string) => Promise<RemoteResult<RulesReadResult>>
      rulesSave: (path: string, text: string) => Promise<RemoteResult<RulesSaveResult>>
      reload: () => Promise<RemoteResult<RulesReloadResult>>
    } | undefined
    if (bridge === undefined) return
    const injected = (): PermissionRulesSectionInjected => ({
      status: async () => {
        const result = await bridge.networkStatus()
        if (!result.ok) throw new Error(`networkStatus failed: ${result.error.code}: ${result.error.message}`)
        return result.value
      },
      rulesRead: async (path) => {
        const result = await bridge.rulesRead(path)
        if (!result.ok) throw new Error(`rulesRead failed: ${result.error.code}: ${result.error.message}`)
        return result.value
      },
      rulesSave: async (path, text) => {
        const result = await bridge.rulesSave(path, text)
        if (!result.ok) throw new Error(`rulesSave failed: ${result.error.code}: ${result.error.message}`)
        return result.value
      },
      reload: async () => {
        const result = await bridge.reload()
        if (!result.ok) throw new Error(`reload failed: ${result.error.code}: ${result.error.message}`)
        return result.value
      },
      t,
    })
    slots.inject('settings.section', () => slots.register({
      name: 'settings.section',
      id: 'permission-rules',
      order: 20,
      label: () => t('nav'),
      locale: NS,
      inject: injected,
    }, PermissionRulesSection))
  })
}
