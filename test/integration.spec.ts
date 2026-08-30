/**
 * Integration test with `dsh-auto-review`: an `ask` rule hit feeds the
 * official approval seam, the auto-review answerer claims it and decides
 * through its (scripted) reviewer subagent, and the complete audit chain —
 * `permissionRules/decision` → `approval/asked` → `autoReview/verdict` →
 * `approval/decided` — lands in the session log in order.
 * @module dsh-permission-rules/test/integration.spec
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CallId } from './call-id.ts'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
// The sibling package's shipped tarball carries runtime JS without its
// .d.ts, so this cross-package test imports it through a local ambient
// declaration (test/auto-review.d.ts); its audit vocabulary is asserted
// structurally below rather than through its declaration merge.
import * as autoReview from 'dsh-auto-review'
import { dispatchPreExecute, makeExec, mountHarness, removeWorkspace, tempWorkspace } from './harness.ts'

const RULES = `
rules:
  - match: { tools: [bash] }
    action: ask
    reason: "命令执行需要第二模型裁决"
`

describe('dsh-permission-rules × dsh-auto-review integration', () => {
  it('ask rule → auto-review verdict → full approval audit chain', async () => {
    const cwd = tempWorkspace()
    mkdirSync(join(cwd, '.dsh'), { recursive: true })
    writeFileSync(join(cwd, '.dsh', 'rules.yaml'), RULES, 'utf8')

    // Mount dsh-auto-review with the scripted reviewer (mock answerer
    // replaces the real model) claiming `bash` requests.
    const harness = await mountHarness({}, {
      cwd,
      approval: true,
      reviewer: () => ({ decision: 'allow', reason: 'looks safe', riskLevel: 'low' }),
    })
    await harness.ctx.plugin(autoReview as unknown as import('@deepseek-ai/cordis').Plugin, {
      reviewerProvider: 'mock',
      toolsPolicy: { overrides: { bash: 'ai' } },
      // The rc.6 test peers drop the ignorable marker, so the full audit
      // chain this spec asserts requires the documented opt-in.
      allowUnmarkedAudit: true,
    })

    try {
      // Step 1: the permission rule produces the ask decision (no reviewer
      // started by this plugin).
      const callId = CallId('call-integration')
      const decision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: { command: 'rm -rf dist' }, callId, agent: harness.agent }),
      )
      expect(decision).toEqual({ kind: 'ask', reason: '命令执行需要第二模型裁决' })
      expect(harness.subagents.starts).toHaveLength(0)

      // Step 2: the official approval seam resolves the ask; the
      // auto-review answerer claims it and the scripted reviewer grants.
      const outcome: ApprovalOutcome = await harness.ctx.approval.request({
        agent: harness.agent,
        toolName: 'bash',
        callId,
        reason: '命令执行需要第二模型裁决',
        signal: new AbortController().signal,
      })
      expect(outcome).toBe('allowed-once')
      expect(harness.subagents.starts).toHaveLength(1)

      // Step 3: the audit chain is complete and ordered.
      const wireTypes = harness.session.events.map(event => (event as { type: string }).type)
      const indexOf = (type: string): number => wireTypes.lastIndexOf(type)
      expect(indexOf('permissionRules/decision')).toBeGreaterThanOrEqual(0)
      expect(indexOf('approval/asked')).toBeGreaterThan(indexOf('permissionRules/decision'))
      expect(indexOf('autoReview/verdict')).toBeGreaterThan(indexOf('approval/asked'))
      expect(indexOf('approval/decided')).toBeGreaterThan(indexOf('autoReview/verdict'))

      const decisionEvent = harness.session.events.find(event => event.type === 'permissionRules/decision')
      expect(decisionEvent?.data).toMatchObject({ toolName: 'bash', callId: 'call-integration', action: 'ask', ruleIndex: 0 })
      const asked = harness.session.events.find(event => event.type === 'approval/asked')
      expect(asked?.data).toMatchObject({ toolName: 'bash', callId: 'call-integration', reason: '命令执行需要第二模型裁决' })
      // autoReview/verdict is dsh-auto-review's vocabulary: asserted at the
      // wire level (this package does not depend on its type declarations).
      const wire = harness.session.events as unknown as { type: string; data: Record<string, unknown> }[]
      const verdict = wire.find(event => event.type === 'autoReview/verdict')
      expect(verdict?.data).toMatchObject({ approvalId: asked?.data.id, toolName: 'bash', decision: 'allow', reason: 'looks safe', outcome: 'allowed-once' })
      const decided = harness.session.events.find(event => event.type === 'approval/decided')
      expect(decided?.data).toMatchObject({ id: asked?.data.id, outcome: 'allowed-once' })
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('a deny verdict from the reviewer settles the ask as rejected through the same chain', async () => {
    const cwd = tempWorkspace()
    mkdirSync(join(cwd, '.dsh'), { recursive: true })
    writeFileSync(join(cwd, '.dsh', 'rules.yaml'), RULES, 'utf8')

    const harness = await mountHarness({}, {
      cwd,
      approval: true,
      reviewer: () => ({ decision: 'deny', reason: 'destructive', riskLevel: 'high' }),
    })
    await harness.ctx.plugin(autoReview as unknown as import('@deepseek-ai/cordis').Plugin, {
      reviewerProvider: 'mock',
      toolsPolicy: { overrides: { bash: 'ai' } },
      // The rc.6 test peers drop the ignorable marker, so the full audit
      // chain this spec asserts requires the documented opt-in.
      allowUnmarkedAudit: true,
    })

    try {
      const decision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: { command: 'rm -rf dist' }, agent: harness.agent }),
      )
      expect(decision).toEqual({ kind: 'ask', reason: '命令执行需要第二模型裁决' })
      const outcome: ApprovalOutcome = await harness.ctx.approval.request({
        agent: harness.agent,
        toolName: 'bash',
        callId: CallId('call-denied'),
        reason: '命令执行需要第二模型裁决',
        signal: new AbortController().signal,
      })
      expect(outcome).toBe('rejected')
      const decided = harness.session.events.findLast(event => event.type === 'approval/decided')
      expect(decided?.data).toMatchObject({ outcome: 'rejected' })
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('with no answerer mounted the ask fails closed as unavailable (official seam)', async () => {
    const cwd = tempWorkspace()
    mkdirSync(join(cwd, '.dsh'), { recursive: true })
    writeFileSync(join(cwd, '.dsh', 'rules.yaml'), RULES, 'utf8')

    // Real ApprovalService with its default `ask` policy, NO answerer plugin.
    const harness = await mountHarness({}, { cwd, approval: true })
    try {
      const decision = await dispatchPreExecute(
        harness.ctx,
        makeExec({ name: 'bash', arguments: { command: 'rm -rf dist' }, agent: harness.agent }),
      )
      expect(decision).toEqual({ kind: 'ask', reason: '命令执行需要第二模型裁决' })
      const outcome: ApprovalOutcome = await harness.ctx.approval.request({
        agent: harness.agent,
        toolName: 'bash',
        callId: CallId('call-unavailable'),
        reason: '命令执行需要第二模型裁决',
        signal: new AbortController().signal,
      })
      expect(outcome).toBe('unavailable')
      const decided = harness.session.events.findLast(event => event.type === 'approval/decided')
      expect(decided?.data).toMatchObject({ outcome: 'unavailable' })
    } finally {
      removeWorkspace(cwd)
    }
  })
})
