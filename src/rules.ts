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

/** How param, path, and env patterns are interpreted. */
export type PatternMode = 'glob' | 'regex'

/** Closed action list for runtime normalization of untrusted values. */
export const RULE_ACTIONS: readonly RuleAction[] = ['allow', 'deny', 'ask']

/** Platform names a `when.platform` entry may name (Node `process.platform` values). */
export const PLATFORMS: readonly string[] = ['aix', 'android', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos', 'win32']

/** Recursion bound for nested argument walks (path candidates and scalar leaves). */
const MAX_ARGUMENT_DEPTH = 8

/** Display-truncation length for reasons/descriptions in `/rules` output. */
const DISPLAY_TRUNCATE = 120

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

/** One parsed rule: match dimensions plus the action, reason, and metadata. */
export interface RuleDocEntry {
  match: RuleMatchDoc
  action: RuleAction
  reason: string
  /** `false` keeps the rule visible but inert (displayed as disabled). */
  enabled: boolean
  /** Optional one-line explanation shown by `/rules`. */
  description?: string
  /** Free-form labels shown by `/rules`. */
  tags: string[]
}

/** The parsed match dimensions; absent dimensions are empty (= no restriction). */
export interface RuleMatchDoc {
  /** Tool-name globs; empty matches every tool. */
  tools: string[]
  /** Param key → patterns; EVERY key must be present and match (AND). A `!`-prefixed pattern negates. */
  params: Record<string, string[]>
  /** Workspace-path globs/regexes; ANY candidate matching ANY pattern satisfies the dimension. */
  paths: string[]
  /** Argument keys that must be ABSENT; every listed key must be missing. */
  absent: string[]
  /**
   * Agent-identity selectors (globs against the calling agent's session
   * header: `main`, `subagent`, and `preset:<name>` candidates); ANY
   * selector matching ANY candidate satisfies the dimension. Empty matches
   * every agent. Unknown agent identity never matches, so agent-scoped
   * rules fail closed.
   */
  agents: string[]
  /** Environment/platform conditions; every listed env key must be present and match. */
  when: WhenDoc
}

/** The parsed `when` conditions. */
export interface WhenDoc {
  /** Env var name → glob/regex patterns; EVERY key must be present and match (AND). */
  env: Record<string, string[]>
  /** Platform names; ANY match satisfies the dimension. */
  platform: string[]
}

/** One compiled rule, ready for the `tools/pre-execute` hot path. */
export interface CompiledRule {
  /** 0-based position in the merged rule chain. */
  readonly index: number
  /** 0-based index into the merged source-chain paths (audit attribution). */
  readonly sourceIndex: number
  readonly action: RuleAction
  readonly reason: string
  readonly enabled: boolean
  readonly description?: string
  readonly tags: readonly string[]
  readonly tools: readonly RegExp[]
  /** Agent-selector globs; empty = every agent. */
  readonly agents: readonly RegExp[]
  /** Param key → positive/negative pattern lists. */
  readonly params: ReadonlyMap<string, { positive: readonly RegExp[]; negative: readonly RegExp[] }>
  readonly paths: readonly RegExp[]
  readonly absent: readonly string[]
  readonly when?: {
    readonly env: ReadonlyMap<string, readonly RegExp[]>
    readonly platform: readonly string[]
  }
  /** The original source strings, kept for the `/rules` display. */
  readonly source: RuleDocEntry
}

/** A compiled, size-capped ruleset. */
export interface CompiledRuleset {
  readonly rules: readonly CompiledRule[]
  /** Whether path patterns (and workspace-path normalization) ignore ASCII case. */
  readonly caseInsensitivePaths: boolean
}

/** Compile options for {@link compileRules}. */
export interface CompileOptions {
  /** Glob or regex interpretation of `params`/`paths`/`when.env` patterns. */
  readonly patternMode: PatternMode
  /** Hard cap on rule count; exceeding it fails the compile loudly. */
  readonly maxRules: number
  /** Hard cap on unbounded glob-star quantifiers per pattern (ReDoS degree bound). */
  readonly maxGlobStars: number
  /** Whether path patterns compile with the `i` flag. */
  readonly caseInsensitivePaths: boolean
}

/** One rule-file text for {@link compileRulesChain}. */
export interface RulesChainEntry {
  /** Absolute rule-file path, for audit attribution and error messages. */
  readonly path: string
  /** The raw YAML text. */
  readonly text: string
}

/** Host facts a `when` dimension evaluates against. */
export interface MatchContext {
  /** Node platform name; defaults to `process.platform` when omitted. */
  readonly platform?: string
  /** Environment table; defaults to `process.env` when omitted. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /**
   * Agent-identity candidate strings the `agents` dimension matches
   * against (`main`, `subagent`, `preset:<name>`); omitted (or empty)
   * means the identity is unknown and agent-scoped rules never match.
   */
  readonly agents?: readonly string[]
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
 * @param options - pattern mode, caps, and case handling.
 * @returns the compiled ruleset (every rule attributed to source 0).
 */
export function compileRules(doc: RulesFileDoc, options: CompileOptions): CompiledRuleset {
  if (doc.rules.length > options.maxRules) {
    throw new RuleError(`rule count ${doc.rules.length} exceeds maxRules ${options.maxRules}`)
  }
  return {
    rules: doc.rules.map((entry, index) => compileRule(entry, index, 0, options)),
    caseInsensitivePaths: options.caseInsensitivePaths,
  }
}

/**
 * Parse and compile an ordered source chain (nearest file first). Rules
 * keep per-file order and are evaluated in chain order, so a nearer file
 * can override a farther one on first-match semantics; `sourceIndex`
 * attributes every rule to its file. The TOTAL rule count is capped by
 * `maxRules`.
 * @param entries - the rule-file texts, nearest file first.
 * @param options - compile options.
 * @returns the merged ruleset and the source paths it references.
 */
export function compileRulesChain(entries: readonly RulesChainEntry[], options: CompileOptions): { ruleset: CompiledRuleset; sources: string[] } {
  const sources = entries.map(entry => entry.path)
  const merged: CompiledRule[] = []
  for (const entry of entries) {
    const doc = parseRulesDocument(entry.text)
    for (const rule of doc.rules) {
      merged.push(compileRule(rule, merged.length, sources.indexOf(entry.path), options))
    }
  }
  if (merged.length > options.maxRules) {
    throw new RuleError(`rule count ${merged.length} exceeds maxRules ${options.maxRules}`)
  }
  return { ruleset: { rules: merged, caseInsensitivePaths: options.caseInsensitivePaths }, sources }
}

/** Compile one parsed rule into its hot-path form. */
function compileRule(entry: RuleDocEntry, index: number, sourceIndex: number, options: CompileOptions): CompiledRule {
  const tools = entry.match.tools.map(pattern => compileToolPattern(pattern, options.maxGlobStars))
  const agents = entry.match.agents.map(pattern => compileToolPattern(pattern, options.maxGlobStars))
  const params = new Map<string, { positive: readonly RegExp[]; negative: readonly RegExp[] }>()
  for (const [key, patterns] of Object.entries(entry.match.params)) {
    params.set(key, compileParamPatterns(key, patterns, options))
  }
  const paths = entry.match.paths.map(pattern => compilePathPattern(pattern, options))
  const env = new Map<string, readonly RegExp[]>()
  for (const [key, patterns] of Object.entries(entry.match.when.env)) {
    env.set(key, patterns.map(pattern => compileValuePattern(pattern, options.patternMode, options.maxGlobStars)))
  }
  return {
    index,
    sourceIndex,
    action: entry.action,
    reason: entry.reason,
    enabled: entry.enabled,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    tags: entry.tags,
    tools,
    agents,
    params,
    paths,
    absent: entry.match.absent,
    ...(env.size === 0 && entry.match.when.platform.length === 0 ? {} : { when: { env, platform: entry.match.when.platform } }),
    source: entry,
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
 *   only tools/when/absent rules.
 * @param cwd - the session's absolute workspace root, for path normalization.
 * @param context - host facts for `when` evaluation; defaults resolve at match time.
 * @returns the first hit, or undefined when every rule passed.
 */
export function matchRules(
  ruleset: CompiledRuleset,
  toolName: string,
  args: unknown,
  cwd: string,
  context: MatchContext = {},
): RuleHit | undefined {
  const argRecord = isRecord(args) ? args : undefined
  for (const rule of ruleset.rules) {
    if (!rule.enabled) continue
    if (!matchTools(rule, toolName)) continue
    if (!matchAgents(rule, context)) continue
    if (!matchWhen(rule, context)) continue
    if (rule.params.size > 0 && (argRecord === undefined || !matchParams(rule, argRecord))) continue
    if (rule.absent.length > 0 && !matchAbsent(rule, argRecord)) continue
    if (rule.paths.length > 0 && (argRecord === undefined || !matchPaths(rule, argRecord, cwd, ruleset.caseInsensitivePaths))) continue
    return { ruleIndex: rule.index, rule }
  }
  return undefined
}

/**
 * Indices of rules that can never fire: every ENABLED rule after the first
 * enabled rule whose every dimension is empty (an unconditional catch-all).
 * Disabled rules are excluded from both roles. Conservative on purpose —
 * pattern-set inclusion across globs is not analyzed.
 * @param ruleset - the compiled rules.
 * @returns 0-based indices of unreachable rules.
 */
export function findUnreachableRules(ruleset: CompiledRuleset): number[] {
  const unreachable: number[] = []
  let catchAllSeen = false
  for (const rule of ruleset.rules) {
    if (!rule.enabled) continue
    if (catchAllSeen) {
      unreachable.push(rule.index)
      continue
    }
    if (isCatchAll(rule)) catchAllSeen = true
  }
  return unreachable
}

/** Whether every match dimension of one rule is empty. */
function isCatchAll(rule: CompiledRule): boolean {
  return rule.tools.length === 0 && rule.agents.length === 0 && rule.params.size === 0 && rule.paths.length === 0 && rule.absent.length === 0 && rule.when === undefined
}

/**
 * One-line human summary of a compiled rule, for `/rules` output. The
 * 1-based number, action, match dimensions, and reason render first; a
 * disabled marker, tags, and a truncated description follow. When `source`
 * is provided (multi-file chains), the rule's origin file is attributed on
 * the line.
 * @param rule - the compiled rule.
 * @param tokens - dimension-prefix vocabulary for the configured language.
 * @param source - display path of the rule's source file, when the listing
 *   spans several files.
 * @returns a single display line.
 */
export function describeRule(rule: CompiledRule, tokens: DescribeTokens, source?: string): string {
  const parts: string[] = []
  if (rule.source.match.tools.length > 0) parts.push(`${tokens.tools}:${rule.source.match.tools.join(',')}`)
  if (rule.source.match.agents.length > 0) parts.push(`${tokens.agents}:${rule.source.match.agents.join(',')}`)
  const params = Object.entries(rule.source.match.params)
    .map(([key, patterns]) => `${key}=${patterns.join('|')}`)
    .join(' ')
  if (params.length > 0) parts.push(`${tokens.params}:${params}`)
  if (rule.source.match.paths.length > 0) parts.push(`${tokens.paths}:${rule.source.match.paths.join(',')}`)
  if (rule.source.match.absent.length > 0) parts.push(`${tokens.absent}:${rule.source.match.absent.join(',')}`)
  const whenParts = Object.entries(rule.source.match.when.env)
    .map(([key, patterns]) => `${key}=${patterns.join('|')}`)
    .join(' ')
  const platformPart = rule.source.match.when.platform.length > 0 ? `${tokens.platform}:${rule.source.match.when.platform.join(',')}` : ''
  if (whenParts.length > 0 || platformPart.length > 0) parts.push(`${tokens.when}:${whenParts}${whenParts.length > 0 && platformPart.length > 0 ? ' ' : ''}${platformPart}`)
  const match = parts.length > 0 ? `[${parts.join(' ')}]` : `[${tokens.allTools}]`
  const disabled = rule.enabled ? '' : ` (${tokens.disabled})`
  const sourcePart = source !== undefined && source.length > 0 ? ` [${tokens.src}:${source}]` : ''
  const description = rule.description !== undefined ? ` (${truncate(rule.description, DISPLAY_TRUNCATE)})` : ''
  const tags = rule.tags.length > 0 ? ` [${tokens.tags}:${rule.tags.join(',')}]` : ''
  return `${rule.index + 1}. ${rule.action}${disabled} ${match}${sourcePart}: ${truncate(rule.reason, DISPLAY_TRUNCATE)}${description}${tags}`
}

/** The localized dimension-prefix vocabulary {@link describeRule} renders. */
export interface DescribeTokens {
  readonly allTools: string
  readonly tools: string
  readonly agents: string
  readonly params: string
  readonly paths: string
  readonly absent: string
  readonly when: string
  readonly platform: string
  readonly disabled: string
  readonly tags: string
  /** Prefix of the per-rule source-file attribution. */
  readonly src: string
}

/** Cut a display string at `limit` characters, marking truncation with `…`. */
function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/** Whether a rule's tools dimension selects the tool. */
function matchTools(rule: CompiledRule, toolName: string): boolean {
  if (rule.tools.length === 0) return true
  return rule.tools.some(regex => regex.test(toolName))
}

/**
 * Whether a rule's agents dimension selects the caller. Any selector glob
 * matching any identity candidate satisfies the dimension; unknown
 * identity (no agent or no candidates) fails the dimension, so an
 * agent-scoped rule can never fire where the caller cannot be identified.
 */
function matchAgents(rule: CompiledRule, context: MatchContext): boolean {
  if (rule.agents.length === 0) return true
  const candidates = context.agents
  if (candidates === undefined || candidates.length === 0) return false
  return rule.agents.some(regex => candidates.some(candidate => regex.test(candidate)))
}

/** Whether a rule's params dimension holds: EVERY key present and matching. */
function matchParams(rule: CompiledRule, args: Record<string, unknown>): boolean {
  for (const [key, { positive, negative }] of rule.params) {
    const value = args[key]
    if (value === undefined) return false
    const candidates = scalarCandidates(value, 0)
    if (candidates.length === 0) return false
    if (positive.length > 0 && !candidates.some(candidate => positive.some(regex => regex.test(candidate)))) return false
    if (negative.length > 0 && candidates.some(candidate => negative.some(regex => regex.test(candidate)))) return false
  }
  return true
}

/** Whether a rule's absent dimension holds: EVERY listed key missing. */
function matchAbsent(rule: CompiledRule, argRecord: Record<string, unknown> | undefined): boolean {
  for (const key of rule.absent) {
    if (argRecord !== undefined && argRecord[key] !== undefined) return false
  }
  return true
}

/** Whether a rule's when dimension holds for the host facts. */
function matchWhen(rule: CompiledRule, context: MatchContext): boolean {
  const when = rule.when
  if (when === undefined) return true
  if (when.platform.length > 0 && !when.platform.includes(context.platform ?? process.platform)) return false
  const env = context.env ?? process.env
  for (const [key, patterns] of when.env) {
    const value = env[key]
    if (value === undefined) return false
    if (!patterns.some(regex => regex.test(value))) return false
  }
  return true
}

/** Whether a rule's paths dimension holds: at least one candidate matches one pattern. */
function matchPaths(rule: CompiledRule, args: Record<string, unknown>, cwd: string, caseInsensitive: boolean): boolean {
  const candidates = extractPathCandidates(args)
    .map(candidate => normalizeWorkspacePath(cwd, candidate, caseInsensitive))
    .filter((candidate): candidate is string => candidate.length > 0)
  if (candidates.length === 0) return false
  return candidates.some(candidate => rule.paths.some(regex => regex.test(candidate)))
}

/** Tool-name patterns are always globs (a tool name is not a path). */
function compileToolPattern(pattern: string, maxGlobStars: number): RegExp {
  return compileGlob(pattern, { segments: false, maxStars: maxGlobStars })
}

/** Param-value patterns follow the configured mode; `/` is an ordinary character. */
function compileValuePattern(pattern: string, mode: PatternMode, maxGlobStars: number): RegExp {
  return mode === 'regex' ? compilePatternRegex(pattern) : compileGlob(pattern, { segments: false, maxStars: maxGlobStars })
}

/** Path patterns follow the configured mode with path-segment glob semantics. */
function compilePathPattern(pattern: string, options: CompileOptions): RegExp {
  return options.patternMode === 'regex'
    ? compilePatternRegex(pattern)
    : compileGlob(pattern, { segments: true, maxStars: options.maxGlobStars, caseInsensitive: options.caseInsensitivePaths })
}

/**
 * Split one param key's patterns into positive and negative lists. A
 * leading `!` negates: the value must NOT match any negated pattern; a bare
 * `!` is a load-time error.
 */
function compileParamPatterns(key: string, patterns: readonly string[], options: CompileOptions): { positive: readonly RegExp[]; negative: readonly RegExp[] } {
  const positive: RegExp[] = []
  const negative: RegExp[] = []
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      const body = pattern.slice(1)
      if (body.length === 0) throw new RuleError(`param key "${key}" has an empty negated pattern`)
      negative.push(compileValuePattern(body, options.patternMode, options.maxGlobStars))
    } else {
      positive.push(compileValuePattern(pattern, options.patternMode, options.maxGlobStars))
    }
  }
  return { positive, negative }
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
  const unknownFields = Object.keys(record).filter(key => key !== 'match' && key !== 'action' && key !== 'reason' && key !== 'enabled' && key !== 'description' && key !== 'tags')
  if (unknownFields.length > 0) {
    throw new RuleError(`${at}: unknown field${unknownFields.length > 1 ? 's' : ''} ${unknownFields.map(k => JSON.stringify(k)).join(', ')} (allowed: match, action, reason, enabled, description, tags)`)
  }
  const action = record['action']
  if (typeof action !== 'string' || !RULE_ACTIONS.includes(action as RuleAction)) {
    throw new RuleError(`${at}: action must be one of ${RULE_ACTIONS.map(a => JSON.stringify(a)).join(' | ')}, got ${JSON.stringify(action)}`)
  }
  const reason = record['reason']
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new RuleError(`${at}: reason must be a non-empty string`)
  }
  const enabled = record['enabled']
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    throw new RuleError(`${at}: enabled must be a boolean, got ${typeof enabled}`)
  }
  const description = record['description']
  if (description !== undefined && (typeof description !== 'string' || description.trim().length === 0)) {
    throw new RuleError(`${at}: description must be a non-empty string`)
  }
  const match = parseMatch(record['match'], at)
  return { match, action: action as RuleAction, reason, enabled: enabled !== false, ...(description !== undefined ? { description } : {}), tags: parseStringList(record['tags'], `${at}.tags`) }
}

