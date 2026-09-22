/**
 * Live-configuration wiring tests for the `0.1.7-alpha` settings contract:
 * `attachSettingsSection` registers this plugin's own-page policy with the
 * settings service, keeps the runtime's config source pointed at the Loader's
 * live references (so a committed edit is visible WITHOUT rebuilding the
 * source), and rebinds the network proxy only when a bind/env-relevant knob
 * actually changed.
 *
 * The live references here are the REAL ones the schema produces, and updates
 * are committed through the same cross-realm protocol symbol the Loader uses
 * (`updateVolatile`), so what is exercised is the shipped path rather than a
 * stand-in shape.
 * @module dsh-permission-rules/test/settings-page
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Config } from '../src/config.ts'
import type { ConfigInput, LiveConfig, NetworkConfig, ResolvedConfig } from '../src/config.ts'
import type { PermissionRulesRuntime } from '../src/runtime.ts'
import { attachSettingsSection } from '../src/settings.ts'

/** The cross-realm write hook `cosmokit` puts on every live reference. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** One recorded `configure()` call from the settings service. */
interface ConfigureCall {
  readonly presentation: { auto?: boolean }
  readonly owner: unknown
}

/** A structural stand-in for the new `ctx.settings` face. */
class FakeSettings {
  readonly calls: ConfigureCall[] = []

  configure(presentation: { auto?: boolean }, owner?: unknown): () => void {
    this.calls.push({ presentation, owner })
    return () => {
      const index = this.calls.findIndex(call => call.presentation === presentation)
      if (index >= 0) this.calls.splice(index, 1)
    }
  }
}

/**
 * Commit a new raw config into the live references, exactly as the Loader's
 * `_commitVolatile` does: resolve a candidate through the same schema and
 * write each value into the running reference.
 */
function commit(config: LiveConfig, raw: ConfigInput): void {
  const next = Config(raw as never)
  for (const key of Object.keys(next) as (keyof LiveConfig)[]) {
    const source = (next[key] as { get(): unknown }).get()
    const write = (config[key] as unknown as Record<symbol, ((value: unknown) => void) | undefined>)[VOLATILE_WRITE]
    write?.(source)
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

/** Build the live config a `0.1.7-alpha` Loader would hand `apply`. */
function liveConfig(raw: ConfigInput = {}): LiveConfig {
  return Config(raw as never) as LiveConfig
}

describe('attachSettingsSection', () => {
  it('registers the own-page policy with the settings service', async () => {
    const ctx = new Context()
    const settings = new FakeSettings()
    ctx.provide('settings', settings as never)
    const { runtime } = fakeRuntime()

    attachSettingsSection(ctx, runtime, liveConfig())
    await vi.waitFor(() => expect(settings.calls).toHaveLength(1))

    // `auto: false` is what keeps the service from generating a second form:
    // this plugin ships its own settings page.
    expect(settings.calls[0]?.presentation).toEqual({ auto: false })
    expect(settings.calls[0]?.owner).toBe(ctx.fiber)
  })

  it('keeps the config source LAZY: a committed edit is visible without rebuilding it', () => {
    const ctx = new Context()
    const { runtime, source } = fakeRuntime()
    const config = liveConfig({ language: 'en' })

    attachSettingsSection(ctx, runtime, config)
    expect(source.current).toBeDefined()
    expect(source.current?.().language).toBe('en')

    const bound = source.current
    commit(config, { language: 'zh', network: { mode: 'deny-all', proxyPort: 0 } })

    // Same closure, new values: the source reads the references on every call.
    expect(source.current).toBe(bound)
    expect(source.current?.().language).toBe('zh')
    expect(source.current?.().network.mode).toBe('deny-all')
    expect(source.current?.().network.proxyPort).toBe(0)
  })

  it('rebinds the network proxy only when a bind/env-relevant knob changed', () => {
    const ctx = new Context()
    const { runtime, rebind } = fakeRuntime()
    const config = liveConfig()
    attachSettingsSection(ctx, runtime, config)

    const steps: NetworkConfig[] = [
      { proxyPort: 9000 },
      { proxyPort: 9000, proxyBind: '127.0.0.2' },
      { proxyPort: 9000, proxyBind: '127.0.0.2', injectEnv: false },
      { proxyPort: 9000, proxyBind: '127.0.0.2', injectEnv: false, noProxy: 'preserve' },
    ]
    for (const step of steps) {
      commit(config, { network: step })
      ctx.emit('loader/volatile-update', [['network']])
    }
    expect(rebind).toHaveBeenCalledTimes(4)

    // A pure mode change needs no rebind — web-tool gating reads config per call.
    commit(config, {
      network: { proxyPort: 9000, proxyBind: '127.0.0.2', injectEnv: false, noProxy: 'preserve', mode: 'deny-all' },
    })
    ctx.emit('loader/volatile-update', [['network', 'mode']])
    // A rule-file change is read live too.
    commit(config, {
      rulesFile: '.dsh/other.yaml',
      network: { proxyPort: 9000, proxyBind: '127.0.0.2', injectEnv: false, noProxy: 'preserve', mode: 'deny-all' },
    })
    ctx.emit('loader/volatile-update', [['rulesFile']])
    expect(rebind).toHaveBeenCalledTimes(4)
  })

  it('reports an unusable live edit instead of throwing out of the listener', () => {
    const ctx = new Context()
    const { runtime } = fakeRuntime()
    const config = liveConfig()
    attachSettingsSection(ctx, runtime, config)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)

    // `searchUp` + an absolute rulesFile is the one rule the schema cannot
    // express, so it reaches the listener as a resolvable-but-invalid config.
    // The Loader swallows a listener throw into a generic warning; this must
    // be named in the plugin's own vocabulary and must not escape.
    commit(config, { searchUp: true, rulesFile: '/etc/rules.yaml' })
    expect(() => ctx.emit('loader/volatile-update', [['searchUp']])).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('searchUp cannot be combined'))
    warn.mockRestore()
  })

  it('leaves the composition config in charge when no settings service is composed', () => {
    const ctx = new Context()
    const { runtime, source } = fakeRuntime()
    const config = liveConfig({ language: 'zh' })

    attachSettingsSection(ctx, runtime, config)

    // The references ARE the entry's values, so the source is bound either
    // way: a host without a settings service keeps serving the config.
    expect(source.current?.().language).toBe('zh')
  })

  it('tolerates a service without configure (a host that predates the live contract)', () => {
    const ctx = new Context()
    ctx.provide('settings', { register: () => undefined } as never)
    const { runtime, source } = fakeRuntime()

    attachSettingsSection(ctx, runtime, liveConfig({ language: 'es' }))

    expect(source.current?.().language).toBe('es')
    expect(runtime).toBeDefined()
  })
})
