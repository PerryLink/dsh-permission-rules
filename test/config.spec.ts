/**
 * Config resolution tests: defaults, numeric validation, the searchUp
 * constraints, and the bad-file/policy vocabulary.
 * @module dsh-permission-rules/test/config.spec
 */

import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'

describe('resolveConfig', () => {
  it('fills every default (case-insensitivity follows the platform)', () => {
    const resolved = resolveConfig()
    expect(resolved).toMatchObject({
      rulesFile: '.dsh/rules.yaml',
      fallbackPath: undefined,
      badFilePolicy: 'fail',
      maxRules: 256,
      maxCachedWorkspaces: 512,
      patternMode: 'glob',
      watch: true,
      watchStabilityThresholdMs: 200,
      language: 'en',
      audit: 'all',
      searchUp: false,
      maxGlobStars: 2,
    })
    expect(resolved.caseInsensitivePaths).toBe(process.platform === 'win32')
  })

  it('preserves explicit values', () => {
    const resolved = resolveConfig({
      rulesFile: '.rules.yml',
      fallbackPath: '/etc/rules.yaml',
      badFilePolicy: 'ignore-with-warning',
      maxRules: 16,
      maxCachedWorkspaces: 64,
      patternMode: 'regex',
      watch: false,
      watchStabilityThresholdMs: 50,
      language: 'zh',
      caseInsensitivePaths: true,
      audit: 'hits',
      searchUp: true,
      maxGlobStars: 1,
    })
    expect(resolved.rulesFile).toBe('.rules.yml')
    expect(resolved.fallbackPath).toBe('/etc/rules.yaml')
    expect(resolved.badFilePolicy).toBe('ignore-with-warning')
    expect(resolved.maxRules).toBe(16)
    expect(resolved.maxCachedWorkspaces).toBe(64)
    expect(resolved.patternMode).toBe('regex')
    expect(resolved.watch).toBe(false)
    expect(resolved.watchStabilityThresholdMs).toBe(50)
    expect(resolved.language).toBe('zh')
    expect(resolved.caseInsensitivePaths).toBe(true)
    expect(resolved.audit).toBe('hits')
    expect(resolved.searchUp).toBe(true)
    expect(resolved.maxGlobStars).toBe(1)
  })

  it('fails loud on non-positive or non-integer maxRules', () => {
    expect(() => resolveConfig({ maxRules: 0 })).toThrow(/maxRules/)
    expect(() => resolveConfig({ maxRules: 1.5 })).toThrow(/maxRules/)
    expect(() => resolveConfig({ maxRules: Number.NaN })).toThrow(/maxRules/)
  })

  it('fails loud on invalid maxCachedWorkspaces', () => {
    expect(() => resolveConfig({ maxCachedWorkspaces: 0 })).toThrow(/maxCachedWorkspaces/)
    expect(() => resolveConfig({ maxCachedWorkspaces: 2.5 })).toThrow(/maxCachedWorkspaces/)
  })

  it('fails loud on invalid maxGlobStars', () => {
    expect(() => resolveConfig({ maxGlobStars: 0 })).toThrow(/maxGlobStars/)
    expect(() => resolveConfig({ maxGlobStars: -1 })).toThrow(/maxGlobStars/)
    expect(() => resolveConfig({ maxGlobStars: 1.5 })).toThrow(/maxGlobStars/)
  })

  it('fails loud on searchUp combined with an absolute rulesFile', () => {
    // POSIX absolute paths are absolute on every platform.
    expect(() => resolveConfig({ searchUp: true, rulesFile: '/etc/rules.yaml' })).toThrow(/searchUp cannot be combined with an absolute rulesFile/)
  })

  it.skipIf(process.platform !== 'win32')('rejects a Windows drive path on Windows hosts', () => {
    expect(() => resolveConfig({ searchUp: true, rulesFile: 'C:\\global\\rules.yaml' })).toThrow(/searchUp/)
  })

  it('fails loud on negative stability windows', () => {
    expect(() => resolveConfig({ watchStabilityThresholdMs: -1 })).toThrow(/watchStabilityThresholdMs/)
  })
})
