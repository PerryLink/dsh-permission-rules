/**
 * Wire-vocabulary tests: the zod v4 codecs shared by both Typert faces and
 * the invocation descriptors they register. A valid document must
 * round-trip through its schema unchanged, every invalid shape (bad mode
 * literal, non-integer counters, wrong types) must fail `safeParse`, and
 * the descriptors must carry the exact ids/methods/parameter codecs the
 * client Remote contribution relies on — including the frozen-object
 * discipline that keeps the two wire codecs from drifting apart.
 * @module dsh-permission-rules/test/wire
 */

import { describe, expect, it } from 'vitest'
import {
  NETWORK_STATUS_DESCRIPTOR,
  PERMISSION_RULES_INVOCATIONS,
  PERMISSION_RULES_SNAPSHOT_SCHEMA,
  RULES_READ_DESCRIPTOR,
  RULES_READ_SCHEMA,
  RULES_RELOAD_DESCRIPTOR,
  RULES_RELOAD_SCHEMA,
  RULES_SAVE_DESCRIPTOR,
  RULES_SAVE_SCHEMA,
} from '../src/wire.ts'
import type { PermissionRulesSnapshot, RulesReadResult, RulesReloadResult, RulesSaveResult } from '../src/wire.ts'

/** A fully-populated snapshot with both recent-block shapes and both source shapes. */
const VALID_SNAPSHOT: PermissionRulesSnapshot = {
  enabled: true,
  mode: 'whitelist',
  configuredMode: 'auto',
  sandboxMode: 'workspace-write',
  proxyPort: 8123,
  proxyActive: true,
  denied: 4,
  askBlocked: 1,
  recent: [
    {
      time: 1_720_000_000_000,
      tool: 'bash',
      attributed: true,
      domain: 'evil.example',
      scheme: 'https',
      port: 443,
      action: 'deny',
      mode: 'whitelist',
      matched: false,
      source: '/ws/.dsh/rules.yaml',
      ruleIndex: null,
      reason: null,
    },
    {
      time: 1_720_000_001_000,
      tool: 'subprocess',
      attributed: false,
      domain: 'good.example',
      scheme: 'http',
      port: 80,
      action: 'ask',
      mode: 'deny-all',
      matched: true,
      source: '/ws/.dsh/rules.yaml',
      ruleIndex: 2,
      reason: 'pinned',
    },
  ],
  sources: [
    { path: '/ws/.dsh/rules.yaml', exists: true, cwd: '/ws' },
    { path: '/etc/dsh/rules.yaml', exists: false, cwd: null },
  ],
}

describe('PERMISSION_RULES_SNAPSHOT_SCHEMA', () => {
  it('round-trips a fully-populated snapshot unchanged', () => {
    expect(PERMISSION_RULES_SNAPSHOT_SCHEMA.parse(VALID_SNAPSHOT)).toEqual(VALID_SNAPSHOT)
  })

  it('accepts the deny-all/allow-all modes, null sandbox, and an empty recent list', () => {
    const minimal = PERMISSION_RULES_SNAPSHOT_SCHEMA.parse({
      enabled: false,
      mode: 'allow-all',
      configuredMode: 'deny-all',
      sandboxMode: null,
      proxyPort: 0,
      proxyActive: false,
      denied: 0,
      askBlocked: 0,
      recent: [],
      sources: [],
    })
    expect(minimal.mode).toBe('allow-all')
    expect(minimal.sandboxMode).toBeNull()
  })

  it('rejects a mode outside the three network literals', () => {
    expect(PERMISSION_RULES_SNAPSHOT_SCHEMA.safeParse({ ...VALID_SNAPSHOT, mode: 'bogus' }).success).toBe(false)
    expect(PERMISSION_RULES_SNAPSHOT_SCHEMA.safeParse({ ...VALID_SNAPSHOT, configuredMode: 'ask' }).success).toBe(false)
  })

  it('rejects non-integer counters and port', () => {
    expect(PERMISSION_RULES_SNAPSHOT_SCHEMA.safeParse({ ...VALID_SNAPSHOT, proxyPort: 8123.5 }).success).toBe(false)
    expect(PERMISSION_RULES_SNAPSHOT_SCHEMA.safeParse({ ...VALID_SNAPSHOT, denied: '4' }).success).toBe(false)
    expect(PERMISSION_RULES_SNAPSHOT_SCHEMA.safeParse({ ...VALID_SNAPSHOT, askBlocked: 1.5 }).success).toBe(false)
  })

  it('rejects a missing required field', () => {
    const withoutEnabled = { ...VALID_SNAPSHOT } as Record<string, unknown>
    delete withoutEnabled.enabled
    expect(PERMISSION_RULES_SNAPSHOT_SCHEMA.safeParse(withoutEnabled).success).toBe(false)
  })

  it('rejects bad recent-block shapes', () => {
    const block = VALID_SNAPSHOT.recent[0]
    if (block === undefined) throw new Error('fixture missing recent block')
    const swapRecent = (partial: Record<string, unknown>): PermissionRulesSnapshot => ({ ...VALID_SNAPSHOT, recent: [{ ...block, ...partial }] })
    expect(PERMISSION_RULES_SNAPSHOT_SCHEMA.safeParse(swapRecent({ action: 'allow' })).success).toBe(false)
    expect(PERMISSION_RULES_SNAPSHOT_SCHEMA.safeParse(swapRecent({ scheme: 'ftp' })).success).toBe(false)
    expect(PERMISSION_RULES_SNAPSHOT_SCHEMA.safeParse(swapRecent({ port: 80.5 })).success).toBe(false)
    expect(PERMISSION_RULES_SNAPSHOT_SCHEMA.safeParse(swapRecent({ time: 'now' })).success).toBe(false)
  })

  it('rejects bad source shapes', () => {
    const source = VALID_SNAPSHOT.sources[0]
    if (source === undefined) throw new Error('fixture missing source')
    const swapSources = (partial: Record<string, unknown>): PermissionRulesSnapshot => ({ ...VALID_SNAPSHOT, sources: [{ ...source, ...partial }] })
    expect(PERMISSION_RULES_SNAPSHOT_SCHEMA.safeParse(swapSources({ path: 42 })).success).toBe(false)
    expect(PERMISSION_RULES_SNAPSHOT_SCHEMA.safeParse(swapSources({ exists: 'yes' })).success).toBe(false)
  })
})

