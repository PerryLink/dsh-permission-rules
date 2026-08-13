/**
 * Pure parser/matcher tests: YAML validation (fail-loud vocabulary), glob
 * and regex compilation, param/path dimension semantics, first-match
 * ordering, passthrough, and the `maxRules` cap.
 * @module dsh-permission-rules/test/rules.spec
 */

import { describe, expect, it } from 'vitest'
import {
  compileRules,
  describeRule,
  extractPathCandidates,
  matchRules,
  normalizeWorkspacePath,
  parseRulesDocument,
  RuleError,
} from '../src/rules.ts'
import { compileGlob, GlobError } from '../src/glob.ts'

const GLOB = { patternMode: 'glob', maxRules: 256 } as const
const REGEX = { patternMode: 'regex', maxRules: 256 } as const

function rules(yaml: string, options: { patternMode: 'glob' | 'regex'; maxRules: number } = GLOB) {
  return compileRules(parseRulesDocument(yaml), options)
}

const CWD = '/ws/project'

describe('parseRulesDocument', () => {
  it('parses the shipped example shape (tools + params + paths, and a tools-only rule)', () => {
    const doc = parseRulesDocument(`
rules:
  - match: { tools: [bash, pwsh], params: { command: "git push*" }, paths: ["**/secrets/**"] }
    action: deny
    reason: "禁止 push 到受保护路径"
  - match: { tools: [edit, write] }
    action: ask
    reason: "写文件需要确认"
`)
    expect(doc.rules).toHaveLength(2)
    expect(doc.rules[0]?.match.tools).toEqual(['bash', 'pwsh'])
    expect(doc.rules[0]?.match.params).toEqual({ command: ['git push*'] })
    expect(doc.rules[0]?.match.paths).toEqual(['**/secrets/**'])
    expect(doc.rules[0]?.action).toBe('deny')
    expect(doc.rules[1]?.match.params).toEqual({})
    expect(doc.rules[1]?.action).toBe('ask')
  })

  it('accepts a param pattern list and an empty/missing rules list', () => {
    const doc = parseRulesDocument(`rules:
  - match: { params: { command: ["npm publish*", "pnpm publish*"] } }
    action: ask
    reason: release
`)
    expect(doc.rules[0]?.match.params['command']).toEqual(['npm publish*', 'pnpm publish*'])
    expect(parseRulesDocument('').rules).toEqual([])
    expect(parseRulesDocument('rules: []').rules).toEqual([])
  })

  it('fails loud on unknown top-level, rule, and match fields', () => {
    expect(() => parseRulesDocument('rules: []\nextra: 1')).toThrowError(RuleError)
    expect(() => parseRulesDocument('rules:\n  - action: deny\n    reason: x\n    extra: 1')).toThrow(/rule 1: unknown field/)
    expect(() => parseRulesDocument('rules:\n  - match: { tools: [bash], extra: 1 }\n    action: deny\n    reason: x')).toThrow(/rule 1\.match: unknown field/)
  })

  it('fails loud on invalid actions, missing reasons, and wrong shapes', () => {
    expect(() => parseRulesDocument('rules:\n  - match: {}\n    action: maybe\n    reason: x')).toThrow(/action must be one of/)
    expect(() => parseRulesDocument('rules:\n  - match: {}\n    action: deny')).toThrow(/reason must be a non-empty string/)
    expect(() => parseRulesDocument('rules:\n  - match: {}\n    action: deny\n    reason: " "')).toThrow(/reason must be a non-empty string/)
    expect(() => parseRulesDocument('rules: not-a-list')).toThrow(/"rules" must be a list/)
    expect(() => parseRulesDocument('rules:\n  - match: [bash]\n    action: deny\n    reason: x')).toThrow(/rule 1\.match must be a mapping/)
    expect(() => parseRulesDocument('rules:\n  - match: { params: { command: { nested: true } } }\n    action: deny\n    reason: x')).toThrow(/must be a string, number, boolean, or a list/)
  })

  it('fails loud on invalid YAML', () => {
    expect(() => parseRulesDocument('rules:\n  - [unclosed')).toThrow(/invalid YAML/)
  })
})

