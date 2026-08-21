/**
 * HMR tests: Chokidar-driven rule reloads. A mocked watcher emits
 * add/change/unlink/error events; reloads debounce, a bad reload keeps the
 * previous rules (never a crash), and watcher errors only warn.
 * @module dsh-permission-rules/test/watch.spec
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { dispatchPreExecute, makeAgent, makeExec, mountHarness, removeWorkspace, tempWorkspace } from './harness.ts'
import type { PermissionRulesRuntime } from '../src/runtime.ts'

/** Hoisted mock controls: chokidar is replaced by a fake EventEmitter watcher. */
const watchHarness = vi.hoisted(() => ({
  watchers: [] as FakeWatcher[],
  closed: [] as FakeWatcher[],
}))
interface FakeWatcher extends EventEmitter {
  path: string
  close(): Promise<void>
}
const { watchers, closed } = watchHarness

vi.mock('chokidar', () => ({
  default: {
    watch(path: string): FakeWatcher {
      const emitter = new EventEmitter()
      const watcher = emitter as FakeWatcher
      watcher.path = path
      watcher.close = async () => {
        closed.push(watcher)
      }
      watchers.push(watcher)
      return watcher
    },
  },
}))

const GOOD_1 = 'rules:\n  - match: { tools: [bash] }\n    action: deny\n    reason: no bash v1\n'
const GOOD_2 = 'rules:\n  - match: { tools: [bash] }\n    action: deny\n    reason: no bash v2\n'
const BAD = 'rules:\n  - match: { tools: [bash] }\n    action: maybe\n    reason: x\n'

function workspaceWithRules(body = GOOD_1): string {
  const cwd = tempWorkspace()
  mkdirSync(join(cwd, '.dsh'), { recursive: true })
  writeFileSync(join(cwd, '.dsh', 'rules.yaml'), body, 'utf8')
  return cwd
}

