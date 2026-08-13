/**
 * The pure rule vocabulary: parsing a `.dsh/rules.yaml` document into a
 * validated {@link RulesFileDoc}, compiling patterns, and first-match
 * evaluation. Every function here is pure — no filesystem, clock, or
 * process state — so the parser, the matcher, and the failure modes are all
 * unit-testable and replayable.
 * @module dsh-permission-rules/rules
 */

import { parse } from 'yaml'
import { compileGlob, compilePatternRegex } from './glob.ts'

/** What one matched rule does to a pending tool call. */
export type RuleAction = 'allow' | 'deny' | 'ask'

/** How param and path patterns are interpreted. */
export type PatternMode = 'glob' | 'regex'

/** Closed action list for runtime normalization of untrusted values. */
export const RULE_ACTIONS: readonly RuleAction[] = ['allow', 'deny', 'ask']

/**
 * Raised when a rule document cannot be parsed or compiled. The message
 * names the failing rule and field; loading code maps it onto the
 * `badFilePolicy`.
 */
export class RuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuleError'
  }
}

/** A parsed, shape-validated rule document (patterns not yet compiled). */
export interface RulesFileDoc {
  rules: RuleDocEntry[]
}

/** One parsed rule: match dimensions plus the action and reason. */
export interface RuleDocEntry {
  match: RuleMatchDoc
  action: RuleAction
  reason: string
}

/** The parsed match dimensions; absent dimensions are empty (= no restriction). */
export interface RuleMatchDoc {
  /** Tool-name globs; empty matches every tool. */
  tools: string[]
  /** Param key → patterns; EVERY key must be present and match (AND). */
  params: Record<string, string[]>
  /** Workspace-path globs/regexes; ANY candidate matching ANY pattern satisfies the dimension. */
  paths: string[]
}

/** One compiled rule, ready for the `tools/pre-execute` hot path. */
export interface CompiledRule {
  readonly index: number
  readonly action: RuleAction
  readonly reason: string
  readonly tools: readonly RegExp[]
  readonly params: ReadonlyMap<string, readonly RegExp[]>
  readonly paths: readonly RegExp[]
  /** The original source strings, kept for the `/rules` display. */
  readonly source: RuleDocEntry
}

/** A compiled, size-capped ruleset. */
export interface CompiledRuleset {
  readonly rules: readonly CompiledRule[]
}

/** Compile options for {@link compileRules}. */
export interface CompileOptions {
  /** Glob or regex interpretation of `params`/`paths` patterns. */
  readonly patternMode: PatternMode
  /** Hard cap on rule count; exceeding it fails the compile loudly. */
  readonly maxRules: number
}

/**
 * Parse one rules file body. Unknown document/rule/match fields, invalid
 * actions, missing reasons, and wrong-shaped collections all throw
 * {@link RuleError} — a malformed file fails loudly at load, never silently.
 * @param text - the raw YAML text.
 * @returns the validated document.
 */
export function parseRulesDocument(text: string): RulesFileDoc {
  const parsed = parseYaml(text)
  // An empty (or comment-only) file is a valid empty rule set.
  if (parsed === null || parsed === undefined) return { rules: [] }
  const root = asRecord(parsed, 'rules document root')
  const unknownRoot = Object.keys(root).filter(key => key !== 'rules')
  if (unknownRoot.length > 0) {
    throw new RuleError(`unknown top-level field${unknownRoot.length > 1 ? 's' : ''} ${unknownRoot.map(k => JSON.stringify(k)).join(', ')} (only "rules" is allowed)`)
  }
  const rawRules = root['rules']
  if (rawRules === undefined) return { rules: [] }
  if (!Array.isArray(rawRules)) throw new RuleError('"rules" must be a list')
  return { rules: rawRules.map((raw, index) => parseRuleEntry(raw, index)) }
}

/**
 * Compile a parsed document for the hot path: pattern strings become
 * RegExps (invalid globs/regexes throw here, at load), and the rule count
 * is capped by `maxRules`.
 * @param doc - the parsed document.
 * @param options - pattern mode and the rule cap.
 * @returns the compiled ruleset.
 */