describe('RULES_READ_SCHEMA', () => {
  it('round-trips a read result and rejects wrong types', () => {
    const result: RulesReadResult = { path: '/ws/.dsh/rules.yaml', exists: true, text: 'rules: []', error: null }
    expect(RULES_READ_SCHEMA.parse(result)).toEqual(result)
    const errored: RulesReadResult = { path: '/ws/.dsh/rules.yaml', exists: false, text: '', error: 'refusing read' }
    expect(RULES_READ_SCHEMA.parse(errored)).toEqual(errored)
    expect(RULES_READ_SCHEMA.safeParse({ ...result, exists: 1 }).success).toBe(false)
    expect(RULES_READ_SCHEMA.safeParse({ ...result, path: null }).success).toBe(false)
    expect(RULES_READ_SCHEMA.safeParse({ ...result, error: 7 }).success).toBe(false)
  })
})

describe('RULES_SAVE_SCHEMA', () => {
  it('round-trips a save result and rejects wrong types', () => {
    const result: RulesSaveResult = { ok: true, error: null, reloaded: 3 }
    expect(RULES_SAVE_SCHEMA.parse(result)).toEqual(result)
    const failed: RulesSaveResult = { ok: false, error: 'not a known source', reloaded: null }
    expect(RULES_SAVE_SCHEMA.parse(failed)).toEqual(failed)
    expect(RULES_SAVE_SCHEMA.safeParse({ ok: 'yes', error: null, reloaded: 0 }).success).toBe(false)
    expect(RULES_SAVE_SCHEMA.safeParse({ ok: true, error: null, reloaded: 1.5 }).success).toBe(false)
  })
})

describe('RULES_RELOAD_SCHEMA', () => {
  it('round-trips a reload result and rejects wrong types', () => {
    const result: RulesReloadResult = { ok: true, error: null }
    expect(RULES_RELOAD_SCHEMA.parse(result)).toEqual(result)
    const failed: RulesReloadResult = { ok: false, error: 'reload boom' }
    expect(RULES_RELOAD_SCHEMA.parse(failed)).toEqual(failed)
    expect(RULES_RELOAD_SCHEMA.safeParse({ ok: 1, error: null }).success).toBe(false)
  })
})

