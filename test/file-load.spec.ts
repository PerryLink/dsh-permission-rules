/**
 * Rule-file loading tests: per-cwd discovery, fallback resolution,
 * `badFilePolicy` fail/ignore paths, mount-time validation of deployment
 * files, and the maxRules cap applied to real files.
 * @module dsh-permission-rules/test/file-load.spec
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { RuleError } from '../src/rules.ts'
import { dispatchPreExecute, makeExec, mountHarness, removeWorkspace, tempWorkspace } from './harness.ts'

const GOOD = 'rules:\n  - match: { tools: [bash] }\n    action: deny\n    reason: no bash\n'
const BAD = 'rules:\n  - match: { tools: [bash] }\n    action: maybe\n    reason: x\n'

describe('rule-file loading', () => {
  it('uses the fallback path when per-cwd discovery finds no project file', async () => {
    const fallback = tempWorkspace('fallback')
    const cwd = tempWorkspace()
    writeFileSync(join(fallback, 'rules.yaml'), GOOD, 'utf8')
    const harness = await mountHarness({ fallbackPath: join(fallback, 'rules.yaml') }, { cwd })
    try {
      const decision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: {}, agent: harness.agent }),
      )
      expect(decision).toEqual({ kind: 'deny', reason: 'no bash' })
      const audit = harness.session.events.find(event => event.type === 'permissionRules/decision')
      expect((audit?.data as { source: string }).source).toBe(join(fallback, 'rules.yaml'))
    } finally {
      removeWorkspace(cwd)
      removeWorkspace(fallback)
    }
  })

  it('bad project file with badFilePolicy fail throws on every use and errors the tool call loudly', async () => {
    const cwd = tempWorkspace()
    mkdirSync(join(cwd, '.dsh'), { recursive: true })
    writeFileSync(join(cwd, '.dsh', 'rules.yaml'), BAD, 'utf8')
    const harness = await mountHarness({}, { cwd })
    try {
      await expect(dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: {}, agent: harness.agent }),
      )).rejects.toThrowError(RuleError)
      // The failure is cached: a second call repeats the same loud error.
      await expect(dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: {}, agent: harness.agent }),
      )).rejects.toThrow(/action must be one of/)
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('bad project file with ignore-with-warning degrades to an empty rule set with a warning', async () => {
    const cwd = tempWorkspace()
    mkdirSync(join(cwd, '.dsh'), { recursive: true })
    writeFileSync(join(cwd, '.dsh', 'rules.yaml'), BAD, 'utf8')
    const harness = await mountHarness({ badFilePolicy: 'ignore-with-warning' }, { cwd })
    const warn = vi.spyOn(harness.ctx.logger, 'warn').mockImplementation(() => undefined)
    try {
      const decision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: {}, agent: harness.agent }),
      )
      expect(decision).toEqual({ kind: 'allow' })
      expect(warn.mock.calls.some(([message]) => String(message).includes('action must be one of'))).toBe(true)
      const audit = harness.session.events.find(event => event.type === 'permissionRules/decision')
      expect((audit?.data as Record<string, unknown>).action).toBe('passthrough')
    } finally {
      warn.mockRestore()
      removeWorkspace(cwd)
    }
  })

  it('an absolute rulesFile that is missing fails the mount loudly', async () => {
    const missing = join(tempWorkspace(), 'nope.yaml')
    await expect(mountHarness({ rulesFile: missing }, {})).rejects.toThrow(/cannot load/)
  })

  it('an absolute rulesFile that is invalid fails the mount loudly', async () => {
    const dir = tempWorkspace()
    const file = join(dir, 'rules.yaml')
    writeFileSync(file, BAD, 'utf8')
    await expect(mountHarness({ rulesFile: file }, {})).rejects.toThrowError(RuleError)
    removeWorkspace(dir)
  })

  it('a configured fallbackPath that is missing fails the mount loudly', async () => {
    const missing = join(tempWorkspace(), 'missing', 'rules.yaml')
    await expect(mountHarness({ fallbackPath: missing }, {})).rejects.toThrow(/fallbackPath.*does not exist/)
  })

  it('a rule file exceeding maxRules fails the load (and the mount when absolute)', async () => {
    const many = `rules:\n${Array.from({ length: 5 }, (_, i) => `  - match: { tools: [t${i}] }\n    action: allow\n    reason: r`).join('\n')}`
    const dir = tempWorkspace()
    const file = join(dir, 'rules.yaml')
    writeFileSync(file, many, 'utf8')
    await expect(mountHarness({ rulesFile: file, maxRules: 4 }, {})).rejects.toThrow(/exceeds maxRules 4/)
    // Per-cwd discovery respects the cap on first use too.
    const cwd = tempWorkspace()
    mkdirSync(join(cwd, '.dsh'), { recursive: true })
    writeFileSync(join(cwd, '.dsh', 'rules.yaml'), many, 'utf8')
    const harness = await mountHarness({ maxRules: 4 }, { cwd })
    try {
      await expect(dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 't0', arguments: {}, agent: harness.agent }),
      )).rejects.toThrow(/exceeds maxRules 4/)
    } finally {
      removeWorkspace(dir)
      removeWorkspace(cwd)
    }
  })

  it('a relative rulesFile other than the default is discovered under the cwd', async () => {
    const cwd = tempWorkspace()
    writeFileSync(join(cwd, 'policy.yml'), GOOD, 'utf8')
    const harness = await mountHarness({ rulesFile: 'policy.yml' }, { cwd })
    try {
      const decision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: {}, agent: harness.agent }),
      )
      expect(decision).toEqual({ kind: 'deny', reason: 'no bash' })
    } finally {
      removeWorkspace(cwd)
    }
  })
})

describe('searchUp hierarchical discovery', () => {
  // A dedicated file name keeps the walk from colliding with real `.dsh`
  // trees in the ancestors of the machine's temp directory.
  const FILE = '.dsh/rules-searchup-test.yaml'
  const PARENT_RULES = 'rules:\n  - match: { tools: [bash] }\n    action: deny\n    reason: parent denies bash\n  - match: { tools: [read] }\n    action: allow\n    reason: parent allows read\n'
  const CHILD_RULES = 'rules:\n  - match: { tools: [bash] }\n    action: ask\n    reason: child asks bash\n'

  it('merges parent files beneath child files so the nearer rule wins', async () => {
    const parent = tempWorkspace()
    const child = join(parent, 'nested', 'project')
    mkdirSync(join(parent, '.dsh'), { recursive: true })
    mkdirSync(join(child, '.dsh'), { recursive: true })
    writeFileSync(join(parent, FILE), PARENT_RULES, 'utf8')
    writeFileSync(join(child, FILE), CHILD_RULES, 'utf8')
    const harness = await mountHarness({ searchUp: true, rulesFile: FILE }, { cwd: child })
    try {
      const bashDecision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: {}, agent: harness.agent }),
      )
      expect(bashDecision).toEqual({ kind: 'ask', reason: 'child asks bash' })
      const readDecision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'read', arguments: {}, agent: harness.agent }),
      )
      expect(readDecision).toEqual({ kind: 'allow' })
      // The audit names the matched rule's own file.
      const bashAudit = harness.session.events.findLast(event => event.type === 'permissionRules/decision' && (event.data as { toolName: string }).toolName === 'bash')
      expect((bashAudit?.data as { source: string }).source).toBe(join(child, FILE))
    } finally {
      removeWorkspace(parent)
    }
  })

  it('uses the fallback only when no file exists anywhere up the tree', async () => {
    const fallbackDir = tempWorkspace()
    const parent = tempWorkspace()
    const child = join(parent, 'nested')
    mkdirSync(join(child, '.dsh'), { recursive: true })
    const fallback = join(fallbackDir, 'rules.yaml')
    writeFileSync(fallback, 'rules:\n  - match: { tools: [bash] }\n    action: deny\n    reason: fallback denies\n', 'utf8')
    mkdirSync(join(parent, '.dsh'), { recursive: true })
    writeFileSync(join(parent, FILE), PARENT_RULES, 'utf8')
    // A parent file exists: the fallback is NOT part of the chain.
    const harness = await mountHarness({ searchUp: true, rulesFile: FILE, fallbackPath: fallback }, { cwd: child })
    try {
      const decision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: {}, agent: harness.agent }),
      )
      expect(decision).toEqual({ kind: 'deny', reason: 'parent denies bash' })
    } finally {
      removeWorkspace(parent)
    }
    // No file anywhere: the fallback serves alone.
    const bare = tempWorkspace()
    const harness2 = await mountHarness({ searchUp: true, rulesFile: FILE, fallbackPath: fallback }, { cwd: bare })
    try {
      const decision = await dispatchPreExecute(
        harness2.ctx,
        makeExec({ name: 'bash', arguments: {}, agent: harness2.agent }),
      )
      expect(decision).toEqual({ kind: 'deny', reason: 'fallback denies' })
    } finally {
      removeWorkspace(bare)
      removeWorkspace(fallbackDir)
    }
  })
})
