/**
 * Host-side live-configuration wiring for the `0.1.7-alpha` settings
 * contract. The plugin's Config fields are declared `.volatile()`, the
 * Loader hands `apply` one live reference per field, and the settings
 * surface edits those references in place. This module therefore owns three
 * things and nothing else: it tells the settings service that this plugin
 * ships its OWN page (so no automatic form is generated for it), it keeps
 * the runtime's config source pointed at the CURRENT reference values, and
 * it rebinds the network proxy when a bind/env-relevant knob changes live.
 *
 * There is no registration any more: the namespace of a settings form is the
 * profile entry id, chosen by the composition, not by the plugin. The
 * service is still reached structurally (`ctx.inject(['settings'])` plus
 * `ctx.get('settings')`) because `@deepseek-ai/dsh-settings` is not a
 * dependency of this package — on a host without it nothing registers and
 * the composition entry keeps serving the config, because the references
 * ARE the entry's own values.
 * @module dsh-permission-rules/settings
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: merges the Loader's `loader/volatile-update` event into `Events`.
// It is a devDependency (the Loader is composed by the host), and the import is
// erased, so nothing is required at runtime — a host whose Loader predates the
// event simply never emits it, and this plugin has nothing to reconcile then.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { resolveConfig } from './config.ts'
import type { LiveConfig, ResolvedConfig } from './config.ts'
import type { PermissionRulesRuntime } from './runtime.ts'

/**
 * The structural settings-service face this plugin uses. The real
 * `ctx.settings` is a `SettingsForms` service; only `configure` is read, and
 * only through this shape, so an older or replaced service is tolerated.
 */
interface SettingsLike {
  configure(presentation: { auto?: boolean }, owner: unknown): () => void
}

/**
 * Point the runtime's live config source at the Loader's references and
 * register this instance's settings-page policy.
 * @param ctx - the plugin context.
 * @param runtime - the runtime whose config source follows the references.
 * @param config - the Loader-delivered live config (references to the entry's values).
 */
export function attachSettingsSection(ctx: Context, runtime: PermissionRulesRuntime, config: LiveConfig): void {
  ctx.inject(['settings'], (scope) => {
    const settings = scope.get('settings') as SettingsLike | undefined
    if (settings?.configure === undefined) return
    // The policy belongs to THIS plugin instance's fiber, and riding an effect
    // means a late-loading or replaced Settings service still picks it up and
    // an unload withdraws it.
    scope.effect(() => settings.configure({ auto: false }, ctx.fiber))
  })

  // LAZY on purpose: `resolveConfig` unwraps the references on every call, so
  // a live edit is visible to the very next read. Resolving once here instead
  // would freeze the config at mount and silently break every later change —
  // which is exactly what the rebind listener below exists to serve.
  runtime.setConfigSource(() => resolveConfig(config))

  // A volatile-only update does NOT remount the plugin (the Loader commits the
  // references and emits), so every bind-time side effect has to be
  // reconciled here. Only the four knobs below decide the proxy's socket, its
  // injected environment, and the NO_PROXY policy; every other field is read
  // live through the config source, so a mode or rule-file change needs no
  // work at all.
  let previous = resolveConfig(config)
  ctx.on('loader/volatile-update', () => {
    let next: ResolvedConfig
    try {
      next = resolveConfig(config)
    } catch (error: unknown) {
      // Every reference is already committed when this fires, and the Loader
      // catches and warns on a listener throw anyway — reporting it in this
      // plugin's own vocabulary is the only signal an operator gets that a
      // live edit left the config unusable.
      ctx.logger.warn(`permission-rules: live config update is not usable: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const rebind = next.network.proxyPort !== previous.network.proxyPort
      || next.network.proxyBind !== previous.network.proxyBind
      || next.network.injectEnv !== previous.network.injectEnv
      || next.network.noProxy !== previous.network.noProxy
    previous = next
    if (rebind) void runtime.onNetworkConfigChanged()
  })
}
