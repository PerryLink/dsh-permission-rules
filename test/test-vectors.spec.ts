/**
 * The shared rule-syntax conformance corpus (docs/rule-test-vectors/corpus.json):
 * every vector compiles through the real parser/compiler and every case must
 * evaluate to its declared first-match decision. This file is the reference
 * implementation of the corpus contract — a second gate consuming the same
 * JSON must produce the same table (see docs/rule-test-vectors/README.md).
 * @module dsh-permission-rules/test/test-vectors.spec
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileRulesChain, matchRules, type MatchContext } from '../src/rules.ts'

/** One case inside a vector: the call shape plus the expected first-match action (null = passthrough). */
interface VectorCase {
  readonly tool: string
  readonly arguments: Record<string, unknown>
  readonly context?: MatchContext
  readonly expect: 'allow' | 'ask' | 'deny' | null
}

/** One self-contained vector: rule text plus its cases. */
interface Vector {
  readonly id: string
  readonly purpose: string
  readonly rules: string
  readonly cases: readonly VectorCase[]
}

/** The corpus envelope (schema dsh-rule-test-vectors/v1). */
interface Corpus {
  readonly schema: 'dsh-rule-test-vectors/v1'
  readonly workspace: string
  readonly vectors: readonly Vector[]
}

const GLOB = { patternMode: 'glob', maxRules: 256, maxGlobStars: 2, caseInsensitivePaths: false } as const

const corpus = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'docs', 'rule-test-vectors', 'corpus.json'), 'utf8'),
) as Corpus

describe('shared rule-syntax test vectors', () => {
  it('declares the current corpus schema', () => {
    expect(corpus.schema).toBe('dsh-rule-test-vectors/v1')
    expect(corpus.vectors.length).toBeGreaterThanOrEqual(10)
  })

  for (const vector of corpus.vectors) {
    it(`${vector.id}: ${vector.purpose}`, () => {
      expect(vector.cases.length).toBeGreaterThan(0)
      const { ruleset } = compileRulesChain([{ path: `/${vector.id}/rules.yaml`, text: vector.rules }], GLOB)
      for (const [index, testCase] of vector.cases.entries()) {
        const hit = matchRules(ruleset, testCase.tool, testCase.arguments, corpus.workspace, testCase.context)
        const actual = hit === undefined ? null : hit.rule.action
        expect(actual, `case ${index} (${testCase.tool} ${JSON.stringify(testCase.arguments)})`).toBe(testCase.expect)
      }
    })
  }
})
