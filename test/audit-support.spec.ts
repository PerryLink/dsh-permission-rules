/**
 * Host-capability degradation for the audit envelope's `ignorable` marker:
 * hosts whose `Session.append` predates the marker (the released rc.1–rc.7
 * lines) write audit events UNMARKED, which makes sessions unresumable on
 * stricter harness builds. The runtime must detect such hosts BEFORE the
 * first append (peer version) and re-check the first append's returned
 * envelope, then disable session-log audit with a one-time warning unless
 * `allowUnmarkedAudit: true` opts back in. The rc.8 peers ARE
 * marker-aware, so the degradation tests simulate the pre-marker line
 * through the runtime's `peerVersion` seam instead of mounting them.
 * @module dsh-permission-rules/test/audit-support.spec
 */

import { describe, expect, it, vi } from 'vitest'
import { isMarkedAuditEvent } from '../src/events.ts'
import { isUnmarkedHostVersion } from '../src/runtime.ts'
import type { PermissionRulesRuntime } from '../src/runtime.ts'
import { dispatchPreExecute, makeExec, mountHarness, removeWorkspace, tempWorkspace } from './harness.ts'

/** Version-line classification for the known-unmarked rc.1–rc.7 peers of the 0.1.0 and 0.1.1 lines. */
describe('isUnmarkedHostVersion', () => {
  it('flags the 0.1.0/0.1.1 rc.1–rc.7 lines and nothing else', () => {
    for (const version of ['0.1.0-rc.1', '0.1.0-rc.6', '0.1.0-rc.7', '0.1.1-rc.1', '0.1.1-rc.2', '0.1.1-rc.7']) expect(isUnmarkedHostVersion(version)).toBe(true)
    for (const version of ['0.1.0-rc.8', '0.1.0-rc.10', '0.1.1-rc.8', '0.1.1-rc.10', '0.1.0', '0.2.0', '0.1.0-rc.6-pre', 'garbage']) expect(isUnmarkedHostVersion(version)).toBe(false)
  })
})

/** Envelope inspection for the append-return probe. */
describe('isMarkedAuditEvent', () => {
  it('accepts only envelopes that actually carry ignorable: true', () => {
    expect(isMarkedAuditEvent({ type: 'permissionRules/decision', seq: 0, time: 1, data: {}, ignorable: true })).toBe(true)
    expect(isMarkedAuditEvent({ type: 'permissionRules/decision', seq: 0, time: 1, data: {} })).toBe(false)
    expect(isMarkedAuditEvent({ ignorable: false })).toBe(false)
    expect(isMarkedAuditEvent(undefined)).toBe(false)
    expect(isMarkedAuditEvent(null)).toBe(false)
    expect(isMarkedAuditEvent('event')).toBe(false)
  })
})

