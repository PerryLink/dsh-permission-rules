/**
 * Waterfall dispatch tests: deny/ask short-circuit with the rule reason,
 * allow and passthrough strictly delegate via `next()`, and every decision
 * appends the log-only `permissionRules/decision` audit event.
 * @module dsh-permission-rules/test/dispatch.spec
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CallId } from './call-id.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { dispatchPreExecute, makeAgent, makeExec, mountHarness, removeWorkspace, tempWorkspace } from './harness.ts'

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

  it('records the workspace cwd on every audit event', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({}, { cwd })
    try {
      await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: { command: 'git push origin main', cwd: 'src/secrets/app' }, agent: harness.agent }),
      )
      expect(decisionEvents(harness.session.events).at(-1)?.cwd).toBe(cwd)
    } finally {
      removeWorkspace(cwd)
    }
  })
})

describe('tools/pre-execute — dry-run mode (enforce: false)', () => {
  it('a deny hit delegates via next() and audits the would-be decision with dryRun', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({ enforce: false }, { cwd })
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
      // Dry-run never short-circuits: the downstream decision wins.
      expect(decision).toEqual({ kind: 'allow' })
      expect(downstreamCalled).toBe(true)
      expect(decisionEvents(harness.session.events).at(-1)).toMatchObject({
        toolName: 'bash',
        action: 'deny',
        outcome: 'allow',
        ruleIndex: 0,
        dryRun: true,
      })
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('a dry-run ask hit records the would-be ask and the real downstream outcome', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({ enforce: false }, { cwd })
    try {
      const decision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'edit', arguments: { path: 'src/a.ts' }, agent: harness.agent }),
        async () => ({ kind: 'deny', reason: 'later listener refused' }),
      )
      expect(decision).toEqual({ kind: 'deny', reason: 'later listener refused' })
      expect(decisionEvents(harness.session.events).at(-1)).toMatchObject({
        toolName: 'edit',
        action: 'ask',
        outcome: 'deny',
        ruleIndex: 1,
        dryRun: true,
      })
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('allow hits and passthroughs carry no dryRun marker', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({ enforce: false }, { cwd })
    try {
      await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'read', arguments: { path: 'README.md' }, agent: harness.agent }),
      )
      await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'glob', arguments: { pattern: '*' }, agent: harness.agent }),
      )
      const events = decisionEvents(harness.session.events)
      expect(events.at(-2)).toMatchObject({ action: 'allow', outcome: 'allow' })
      expect(events.at(-2)).not.toHaveProperty('dryRun')
      expect(events.at(-1)).toMatchObject({ action: 'passthrough' })
      expect(events.at(-1)).not.toHaveProperty('dryRun')
    } finally {
      removeWorkspace(cwd)
    }
  })
})

describe('tools/pre-execute — agents dimension', () => {
  const AGENT_RULES = `
rules:
  - match: { tools: [bash], agents: [subagent, "preset:code*"] }
    action: deny
    reason: "子代理不得运行 shell"
  - match: { tools: [write], agents: [main] }
    action: ask
    reason: "主代理写文件需要确认"
`

  it('selects rules by the caller session identity (main vs subagent vs preset)', async () => {
    const cwd = tempWorkspace()
    const harness = await mountHarness({}, { cwd })
    try {
      mkdirSync(join(cwd, '.dsh'), { recursive: true })
      writeFileSync(join(cwd, '.dsh', 'rules.yaml'), AGENT_RULES, 'utf8')
      // The harness agent is a top-level session: the main-scoped rule asks.
      const mainDecision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'write', arguments: { path: 'a.txt' }, agent: harness.agent }),
      )
      expect(mainDecision).toEqual({ kind: 'ask', reason: '主代理写文件需要确认' })
      // A subagent child session is denied the shell outright.
      const child = harness.ctx.sessions.create(SessionId('sub-child'), { meta: { cwd, origin: 'subagent' } })
      const childAgent = makeAgent(child)
      const subDecision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: { command: 'ls' }, agent: childAgent }),
      )
      expect(subDecision).toEqual({ kind: 'deny', reason: '子代理不得运行 shell' })
      // A preset-composed top-level session also matches the subagent rule.
      const preset = harness.ctx.sessions.create(SessionId('preset-child'), { meta: { cwd, agentPreset: 'coder' } })
      const presetAgent = makeAgent(preset)
      const presetDecision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: { command: 'ls' }, agent: presetAgent }),
      )
      expect(presetDecision).toEqual({ kind: 'deny', reason: '子代理不得运行 shell' })
    } finally {
      removeWorkspace(cwd)
    }
  })
})
