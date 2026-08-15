/**
 * Pure parser/matcher tests: YAML validation (fail-loud vocabulary), glob
 * and regex compilation (including the catastrophic-backtracking guards),
 * param/path/absent/when dimension semantics, rule metadata, first-match
 * ordering, chain merging, shadow detection, passthrough, and the caps.
 * @module dsh-permission-rules/test/rules.spec
 */

import { describe, expect, it } from 'vitest'
import {
  compileRules,
  compileRulesChain,
  describeRule,
  extractPathCandidates,
  findUnreachableRules,
  matchRules,
  normalizeWorkspacePath,
  parseRulesDocument,
  RuleError,
} from '../src/rules.ts'
import { DESCRIBE_TOKENS } from '../src/prose.ts'
import { compileGlob, compilePatternRegex, GlobError } from '../src/glob.ts'

const GLOB = { patternMode: 'glob', maxRules: 256, maxGlobStars: 2, caseInsensitivePaths: false } as const
const REGEX = { patternMode: 'regex', maxRules: 256, maxGlobStars: 2, caseInsensitivePaths: false } as const
const CI = { patternMode: 'glob', maxRules: 256, maxGlobStars: 2, caseInsensitivePaths: true } as const

function rules(yaml: string, options: { patternMode: 'glob' | 'regex'; maxRules: number; maxGlobStars: number; caseInsensitivePaths: boolean } = GLOB) {
  return compileRules(parseRulesDocument(yaml), options)
}

const CWD = '/ws/project'
const EN = DESCRIBE_TOKENS.en

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
    expect(doc.rules[0]?.match.absent).toEqual([])
    expect(doc.rules[0]?.match.when).toEqual({ env: {}, platform: [] })
    expect(doc.rules[0]?.enabled).toBe(true)
    expect(doc.rules[0]?.tags).toEqual([])
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

  it('parses rule metadata (enabled/description/tags) and new match dimensions (absent/when)', () => {
    const doc = parseRulesDocument(`
rules:
  - match: { tools: [bash], absent: [command], when: { env: { CI: "1" }, platform: [linux, win32] } }
    action: ask
    reason: gated
    enabled: false
    description: "hold shell until CI"
    tags: [shell, safety]
`)
    const rule = doc.rules[0]!
    expect(rule.enabled).toBe(false)
    expect(rule.description).toBe('hold shell until CI')
    expect(rule.tags).toEqual(['shell', 'safety'])
    expect(rule.match.absent).toEqual(['command'])
    expect(rule.match.when).toEqual({ env: { CI: ['1'] }, platform: ['linux', 'win32'] })
  })

  it('fails loud on unknown top-level, rule, and match fields', () => {
    expect(() => parseRulesDocument('rules: []\nextra: 1')).toThrowError(RuleError)
    expect(() => parseRulesDocument('rules:\n  - action: deny\n    reason: x\n    extra: 1')).toThrow(/rule 1: unknown field/)
    expect(() => parseRulesDocument('rules:\n  - match: { tools: [bash], extra: 1 }\n    action: deny\n    reason: x')).toThrow(/rule 1\.match: unknown field/)
    expect(() => parseRulesDocument('rules:\n  - match: { when: { extra: 1 } }\n    action: deny\n    reason: x')).toThrow(/rule 1\.match\.when: unknown field/)
  })

  it('fails loud on invalid metadata and when vocabulary', () => {
    expect(() => parseRulesDocument('rules:\n  - match: {}\n    action: deny\n    reason: x\n    enabled: nope')).toThrow(/enabled must be a boolean/)
    expect(() => parseRulesDocument('rules:\n  - match: {}\n    action: deny\n    reason: x\n    description: ""')).toThrow(/description must be a non-empty string/)
    expect(() => parseRulesDocument('rules:\n  - match: { when: { platform: [beos] } }\n    action: deny\n    reason: x')).toThrow(/unknown platform "beos"/)
    expect(() => parseRulesDocument('rules:\n  - match: { when: { env: { CI: [] } } }\n    action: deny\n    reason: x')).toThrow(/env patterns must be non-empty/)
    expect(() => parseRulesDocument('rules:\n  - match: { when: { env: 5 } }\n    action: deny\n    reason: x')).toThrow(/must be a mapping/)
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

  it('compiles with the i flag when caseInsensitive is set', () => {
    expect(compileGlob('**/secrets/**', { segments: true, caseInsensitive: true }).test('SRC/SECRETS/KEY.PEM')).toBe(true)
    expect(compileGlob('**/secrets/**', { segments: true }).test('SRC/SECRETS/KEY.PEM')).toBe(false)
  })

  it('caps unbounded star expansions (backtracking-degree bound)', () => {
    expect(() => compileGlob('*a*b*c*', { segments: false, maxStars: 2 })).toThrowError(GlobError)
    expect(compileGlob('git push*--force*', { segments: false, maxStars: 2 }).test('git push --force origin main')).toBe(true)
    expect(compileGlob('**/secrets/**', { segments: true, maxStars: 2 }).test('src/secrets/key.pem')).toBe(true)
    expect(() => compileGlob('**/**/**', { segments: true, maxStars: 2 })).toThrowError(GlobError)
  })

  it('fails loud on bad globs', () => {
    expect(() => compileGlob('a[bc', { segments: true })).toThrowError(GlobError)
    expect(() => compileGlob('a[]', { segments: true })).toThrowError(GlobError)
    expect(() => compileGlob('a\\', { segments: true })).toThrowError(GlobError)
  })
})

