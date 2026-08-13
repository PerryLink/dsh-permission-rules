/**
 * Config resolution tests: defaults, numeric validation, and the
 * bad-file/policy vocabulary.
 * @module dsh-permission-rules/test/config.spec
 */

import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'

describe('resolveConfig', () => {
  it('fills every default', () => {
    const resolved = resolveConfig()
    expect(resolved).toEqual({
      rulesFile: '.dsh/rules.yaml',
      fallbackPath: undefined,
      badFilePolicy: 'fail',
      maxRules: 256,
      patternMode: 'glob',
      watch: true,
      watchStabilityThresholdMs: 200,
    })
  })

  it('preserves explicit values', () => {
    const resolved = resolveConfig({
      rulesFile: '.rules.yml',
      fallbackPath: '/etc/rules.yaml',
      badFilePolicy: 'ignore-with-warning',
      maxRules: 16,
      patternMode: 'regex',
      watch: false,
      watchStabilityThresholdMs: 50,
    })
    expect(resolved.rulesFile).toBe('.rules.yml')
    expect(resolved.fallbackPath).toBe('/etc/rules.yaml')
    expect(resolved.badFilePolicy).toBe('ignore-with-warning')
    expect(resolved.maxRules).toBe(16)
    expect(resolved.patternMode).toBe('regex')
    expect(resolved.watch).toBe(false)
    expect(resolved.watchStabilityThresholdMs).toBe(50)
  })

  it('fails loud on non-positive or non-integer maxRules', () => {
    expect(() => resolveConfig({ maxRules: 0 })).toThrow(/maxRules/)
    expect(() => resolveConfig({ maxRules: 1.5 })).toThrow(/maxRules/)
    expect(() => resolveConfig({ maxRules: Number.NaN })).toThrow(/maxRules/)
  })

  it('fails loud on negative stability windows', () => {
    expect(() => resolveConfig({ watchStabilityThresholdMs: -1 })).toThrow(/watchStabilityThresholdMs/)
  })
})
