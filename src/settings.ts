/**
 * Host-side settings-namespace wiring: registers the whole plugin config
 * as the `permission-rules` settings section (editable from the Web
 * settings surface, loopback-only), keeps the runtime's config source
 * pointed at the resolved section, and rebinds the network proxy when a
 * bind/env-relevant knob changes live. On hosts without a settings
 * service (the rc.6 line) nothing registers and the composition entry
 * keeps serving the config — the plugin stays fully functional.
 *
 * The registration uses only structural interfaces: `@deepseek-ai/
 * dsh-settings` is not an rc.6 peer, so importing it would hard-fail
 * older hosts; the real service satisfies these shapes.
 * @module dsh-permission-rules/settings
 */

import type { Context } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'
import { Config, resolveConfig } from './config.ts'
import type { Config as PluginConfig, ResolvedConfig } from './config.ts'
import type { PermissionRulesRuntime } from './runtime.ts'

/** The settings namespace this plugin owns (kebab-case, per the provider contract). */
export const SETTINGS_NAMESPACE = 'permission-rules'

/** The owner-facing scope the real settings service hands back. */
interface SettingsScopeLike<T> {
  get(): T
  watch(callback: (next: T, prev: T) => void | Promise<void>): () => void
}

/** The structural settings-provider shape the real `ctx.settings` satisfies. */
interface SettingsProviderLike {
  register<T>(ns: string, schema: z<T>, options?: {
    base?: Partial<T>
    expose?: boolean
    applies?: string
    validate?: (value: T) => void
  }): SettingsScopeLike<T>
}

/**
 * Register the settings section and bind the runtime's live config
 * source. Runs only where a settings service is composed.
 * @param ctx - the plugin context.
 * @param runtime - the runtime whose config source follows the section.
 * @param entry - the composition entry config (the section's `base` layer).
 */
export function attachSettingsSection(ctx: Context, runtime: PermissionRulesRuntime, entry: PluginConfig): void {
  ctx.inject(['settings'], (scope) => {
    const settings = scope.get('settings') as SettingsProviderLike | undefined
    if (settings === undefined) return
    const registration = settings.register<PluginConfig>(SETTINGS_NAMESPACE, Config as z<PluginConfig>, {
      base: entry,
      expose: true,
      applies: 'live',
      validate: (value: PluginConfig) => {
        // Schemastery already enforced the closed enums; this re-runs the
        // numeric-bounds checks so an out-of-range stored value is refused
        // at write time instead of disabling the owner later.
        resolveConfig(value)
      },
    })
    runtime.setConfigSource(() => resolveConfig(registration.get()))
    registration.watch((next, prev) => {
      const nextConfig = resolveConfig(next) as ResolvedConfig
      const prevConfig = resolveConfig(prev) as ResolvedConfig
      const rebind = nextConfig.network.proxyPort !== prevConfig.network.proxyPort
        || nextConfig.network.proxyBind !== prevConfig.network.proxyBind
        || nextConfig.network.injectEnv !== prevConfig.network.injectEnv
        || nextConfig.network.noProxy !== prevConfig.network.noProxy
      if (rebind) void runtime.onNetworkConfigChanged()
    })
  })
}
