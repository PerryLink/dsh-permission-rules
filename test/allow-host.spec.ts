/**
 * The allow-host pure core: host normalization/validation, the comment-
 * preserving index-0 insertion, the target-file choice, and the notice
 * mapping. Every safety property issue #19 item 3 names is asserted here on
 * the function that implements it, so a regression fails next to the code
 * rather than only through the runtime integration.
 * @module dsh-permission-rules/test/allow-host
 */

import { describe, expect, it } from 'vitest'
import { isAbsolute, join, resolve } from 'node:path'
import {
  allowHostReason,
  insertAllowRule,
  isWritableHost,
  normalizeAllowHost,
  resolveAllowHostTarget,
} from '../src/allow-host.ts'
import type { AllowHostTargetInput } from '../src/allow-host.ts'
import { allowHostNotice, allowHostWorkspaces } from '../src/allow-host-notice.ts'
import { compileRules, parseRulesDocument, targetMatchesNetwork } from '../src/rules.ts'
import type { CompileOptions } from '../src/rules.ts'
import type { AllowHostResult } from '../src/wire.ts'

const COMPILE: CompileOptions = { patternMode: 'glob', maxRules: 256, maxGlobStars: 2, caseInsensitivePaths: false }

/** One existing document with a header comment, an inline comment, and a deny rule. */
const DOCUMENT = [
  '# workspace rules',
  'rules:',
  '  # keep this comment',
  '  - match: { network: { domains: [evil.example] } }',
  '    action: deny',
  '    reason: "known bad"',
  '',
].join('\n')

/** Every field of an {@link AllowHostResult}, so a case only states what it means. */
function result(partial: Partial<AllowHostResult>): AllowHostResult {
  return { ok: true, path: null, created: false, reloaded: 0, outcome: 'allow', alreadyAllowed: false, error: null, ...partial }
}

describe('normalizeAllowHost', () => {
  it('lowercases, strips IPv6 brackets, and strips trailing dots like target parsing does', () => {
    expect(normalizeAllowHost('Registry.NPMJS.org')).toBe('registry.npmjs.org')
    expect(normalizeAllowHost('example.com.')).toBe('example.com')
    expect(normalizeAllowHost('[::1]')).toBe('::1')
    expect(normalizeAllowHost('EXAMPLE.com..')).toBe('example.com')
  })
})

