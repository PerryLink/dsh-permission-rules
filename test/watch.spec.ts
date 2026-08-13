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
import { dispatchPreExecute, makeExec, mountHarness, removeWorkspace, tempWorkspace } from './harness.ts'

/** Hoisted mock controls: chokidar is replaced by a fake EventEmitter watcher. */
const watchHarness = vi.hoisted(() => ({
  watchers: [] as FakeWatcher[],
}))
interface FakeWatcher extends EventEmitter {
  path: string
  close(): Promise<void>
}
const { watchers } = watchHarness

vi.mock('chokidar', () => ({
  default: {
    watch(path: string): FakeWatcher {
      const emitter = new EventEmitter()
      const watcher = emitter as FakeWatcher
      watcher.path = path
      watcher.close = async () => undefined
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
})
