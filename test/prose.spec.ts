/**
 * Prose-table smoke tests: every localized string function of every
 * language renders without throwing, and every describe-rule token is a
 * non-empty string. Translation tables are data-like behavior, but they
 * are still product-visible output — exercising them keeps the coverage
 * gate honest instead of excluding the module.
 * @module dsh-permission-rules/test/prose.spec
 */

import { describe, expect, it } from 'vitest'
import { DESCRIBE_TOKENS, UI_PROSE } from '../src/prose.ts'

const SAMPLE = {
  count: 2,
  sources: ['/a/.dsh/rules.yaml', '/b/.dsh/rules.yaml'] as readonly string[],
  cwd: '/ws',
  error: 'bad file',
  arg: 'nuke',
  shown: 1,
  total: 3,
  seq: 12,
  action: 'deny',
  tool: 'bash',
  ruleIndex: 1,
  reason: 'no pushes',
  numbers: [3, 4] as readonly number[],
  fallback: 'missing',
} as const

describe('UI_PROSE', () => {
  it.each(Object.keys(UI_PROSE) as (keyof typeof UI_PROSE)[])('renders every string of %s', (language) => {
    const prose = UI_PROSE[language]
    expect(prose.rulesHeader(SAMPLE.count, SAMPLE.sources, SAMPLE.cwd)).toContain('2')
    expect(prose.noRules(SAMPLE.cwd, prose.fallbackMissing)).toContain(SAMPLE.cwd)
    expect(prose.fallbackMissing.length).toBeGreaterThan(0)
    expect(prose.reloaded(SAMPLE.count, SAMPLE.sources.join(', '))).toContain('2')
    expect(prose.reloadFailed(SAMPLE.error)).toContain(SAMPLE.error)
    expect(prose.lastReloadWarning(SAMPLE.error)).toContain(SAMPLE.error)
    expect(prose.unknownArg(SAMPLE.arg)).toContain(SAMPLE.arg)
    expect(prose.usage.length).toBeGreaterThan(0)
    expect(prose.decisionsHeader(SAMPLE.shown, SAMPLE.total)).toContain('3')
    expect(prose.noDecisions.length).toBeGreaterThan(0)
    expect(prose.invalidDecisionsCount(SAMPLE.arg)).toContain(SAMPLE.arg)
    expect(prose.decisionLine(SAMPLE.seq, SAMPLE.action, SAMPLE.tool, SAMPLE.ruleIndex, SAMPLE.reason)).toContain(SAMPLE.tool)
    expect(prose.decisionLine(SAMPLE.seq, SAMPLE.action, SAMPLE.tool, SAMPLE.ruleIndex, SAMPLE.reason)).toContain('2')
    expect(prose.decisionLine(SAMPLE.seq, SAMPLE.action, SAMPLE.tool, undefined, undefined)).toContain(SAMPLE.tool)
    expect(prose.testHit(SAMPLE.tool, SAMPLE.ruleIndex, SAMPLE.action, SAMPLE.reason)).toContain(SAMPLE.tool)
    expect(prose.testHit(SAMPLE.tool, SAMPLE.ruleIndex, SAMPLE.action, SAMPLE.reason)).toContain('2')
    expect(prose.testNoMatch(SAMPLE.tool)).toContain(SAMPLE.tool)
    expect(prose.testBadJson(SAMPLE.arg)).toContain(SAMPLE.arg)
    expect(prose.testUsage).toContain('/rules test')
    expect(prose.unreachableWarning(SAMPLE.numbers)).toContain('3')
    expect(prose.unreachableWarning(SAMPLE.numbers)).toContain('4')
    expect(prose.emptySource.length).toBeGreaterThan(0)
  })
})

describe('DESCRIBE_TOKENS', () => {
  it.each(Object.keys(DESCRIBE_TOKENS) as (keyof typeof DESCRIBE_TOKENS)[])('provides non-empty tokens for %s', (language) => {
    for (const token of Object.values(DESCRIBE_TOKENS[language])) {
      expect(token.length).toBeGreaterThan(0)
    }
  })
})