export function compileRules(doc: RulesFileDoc, options: CompileOptions): CompiledRuleset {
  if (doc.rules.length > options.maxRules) {
    throw new RuleError(`rule count ${doc.rules.length} exceeds maxRules ${options.maxRules}`)
  }
  return {
    rules: doc.rules.map((entry, index) => {
      const tools = entry.match.tools.map(pattern => compileToolPattern(pattern))
      const params = new Map<string, readonly RegExp[]>()
      for (const [key, patterns] of Object.entries(entry.match.params)) {
        params.set(key, patterns.map(pattern => compileValuePattern(pattern, options.patternMode)))
      }
      const paths = entry.match.paths.map(pattern => compilePathPattern(pattern, options.patternMode))
      return { index, action: entry.action, reason: entry.reason, tools, params, paths, source: entry }
    }),
  }
}

/** A matched rule: its index and the compiled rule that fired. */
export interface RuleHit {
  /** 0-based index of the first matching rule. */
  readonly ruleIndex: number
  readonly rule: CompiledRule
}

/**
 * Evaluate rules in order against one pending tool call. First match wins;
 * no match returns `undefined` (passthrough). Pure and synchronous — this
 * is the `tools/pre-execute` hot path, so it runs no I/O.
 * @param ruleset - compiled rules.
 * @param toolName - the tool being called.
 * @param args - the parsed (JSON) tool arguments; non-object values satisfy
 *   only tools-only rules.
 * @param cwd - the session's absolute workspace root, for path normalization.
 * @returns the first hit, or undefined when every rule passed.
 */
export function matchRules(
  ruleset: CompiledRuleset,
  toolName: string,
  args: unknown,
  cwd: string,
): RuleHit | undefined {
  const argRecord = isRecord(args) ? args : undefined
  for (const rule of ruleset.rules) {
    if (!matchTools(rule, toolName)) continue
    if (argRecord === undefined && rule.params.size > 0) continue
    if (argRecord !== undefined && !matchParams(rule, argRecord)) continue
    if (rule.paths.length > 0 && (argRecord === undefined || !matchPaths(rule, argRecord, cwd))) continue
    return { ruleIndex: rule.index, rule }
  }
  return undefined
}

/**
 * One-line human summary of a compiled rule, for `/rules` output.
 * @param rule - the compiled rule.
 * @returns a single display line naming the index (1-based), action, match
 *   dimensions, and reason.
 */
export function describeRule(rule: CompiledRule): string {
  const parts: string[] = []
  if (rule.source.match.tools.length > 0) parts.push(`tools:${rule.source.match.tools.join(',')}`)
  const params = Object.entries(rule.source.match.params)
    .map(([key, patterns]) => `${key}=${patterns.join('|')}`)
    .join(' ')
  if (params.length > 0) parts.push(`params:${params}`)
  if (rule.source.match.paths.length > 0) parts.push(`paths:${rule.source.match.paths.join(',')}`)
  const match = parts.length > 0 ? `[${parts.join(' ')}]` : '[all tools]'
  return `${rule.index + 1}. ${rule.action} ${match}: ${rule.reason}`
}

/** Whether a rule's tools dimension selects the tool. */
function matchTools(rule: CompiledRule, toolName: string): boolean {
  if (rule.tools.length === 0) return true
  return rule.tools.some(regex => regex.test(toolName))
}

/** Whether a rule's params dimension holds: EVERY key present and matching. */
function matchParams(rule: CompiledRule, args: Record<string, unknown>): boolean {
  for (const [key, patterns] of rule.params) {
    const value = args[key]
    if (value === undefined) return false
    const candidates = scalarCandidates(value)
    if (candidates.length === 0) return false
    if (!candidates.some(candidate => patterns.some(regex => regex.test(candidate)))) return false
  }
  return true
}

/** Whether a rule's paths dimension holds: at least one candidate matches one pattern. */
function matchPaths(rule: CompiledRule, args: Record<string, unknown>, cwd: string): boolean {
  const candidates = extractPathCandidates(args)
    .map(candidate => normalizeWorkspacePath(cwd, candidate))
    .filter((candidate): candidate is string => candidate.length > 0)
  if (candidates.length === 0) return false
  return candidates.some(candidate => rule.paths.some(regex => regex.test(candidate)))
}

