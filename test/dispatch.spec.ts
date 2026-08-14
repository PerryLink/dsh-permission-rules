/**
 * Waterfall dispatch tests: deny/ask short-circuit with the rule reason,
 * allow and passthrough strictly delegate via `next()`, and every decision
 * appends the log-only `permissionRules/decision` audit event.
 * @module dsh-permission-rules/test/dispatch.spec
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { dispatchPreExecute, makeExec, mountHarness, removeWorkspace, tempWorkspace } from './harness.ts'

const RULES = `
rules:
  - match: { tools: [bash, pwsh], params: { command: "git push*" }, paths: ["**/secrets/**"] }
    action: deny
    reason: "禁止 push 到受保护路径"
  - match: { tools: [edit, write] }
    action: ask
    reason: "写文件需要确认"
  - match: { tools: [read] }
    action: allow
    reason: "读文件放行"
`

function workspaceWithRules(): string {
  const cwd = tempWorkspace()
  mkdirSync(join(cwd, '.dsh'), { recursive: true })
  writeFileSync(join(cwd, '.dsh', 'rules.yaml'), RULES, 'utf8')
  return cwd
}

function decisionEvents(events: readonly { type: string; data: unknown }[]): Record<string, unknown>[] {
  return events.filter(event => event.type === 'permissionRules/decision').map(event => event.data as Record<string, unknown>)
}

describe('tools/pre-execute dispatch', () => {
  it('deny hit short-circuits with the rule reason and never calls next()', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({}, { cwd })
    try {
      let downstreamCalled = false
      const decision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: { command: 'git push origin main', cwd: 'src/secrets/app' }, agent: harness.agent }),
        async () => {
          downstreamCalled = true
          return { kind: 'allow' }
        },
      )
      expect(decision).toEqual({ kind: 'deny', reason: '禁止 push 到受保护路径' })
      expect(downstreamCalled).toBe(false)
      const audit = decisionEvents(harness.session.events)
      expect(audit.at(-1)).toMatchObject({
        toolName: 'bash',
        callId: 'call-1',
        action: 'deny',
        outcome: 'deny',
        ruleIndex: 0,
        reason: '禁止 push 到受保护路径',
      })
      expect(audit.at(-1)?.source).toContain('rules.yaml')
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('ask hit short-circuits with the rule reason', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({}, { cwd })
    try {
      let downstreamCalled = false
      const decision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'edit', arguments: { path: 'src/a.ts' }, agent: harness.agent }),
        async () => {
          downstreamCalled = true
          return { kind: 'allow' }
        },
      )
      expect(decision).toEqual({ kind: 'ask', reason: '写文件需要确认' })
      expect(downstreamCalled).toBe(false)
      expect(decisionEvents(harness.session.events).at(-1)).toMatchObject({
        toolName: 'edit',
        action: 'ask',
        outcome: 'ask',
        ruleIndex: 1,
      })
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('allow hit MUST delegate via next() (downstream decision preserved)', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({}, { cwd })
    try {
      const decision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'read', arguments: { path: 'README.md' }, agent: harness.agent }),
        async () => ({ kind: 'deny', reason: 'downstream listener denied' }),
      )
      expect(decision).toEqual({ kind: 'deny', reason: 'downstream listener denied' })
      // The audit names BOTH the rule action (allow) and the final outcome
      // (deny, decided by the downstream listener) — the log never claims a
      // call was allowed when a later listener denied it.
      expect(decisionEvents(harness.session.events).at(-1)).toMatchObject({
        toolName: 'read',
        action: 'allow',
        outcome: 'deny',
        ruleIndex: 2,
      })
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('passthrough delegates via next() and audits action passthrough without rule fields', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({}, { cwd })
    try {
      let downstreamCalled = false
      const decision: PreToolDecision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'glob', arguments: { pattern: '*' }, agent: harness.agent }),
        async () => {
          downstreamCalled = true
          return { kind: 'allow' }
        },
      )
      expect(decision).toEqual({ kind: 'allow' })
      expect(downstreamCalled).toBe(true)
      const audit = decisionEvents(harness.session.events).at(-1)
      expect(audit).toMatchObject({ toolName: 'glob', action: 'passthrough', outcome: 'allow' })
      expect(audit).not.toHaveProperty('ruleIndex')
      expect(audit).not.toHaveProperty('reason')
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('empty rule set passes everything through and audits with source ""', async () => {
    const cwd = tempWorkspace() // no rules file
    const harness = await mountHarness({}, { cwd })
    try {
      const decision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: { command: 'ls' }, agent: harness.agent }),
      )
      expect(decision).toEqual({ kind: 'allow' })
      expect(decisionEvents(harness.session.events).at(-1)).toMatchObject({
        toolName: 'bash',
        action: 'passthrough',
        outcome: 'allow',
        source: '',
      })
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('agentless calls still decide but append no audit event', async () => {
    const cwd = workspaceWithRules()
    // Agentless executions have no session cwd: the configured fallback
    // path serves them.
    const harness = await mountHarness({ fallbackPath: join(cwd, '.dsh', 'rules.yaml') }, { cwd })
    try {
      const decision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: { command: 'git push origin main', cwd: 'secrets/x' } }),
      )
      expect(decision).toEqual({ kind: 'deny', reason: '禁止 push 到受保护路径' })
      expect(decisionEvents(harness.session.events)).toHaveLength(0)
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('the call id rides the audit event for model-visible ⟺ logged reconstruction', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({}, { cwd })
    try {
      await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'write', arguments: { path: 'a.txt' }, callId: CallId('call-42'), agent: harness.agent }),
      )
      expect(decisionEvents(harness.session.events).at(-1)).toMatchObject({ callId: 'call-42' })
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('requests the ignorable envelope marker so any harness build can load the log', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({}, { cwd })
    try {
      const append = vi.spyOn(harness.session, 'append')
      await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: { command: 'git push origin main', cwd: 'src/secrets/app' }, agent: harness.agent }),
      )
      const call = append.mock.calls.find(([type]) => type === 'permissionRules/decision')
      expect(call).toBeDefined()
      expect(call?.[2]).toEqual({ ignorable: true })
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('audit: hits skips passthrough audit events but keeps hit events', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({ audit: 'hits' }, { cwd })
    try {
      await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'glob', arguments: { pattern: '*' }, agent: harness.agent }),
      )
      expect(decisionEvents(harness.session.events)).toHaveLength(0)
      await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: { command: 'git push origin main', cwd: 'src/secrets/app' }, agent: harness.agent }),
      )
      expect(decisionEvents(harness.session.events).at(-1)).toMatchObject({ action: 'deny', outcome: 'deny' })
    } finally {
      removeWorkspace(cwd)
    }
  })
})