/** Validate the `match` block of one rule. */
function parseMatch(raw: unknown, at: string): RuleMatchDoc {
  if (raw === undefined) return { tools: [], agents: [], params: {}, paths: [], absent: [], when: { env: {}, platform: [] } }
  const record = asRecord(raw, `${at}.match`)
  const unknownFields = Object.keys(record).filter(key => key !== 'tools' && key !== 'agents' && key !== 'params' && key !== 'paths' && key !== 'absent' && key !== 'when')
  if (unknownFields.length > 0) {
    throw new RuleError(`${at}.match: unknown field${unknownFields.length > 1 ? 's' : ''} ${unknownFields.map(k => JSON.stringify(k)).join(', ')} (allowed: tools, agents, params, paths, absent, when)`)
  }
  return {
    tools: parseStringList(record['tools'], `${at}.match.tools`),
    agents: parseStringList(record['agents'], `${at}.match.agents`),
    params: parseParams(record['params'], `${at}.match.params`),
    paths: parseStringList(record['paths'], `${at}.match.paths`),
    absent: parseStringList(record['absent'], `${at}.match.absent`),
    when: parseWhen(record['when'], `${at}.match.when`),
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

/** Validate the `when` block: env patterns and a closed platform vocabulary. */
function parseWhen(raw: unknown, at: string): WhenDoc {
  if (raw === undefined) return { env: {}, platform: [] }
  const record = asRecord(raw, at)
  const unknownFields = Object.keys(record).filter(key => key !== 'env' && key !== 'platform')
  if (unknownFields.length > 0) {
    throw new RuleError(`${at}: unknown field${unknownFields.length > 1 ? 's' : ''} ${unknownFields.map(k => JSON.stringify(k)).join(', ')} (allowed: env, platform)`)
  }
  const env: Record<string, string[]> = {}
  const rawEnv = record['env']
  if (rawEnv !== undefined) {
    const envRecord = asRecord(rawEnv, `${at}.env`)
    for (const [key, value] of Object.entries(envRecord)) {
      if (key.length === 0) throw new RuleError(`${at}.env: env var names must be non-empty strings`)
      const patterns = parsePatternValues(value, `${at}.env.${key}`)
      if (patterns.length === 0) throw new RuleError(`${at}.env.${key}: env patterns must be non-empty`)
      env[key] = patterns
    }
  }
  const platform = parseStringList(record['platform'], `${at}.platform`)
  for (const name of platform) {
    if (!PLATFORMS.includes(name)) {
      throw new RuleError(`${at}.platform: unknown platform ${JSON.stringify(name)} (allowed: ${PLATFORMS.map(p => JSON.stringify(p)).join(', ')})`)
    }
  }
  return { env, platform }
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
 * Collect path-candidate strings from tool arguments at ANY nesting depth
 * (capped at {@link MAX_ARGUMENT_DEPTH}): scalar strings under the
 * documented {@link PATH_CANDIDATE_KEYS}, plus string elements of arrays
 * under those keys. Nested objects are walked so MCP-style
 * `{ arguments: { path } }` shapes still feed path matching. Iterates the
 * argument object's own key order, so extraction order is deterministic.
 * @param args - the parsed tool arguments.
 * @returns candidate strings in argument key order (duplicates kept).
 */
export function extractPathCandidates(args: Record<string, unknown>): string[] {
  const candidates: string[] = []
  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_ARGUMENT_DEPTH) return
    if (Array.isArray(node)) {
      for (const element of node) walk(element, depth + 1)
      return
    }
    if (typeof node !== 'object' || node === null) return
    for (const [key, value] of Object.entries(node)) {
      if (PATH_CANDIDATE_KEYS.includes(key)) {
        if (typeof value === 'string') candidates.push(value)
        else if (Array.isArray(value)) {
          for (const element of value) {
            if (typeof element === 'string') candidates.push(element)
          }
        }
      }
      walk(value, depth + 1)
    }
  }
  walk(args, 0)
  return candidates
}

/**
 * Normalize one candidate path against the workspace root: separators
 * become `/`, `./` prefixes drop, and in-root paths become workspace
 * relative. Candidates OUTSIDE the root (absolute or drive-prefixed
 * elsewhere) yield `''` — path patterns address workspace-relative paths
 * only; a still-relative `../…` input is kept so explicit out-of-root
 * globs like `../shared/**` can address it. When `caseInsensitive` is set
 * (Windows default), the drive and root-prefix comparisons ignore ASCII
 * case, matching the case-insensitive filesystem.
 * @param cwd - the session's absolute workspace root (any separator).
 * @param candidate - the raw candidate path.
 * @param caseInsensitive - compare root prefixes without ASCII case.
 * @returns the workspace-relative posix path, or `''` to drop the candidate.
 */
export function normalizeWorkspacePath(cwd: string, candidate: string, caseInsensitive = false): string {
  const root = toPosix(cwd).replace(/\/+$/, '')
  const raw = toPosix(candidate)
  if (raw.length === 0) return ''
  let path = raw
  while (path.startsWith('./')) path = path.slice(2)
  if (/^[A-Za-z]:\//.test(path)) {
    // Windows drive path: relative only when on the root's own drive.
    if (!/^[A-Za-z]:\//.test(root)) return ''
    if (path.slice(0, 2).toLowerCase() !== root.slice(0, 2).toLowerCase()) return ''
    return relFromRoot(root, path, path.slice(2), root.slice(2), caseInsensitive)
  }
  if (path.startsWith('/')) {
    // Absolute posix path: relative when inside the root, dropped otherwise.
    return relFromRoot(root, path, path, root, caseInsensitive)
  }
  return path
}

/** Strip a common root prefix from one absolute path, else drop the path. */
function relFromRoot(root: string, path: string, rest: string, rootRest: string, caseInsensitive: boolean): string {
  const restLower = caseInsensitive ? rest.toLowerCase() : rest
  const rootRestLower = caseInsensitive ? rootRest.toLowerCase() : rootRest
  if (rootRestLower.length === 0) return rest.slice(1)
  // A candidate equal to the root itself — modulo case only when the
  // comparison is case-insensitive — is the workspace root, not a relative
  // path inside it, and is dropped explicitly.
  if (path === root || (caseInsensitive && path.toLowerCase() === root.toLowerCase())) return ''
  return restLower.startsWith(`${rootRestLower}/`) ? rest.slice(rootRest.length + 1) : ''
}

/** Convert a path to posix separators. */
function toPosix(path: string): string {
  return path.replaceAll('\\', '/')
}

/** Collect scalar candidate strings from one param value, recursing into arrays and objects. */
function scalarCandidates(value: unknown, depth: number): string[] {
  if (depth > MAX_ARGUMENT_DEPTH) return []
  if (typeof value === 'string') return [value]
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) {
    return value.flatMap(element => scalarCandidates(element, depth + 1))
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(child => scalarCandidates(child, depth + 1))
  }
  return []
}