/** Tool-name patterns are always globs (a tool name is not a path). */
function compileToolPattern(pattern: string): RegExp {
  return compileGlob(pattern, { segments: false })
}

/** Param-value patterns follow the configured mode; `/` is an ordinary character. */
function compileValuePattern(pattern: string, mode: PatternMode): RegExp {
  return mode === 'regex' ? compilePatternRegex(pattern) : compileGlob(pattern, { segments: false })
}

/** Path patterns follow the configured mode with path-segment glob semantics. */
function compilePathPattern(pattern: string, mode: PatternMode): RegExp {
  return mode === 'regex' ? compilePatternRegex(pattern) : compileGlob(pattern, { segments: true })
}

// --- YAML/shape validation -------------------------------------------------

/** Parse YAML through the `yaml` dependency, mapping parse failures onto {@link RuleError}. */
function parseYaml(text: string): unknown {
  try {
    return parse(text)
  } catch (error) {
    throw new RuleError(`invalid YAML: ${String(error)}`)
  }
}

/** Validate one raw rule entry from the YAML document. */
function parseRuleEntry(raw: unknown, index: number): RuleDocEntry {
  const at = `rule ${index + 1}`
  const record = asRecord(raw, at)
  const unknownFields = Object.keys(record).filter(key => key !== 'match' && key !== 'action' && key !== 'reason')
  if (unknownFields.length > 0) {
    throw new RuleError(`${at}: unknown field${unknownFields.length > 1 ? 's' : ''} ${unknownFields.map(k => JSON.stringify(k)).join(', ')} (allowed: match, action, reason)`)
  }
  const action = record['action']
  if (typeof action !== 'string' || !RULE_ACTIONS.includes(action as RuleAction)) {
    throw new RuleError(`${at}: action must be one of ${RULE_ACTIONS.map(a => JSON.stringify(a)).join(' | ')}, got ${JSON.stringify(action)}`)
  }
  const reason = record['reason']
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new RuleError(`${at}: reason must be a non-empty string`)
  }
  const match = parseMatch(record['match'], at)
  return { match, action: action as RuleAction, reason }
}

/** Validate the `match` block of one rule. */
function parseMatch(raw: unknown, at: string): RuleMatchDoc {
  if (raw === undefined) return { tools: [], params: {}, paths: [] }
  const record = asRecord(raw, `${at}.match`)
  const unknownFields = Object.keys(record).filter(key => key !== 'tools' && key !== 'params' && key !== 'paths')
  if (unknownFields.length > 0) {
    throw new RuleError(`${at}.match: unknown field${unknownFields.length > 1 ? 's' : ''} ${unknownFields.map(k => JSON.stringify(k)).join(', ')} (allowed: tools, params, paths)`)
  }
  return {
    tools: parseStringList(record['tools'], `${at}.match.tools`),
    params: parseParams(record['params'], `${at}.match.params`),
    paths: parseStringList(record['paths'], `${at}.match.paths`),
  }
}

/** Validate the params map: non-empty string keys → one pattern or a pattern list. */
function parseParams(raw: unknown, at: string): Record<string, string[]> {
  if (raw === undefined) return {}
  const record = asRecord(raw, at)
  const out: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key.length === 0) throw new RuleError(`${at}: param keys must be non-empty strings`)
    const patterns = parsePatternValues(value, `${at}.${key}`)
    if (patterns.length === 0) throw new RuleError(`${at}.${key}: param patterns must be non-empty`)
    out[key] = patterns
  }
  return out
}

/**
 * Validate one pattern or a pattern list; scalar strings/numbers/booleans
 * are single patterns (matching the runtime scalar-stringify semantics).
 */
function parsePatternValues(raw: unknown, at: string): string[] {
  if (typeof raw === 'string') return [raw]
  if (typeof raw === 'number' || typeof raw === 'boolean') return [String(raw)]
  if (raw === undefined) return []
  if (Array.isArray(raw)) {
    return raw.map((value, index) => {
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new RuleError(`${at}[${index}] must be a string, number, or boolean`)
      }
      const pattern = String(value)
      if (pattern.length === 0) throw new RuleError(`${at}[${index}] must be non-empty`)
      return pattern
    })
  }
  throw new RuleError(`${at} must be a string, number, boolean, or a list of them`)
}