describe('rule-file watching', () => {
  it('reloads a changed rule file and applies the new reason', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({ watch: true, watchStabilityThresholdMs: 10 }, { cwd })
    try {
      const first = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: {}, agent: harness.agent }),
      )
      expect(first).toEqual({ kind: 'deny', reason: 'no bash v1' })
      writeFileSync(join(cwd, '.dsh', 'rules.yaml'), GOOD_2, 'utf8')
      watchers.at(-1)?.emit('change', join(cwd, '.dsh', 'rules.yaml'))
      // Debounce window, then the new reason takes effect.
      await vi.waitFor(async () => {
        const decision = await dispatchPreExecute(
          harness.ctx,
          makeExec({ name: 'bash', arguments: {}, agent: harness.agent }),
        )
        expect(decision).toEqual({ kind: 'deny', reason: 'no bash v2' })
      })
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('a broken reload keeps the previous rules and only warns (no crash)', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({ watch: true, watchStabilityThresholdMs: 10 }, { cwd })
    const warn = vi.spyOn(harness.ctx.logger, 'warn').mockImplementation(() => undefined)
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      writeFileSync(join(cwd, '.dsh', 'rules.yaml'), BAD, 'utf8')
      watchers.at(-1)?.emit('change', join(cwd, '.dsh', 'rules.yaml'))
      await vi.waitFor(() => {
        expect(warn.mock.calls.some(([message]) => String(message).includes('reload failed'))).toBe(true)
      })
      const decision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: {}, agent: harness.agent }),
      )
      expect(decision).toEqual({ kind: 'deny', reason: 'no bash v1' })
    } finally {
      warn.mockRestore()
      removeWorkspace(cwd)
    }
  })

  it('an unlink re-resolves the source (empty set) and a recreated file is adopted', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({ watch: true, watchStabilityThresholdMs: 10 }, { cwd })
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      // Real deletion drives the unlink (the reload re-resolves the source).
      rmSync(join(cwd, '.dsh', 'rules.yaml'))
      watchers.at(-1)?.emit('unlink', join(cwd, '.dsh', 'rules.yaml'))
      await vi.waitFor(async () => {
        const decision = await dispatchPreExecute(
          harness.ctx,
          makeExec({ name: 'bash', arguments: {}, agent: harness.agent }),
        )
        expect(decision).toEqual({ kind: 'allow' })
      })
      // File recreated: the watcher's add event reloads it into active rules.
      writeFileSync(join(cwd, '.dsh', 'rules.yaml'), GOOD_2, 'utf8')
      watchers.at(-1)?.emit('add', join(cwd, '.dsh', 'rules.yaml'))
      await vi.waitFor(async () => {
        const decision = await dispatchPreExecute(
          harness.ctx,
          makeExec({ name: 'bash', arguments: {}, agent: harness.agent }),
        )
        expect(decision).toEqual({ kind: 'deny', reason: 'no bash v2' })
      })
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('watcher errors warn only and never crash the pipeline', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({ watch: true }, { cwd })
    // The first dispatch attaches this test's watcher.
    await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
    const warn = vi.spyOn(harness.ctx.logger, 'warn').mockImplementation(() => undefined)
    try {
      watchers.at(-1)?.emit('error', new Error('watch backend died'))
      await vi.waitFor(() => {
        expect(warn.mock.calls.some(([message]) => String(message).includes('watcher error'))).toBe(true)
      })
      const decision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: {}, agent: harness.agent }),
      )
      expect(decision).toEqual({ kind: 'deny', reason: 'no bash v1' })
    } finally {
      warn.mockRestore()
      removeWorkspace(cwd)
    }
  })

  it('watch: false never opens a watcher', async () => {
    const cwd = workspaceWithRules()
    const before = watchers.length
    const harness = await mountHarness({ watch: false }, { cwd })
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      expect(watchers.length).toBe(before)
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('a rule file created mid-session (empty chain) is adopted without a manual reload', async () => {
    const cwd = tempWorkspace() // no .dsh/rules.yaml yet
    const harness = await mountHarness({ watch: true, watchStabilityThresholdMs: 10 }, { cwd })
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      // The empty chain watches the deepest existing ancestor of the
      // would-be project file, so the creation fires an adoption. (The key
      // is case-folded on Windows; compare paths without ASCII case.)
      const candidateWatcher = watchers.at(-1)
      expect(candidateWatcher?.path.toLowerCase()).toBe(cwd.toLowerCase())
      mkdirSync(join(cwd, '.dsh'), { recursive: true })
      writeFileSync(join(cwd, '.dsh', 'rules.yaml'), GOOD_1, 'utf8')
      candidateWatcher?.emit('add', join(cwd, '.dsh', 'rules.yaml'))
      await vi.waitFor(async () => {
        const decision = await dispatchPreExecute(
          harness.ctx,
          makeExec({ name: 'bash', arguments: {}, agent: harness.agent }),
        )
        expect(decision).toEqual({ kind: 'deny', reason: 'no bash v1' })
      })
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('a fallback deleted mid-session is re-adopted when recreated', async () => {
    const cwd = tempWorkspace()
    const fallbackDir = tempWorkspace()
    const fallback = join(fallbackDir, 'fallback.yaml')
    // Deployment-file validation requires the configured fallback to EXIST
    // at mount; the candidate watch covers deletion + recreation after that.
    writeFileSync(fallback, 'rules:\n  - match: { tools: [bash] }\n    action: deny\n    reason: fallback rules\n', 'utf8')
    const harness = await mountHarness({ watch: true, watchStabilityThresholdMs: 10, fallbackPath: fallback }, { cwd })
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      // Chain = [fallback]: the fallback gets a file watcher, the absent
      // project file gets a candidate watcher on its ancestor directory.
      const fallbackWatcher = watchers.find(entry => entry.path.toLowerCase() === fallback.toLowerCase())
      expect(fallbackWatcher).toBeDefined()
      rmSync(fallback)
      fallbackWatcher?.emit('unlink', fallback)
      await vi.waitFor(async () => {
        const decision = await dispatchPreExecute(
          harness.ctx,
          makeExec({ name: 'bash', arguments: {}, agent: harness.agent }),
        )
        expect(decision).toEqual({ kind: 'allow' })
      })
      // Empty chain again: both the project and fallback candidates are
      // watched through their ancestor directories; recreate the fallback.
      const candidateWatcher = watchers.at(-1)
      expect(candidateWatcher?.path.toLowerCase()).toBe(fallbackDir.toLowerCase())
      writeFileSync(fallback, 'rules:\n  - match: { tools: [bash] }\n    action: deny\n    reason: fallback rules\n', 'utf8')
      candidateWatcher?.emit('add', fallback)
      await vi.waitFor(async () => {
        const decision = await dispatchPreExecute(
          harness.ctx,
          makeExec({ name: 'bash', arguments: {}, agent: harness.agent }),
        )
        expect(decision).toEqual({ kind: 'deny', reason: 'fallback rules' })
      })
    } finally {
      removeWorkspace(cwd)
      removeWorkspace(fallbackDir)
    }
  })

  it('a recreated project file switches back from the active fallback', async () => {
    const cwd = workspaceWithRules()
    const fallbackDir = tempWorkspace()
    const fallback = join(fallbackDir, 'fallback.yaml')
    writeFileSync(fallback, 'rules:\n  - match: { tools: [bash] }\n    action: deny\n    reason: fallback rules\n', 'utf8')
    const harness = await mountHarness({ watch: true, watchStabilityThresholdMs: 10, fallbackPath: fallback }, { cwd })
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      const projectWatcher = watchers.at(-1)
      expect(projectWatcher).toBeDefined()
      rmSync(join(cwd, '.dsh', 'rules.yaml'))
      projectWatcher?.emit('unlink', join(cwd, '.dsh', 'rules.yaml'))
      await vi.waitFor(async () => {
        const decision = await dispatchPreExecute(
          harness.ctx,
          makeExec({ name: 'bash', arguments: {}, agent: harness.agent }),
        )
        expect(decision).toEqual({ kind: 'deny', reason: 'fallback rules' })
      })
      // The absent project file is now watched through its parent directory.
      const candidateWatcher = watchers.at(-1)
      expect(candidateWatcher?.path.toLowerCase()).toBe(join(cwd, '.dsh').toLowerCase())
      writeFileSync(join(cwd, '.dsh', 'rules.yaml'), GOOD_2, 'utf8')
      candidateWatcher?.emit('add', join(cwd, '.dsh', 'rules.yaml'))
      await vi.waitFor(async () => {
        const decision = await dispatchPreExecute(
          harness.ctx,
          makeExec({ name: 'bash', arguments: {}, agent: harness.agent }),
        )
        expect(decision).toEqual({ kind: 'deny', reason: 'no bash v2' })
      })
    } finally {
      removeWorkspace(cwd)
      removeWorkspace(fallbackDir)
    }
  })

  it('differently-spelled paths to one workspace share a single cache entry and watcher', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({ watch: true }, { cwd })
    const runtime = harness.ctx.get('permissionRulesRuntime') as PermissionRulesRuntime
    const session2 = harness.ctx.sessions.create(SessionId('same-ws'), { meta: { cwd: `${cwd}/./` } })
    const agent2 = makeAgent(session2)
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: agent2 }))
      // One canonical cache key → one workspace → one watcher on the file.
      expect(runtime.activeWatcherCount()).toBe(1)
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('a source switch to the fallback closes the watcher on the previous source', async () => {
    const cwd = workspaceWithRules()
    const fallbackDir = tempWorkspace()
    const fallback = join(fallbackDir, 'fallback.yaml')
    writeFileSync(fallback, 'rules:\n  - match: { tools: [bash] }\n    action: deny\n    reason: fallback rules\n', 'utf8')
    const harness = await mountHarness({ watch: true, watchStabilityThresholdMs: 10, fallbackPath: fallback }, { cwd })
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      const workspaceWatcher = watchers.at(-1)
      expect(workspaceWatcher).toBeDefined()
      rmSync(join(cwd, '.dsh', 'rules.yaml'))
      workspaceWatcher?.emit('unlink', join(cwd, '.dsh', 'rules.yaml'))
      // The fallback takes over and the stale watcher on the deleted project
      // file is closed (no unbounded watcher accumulation).
      await vi.waitFor(async () => {
        const decision = await dispatchPreExecute(
          harness.ctx,
          makeExec({ name: 'bash', arguments: {}, agent: harness.agent }),
        )
        expect(decision).toEqual({ kind: 'deny', reason: 'fallback rules' })
      })
      expect(closed.includes(workspaceWatcher as FakeWatcher)).toBe(true)
    } finally {
      removeWorkspace(cwd)
      removeWorkspace(fallbackDir)
    }
  })

  it('maxCachedWorkspaces evicts the least-recently-USED workspace (LRU, not insertion order)', async () => {
    const cwd1 = workspaceWithRules()
    const cwd2 = workspaceWithRules()
    const cwd3 = workspaceWithRules()
    const harness = await mountHarness({ watch: true, maxCachedWorkspaces: 2 }, { cwd: cwd1 })
    const session1 = harness.ctx.sessions.create(SessionId('lru-1'), { meta: { cwd: cwd1 } })
    const session2 = harness.ctx.sessions.create(SessionId('lru-2'), { meta: { cwd: cwd2 } })
    const session3 = harness.ctx.sessions.create(SessionId('lru-3'), { meta: { cwd: cwd3 } })
    const agent1 = makeAgent(session1)
    const agent2 = makeAgent(session2)
    const agent3 = makeAgent(session3)
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: agent1 }))
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: agent2 }))
      const watcher1 = watchers.at(-2)
      const watcher2 = watchers.at(-1)
      expect(watcher1).toBeDefined()
      expect(watcher2).toBeDefined()
      // Touch cwd1: it becomes the most recently used, so the NEXT eviction
      // must drop cwd2 — even though cwd2 was inserted later.
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: agent1 }))
      const decision3 = await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: agent3 }))
      expect(decision3).toEqual({ kind: 'deny', reason: 'no bash v1' })
      expect(closed.includes(watcher2 as FakeWatcher)).toBe(true)
      expect(closed.includes(watcher1 as FakeWatcher)).toBe(false)
      // A later dispatch on the evicted workspace reloads from scratch.
      const decision2 = await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: agent2 }))
      expect(decision2).toEqual({ kind: 'deny', reason: 'no bash v1' })
    } finally {
      for (const dir of [cwd1, cwd2, cwd3]) removeWorkspace(dir)
    }
  })

  it('pruning a watcher on a source switch also clears its pending debounce timer', async () => {
    const cwd = workspaceWithRules()
    const fallbackDir = tempWorkspace()
    const fallback = join(fallbackDir, 'fallback.yaml')
    writeFileSync(fallback, 'rules:\n  - match: { tools: [bash] }\n    action: deny\n    reason: fallback rules\n', 'utf8')
    const harness = await mountHarness({ watch: true, watchStabilityThresholdMs: 5000, fallbackPath: fallback }, { cwd })
    const runtime = harness.ctx.get('permissionRulesRuntime') as PermissionRulesRuntime
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      const workspaceWatcher = watchers.at(-1)
      expect(workspaceWatcher).toBeDefined()
      // A change event schedules a debounced reload (5 s window); the file is
      // already gone, so a manual reload resolves the fallback and prunes the
      // workspace watcher while its timer is still pending.
      rmSync(join(cwd, '.dsh', 'rules.yaml'))
      workspaceWatcher?.emit('change', join(cwd, '.dsh', 'rules.yaml'))
      expect(runtime.pendingReloadCount()).toBe(1)
      await harness.ctx.commands.execute(harness.agent, '/rules reload', [], new AbortController().signal)
      expect(runtime.pendingReloadCount()).toBe(0)
      expect(closed.includes(workspaceWatcher as FakeWatcher)).toBe(true)
      const decision = await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      expect(decision).toEqual({ kind: 'deny', reason: 'fallback rules' })
    } finally {
      removeWorkspace(cwd)
      removeWorkspace(fallbackDir)
    }
  })
})
