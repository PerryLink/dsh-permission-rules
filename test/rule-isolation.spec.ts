/**
 * Per-rule failure isolation (issue #49): one bad rule must disable only
 * itself — never the whole rules file, never the plugin's activation — and
 * the disabled entries must be reported with their source file and
 * 0-based document index at startup and in `/rules`.
 * @module dsh-permission-rules/test/rule-isolation.spec
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { compileRulesText, parseRulesDocumentIsolated, RuleError } from '../src/rules.ts'
import { dispatchPreExecute, makeExec, mountHarness, removeWorkspace, tempWorkspace } from './harness.ts'

const GLOB = { patternMode: 'glob', maxRules: 256, maxGlobStars: 2, caseInsensitivePaths: false } as const

/**
 * The reporter's exact shape: one rule whose glob has three star expansions
 * (over `maxGlobStars: 2`), then a rule every pattern compiler accepts.
 */
const BAD_GLOB_THEN_GOOD = `rules:
  - match: { tools: [bash], params: { command: "*Remove-Item* -Recurse*" } }
    action: deny
    reason: bad glob
  - match: { tools: [bash] }
    action: deny
    reason: good rule
`

const FIXED = `rules:
  - match: { tools: [bash], params: { command: "Remove-Item* -Recurse*" } }
    action: deny
    reason: fixed glob
  - match: { tools: [bash] }
    action: deny
    reason: good rule
`

function workspaceWith(text: string): { cwd: string; file: string } {
  const cwd = tempWorkspace()
  mkdirSync(join(cwd, '.dsh'), { recursive: true })
  const file = join(cwd, '.dsh', 'rules.yaml')
  writeFileSync(file, text, 'utf8')
  return { cwd, file }
}

function auditEvents(harness: Awaited<ReturnType<typeof mountHarness>>): Record<string, unknown>[] {
  return harness.session
    .snapshotEvents()
    .filter(event => event.type === 'permissionRules/decision')
    .map(event => event.data as Record<string, unknown>)
}

describe('compileRulesText — per-rule isolation', () => {
  it('disables only the rule with the bad glob and reports its 0-based index', () => {
    const { rules, issues } = compileRulesText(BAD_GLOB_THEN_GOOD, GLOB)
    expect(rules.map(rule => rule.reason)).toEqual(['good rule'])
    // The surviving rule keeps its DOCUMENT index until the chain merge
    // renumbers the active chain.
    expect(rules[0]?.index).toBe(1)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.index).toBe(0)
    expect(issues[0]?.message).toMatch(/unbounded star quantifiers/)
  })

  it('isolates a per-rule PARSE error too (invalid action, missing reason)', () => {
    const doc = parseRulesDocumentIsolated(`rules:
  - match: { tools: [bash] }
    action: maybe
    reason: x
  - match: { tools: [read] }
    action: deny
    reason: no read
`)
    expect(doc.rules.map(rule => rule.reason)).toEqual(['no read'])
    expect(doc.issues?.[0]?.index).toBe(0)
    expect(doc.issues?.[0]?.message).toMatch(/action must be one of/)
  })

  it('keeps FILE-level failures loud (invalid YAML, unknown top-level field)', () => {
    expect(() => compileRulesText('rules: {', GLOB)).toThrowError(RuleError)
    expect(() => compileRulesText('rules: []\nextra: 1', GLOB)).toThrow(/unknown top-level field/)
    expect(() => compileRulesText('rules: not-a-list', GLOB)).toThrow(/"rules" must be a list/)
  })

  it('still counts disabled entries against maxRules', () => {
    const many = `rules:\n${Array.from({ length: 4 }, (_, i) => `  - match: { tools: [t${i}] }\n    action: deny\n    reason: r${i}`).join('\n')}`
    // 3 valid + 1 invalid still exceeds a cap of 3: skipping must not be a
    // way around the document-size bound.
    expect(() => compileRulesText(many.replace('reason: r0', 'reason: ""'), { ...GLOB, maxRules: 3 })).toThrow(/exceeds maxRules 3/)
  })
})