describe('invocation descriptors', () => {
  it('NETWORK_STATUS_DESCRIPTOR names the zero-parameter networkStatus invocation', () => {
    expect(NETWORK_STATUS_DESCRIPTOR.id).toBe('dsh-permission-rules#permissionRules/networkStatus')
    expect(NETWORK_STATUS_DESCRIPTOR.service).toBe('permissionRules')
    expect(NETWORK_STATUS_DESCRIPTOR.namespace).toBe('permissionRules')
    expect(NETWORK_STATUS_DESCRIPTOR.method).toBe('networkStatus')
    expect(NETWORK_STATUS_DESCRIPTOR.invocation).toEqual({ kind: 'direct' })
    expect(NETWORK_STATUS_DESCRIPTOR.parameters).toEqual([])
    expect(NETWORK_STATUS_DESCRIPTOR.result).toEqual({
      mode: 'strict',
      typeSymbol: 'dsh-permission-rules/types#PermissionRulesSnapshot',
      schema: PERMISSION_RULES_SNAPSHOT_SCHEMA,
    })
    expect(NETWORK_STATUS_DESCRIPTOR.sourceLocation.file).toBe('src/wire.ts')
  })

  it('RULES_READ_DESCRIPTOR declares one string path parameter and the read-result codec', () => {
    expect(RULES_READ_DESCRIPTOR.id).toBe('dsh-permission-rules#permissionRules/rulesRead')
    expect(RULES_READ_DESCRIPTOR.method).toBe('rulesRead')
    const parameters = RULES_READ_DESCRIPTOR.parameters
    expect(parameters).toHaveLength(1)
    const param = parameters[0]
    if (param === undefined) throw new Error('fixture: rulesRead descriptor has no parameters')
    expect(param).toMatchObject({ name: 'path', wire: 'path', source: 'json' })
    expect(param.codec).toMatchObject({ mode: 'strict', typeSymbol: 'dsh-permission-rules/types#RulesReadRequestPath' })
    expect(param.codec.schema.safeParse('/ws/rules.yaml').success).toBe(true)
    expect(param.codec.schema.safeParse(42).success).toBe(false)
    expect(RULES_READ_DESCRIPTOR.result.schema).toBe(RULES_READ_SCHEMA)
  })

  it('RULES_SAVE_DESCRIPTOR declares path and text string parameters in order', () => {
    expect(RULES_SAVE_DESCRIPTOR.id).toBe('dsh-permission-rules#permissionRules/rulesSave')
    expect(RULES_SAVE_DESCRIPTOR.method).toBe('rulesSave')
    expect(RULES_SAVE_DESCRIPTOR.parameters.map(param => param.name)).toEqual(['path', 'text'])
    for (const param of RULES_SAVE_DESCRIPTOR.parameters) {
      expect(param.codec.schema.safeParse('anything').success).toBe(true)
      expect(param.codec.schema.safeParse({ nested: true }).success).toBe(false)
    }
    expect(RULES_SAVE_DESCRIPTOR.result.schema).toBe(RULES_SAVE_SCHEMA)
  })

  it('RULES_RELOAD_DESCRIPTOR declares the zero-parameter reload invocation', () => {
    expect(RULES_RELOAD_DESCRIPTOR.id).toBe('dsh-permission-rules#permissionRules/reload')
    expect(RULES_RELOAD_DESCRIPTOR.method).toBe('reload')
    expect(RULES_RELOAD_DESCRIPTOR.invocation).toEqual({ kind: 'direct' })
    expect(RULES_RELOAD_DESCRIPTOR.parameters).toEqual([])
    expect(RULES_RELOAD_DESCRIPTOR.result.schema).toBe(RULES_RELOAD_SCHEMA)
  })

  it('every descriptor and its nested payloads are frozen (shared codec discipline)', () => {
    for (const descriptor of PERMISSION_RULES_INVOCATIONS) {
      expect(Object.isFrozen(descriptor)).toBe(true)
      expect(Object.isFrozen(descriptor.invocation)).toBe(true)
      expect(Object.isFrozen(descriptor.result)).toBe(true)
      expect(Object.isFrozen(descriptor.parameters)).toBe(true)
      for (const param of descriptor.parameters) {
        expect(Object.isFrozen(param)).toBe(true)
        expect(Object.isFrozen(param.codec)).toBe(true)
      }
    }
  })

  it('PERMISSION_RULES_INVOCATIONS lists the four descriptors by identity, shared with the host manifest', () => {
    expect(PERMISSION_RULES_INVOCATIONS).toHaveLength(4)
    expect(PERMISSION_RULES_INVOCATIONS[0]).toBe(NETWORK_STATUS_DESCRIPTOR)
    expect(PERMISSION_RULES_INVOCATIONS[1]).toBe(RULES_READ_DESCRIPTOR)
    expect(PERMISSION_RULES_INVOCATIONS[2]).toBe(RULES_SAVE_DESCRIPTOR)
    expect(PERMISSION_RULES_INVOCATIONS[3]).toBe(RULES_RELOAD_DESCRIPTOR)
    expect(Object.isFrozen(PERMISSION_RULES_INVOCATIONS)).toBe(true)
    expect(new Set(PERMISSION_RULES_INVOCATIONS.map(descriptor => descriptor.method))).toEqual(
      new Set(['networkStatus', 'rulesRead', 'rulesSave', 'reload']),
    )
  })
})
