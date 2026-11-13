/**
 * Audit-schema additions from issue #48: a stable `ruleId` on hit rows
 * (explicit `id` or content fingerprint, with `ruleIndex` retained) and a
 * `passthroughReason` discriminator on passthrough rows. Both are optional
 * additions, so pre-existing consumers and stored logs keep working.
 * @module dsh-permission-rules/test/decision-schema.spec
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileRulesText, mergeCompiledRules } from '../src/rules.ts'
import { dispatchPreExecute, makeExec, mountHarness, removeWorkspace, tempWorkspace } from './harness.ts'

const GLOB = { patternMode: 'glob', maxRules: 256, maxGlobStars: 2, caseInsensitivePaths: false } as const

const EXPLICIT_ID = `rules:
  - id: block-shell
    match: { tools: [bash] }
    action: deny
    reason: no shell
`

function workspaceWith(text: string): string {
  const cwd = tempWorkspace()
  mkdirSync(join(cwd, '.dsh'), { recursive: true })
  writeFileSync(join(cwd, '.dsh', 'rules.yaml'), text, 'utf8')
  return cwd
}

function decisions(harness: Awaited<ReturnType<typeof mountHarness>>): Record<string, unknown>[] {
  return harness.session
    .snapshotEvents()
    .filter(event => event.type === 'permissionRules/decision')
    .map(event => event.data as Record<string, unknown>)
}

async function command(harness: Awaited<ReturnType<typeof mountHarness>>, input: string) {
  return harness.ctx.commands.execute(harness.agent, input, [], new AbortController().signal)
}

describe('rule identity (issue #48)', () => {
  it('uses an explicit rule id on the hit row and keeps ruleIndex', async () => {
    const cwd = workspaceWith(EXPLICIT_ID)
    const harness = await mountHarness({}, { cwd })
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      expect(decisions(harness).at(-1)).toMatchObject({
        action: 'deny',
        ruleIndex: 0,
        ruleId: 'block-shell',
        reason: 'no shell',
      })
      expect(decisions(harness).at(-1)).not.toHaveProperty('passthroughReason')
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('falls back to a deterministic content fingerprint that survives reformatting', () => {
    const compact = `rules:\n  - match: { tools: [bash] }\n    action: deny\n    reason: no shell\n`
    const expanded = `rules:
  - match:
      tools: [bash]
    action: deny
    reason: no shell
`
    const first = compileRulesText(compact, GLOB).rules[0]!
    const second = compileRulesText(expanded, GLOB).rules[0]!
    expect(first.ruleId).toMatch(/^auto:[0-9a-f]{16}$/)
    expect(second.ruleId).toBe(first.ruleId)
    // Same content at a different position (an unrelated rule before it):
    // the fingerprint does not move with the position.
    const shifted = compileRulesText(`rules:\n  - match: { tools: [read] }\n    action: allow\n    reason: reads\n  - match: { tools: [bash] }\n    action: deny\n    reason: no shell\n`, GLOB)
    expect(shifted.rules[1]?.ruleId).toBe(first.ruleId)
    // Editing the rule's content changes its identity.
    const edited = compileRulesText(compact.replace('no shell', 'no commands'), GLOB).rules[0]!
    expect(edited.ruleId).not.toBe(first.ruleId)
  })

  it('keeps the fingerprint stable through chain merging', () => {
    const compiled = compileRulesText(EXPLICIT_ID.replace('    id: block-shell\n', ''), GLOB)
    const merged = mergeCompiledRules([[...compiled.rules]], GLOB)
    expect(merged.rules[0]?.ruleId).toBe(compiled.rules[0]?.ruleId)
  })

  it('rejects malformed and reserved ids as an isolated rule error', () => {
    const { rules, issues } = compileRulesText(`rules:
  - id: "has space"
    match: { tools: [bash] }
    action: deny
    reason: x
  - id: "auto:deadbeef"
    match: { tools: [read] }
    action: deny
    reason: x
  - match: { tools: [glob] }
    action: allow
    reason: fine
`, GLOB)
    expect(rules.map(rule => rule.reason)).toEqual(['fine'])
    expect(issues.map(issue => issue.index)).toEqual([0, 1])
    expect(issues[0]?.message).toMatch(/id .* must be/)
    expect(issues[1]?.message).toMatch(/reserved "auto:" prefix/)
  })
})

describe('passthroughReason (issue #48)', () => {
  it('reports no-match when a healthy chain has no matching rule', async () => {
    const cwd = workspaceWith(EXPLICIT_ID)
    const harness = await mountHarness({}, { cwd })
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'glob', arguments: {}, agent: harness.agent }))
      const audit = decisions(harness).at(-1)
      expect(audit).toMatchObject({ action: 'passthrough', passthroughReason: 'no-match' })
      expect(audit).not.toHaveProperty('ruleId')
      expect(audit).not.toHaveProperty('ruleIndex')
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('reports out-of-scope when no rule file applies to the workspace', async () => {
    const cwd = tempWorkspace()
    const harness = await mountHarness({}, { cwd })
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      expect(decisions(harness).at(-1)).toMatchObject({ action: 'passthrough', passthroughReason: 'out-of-scope', source: '' })
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('reports rules-not-loaded when a bad file degrades the chain under ignore-with-warning', async () => {
    const cwd = workspaceWith('rules: {')
    const harness = await mountHarness({ badFilePolicy: 'ignore-with-warning' }, { cwd })
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      expect(decisions(harness).at(-1)).toMatchObject({ action: 'passthrough', passthroughReason: 'rules-not-loaded' })
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('reports rules-not-loaded when a failed reload keeps the previous rules', async () => {
    const cwd = workspaceWith(EXPLICIT_ID)
    const harness = await mountHarness({}, { cwd })
    try {
      // First use loads the good chain, then a broken edit is rejected and
      // the previous rules stay active (stale policy).
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      writeFileSync(join(cwd, '.dsh', 'rules.yaml'), 'rules: {', 'utf8')
      const reload = await command(harness, '/rules reload')
      expect(reload?.result.kind).toBe('error')
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'glob', arguments: {}, agent: harness.agent }))
      const audit = decisions(harness).at(-1)
      expect(audit).toMatchObject({ action: 'passthrough', passthroughReason: 'rules-not-loaded', source: join(cwd, '.dsh', 'rules.yaml') })
      // The previous (stale) rule still decides matching calls, and its hit
      // row keeps the identity rather than a passthrough reason.
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      expect(decisions(harness).at(-1)).toMatchObject({ action: 'deny', ruleId: 'block-shell' })
      expect(decisions(harness).at(-1)).not.toHaveProperty('passthroughReason')
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('reports rules-not-loaded when per-rule errors disabled part of the chain', async () => {
    const cwd = workspaceWith(`rules:
  - match: { tools: [bash], params: { command: "*a*b*c*" } }
    action: deny
    reason: bad
  - match: { tools: [read] }
    action: allow
    reason: reads
`)
    const harness = await mountHarness({}, { cwd })
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'glob', arguments: {}, agent: harness.agent }))
      expect(decisions(harness).at(-1)).toMatchObject({ action: 'passthrough', passthroughReason: 'rules-not-loaded' })
    } finally {
      removeWorkspace(cwd)
    }
  })
})