describe('runtime per-rule isolation', () => {
  it('loads the valid rule from a file whose first rule has an invalid glob', async () => {
    const { cwd } = workspaceWith(BAD_GLOB_THEN_GOOD)
    const harness = await mountHarness({}, { cwd })
    const error = vi.spyOn(harness.ctx.logger, 'error').mockImplementation(() => undefined)
    try {
      const decision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: { command: 'Remove-Item -Recurse C:\\tmp' }, agent: harness.agent }),
      )
      expect(decision).toEqual({ kind: 'deny', reason: 'good rule' })
      // The audit still names the rule that actually decided the call.
      expect(auditEvents(harness).at(-1)).toMatchObject({ action: 'deny', ruleIndex: 0, reason: 'good rule', source: join(cwd, '.dsh', 'rules.yaml') })
      // The disabled rule is reported with its file and 1-based position.
      expect(error.mock.calls.some(([message]) => String(message).includes('rule 1 disabled') && String(message).includes('unbounded star'))).toBe(true)
    } finally {
      error.mockRestore()
      removeWorkspace(cwd)
    }
  })

  it('renders the degraded chain as an error in /rules, then clears after a fix + reload', async () => {
    const { cwd, file } = workspaceWith(BAD_GLOB_THEN_GOOD)
    const harness = await mountHarness({}, { cwd })
    const error = vi.spyOn(harness.ctx.logger, 'error').mockImplementation(() => undefined)
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      const status = await harness.ctx.commands.execute(harness.agent, '/rules', [], new AbortController().signal)
      expect(status?.result.kind).toBe('error')
      const text = status?.result.text ?? ''
      expect(text).toContain('1 rule(s) could not be loaded')
      expect(text).toContain('rule 1 (disabled)')
      expect(text).toContain('unbounded star')
      expect(text).toContain('good rule')

      writeFileSync(file, FIXED, 'utf8')
      const reload = await harness.ctx.commands.execute(harness.agent, '/rules reload', [], new AbortController().signal)
      expect(reload?.result.kind).toBe('success')
      expect(reload?.result.text).toContain('2 rule(s)')
      const healthy = await harness.ctx.commands.execute(harness.agent, '/rules', [], new AbortController().signal)
      expect(healthy?.result.kind).toBe('success')
    } finally {
      error.mockRestore()
      removeWorkspace(cwd)
    }
  })

  it('announces a degraded chain at session startup without vetoing session creation', async () => {
    const { cwd } = workspaceWith(BAD_GLOB_THEN_GOOD)
    const harness = await mountHarness({}, { cwd })
    const error = vi.spyOn(harness.ctx.logger, 'error').mockImplementation(() => undefined)
    try {
      const session = harness.ctx.sessions.create(SessionId('startup-check'), { meta: { cwd } })
      expect(session.id).toBe('startup-check')
      expect(error.mock.calls.some(([message]) => String(message).includes('STARTUP') && String(message).includes('1 rule(s)'))).toBe(true)
    } finally {
      error.mockRestore()
      removeWorkspace(cwd)
    }
  })

  it('a bad rule does not make badFilePolicy: fail refuse to activate the plugin', async () => {
    const cwd = tempWorkspace()
    const file = join(cwd, 'rules.yaml')
    // Both rules are invalid: the file is fully degraded but still a valid
    // document, so the plugin mounts and every call flows through.
    writeFileSync(file, 'rules:\n  - match: { tools: [bash] }\n    action: maybe\n    reason: x\n', 'utf8')
    const harness = await mountHarness({ rulesFile: file }, { cwd: tempWorkspace() })
    try {
      const decision = await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      expect(decision).toEqual({ kind: 'allow' })
      const status = await harness.ctx.commands.execute(harness.agent, '/rules', [], new AbortController().signal)
      expect(status?.result.kind).toBe('error')
      expect(status?.result.text).toContain('0 rule(s)')
    } finally {
      removeWorkspace(cwd)
    }
  })
})
