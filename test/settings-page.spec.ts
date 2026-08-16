/**
 * Settings-section attachment tests: `attachSettingsSection` registers the
 * whole plugin config under the `permission-rules` namespace with the
 * live/exposed options, points the runtime's config source at the resolved
 * scope, re-runs `resolveConfig` on every write (out-of-range values are
 * refused), and rebinds the network proxy only when a bind/env-relevant
 * knob actually changed. On hosts without a settings service nothing
 * registers and the composition entry keeps serving the config.
 * @module dsh-permission-rules/test/settings-page
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Config } from '../src/config.ts'
import type { ResolvedConfig } from '../src/config.ts'
import type { PermissionRulesRuntime } from '../src/runtime.ts'
import { SETTINGS_NAMESPACE, attachSettingsSection } from '../src/settings.ts'

/** One recorded `register()` call, mirroring the structural settings-provider shape. */
interface SettingsRegistration {
  readonly ns: string
  readonly schema: unknown
  readonly options: {
    base?: unknown
    expose?: boolean
    applies?: string
    validate?: (value: Record<string, unknown>) => void
  }
}

/** A structural stand-in for `ctx.settings`: records registrations and replays watch callbacks. */
class FakeSettings {
  readonly registrations: SettingsRegistration[] = []
  private readonly listeners: ((next: unknown, prev: unknown) => void | Promise<void>)[] = []

  constructor(private value: Record<string, unknown>) {}

  register(ns: string, schema: unknown, options: SettingsRegistration['options'] = {}): { get(): Record<string, unknown>; watch(callback: (next: unknown, prev: unknown) => void | Promise<void>): () => void } {
    this.registrations.push({ ns, schema, options })
    return {
      get: () => this.value,
      watch: callback => {
        this.listeners.push(callback)
        return () => {
          const index = this.listeners.indexOf(callback)
          if (index >= 0) this.listeners.splice(index, 1)
        }
      },
    }
  }

  set(value: Record<string, unknown>): void {
    this.value = value
  }

  fire(next: Record<string, unknown>, prev: Record<string, unknown>): void {
    for (const listener of this.listeners) void listener(next, prev)
  }
}

/** A runtime stand-in recording the config source and the rebind calls. */
function fakeRuntime(): { runtime: PermissionRulesRuntime; source: { current?: () => ResolvedConfig }; rebind: ReturnType<typeof vi.fn> } {
  const source: { current?: () => ResolvedConfig } = {}
  const rebind = vi.fn(async () => undefined)
  const runtime = {
    setConfigSource: (next: () => ResolvedConfig): void => {
      source.current = next
    },
    onNetworkConfigChanged: rebind,
  } as unknown as PermissionRulesRuntime
  return { runtime, source, rebind }
}

describe('attachSettingsSection', () => {
  it('registers the namespace with the Config schema and live/exposed options, then binds the config source', async () => {
    const ctx = new Context()
    const provider = new FakeSettings({ language: 'en' })
    ctx.provide('settings', provider as never)
    const { runtime, source } = fakeRuntime()
    const entry = { rulesFile: '.dsh/rules.yaml' }
    attachSettingsSection(ctx, runtime, entry)
    await vi.waitFor(() => expect(provider.registrations).toHaveLength(1))

    const registration = provider.registrations[0]
    expect(registration?.ns).toBe(SETTINGS_NAMESPACE)
    expect(registration?.ns).toBe('permission-rules')
    expect(registration?.schema).toBe(Config)
    expect(registration?.options).toMatchObject({ base: entry, expose: true, applies: 'live' })
    expect(typeof registration?.options.validate).toBe('function')

    // The runtime config source follows the scope's value, resolved like a mount config.
    expect(source.current).toBeDefined()
    expect(source.current?.().language).toBe('en')
    provider.set({ language: 'zh', network: { mode: 'deny-all', proxyPort: 0 } })
    expect(source.current?.().language).toBe('zh')
    expect(source.current?.().network.mode).toBe('deny-all')
    expect(source.current?.().network.proxyPort).toBe(0)
  })

  it('re-runs resolveConfig on save, so out-of-range stored values are refused', async () => {
    const ctx = new Context()
    const provider = new FakeSettings({})
    ctx.provide('settings', provider as never)
    const { runtime } = fakeRuntime()
    attachSettingsSection(ctx, runtime, {})
    await vi.waitFor(() => expect(provider.registrations).toHaveLength(1))
    const validate = provider.registrations[0]?.options.validate
    expect(validate).toBeDefined()
    expect(() => validate?.({ network: { proxyPort: 99999 } })).toThrow(TypeError)
    expect(() => validate?.({ maxRules: 0 })).toThrow(TypeError)
    expect(() => validate?.({ language: 'xx' })).toThrow(TypeError)
    expect(() => validate?.({ network: { proxyPort: 0, mode: 'allow-all' } })).not.toThrow()
  })

  it('rebinds the network proxy only when a bind/env-relevant knob changed', async () => {
    const ctx = new Context()
    const provider = new FakeSettings({})
    ctx.provide('settings', provider as never)
    const { runtime, rebind } = fakeRuntime()
    attachSettingsSection(ctx, runtime, {})
    await vi.waitFor(() => expect(provider.registrations).toHaveLength(1))

    provider.fire({ network: { proxyPort: 9000 } }, { network: { proxyPort: 0 } })
    provider.fire({ network: { proxyBind: '127.0.0.2' } }, { network: { proxyBind: '127.0.0.1' } })
    provider.fire({ network: { injectEnv: true } }, { network: { injectEnv: false } })
    provider.fire({ network: { noProxy: 'preserve' } }, { network: { noProxy: 'clear' } })
    expect(rebind).toHaveBeenCalledTimes(4)

    // A pure mode change needs no rebind — web-tool gating reads config per call.
    provider.fire({ network: { mode: 'deny-all' } }, { network: { mode: 'allow-all' } })
    provider.fire({ mode: 'allow-all' }, { mode: 'deny-all' })
    expect(rebind).toHaveBeenCalledTimes(4)
  })

  it('registers nothing and leaves the composition config in charge when settings is absent', async () => {
    const ctx = new Context()
    const { runtime, source } = fakeRuntime()
    attachSettingsSection(ctx, runtime, {})
    // The inject plugin never activates without the service; ticks settle any queued work.
    await Promise.resolve()
    await Promise.resolve()
    expect(source.current).toBeUndefined()
    expect(runtime).toBeDefined()
  })

  it('tolerates a settings service whose resolved value is undefined (nothing registers)', async () => {
    const ctx = new Context()
    ctx.provide('settings', undefined as never)
    const { runtime, source } = fakeRuntime()
    attachSettingsSection(ctx, runtime, {})
    await Promise.resolve()
    await Promise.resolve()
    expect(source.current).toBeUndefined()
    expect(runtime).toBeDefined()
  })
})