describe('compilePatternRegex — catastrophic-backtracking guards', () => {
  it('rejects nested unbounded quantifiers', () => {
    expect(() => compilePatternRegex('(a+)+')).toThrow(/unbounded quantifier/)
    expect(() => compilePatternRegex('(ab*)+')).toThrow(/unbounded quantifier/)
    expect(() => compilePatternRegex('((a|b)+)*')).toThrow(/unbounded quantifier/)
    expect(() => compilePatternRegex('(a{2,})+')).toThrow(/unbounded quantifier/)
    expect(() => compilePatternRegex('(\\w+\\s?)+')).toThrow(/unbounded quantifier/)
  })

  it('rejects quantified groups with overlapping literal alternation branches', () => {
    expect(() => compilePatternRegex('(a|aa)+')).toThrow(/overlapping alternation/)
    expect(() => compilePatternRegex('(foo|foobar)*$')).toThrow(/overlapping alternation/)
  })

  it('keeps everyday patterns (independent top-level quantifiers, bounded groups)', () => {
    expect(compilePatternRegex('rm\\s+-[a-z]+\\s+/').test('rm -rf /')).toBe(true)
    expect(compilePatternRegex('\\d+\\.\\d+\\.\\d+').test('1.2.3')).toBe(true)
    expect(compilePatternRegex('[a-z]+\\.[a-z]+').test('file.ts')).toBe(true)
    expect(compilePatternRegex('(a|b)+').test('abab')).toBe(true)
    expect(compilePatternRegex('(read|write)+').test('readwrite')).toBe(true)
    expect(compilePatternRegex('\\S+@\\S+').test('a@b')).toBe(true)
    expect(compilePatternRegex('(a+)?b*').test('aaabbb')).toBe(true)
  })

  it('fails loud on invalid regexes', () => {
    expect(() => compilePatternRegex('a[bc')).toThrow(/not a valid regular expression/)
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

  it('skips disabled rules entirely (matching, indexing, and shadowing)', () => {
    const set = rules(`
rules:
  - match: { tools: [bash] }
    action: deny
    reason: off for now
    enabled: false
  - match: { tools: [bash] }
    action: ask
    reason: confirm bash
`)
    expect(matchRules(set, 'bash', {}, CWD)?.rule.action).toBe('ask')
    expect(matchRules(set, 'bash', {}, CWD)?.ruleIndex).toBe(1)
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

  it('collects scalar leaves from nested objects and arrays (depth-capped)', () => {
    const set = rules('rules:\n  - match: { params: { command: "*" } }\n    action: deny\n    reason: x')
    expect(matchRules(set, 'bash', { command: { nested: true } }, CWD)?.rule.action).toBe('deny')
    expect(matchRules(set, 'bash', { command: { cmd: 'git push', args: ['-f'] } }, CWD)?.rule.action).toBe('deny')
    // An object with no scalar leaves yields no candidates.
    expect(matchRules(set, 'bash', { command: {} }, CWD)).toBeUndefined()
  })

  it('supports negated patterns: value must not match any `!pattern`', () => {
    const set = rules(`
rules:
  - match: { params: { command: ["*", "!git*", "!npm*"] } }
    action: ask
    reason: anything but git/npm
`)
    expect(matchRules(set, 'bash', { command: 'ls -la' }, CWD)?.rule.action).toBe('ask')
    expect(matchRules(set, 'bash', { command: 'git status' }, CWD)).toBeUndefined()
    expect(matchRules(set, 'bash', { command: 'npm publish' }, CWD)).toBeUndefined()
    // The key must still be present.
    expect(matchRules(set, 'bash', {}, CWD)).toBeUndefined()
  })

  it('fails loud on a bare `!` negated pattern', () => {
    expect(() => rules('rules:\n  - match: { params: { command: "!" } }\n    action: deny\n    reason: x')).toThrow(/empty negated pattern/)
  })

  it('supports regex mode (unanchored)', () => {
    const set = rules('rules:\n  - match: { params: { command: \'rm\\s+-[a-z]+\\s+/\' } }\n    action: deny\n    reason: x', REGEX)
    expect(matchRules(set, 'bash', { command: 'sudo rm -rf /etc' }, CWD)?.rule.action).toBe('deny')
    expect(matchRules(set, 'bash', { command: 'ls /etc' }, CWD)).toBeUndefined()
  })
})

describe('matchRules — absent dimension', () => {
  it('matches only when every listed key is missing', () => {
    const set = rules(`
rules:
  - match: { tools: [bash], absent: [command] }
    action: ask
    reason: arg-less shell calls are suspicious
`)
    expect(matchRules(set, 'bash', {}, CWD)?.rule.action).toBe('ask')
    expect(matchRules(set, 'bash', { other: 1 }, CWD)?.rule.action).toBe('ask')
    expect(matchRules(set, 'bash', { command: 'ls' }, CWD)).toBeUndefined()
    // Non-object arguments satisfy absent (all keys missing).
    expect(matchRules(set, 'bash', 'not-an-object', CWD)?.rule.action).toBe('ask')
  })
})

describe('matchRules — when dimension', () => {
  it('matches only on the listed platform', () => {
    const set = rules(`
rules:
  - match: { tools: [bash], when: { platform: [win32] } }
    action: ask
    reason: windows shell gate
`)
    expect(matchRules(set, 'bash', {}, CWD, { platform: 'win32', env: {} })?.rule.action).toBe('ask')
    expect(matchRules(set, 'bash', {}, CWD, { platform: 'linux', env: {} })).toBeUndefined()
  })

  it('matches only when every listed env var is present and matches', () => {
    const set = rules(`
rules:
  - match: { tools: [bash], when: { env: { CI: "1" } } }
    action: deny
    reason: no shell in CI
`)
    const env = { CI: '1', HOME: '/root' } as const
    expect(matchRules(set, 'bash', {}, CWD, { platform: 'linux', env })?.rule.action).toBe('deny')
    expect(matchRules(set, 'bash', {}, CWD, { platform: 'linux', env: { CI: '0' } })).toBeUndefined()
    expect(matchRules(set, 'bash', {}, CWD, { platform: 'linux', env: {} })).toBeUndefined()
  })
})

describe('matchRules — agents dimension', () => {
  it('matches any selector against any candidate and never matches unknown identity', () => {
    const set = rules(`
rules:
  - match: { tools: [bash], agents: [subagent, "preset:code*"] }
    action: deny
    reason: subagents never run shells
  - match: { tools: [write], agents: [main] }
    action: ask
    reason: main-agent writes need confirmation
`)
    // Subagent candidate hits the first rule.
    expect(matchRules(set, 'bash', {}, CWD, { agents: ['subagent', 'preset:coder'] })?.rule.action).toBe('deny')
    // Preset candidate hits the first rule too.
    expect(matchRules(set, 'bash', {}, CWD, { agents: ['main', 'preset:coder'] })?.rule.action).toBe('deny')
    // A main-only caller does not match the subagent rule; the second rule asks.
    expect(matchRules(set, 'write', {}, CWD, { agents: ['main'] })?.rule.action).toBe('ask')
    expect(matchRules(set, 'write', {}, CWD, { agents: ['subagent'] })).toBeUndefined()
    // Unknown identity fails closed on agent-scoped rules (no candidates).
    expect(matchRules(set, 'bash', {}, CWD, { agents: [] })).toBeUndefined()
    expect(matchRules(set, 'bash', {}, CWD, {})).toBeUndefined()
    expect(matchRules(set, 'bash', {}, CWD)).toBeUndefined()
  })

  it('parses the agents vocabulary and rejects bad shapes', () => {
    const doc = parseRulesDocument('rules:\n  - match: { agents: [main, "preset:*"] }\n    action: allow\n    reason: x')
    expect(doc.rules[0]?.match.agents).toEqual(['main', 'preset:*'])
    expect(() => parseRulesDocument('rules:\n  - match: { agents: [""] }\n    action: allow\n    reason: x')).toThrow(/non-empty string/)
    expect(() => rules('rules:\n  - match: { agents: "a[bc" }\n    action: allow\n    reason: x')).toThrowError(GlobError)
  })

  it('agents dimension participates in AND and catch-all shadowing', () => {
    const set = rules(`
rules:
  - match: {}
    action: allow
    reason: catch-all
  - match: { agents: [subagent] }
    action: deny
    reason: unreachable
`)
    expect(findUnreachableRules(set)).toEqual([1])
    // An agent-scoped rule only restricts when its dimension holds.
    const gated = rules('rules:\n  - match: { agents: [main], paths: ["**/secrets/**"] }\n    action: deny\n    reason: x')
    expect(matchRules(gated, 'read', { path: 'secrets/a' }, CWD, { agents: ['main'] })?.rule.action).toBe('deny')
    expect(matchRules(gated, 'read', { path: 'secrets/a' }, CWD, { agents: ['subagent'] })).toBeUndefined()
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

  it('ignores ASCII case on Windows-style roots when caseInsensitivePaths is set', () => {
    const winCwd = 'D:\\ws\\project'
    const set = rules('rules:\n  - match: { paths: ["**/secrets/**"] }\n    action: deny\n    reason: x', CI)
    // Case-differing root AND segment must both resolve (previously a rule bypass).
    expect(matchRules(set, 'read', { path: 'D:\\WS\\PROJECT\\SECRETS\\key.pem' }, winCwd)?.rule.action).toBe('deny')
    expect(matchRules(set, 'read', { path: 'd:\\ws\\project\\Secrets\\key.pem' }, winCwd)?.rule.action).toBe('deny')
    // Case sensitivity still applies to the workspace-relative part without the flag.
    const strict = rules('rules:\n  - match: { paths: ["**/secrets/**"] }\n    action: deny\n    reason: x')
    expect(matchRules(strict, 'read', { path: 'D:\\WS\\PROJECT\\secrets\\key.pem' }, winCwd)).toBeUndefined()
  })

  it('requires at least one candidate; a rule with paths never matches arg-less tools', () => {
    const set = rules('rules:\n  - match: { paths: ["**/*.md"] }\n    action: deny\n    reason: x')
    expect(matchRules(set, 'bash', { command: 'ls' }, CWD)).toBeUndefined()
    expect(matchRules(set, 'bash', 'not-an-object', CWD)).toBeUndefined()
  })

  it('collects candidates only from the documented path keys, at any nesting depth', () => {
    expect(extractPathCandidates({ path: 'a', file_path: 'b', files: ['c', 'd'], command: 'x', nested: 'n' }))
      .toEqual(['a', 'b', 'c', 'd'])
    // MCP-style nesting: candidate keys inside arbitrary objects and arrays.
    expect(extractPathCandidates({ arguments: { path: 'p' }, config: { dir: 'd' }, files: [{ file_path: 'f' }] }))
      .toEqual(['p', 'd', 'f'])
    const set = rules('rules:\n  - match: { paths: ["**/secrets/**"] }\n    action: deny\n    reason: x')
    expect(matchRules(set, 'mcp__fs__read', { arguments: { path: 'src/secrets/a' } }, CWD)?.rule.action).toBe('deny')
  })
})

describe('normalizeWorkspacePath', () => {
  it('drops outside-root absolutes and keeps ../ relative forms', () => {
    expect(normalizeWorkspacePath('/ws/project', '../other/x')).toBe('../other/x')
    expect(normalizeWorkspacePath('/ws/project', '/etc/passwd')).toBe('')
    expect(normalizeWorkspacePath('/ws/project', './a/b')).toBe('a/b')
    expect(normalizeWorkspacePath('D:\\ws', 'C:\\other\\x')).toBe('')
  })

  it('compares the root prefix case-insensitively when asked', () => {
    expect(normalizeWorkspacePath('D:\\ws\\project', 'D:\\WS\\PROJECT\\secrets\\key.pem', true)).toBe('secrets/key.pem')
    expect(normalizeWorkspacePath('D:\\ws\\project', 'D:\\WS\\PROJECT\\secrets\\key.pem', false)).toBe('')
    expect(normalizeWorkspacePath('/ws/project', '/WS/PROJECT/secrets/key.pem', false)).toBe('')
  })

  it('drops candidates that equal the workspace root itself', () => {
    expect(normalizeWorkspacePath('/ws/project', '/ws/project')).toBe('')
    expect(normalizeWorkspacePath('D:\\ws\\project', 'D:/ws/project')).toBe('')
    expect(normalizeWorkspacePath('D:\\ws\\project', 'd:/WS/PROJECT', true)).toBe('')
    expect(normalizeWorkspacePath('D:\\ws\\project', 'd:/WS/PROJECT', false)).toBe('')
  })
})

describe('compileRules — limits and loud failures', () => {
  it('fails the compile when the rule count exceeds maxRules, accepts the limit', () => {
    const many = `rules:\n${Array.from({ length: 5 }, (_, i) => `  - match: { tools: [t${i}] }\n    action: allow\n    reason: r`).join('\n')}`
    expect(() => compileRules(parseRulesDocument(many), { patternMode: 'glob', maxRules: 4, maxGlobStars: 2, caseInsensitivePaths: false })).toThrow(/exceeds maxRules 4/)
    expect(compileRules(parseRulesDocument(many), { patternMode: 'glob', maxRules: 5, maxGlobStars: 2, caseInsensitivePaths: false }).rules).toHaveLength(5)
  })

  it('fails the compile on invalid globs and invalid regexes', () => {
    expect(() => rules('rules:\n  - match: { tools: "a[bc" }\n    action: allow\n    reason: x')).toThrowError(GlobError)
    expect(() => rules('rules:\n  - match: { paths: ["**/secrets/**"] }\n    action: deny\n    reason: x', REGEX)).toThrow(/not a valid regular expression/)
  })
})

describe('compileRulesChain — hierarchical merging', () => {
  it('merges nearest-file rules first and attributes every rule to its source', () => {
    const { ruleset, sources } = compileRulesChain([
      { path: '/repo/child/.dsh/rules.yaml', text: 'rules:\n  - match: { tools: [bash] }\n    action: ask\n    reason: child asks\n' },
      { path: '/repo/.dsh/rules.yaml', text: 'rules:\n  - match: { tools: [bash] }\n    action: deny\n    reason: parent denies\n  - match: { tools: [read] }\n    action: allow\n    reason: parent allows\n' },
    ], GLOB)
    expect(sources).toEqual(['/repo/child/.dsh/rules.yaml', '/repo/.dsh/rules.yaml'])
    expect(ruleset.rules).toHaveLength(3)
    expect(ruleset.rules[0]?.sourceIndex).toBe(0)
    expect(ruleset.rules[1]?.sourceIndex).toBe(1)
    // Child first: the nearer rule wins on first-match.
    expect(matchRules(ruleset, 'bash', {}, CWD)?.rule.action).toBe('ask')
    expect(matchRules(ruleset, 'read', {}, CWD)?.rule.action).toBe('allow')
  })

  it('caps the TOTAL rule count across the chain', () => {
    const text = 'rules:\n  - match: { tools: [a] }\n    action: allow\n    reason: x\n  - match: { tools: [b] }\n    action: allow\n    reason: x\n'
    expect(() => compileRulesChain([
      { path: '/a.yaml', text },
      { path: '/b.yaml', text },
    ], { ...GLOB, maxRules: 3 })).toThrow(/exceeds maxRules 3/)
  })
})

describe('findUnreachableRules', () => {
  it('flags every enabled rule after an enabled catch-all, ignoring disabled rules', () => {
    const set = rules(`
rules:
  - match: { tools: [bash] }
    action: allow
    reason: baseline
  - match: {}
    action: allow
    reason: catch-all
  - match: { tools: [read] }
    action: deny
    reason: unreachable
  - match: { tools: [edit] }
    action: ask
    reason: unreachable too
    enabled: false
`)
    expect(findUnreachableRules(set)).toEqual([2])
  })

  it('a disabled catch-all does not shadow, and non-catch-all rules never shadow', () => {
    const set = rules(`
rules:
  - match: {}
    action: allow
    reason: disabled catch-all
    enabled: false
  - match: { tools: [bash] }
    action: deny
    reason: reachable
`)
    expect(findUnreachableRules(set)).toEqual([])
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
    expect(describeRule(set.rules[0]!, EN)).toBe('1. deny [tools:bash,pwsh params:command=git push*]: no push')
  })

  it('renders absent/when dimensions, disabled markers, tags, and descriptions', () => {
    const set = rules(`
rules:
  - match: { tools: [bash], absent: [command], when: { env: { CI: "1" }, platform: [linux] } }
    action: ask
    reason: gated
    enabled: false
    description: "hold shell in CI"
    tags: [shell]
`)
    expect(describeRule(set.rules[0]!, EN)).toBe('1. ask (disabled) [tools:bash absent:command when:CI=1 platform:linux]: gated (hold shell in CI) [tags:shell]')
  })

  it('renders the agents dimension with its own token', () => {
    const set = rules('rules:\n  - match: { agents: [subagent, "preset:*"] }\n    action: deny\n    reason: no shells')
    expect(describeRule(set.rules[0]!, EN)).toBe('1. deny [agents:subagent,preset:*]: no shells')
  })

  it('truncates very long reasons at 120 characters', () => {
    const long = 'x'.repeat(200)
    const set = rules(`rules:\n  - match: { tools: [bash] }\n    action: deny\n    reason: "${long}"`)
    const line = describeRule(set.rules[0]!, EN)
    expect(line.length).toBeLessThan(long.length)
    expect(line).toContain(`${'x'.repeat(120)}…`)
  })

  it('attributes the source file when one is provided (multi-file chains)', () => {
    const set = rules('rules:\n  - match: { tools: [bash] }\n    action: deny\n    reason: no bash')
    expect(describeRule(set.rules[0]!, EN, '.dsh/rules.yaml')).toBe('1. deny [tools:bash] [src:.dsh/rules.yaml]: no bash')
    expect(describeRule(set.rules[0]!, EN)).toBe('1. deny [tools:bash]: no bash')
    expect(describeRule(set.rules[0]!, EN, '')).toBe('1. deny [tools:bash]: no bash')
  })
})
