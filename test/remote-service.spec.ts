/**
 * Remote-service unit tests: the `permissionRules` Typert Remote bridge
 * must map the runtime's snapshot (counters, recent blocks with and
 * without rule attribution, known sources with and without an owner) onto
 * the strict wire vocabulary, forward read/save/reload verbatim, and
 * contain audit or reload failures so the settings page always gets a
 * well-formed result. The service is driven by a structural runtime
 * stand-in — no proxy, no real rule files beyond one exists-check fixture.
 * @module dsh-permission-rules/test/remote-service
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { PermissionRulesRemoteService } from '../src/remote-service.ts'
import type { PermissionRulesRuntime } from '../src/runtime.ts'
import type { NetworkBlockRecord } from '../src/proxy.ts'

/** A fully-attributed proxy block (all optional fields present). */
const FULL_BLOCK: NetworkBlockRecord = {
  time: 1_720_000_000_000,
  tool: 'bash',
  attributed: true,
  callId: 'call-9' as never,
  domain: 'evil.example',
  scheme: 'https',
  port: 443,
  action: 'deny',
  mode: 'whitelist',
  matched: true,
  source: '/ws/.dsh/rules.yaml',
  ruleIndex: 2,
  reason: 'no mirrors',
}

/** A mode-default block (no rule attribution — the optional fields are absent). */
const MODE_BLOCK: NetworkBlockRecord = {
  time: 1_720_000_001_000,
  tool: 'subprocess',
  attributed: false,
  domain: 'unlisted.example',
  action: 'ask',
  mode: 'deny-all',
  matched: false,
  source: '',
}

/** Build a service over the given runtime stand-in. */
function serviceOver(runtime: Partial<PermissionRulesRuntime>): PermissionRulesRemoteService {
  return new PermissionRulesRemoteService(new Context(), { runtime: runtime as PermissionRulesRuntime })
}

describe('PermissionRulesRemoteService.networkStatus', () => {
  it('maps the snapshot, block attribution (nulls when absent), and source owners onto the wire shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-permission-rules-remote-'))
    try {
      const existing = join(dir, 'rules.yaml')
      writeFileSync(existing, 'rules: []', 'utf8')
      const missing = join(dir, 'missing.yaml')
      const service = serviceOver({
        networkSnapshot: () => ({
          enabled: true,
          mode: 'deny-all',
          configuredMode: 'auto',
          sandboxMode: undefined,
          proxyPort: 8123,
          proxyActive: true,
          denied: 2,
          askBlocked: 1,
          recent: [FULL_BLOCK, MODE_BLOCK],
        }),
        knownRuleSources: () => [existing, missing],
        sourceOwner: (path: string) => (path === existing ? dir : undefined),
      })
      const snapshot = service.networkStatus()
      expect(snapshot).toMatchObject({
        enabled: true,
        mode: 'deny-all',
        configuredMode: 'auto',
        sandboxMode: null,
        proxyPort: 8123,
        proxyActive: true,
        denied: 2,
        askBlocked: 1,
      })
      // The attributed block keeps its optional fields…
      expect(snapshot.recent[0]).toMatchObject({ scheme: 'https', port: 443, ruleIndex: 2, reason: 'no mirrors', domain: 'evil.example' })
      // …and the mode-default block maps the absent fields to null.
      expect(snapshot.recent[1]).toMatchObject({ scheme: null, port: null, ruleIndex: null, reason: null, tool: 'subprocess' })
      // Existing sources carry exists + owner; missing ones exists: false + null cwd.
      expect(snapshot.sources).toEqual([
        { path: existing, exists: true, cwd: dir },
        { path: missing, exists: false, cwd: null },
      ])
      expect(existsSync(existing)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes the sandbox preset through when the mode mapping names one', () => {
    const service = serviceOver({
      networkSnapshot: () => ({
        enabled: true,
        mode: 'allow-all',
        configuredMode: 'allow-all',
        sandboxMode: 'danger-full-access',
        proxyPort: 0,
        proxyActive: false,
        denied: 0,
        askBlocked: 0,
        recent: [],
      }),
      knownRuleSources: () => [],
      sourceOwner: () => undefined,
    })
    const snapshot = service.networkStatus()
    expect(snapshot.mode).toBe('allow-all')
    expect(snapshot.configuredMode).toBe('allow-all')
    expect(snapshot.sandboxMode).toBe('danger-full-access')
    expect(snapshot.sources).toEqual([])
    expect(snapshot.recent).toEqual([])
  })
})

describe('PermissionRulesRemoteService.rulesRead and rulesSave', () => {
  it('forwards read results verbatim, mapping the optional error to null', () => {
    const service = serviceOver({
      readRuleFile: (path: string) => ({ path, exists: true, text: 'rules: []' }),
    })
    expect(service.rulesRead('/ws/.dsh/rules.yaml')).toEqual({ path: '/ws/.dsh/rules.yaml', exists: true, text: 'rules: []', error: null })
  })

  it('forwards read failures with the runtime error text', () => {
    const service = serviceOver({
      readRuleFile: (path: string) => ({ path, exists: true, text: '', error: 'EACCES: permission denied' }),
    })
    expect(service.rulesRead('/ws/.dsh/rules.yaml')).toEqual({ path: '/ws/.dsh/rules.yaml', exists: true, text: '', error: 'EACCES: permission denied' })
  })

  it('forwards save results verbatim, mapping the optional error and reloaded count', () => {
    const ok = serviceOver({
      saveRuleFile: (_path: string, _text: string) => ({ ok: true, reloaded: 3 }),
    })
    expect(ok.rulesSave('/ws/.dsh/rules.yaml', 'rules: []')).toEqual({ ok: true, error: null, reloaded: 3 })

    const refused = serviceOver({
      saveRuleFile: (path: string) => ({ ok: false, error: `refusing to write ${path}: not a known rule source` }),
    })
    expect(refused.rulesSave('/etc/outside.yaml', 'rules: []')).toEqual({ ok: false, error: 'refusing to write /etc/outside.yaml: not a known rule source', reloaded: null })
  })
})

describe('PermissionRulesRemoteService.reload', () => {
  it('reports success when every cached chain re-reads cleanly', () => {
    const service = serviceOver({ reloadAll: () => undefined })
    expect(service.reload()).toEqual({ ok: true, error: null })
  })

  it('contains an Error thrown by the reload pass into a structured failure', () => {
    const service = serviceOver({
      reloadAll: () => {
        throw new Error('reload boom')
      },
    })
    expect(service.reload()).toEqual({ ok: false, error: 'reload boom' })
  })

  it('stringifies a non-Error throw so the settings page never sees an exception', () => {
    const service = serviceOver({
      reloadAll: () => {
        throw { code: 'EIO' }
      },
    })
    expect(service.reload()).toEqual({ ok: false, error: '[object Object]' })
  })
})

describe('PermissionRulesRemoteService registration', () => {
  it('registers as the permissionRules service with the typert remote binding', () => {
    const ctx = new Context()
    const service = new PermissionRulesRemoteService(ctx, { runtime: {} as PermissionRulesRuntime })
    expect(service.name).toBe('permissionRules')
    expect(service.typertRemote).toMatchObject({ serviceKey: 'permissionRules', namespace: 'permissionRules' })
    expect(ctx.get('permissionRules')).toBeDefined()
  })
})
