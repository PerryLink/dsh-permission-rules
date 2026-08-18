/**
 * Lifecycle and export-contract suite: the HMR-safety test (dispose the
 * contributing fiber, re-query the authoritative registries), the
 * default-export guard (module namespace + Loader unwrap round-trip), and the
 * explicit resolveConfig negative (the second fail-loud layer beyond the
 * Loader's Schemastery pass).
 *
 * @module dsh-permission-rules/test/lifecycle.spec
 */

import { describe, expect, it } from 'vitest'
import { resolve as resolvePath } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Commands from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { resolveConfig } from '../src/config.ts'
import { makeAgent, removeWorkspace, tempWorkspace } from './harness.ts'

async function mount(config: Record<string, unknown> = {}) {
  const cwd = tempWorkspace()
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('dsh-permission-rules-lifecycle'), { meta: { cwd } })
  session.append('turn/start', { turn: 1 })
  ctx.provide('tools', { get: () => undefined, restrict: () => () => undefined } as never)
  await ctx.plugin(Commands)
  const plugin = await import('../src/index.ts')
  const pluginFiber = await ctx.plugin(plugin as unknown as import('@deepseek-ai/cordis').Plugin, { watch: false, allowUnmarkedAudit: true, network: { enabled: false }, ...config })
  return { ctx, session, agent: makeAgent(session), pluginFiber, cwd }
}

// ---------------------------------------------------------------------------
// C2: the function-plugin namespace must survive Loader unwrapping
// ---------------------------------------------------------------------------

describe('export contract', () => {
  it('module carries no default export and Loader unwrap round-trips the namespace', async () => {
    const plugin = await import('../src/index.ts')
    expect('default' in plugin).toBe(false)
    const loader = Object.create(Loader.prototype)
    const unwrapped = loader.unwrapExports(plugin)
    expect(unwrapped).toBe(plugin)
    expect(unwrapped.name).toBe('permission-rules')
    expect(unwrapped.inject).toEqual(['commands', 'tools'])
    expect(typeof unwrapped.Config).toBe('function')
    expect(typeof unwrapped.apply).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// C1: disposing the contributing fiber removes every registry contribution
// ---------------------------------------------------------------------------

describe('fiber disposal', () => {
  it('removes the runtime and the /rules command on dispose', async () => {
    const harness = await mount()
    try {
      expect(harness.ctx.get('permissionRulesRuntime')).toBeDefined()
      expect(harness.ctx.commands.list(harness.agent).map(entry => entry.name)).toContain('rules')

      await harness.pluginFiber.dispose()

      expect(harness.ctx.get('permissionRulesRuntime')).toBeUndefined()
      expect(harness.ctx.commands.list(harness.agent).map(entry => entry.name)).not.toContain('rules')
    } finally {
      removeWorkspace(harness.cwd)
      await harness.ctx.fiber.dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// U4: the explicit resolveConfig layer rejects out-of-bounds values
// ---------------------------------------------------------------------------

describe('resolveConfig fail-loud', () => {
  it('rejects a non-positive maxRules with the real message', () => {
    expect(() => resolveConfig({ maxRules: 0 })).toThrow(/maxRules must be a positive safe integer/u)
  })

  it('rejects a closed-enum badFilePolicy with the real message', () => {
    expect(() => resolveConfig({ badFilePolicy: 'ignore' as never })).toThrow(/badFilePolicy must be one of/u)
  })

  it('rejects searchUp combined with an absolute rulesFile', () => {
    // A real platform-absolute path: a Windows-style literal would read as
    // relative on POSIX runners and never reach the rejection.
    expect(() => resolveConfig({ searchUp: true, rulesFile: resolvePath('abs', 'rules.yaml') })).toThrow(/searchUp cannot be combined with an absolute rulesFile/u)
  })
})