/** Validate a string or string list, absent = empty list. */
function parseStringList(raw: unknown, at: string): string[] {
  if (raw === undefined) return []
  const values = typeof raw === 'string' ? [raw] : raw
  if (!Array.isArray(values)) throw new RuleError(`${at} must be a string or a list of strings`)
  return values.map((value, index) => {
    if (typeof value !== 'string' || value.length === 0) {
      throw new RuleError(`${at}[${index}] must be a non-empty string`)
    }
    return value
  })
}

/** Narrow an unknown value to a plain record, throwing a {@link RuleError}. */
function asRecord(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RuleError(`${at} must be a mapping, got ${Array.isArray(value) ? 'a list' : typeof value}`)
  }
  return value as Record<string, unknown>
}

/** Narrow an unknown value to a plain string-keyed record (tool arguments). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// --- Candidate extraction --------------------------------------------------

/** Top-level argument keys whose string values are path candidates. */
export const PATH_CANDIDATE_KEYS: readonly string[] = [
  'path',
  'paths',
  'file',
  'files',
  'file_path',
  'dir',
  'directory',
  'directories',
  'cwd',
  'workspace',
  'root',
  'target',
  'targets',
  'output',
]

/**
 * Collect path-candidate strings from the top level of tool arguments:
 * scalar strings under the documented {@link PATH_CANDIDATE_KEYS}, plus
 * string elements of arrays under those keys. Iterates the argument
 * object's own key order, so extraction order is deterministic.
 * @param args - the parsed tool arguments.
 * @returns candidate strings in argument key order (duplicates kept).
 */
export function extractPathCandidates(args: Record<string, unknown>): string[] {
  const candidates: string[] = []
  for (const key of Object.keys(args)) {
    if (!PATH_CANDIDATE_KEYS.includes(key)) continue
    const value = args[key]
    if (typeof value === 'string') candidates.push(value)
    else if (Array.isArray(value)) {
      for (const element of value) {
        if (typeof element === 'string') candidates.push(element)
      }
    }
  }
  return candidates
}

/**
 * Normalize one candidate path against the workspace root: separators
 * become `/`, `./` prefixes drop, and in-root paths become workspace
 * relative. Candidates OUTSIDE the root (absolute or drive-prefixed
 * elsewhere) yield `''` — path patterns address workspace-relative paths
 * only; a still-relative `../…` input is kept so explicit out-of-root
 * globs like `../shared/**` can address it.
 * @param cwd - the session's absolute workspace root (any separator).
 * @param candidate - the raw candidate path.
 * @returns the workspace-relative posix path, or `''` to drop the candidate.
 */
export function normalizeWorkspacePath(cwd: string, candidate: string): string {
  const root = toPosix(cwd).replace(/\/+$/, '')
  const raw = toPosix(candidate)
  if (raw.length === 0) return ''
  let path = raw
  while (path.startsWith('./')) path = path.slice(2)
  if (/^[A-Za-z]:\//.test(path)) {
    // Windows drive path: relative only when on the root's own drive.
    if (!/^[A-Za-z]:\//.test(root)) return ''
    if (path.slice(0, 2).toLowerCase() !== root.slice(0, 2).toLowerCase()) return ''
    return relFromRoot(root, path, path.slice(2), root.slice(2))
  }
  if (path.startsWith('/')) {
    // Absolute posix path: relative when inside the root, dropped otherwise.
    return relFromRoot(root, path, path, root)
  }
  return path
}

/** Strip a common root prefix from one absolute path, else drop the path. */
function relFromRoot(root: string, path: string, rest: string, rootRest: string): string {
  if (rootRest.length === 0) return rest.slice(1)
  if (path.toLowerCase() === root.toLowerCase()) return ''
  return rest.startsWith(`${rootRest}/`) ? rest.slice(rootRest.length + 1) : ''
}

/** Convert a path to posix separators. */
function toPosix(path: string): string {
  return path.replaceAll('\\', '/')
}

/** Stringify one scalar arg value; non-scalars yield no candidates. */
function scalarCandidates(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) {
    return value.flatMap(element => scalarCandidates(element))
  }
  return []
}