describe('isWritableHost', () => {
  it('accepts host names and IP literals', () => {
    for (const host of ['example.com', 'registry.npmjs.org', 'localhost', 'my-host_1.example', '127.0.0.1', '::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isWritableHost(host), host).toBe(true)
    }
  })

  it('refuses anything that is not exactly one host: injection text, globs, URLs, paths, blanks', () => {
    for (const host of [
      '',
      ' ',
      'example com',
      'example.com\nrules:\n  - action: allow',
      'rules:',
      '#comment',
      '*.example.com',
      'example.com:443',
      'http://example.com',
      '../../etc/rules.yaml',
      'a".example',
      "a'.example",
      'x'.repeat(254),
    ]) {
      expect(isWritableHost(host), JSON.stringify(host)).toBe(false)
    }
  })
})

describe('insertAllowRule', () => {
  it('inserts the generated rule at index 0, keeping comments and the existing rules byte-identical', () => {
    const edit = insertAllowRule(DOCUMENT, 'registry.npmjs.org')
    expect(edit.inserted).toBe(true)
    const lines = edit.text.split('\n')
    // The header comment stays put, and the new rule is the FIRST list item.
    expect(lines[0]).toBe('# workspace rules')
    expect(lines[1]).toBe('rules:')
    expect(lines[2]).toBe('  # keep this comment')
    expect(edit.text.indexOf('registry.npmjs.org')).toBeLessThan(edit.text.indexOf('evil.example'))
    // The untouched tail survives verbatim, inline flow style and quoting included.
    expect(edit.text).toContain('  - match: { network: { domains: [ evil.example ] } }\n    action: deny\n    reason: "known bad"\n')
    expect(edit.text).toContain(allowHostReason('registry.npmjs.org'))
  })

  it('writes a rule that parses, compiles, and matches the host AND its subdomains', () => {
    const edit = insertAllowRule('rules:\n  - match: { network: { domains: [evil.example] } }\n    action: deny\n    reason: bad\n', 'registry.npmjs.org')
    const doc = parseRulesDocument(edit.text)
    expect(doc.rules[0]?.action).toBe('allow')
    expect(doc.rules[0]?.match.network?.domains).toEqual(['registry.npmjs.org'])
    // No schemes/ports: the generated rule is exactly one domain dimension.
    expect(doc.rules[0]?.match.network?.schemes).toEqual([])
    expect(doc.rules[0]?.match.network?.ports).toEqual([])
    const compiled = compileRules(doc, COMPILE).rules[0]
    if (compiled?.network === undefined) throw new Error('generated rule lost its network scope')
    expect(targetMatchesNetwork({ scheme: 'https', host: 'registry.npmjs.org', port: 443, ips: [] }, compiled.network)).toBe(true)
    expect(targetMatchesNetwork({ scheme: 'http', host: 'cdn.registry.npmjs.org', port: 80, ips: [] }, compiled.network)).toBe(true)
    expect(targetMatchesNetwork({ scheme: 'https', host: 'registry.npmjs.org.evil.example', port: 443, ips: [] }, compiled.network)).toBe(false)
  })

  it('creates the list in an empty or comment-only file without dropping the comments', () => {
    const empty = insertAllowRule('', 'example.com')
    expect(empty.inserted).toBe(true)
    expect(empty.text.startsWith('rules:\n  - match:')).toBe(true)
    expect(parseRulesDocument(empty.text).rules).toHaveLength(1)

    const commentsOnly = insertAllowRule('# why this file exists\n', 'example.com')
    expect(commentsOnly.text.startsWith('# why this file exists\n')).toBe(true)
    expect(parseRulesDocument(commentsOnly.text).rules).toHaveLength(1)
  })

  it('refuses an unparseable document instead of re-emitting a partial one', () => {
    expect(() => insertAllowRule('rules: [not a list', 'example.com')).toThrow(/cannot edit the rule file/)
    expect(() => insertAllowRule('rules:\n  - match: {a: 1\n', 'example.com')).toThrow(/cannot edit the rule file/)
    // A duplicate key is a document error too: the file must not be rewritten.
    expect(() => insertAllowRule('rules: []\nrules: []\n', 'example.com')).toThrow(/cannot edit the rule file/)
  })

  it('refuses a document whose "rules" is not a list', () => {
    expect(() => insertAllowRule('rules:\n  domains: [a.example]\n', 'example.com')).toThrow(/"rules" must be a list/)
    expect(() => insertAllowRule('rules:\n', 'example.com')).toThrow(/"rules" must be a list/)
    // Semantics of the ITEMS are the validation gate's business (the runtime
    // re-parses and compiles the text before it is written), not the editor's.
    expect(() => insertAllowRule('rules:\n  - 1\n', 'example.com')).not.toThrow()
    expect(() => insertAllowRule('other: 1\n', 'example.com')).toThrow(/no "rules" list/)
    expect(() => insertAllowRule('just a scalar\n', 'example.com')).toThrow(/root must be a mapping/)
  })

  it('reports inserted: false when the file already leads with this exact allow rule', () => {
    const first = insertAllowRule(DOCUMENT, 'registry.npmjs.org')
    const again = insertAllowRule(first.text, 'registry.npmjs.org')
    expect(again.inserted).toBe(false)
    expect(again.text).toBe(first.text)

    // Normalization is what makes the check idempotent across spellings.
    const shouty = insertAllowRule(first.text, 'REGISTRY.npmjs.org.')
    expect(shouty.inserted).toBe(false)

    // A head rule with a different scope is NOT the generated rule: skipping the
    // write for it would leave the blocked port/scheme/tool blocked.
    const scoped = insertAllowRule('rules:\n  - match: { network: { domains: [registry.npmjs.org], ports: [443] } }\n    action: allow\n    reason: narrow\n', 'registry.npmjs.org')
    expect(scoped.inserted).toBe(true)
    expect(insertAllowRule('rules:\n  - match: { tools: [bash], network: { domains: [registry.npmjs.org] } }\n    action: allow\n    reason: tool-scoped\n', 'registry.npmjs.org').inserted).toBe(true)
    // A disabled twin is inert, so the action must still write.
    expect(insertAllowRule('rules:\n  - match: { network: { domains: [registry.npmjs.org] } }\n    action: allow\n    reason: off\n    enabled: false\n', 'registry.npmjs.org').inserted).toBe(true)
    // Nor is an allow for another host, or a deny for this one.
    expect(insertAllowRule('rules:\n  - match: { network: { domains: [other.example] } }\n    action: allow\n    reason: other\n', 'registry.npmjs.org').inserted).toBe(true)
    expect(insertAllowRule('rules:\n  - match: { network: { domains: [registry.npmjs.org] } }\n    action: deny\n    reason: no\n', 'registry.npmjs.org').inserted).toBe(true)

    // The generated shape (plus incidental metadata) IS recognized.
    const withTags = insertAllowRule(`rules:\n  - match: { network: { domains: [registry.npmjs.org] } }\n    action: allow\n    reason: ${JSON.stringify(allowHostReason('registry.npmjs.org'))}\n    tags: [generated]\n`, 'registry.npmjs.org')
    expect(withTags.inserted).toBe(false)
  })

  it('never mistakes a differently-shaped head rule for the generated one', () => {
    const heads = [
      'rules:\n  - 1\n',
      'rules:\n  - just a string\n',
      'rules:\n  - match: 5\n    action: allow\n    reason: r\n',
      'rules:\n  - match: { network: 5 }\n    action: allow\n    reason: r\n',
      'rules:\n  - match: { network: { domains: [] } }\n    action: allow\n    reason: r\n',
      'rules:\n  - match: { network: { domains: [1] } }\n    action: allow\n    reason: r\n',
      'rules:\n  - match: { network: { domains: [registry.npmjs.org], ips: [127.0.0.1] } }\n    action: allow\n    reason: r\n',
    ]
    for (const head of heads) {
      expect(insertAllowRule(head, 'registry.npmjs.org').inserted, head).toBe(true)
    }
  })
})

describe('resolveAllowHostTarget', () => {
  const WS = resolve('/ws')
  const OTHER = resolve('/other')
  const HOST = resolve('/host-cwd')
  const PROJECT = join(WS, '.dsh', 'rules.yaml')
  const HOST_PROJECT = join(HOST, '.dsh', 'rules.yaml')
  const FALLBACK = resolve('/etc/dsh/fallback.yaml')
  const BUILTIN = resolve('/pkg/builtin-high-risk.yaml')

  /** The runtime's own state, as the runtime would pass it. */
  function input(partial: Partial<AllowHostTargetInput> = {}): AllowHostTargetInput {
    return {
      cwd: WS,
      loadedCwds: [WS, OTHER],
      knownSources: [PROJECT, join(OTHER, '.dsh', 'rules.yaml'), HOST_PROJECT, FALLBACK, BUILTIN],
      rulesFile: '.dsh/rules.yaml',
      fallbackPath: FALLBACK,
      processCwd: HOST,
      builtinPath: BUILTIN,
      exists: () => false,
      ...partial,
    }
  }

  it('targets the named workspace project file', () => {
    expect(resolveAllowHostTarget(input())).toBe(PROJECT)
    expect(resolveAllowHostTarget(input({ cwd: OTHER }))).toBe(join(OTHER, '.dsh', 'rules.yaml'))
  })

  it('refuses a cwd that is not a loaded workspace (the RPC accepts no path)', () => {
    expect(() => resolveAllowHostTarget(input({ cwd: resolve('/elsewhere') }))).toThrow(/not a workspace whose rules are loaded/)
  })

  it('refuses a target that is not a known rule source', () => {
    expect(() => resolveAllowHostTarget(input({ knownSources: [FALLBACK] }))).toThrow(/not a known rule source/)
  })

  it('never targets the built-in baseline', () => {
    // An absolute rulesFile that IS the baseline: both the cwd path and the
    // host path resolve to it, and both must refuse.
    const baseline = input({ rulesFile: BUILTIN, cwd: WS })
    expect(() => resolveAllowHostTarget(baseline)).toThrow(/built-in ruleset is read-only/)
    expect(() => resolveAllowHostTarget({ ...baseline, cwd: null })).toThrow(/built-in ruleset is read-only/)
  })

  it('mirrors the host chain order: absolute rulesFile, existing project file, fallback, project file', () => {
    // An absolute rulesFile is the file every workspace (and the host chain) uses.
    expect(resolveAllowHostTarget(input({ cwd: null, rulesFile: FALLBACK }))).toBe(FALLBACK)
    // An existing <processCwd>/<rulesFile> wins over the fallback.
    expect(resolveAllowHostTarget(input({ cwd: null, exists: path => path === HOST_PROJECT }))).toBe(HOST_PROJECT)
    // Otherwise the fallback, and only with no fallback the (created) project file.
    expect(resolveAllowHostTarget(input({ cwd: null }))).toBe(FALLBACK)
    expect(resolveAllowHostTarget(input({ cwd: null, fallbackPath: undefined }))).toBe(HOST_PROJECT)
    const relative = resolve('rel/fallback.yaml')
    const resolved = resolveAllowHostTarget(input({ cwd: null, fallbackPath: 'rel/fallback.yaml', knownSources: [relative] }))
    expect(resolved).toBe(relative)
    expect(isAbsolute(resolved)).toBe(true)
  })
})

describe('allowHostNotice', () => {
  it('reports a failure with its error text', () => {
    const notice = allowHostNotice(result({ ok: false, error: 'refusing to allow "x": not a host name or IP literal' }))
    expect(notice).toEqual({ ok: false, key: 'allowHostFailed', vars: { error: 'refusing to allow "x": not a host name or IP literal' } })
    expect(allowHostNotice(result({ ok: false, error: null })).vars['error']).toBe('unknown error')
  })

  it('never reports success while the recomputed outcome is not allow', () => {
    const blocked = allowHostNotice(result({ ok: true, path: '/ws/.dsh/rules.yaml', outcome: 'deny' }))
    expect(blocked.ok).toBe(false)
    expect(blocked.key).toBe('allowHostStillBlocked')
    expect(blocked.vars).toEqual({ outcome: 'deny' })
    // Even the no-write branch cannot claim success for a still-blocked target.
    expect(allowHostNotice(result({ alreadyAllowed: true, outcome: 'ask' })).key).toBe('allowHostStillBlocked')
  })

  it('distinguishes an already-allowed no-op from a write', () => {
    expect(allowHostNotice(result({ alreadyAllowed: true })).key).toBe('allowHostAlready')
    const saved = allowHostNotice(result({ path: '/ws/.dsh/rules.yaml', reloaded: 2, created: true }))
    expect(saved).toEqual({ ok: true, key: 'allowHostSaved', vars: { path: '/ws/.dsh/rules.yaml', reloaded: 2 } })
    // Defensive renderings: a result that somehow lost its outcome/path still
    // produces a message rather than "undefined" in the page.
    expect(allowHostNotice(result({ outcome: null }))).toMatchObject({ ok: false, key: 'allowHostStillBlocked', vars: { outcome: 'unknown' } })
    expect(allowHostNotice(result({ path: null })).vars['path']).toBe('')
  })
})

describe('allow-host module split', () => {
  it('keeps the host module re-exporting the client-safe helpers', async () => {
    // The settings page imports from '../src/allow-host-notice.ts' directly;
    // these re-exports keep pre-split host-side import sites working.
    const host = await import('../src/allow-host.ts')
    expect(host.allowHostNotice).toBe(allowHostNotice)
    expect(host.allowHostWorkspaces).toBe(allowHostWorkspaces)
  })
})