describe('audit host-capability degradation', () => {
  it('a simulated pre-marker host (rc.6 line) disables session-log audit BEFORE the first append, warning once', async () => {
    const cwd = tempWorkspace()
    // The production default (allowUnmarkedAudit: false — the harness
    // otherwise opts tests in). The rc.8 peers are marker-aware, so the
    // unmarked line is simulated through the peer-version pre-check.
    const harness = await mountHarness({ allowUnmarkedAudit: false }, { cwd })
    const runtime = harness.ctx.get('permissionRulesRuntime') as PermissionRulesRuntime
    const warn = vi.spyOn(harness.ctx.logger, 'warn').mockImplementation(() => undefined)
    const versionSpy = vi.spyOn(runtime as unknown as { peerVersion(): string | null }, 'peerVersion').mockReturnValue('0.1.0-rc.6')
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'glob', arguments: {}, agent: harness.agent }))
      // No audit event ever entered the session log.
      expect(harness.session.events.filter(event => event.type === 'permissionRules/decision')).toHaveLength(0)
      // The warning fired exactly once and explains the degradation.
      const unmarkedWarnings = warn.mock.calls.filter(([message]) => String(message).includes('ignorable'))
      expect(unmarkedWarnings).toHaveLength(1)
      expect(String(unmarkedWarnings[0]?.[0])).toContain('allowUnmarkedAudit')
    } finally {
      versionSpy.mockRestore()
      warn.mockRestore()
      removeWorkspace(cwd)
    }
  })

  it('allowUnmarkedAudit: true keeps appending on unmarked hosts without a warning', async () => {
    const cwd = tempWorkspace()
    const harness = await mountHarness({ allowUnmarkedAudit: true }, { cwd })
    const warn = vi.spyOn(harness.ctx.logger, 'warn').mockImplementation(() => undefined)
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      expect(harness.session.events.filter(event => event.type === 'permissionRules/decision')).toHaveLength(1)
      expect(warn.mock.calls.some(([message]) => String(message).includes('ignorable'))).toBe(false)
    } finally {
      warn.mockRestore()
      removeWorkspace(cwd)
    }
  })

  it('a marker-aware host passes the append probe and keeps auditing (no warning)', async () => {
    const cwd = tempWorkspace()
    const harness = await mountHarness({ allowUnmarkedAudit: false }, { cwd })
    const runtime = harness.ctx.get('permissionRulesRuntime') as PermissionRulesRuntime
    const warn = vi.spyOn(harness.ctx.logger, 'warn').mockImplementation(() => undefined)
    // Simulate a future marker-aware line so the version pre-check lets the probe run…
    const versionSpy = vi.spyOn(runtime as unknown as { peerVersion(): string | null }, 'peerVersion').mockReturnValue('0.2.0')
    // …and make the append return a marker-stamped envelope.
    const realAppend = (runtime as unknown as { appendAudit(agent: never, data: unknown): unknown }).appendAudit.bind(runtime) as (agent: never, data: unknown) => unknown
    const appendSpy = vi.spyOn(runtime as unknown as { appendAudit(agent: never, data: unknown): unknown }, 'appendAudit').mockImplementation((agent: never, data: unknown) => ({
      ...(realAppend(agent, data) as object),
      ignorable: true,
    }))
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'glob', arguments: {}, agent: harness.agent }))
      expect(harness.session.events.filter(event => event.type === 'permissionRules/decision')).toHaveLength(2)
      expect(warn.mock.calls.some(([message]) => String(message).includes('ignorable'))).toBe(false)
      expect(appendSpy).toHaveBeenCalledTimes(2)
    } finally {
      appendSpy.mockRestore()
      versionSpy.mockRestore()
      warn.mockRestore()
      removeWorkspace(cwd)
    }
  })

  it('/rules decisions explains the disabled audit on a degraded (simulated pre-marker) host', async () => {
    const cwd = tempWorkspace()
    const harness = await mountHarness({ allowUnmarkedAudit: false }, { cwd })
    const runtime = harness.ctx.get('permissionRulesRuntime') as PermissionRulesRuntime
    const warn = vi.spyOn(harness.ctx.logger, 'warn').mockImplementation(() => undefined)
    // rc.8 peers are marker-aware; simulate the pre-marker rc.6 line so the
    // version pre-check disables session-log audit before any append.
    const versionSpy = vi.spyOn(runtime as unknown as { peerVersion(): string | null }, 'peerVersion').mockReturnValue('0.1.0-rc.6')
    try {
      await dispatchPreExecute(harness.ctx, makeExec({ name: 'bash', arguments: {}, agent: harness.agent }))
      const execution = await harness.ctx.commands.execute(harness.agent, '/rules decisions', [], new AbortController().signal)
      const text = execution?.result.kind === 'success' ? execution.result.text ?? '' : ''
      expect(text).toContain('No permission decisions recorded')
      expect(text).toContain('Session-log audit is disabled on this host')
    } finally {
      versionSpy.mockRestore()
      warn.mockRestore()
      removeWorkspace(cwd)
    }
  })
})