describe('compileGlob', () => {
  it('supports stars, globstars, classes, escapes, and segment semantics', () => {
    expect(compileGlob('src/**/test.ts', { segments: true }).test('src/a/b/test.ts')).toBe(true)
    expect(compileGlob('src/**/test.ts', { segments: true }).test('src/test.ts')).toBe(true)
    expect(compileGlob('src/*/test.ts', { segments: true }).test('src/a/b/test.ts')).toBe(false)
    expect(compileGlob('a[bc]d', { segments: true }).test('abd')).toBe(true)
    expect(compileGlob('a[!bc]d', { segments: true }).test('abd')).toBe(false)
    expect(compileGlob('a[!bc]d', { segments: true }).test('axd')).toBe(true)
    expect(compileGlob('git\\ push*', { segments: false }).test('git push origin')).toBe(true)
    expect(compileGlob('*.md', { segments: true }).test('README.md')).toBe(true)
  })

  it('lets `*` cross `/` in non-segment mode (params)', () => {
    expect(compileGlob('git push*', { segments: false }).test('git push origin https://host/x')).toBe(true)
    expect(compileGlob('git push*', { segments: true }).test('git push origin https://host/x')).toBe(false)
  })

  it('fails loud on bad globs', () => {
    expect(() => compileGlob('a[bc', { segments: true })).toThrowError(GlobError)
    expect(() => compileGlob('a[]', { segments: true })).toThrowError(GlobError)
    expect(() => compileGlob('a\\', { segments: true })).toThrowError(GlobError)
  })
})

describe('matchRules — three-state dispatch and ordering', () => {
  it('returns deny/ask/allow hits and undefined passthrough', () => {
    const set = rules(`
rules:
  - match: { tools: [bash] }
    action: deny
    reason: no bash
  - match: { tools: [edit] }
    action: ask
    reason: confirm edits
  - match: { tools: [read] }
    action: allow
    reason: reads fine
`)
    expect(matchRules(set, 'bash', {}, CWD)?.rule.action).toBe('deny')
    expect(matchRules(set, 'edit', {}, CWD)?.rule.action).toBe('ask')
    expect(matchRules(set, 'read', {}, CWD)?.rule.action).toBe('allow')
    expect(matchRules(set, 'glob', {}, CWD)).toBeUndefined()
  })

  it('first match wins even when a later rule also matches', () => {
    const set = rules(`
rules:
  - match: { tools: [bash] }
    action: allow
    reason: baseline
  - match: { params: { command: "rm *" } }
    action: deny
    reason: no rm
`)
    const hit = matchRules(set, 'bash', { command: 'rm -rf /' }, CWD)
    expect(hit?.ruleIndex).toBe(0)
    expect(hit?.rule.action).toBe('allow')
  })

  it('reports the 0-based rule index', () => {
    const set = rules('rules:\n  - match: { tools: [bash] }\n    action: deny\n    reason: x')
    expect(matchRules(set, 'bash', {}, CWD)?.ruleIndex).toBe(0)
  })

  it('matches mcp__-prefixed tool names by glob', () => {
    const set = rules('rules:\n  - match: { tools: [mcp__*] }\n    action: ask\n    reason: mcp gate')
    expect(matchRules(set, 'mcp__filesystem__read', {}, CWD)?.rule.action).toBe('ask')
    expect(matchRules(set, 'read', {}, CWD)).toBeUndefined()
  })
})

describe('matchRules — params dimension', () => {
  it('requires every listed key and matches globs across `/`', () => {
    const set = rules(`
rules:
  - match: { params: { command: "git push*", remote: "origin" } }
    action: deny
    reason: no push
`)
    expect(matchRules(set, 'bash', { command: 'git push origin https://host/x', remote: 'origin' }, CWD)?.rule.action).toBe('deny')
    expect(matchRules(set, 'bash', { command: 'git status' }, CWD)).toBeUndefined()
    expect(matchRules(set, 'bash', { remote: 'origin' }, CWD)).toBeUndefined()
  })

  it('stringifies scalars and matches array elements any-of', () => {
    const set = rules('rules:\n  - match: { params: { port: 443 } }\n    action: deny\n    reason: x')
    expect(matchRules(set, 'web_fetch', { port: 443 }, CWD)?.rule.action).toBe('deny')
    const setArray = rules('rules:\n  - match: { params: { files: "*.env" } }\n    action: ask\n    reason: x')
    expect(matchRules(setArray, 'read', { files: ['a.ts', 'b.env'] }, CWD)?.rule.action).toBe('ask')
    expect(matchRules(setArray, 'read', { files: ['a.ts'] }, CWD)).toBeUndefined()
  })

  it('treats object-valued params as non-matching', () => {
    const set = rules('rules:\n  - match: { params: { command: "*" } }\n    action: deny\n    reason: x')
    expect(matchRules(set, 'bash', { command: { nested: true } }, CWD)).toBeUndefined()
  })

  it('supports regex mode (unanchored)', () => {
    const set = rules('rules:\n  - match: { params: { command: \'rm\\s+-[a-z]+\\s+/\' } }\n    action: deny\n    reason: x', REGEX)
    expect(matchRules(set, 'bash', { command: 'sudo rm -rf /etc' }, CWD)?.rule.action).toBe('deny')
    expect(matchRules(set, 'bash', { command: 'ls /etc' }, CWD)).toBeUndefined()
  })
})

describe('matchRules — paths dimension', () => {
  it('matches workspace-relative candidates with segment globs', () => {
    const set = rules('rules:\n  - match: { paths: ["**/secrets/**"] }\n    action: deny\n    reason: protected')
    expect(matchRules(set, 'read', { path: 'src/secrets/key.pem' }, CWD)?.rule.action).toBe('deny')
    expect(matchRules(set, 'read', { path: 'secrets/key.pem' }, CWD)?.rule.action).toBe('deny')
    expect(matchRules(set, 'read', { path: 'src/public/key.pem' }, CWD)).toBeUndefined()
  })

  it('resolves absolute in-cwd candidates to relative form', () => {
    const set = rules('rules:\n  - match: { paths: ["**/*.env"] }\n    action: deny\n    reason: x')
    expect(matchRules(set, 'read', { file_path: '/ws/project/.env' }, CWD)?.rule.action).toBe('deny')
  })

  it('normalizes windows separators and drive-prefixed candidates', () => {
    const winCwd = 'D:\\ws\\project'
    const set = rules('rules:\n  - match: { paths: ["**/secrets/**"] }\n    action: deny\n    reason: x')
    expect(matchRules(set, 'read', { path: 'src\\secrets\\key.pem' }, winCwd)?.rule.action).toBe('deny')
    expect(matchRules(set, 'read', { path: 'D:\\ws\\project\\secrets\\key.pem' }, winCwd)?.rule.action).toBe('deny')
    expect(matchRules(set, 'read', { path: 'C:\\elsewhere\\secrets\\key.pem' }, winCwd)).toBeUndefined()
  })

  it('requires at least one candidate; a rule with paths never matches arg-less tools', () => {
    const set = rules('rules:\n  - match: { paths: ["**/*.md"] }\n    action: deny\n    reason: x')
    expect(matchRules(set, 'bash', { command: 'ls' }, CWD)).toBeUndefined()
    expect(matchRules(set, 'bash', 'not-an-object', CWD)).toBeUndefined()
  })

  it('collects candidates only from the documented path keys', () => {
    expect(extractPathCandidates({ path: 'a', file_path: 'b', files: ['c', 'd'], command: 'x', nested: 'n' }))
      .toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('normalizeWorkspacePath', () => {
  it('drops outside-root absolutes and keeps ../ relative forms', () => {
    expect(normalizeWorkspacePath('/ws/project', '../other/x')).toBe('../other/x')
    expect(normalizeWorkspacePath('/ws/project', '/etc/passwd')).toBe('')
    expect(normalizeWorkspacePath('/ws/project', './a/b')).toBe('a/b')
    expect(normalizeWorkspacePath('D:\\ws', 'C:\\other\\x')).toBe('')
  })
})

describe('compileRules — limits and loud failures', () => {
  it('fails the compile when the rule count exceeds maxRules, accepts the limit', () => {
    const many = `rules:\n${Array.from({ length: 5 }, (_, i) => `  - match: { tools: [t${i}] }\n    action: allow\n    reason: r`).join('\n')}`
    expect(() => compileRules(parseRulesDocument(many), { patternMode: 'glob', maxRules: 4 })).toThrow(/exceeds maxRules 4/)
    expect(compileRules(parseRulesDocument(many), { patternMode: 'glob', maxRules: 5 }).rules).toHaveLength(5)
  })

  it('fails the compile on invalid globs and invalid regexes', () => {
    expect(() => rules('rules:\n  - match: { tools: "a[bc" }\n    action: allow\n    reason: x')).toThrowError(GlobError)
    expect(() => rules('rules:\n  - match: { paths: ["**/secrets/**"] }\n    action: deny\n    reason: x', REGEX)).toThrow(/not a valid regular expression/)
  })
})

describe('describeRule', () => {
  it('renders a 1-based, dimensions-named single line', () => {
    const set = rules(`
rules:
  - match: { tools: [bash, pwsh], params: { command: "git push*" } }
    action: deny
    reason: no push
`)
    expect(describeRule(set.rules[0]!)).toBe('1. deny [tools:bash,pwsh params:command=git push*]: no push')
  })
})
