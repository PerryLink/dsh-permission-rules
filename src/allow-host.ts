/**
 * The settings-page "allow this host" action, host-only half: normalizing
 * and validating a blocked host, inserting ONE minimal
 * `match.network.domains` allow rule at the HEAD of a rule document, and
 * choosing which rule file the rule belongs in.
 *
 * The workspace choices (`allowHostWorkspaces`) and the notice mapping
 * (`allowHostNotice`) live in `./allow-host-notice.ts`: the settings page
 * imports them from the BROWSER bundle, whose bundler inlines every value
 * import — keeping them next to the `node:path`/`node:net`/`yaml` code here
 * emitted `require("process")`/`require("buffer")` calls the shell's frozen
 * module table cannot answer, failing the whole plugin load. They are
 * re-exported below so existing host-side imports keep working.
 *
 * Three invariants hold here and are asserted by `test/allow-host.spec.ts`:
 *
 * 1. the rule is inserted at index 0 — rules are first-match-wins, so a rule
 *    appended after an existing `deny` would be dead text;
 * 2. a document the yaml parser reports an error for, or whose `rules` is not
 *    a list, is REFUSED (a {@link RuleError}) — the caller never overwrites a
 *    file it could not read; and
 * 3. the insertion goes through the yaml Document API (`parseDocument` +
 *    `createNode` + `items.unshift` + `String(doc)`), so comments and the
 *    existing formatting of the untouched rules survive.
 *
 * Nothing here reads the filesystem or the process cwd: the runtime injects
 * `exists`, `processCwd`, and the source lists it already computed, which is
 * what makes the target choice testable without touching a real host.
 * @module dsh-permission-rules/allow-host
 */

import { isAbsolute, join, resolve } from 'node:path'
import { isIP } from 'node:net'
import { isMap, isSeq, parseDocument } from 'yaml'
import type { YAMLSeq } from 'yaml'
import { RuleError, normalizeHost } from './rules.ts'

// Client-safe pieces re-exported from their own module — see the module doc
// above for why they must not live in this host-only file.
export { allowHostNotice, allowHostWorkspaces } from './allow-host-notice.ts'
export type { AllowHostNotice, AllowHostNoticeKey } from './allow-host-notice.ts'

/**
 * Why a generated rule may legitimately live in a rule file the parser would
 * reject: it is not one — every write goes back through the same
 * `parseRulesDocument` + `compileRules` gate as a hand edit.
 */
const RULE_REASON_SUFFIX = '(added from the settings page)'

/**
 * A DNS-ish host: dot-separated labels of ASCII letters/digits/`-`/`_`, each
 * starting and ending with an alphanumeric. Deliberately narrow — the action
 * writes an EXACT host, so glob metacharacters (`*`), whitespace, `#`, `:`,
 * `[`, quotes and anything else that could make the generated scalar mean
 * something other than "this one host" are refused instead of escaped.
 */
const HOSTNAME_SHAPE = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?)*$/

/** Longest a host name (or an IP literal) may be; also bounds the generated rule. */
const MAX_HOST_LENGTH = 253

/**
 * Canonical spelling of a host for the allow action, matching target parsing
 * exactly (see `normalizeHost`): lowercase, IPv6 brackets stripped, one
 * trailing dot stripped.
 * @param host - the host as the block record reported it.
 * @returns the canonical spelling.
 */
export function normalizeAllowHost(host: string): string {
  return normalizeHost(host)
}

/**
 * Whether a normalized host may be written into a rule: a host name or an IP
 * literal, nothing else. This is the syntactic half of the action's safety —
 * a newline, a `rules:` fragment, a glob, a URL, or a `host:port` authority is
 * refused here rather than relying on the YAML emitter to quote it. The IP
 * check is `node:net`'s `isIP`, so a `host:port` string (which merely contains
 * a colon) is not mistaken for an IPv6 literal.
 * @param host - the normalized host.
 * @returns true when the host may be allowed.
 */
export function isWritableHost(host: string): boolean {
  if (host.length === 0 || host.length > MAX_HOST_LENGTH) return false
  if (isIP(host) !== 0) return true
  return HOSTNAME_SHAPE.test(host)
}

/**
 * The `reason` carried by every generated rule. English on purpose: rule
 * `reason`s are never translated (they are quoted verbatim in denial messages
 * and in the session audit), so a localized reason would make one rule read
 * differently per UI language.
 * @param host - the allowed host.
 * @returns the reason line.
 */
export function allowHostReason(host: string): string {
  return `Allow ${host} ${RULE_REASON_SUFFIX}`
}

/** The outcome of one insertion attempt. */
export interface AllowHostInsertion {
  /** The document text to write; identical to the input when `inserted` is false. */
  readonly text: string
  /** Whether the rule was added (false = the file already leads with this exact allow). */
  readonly inserted: boolean
}

/**
 * Insert the minimal allow rule for `host` at the HEAD of a rule document.
 *
 * `inserted: false` (with the input text returned unchanged) means the first
 * rule of the file is ALREADY this exact allow — first-match semantics make a
 * second copy do nothing, so the caller must not rewrite the file (repeated
 * clicks would otherwise pile up duplicate lines in the user's git diff).
 *
 * @param text - the current file text (empty for a file to be created).
 * @param host - the normalized, validated host.
 * @returns the text to write plus whether anything was added.
 * @throws RuleError when the document cannot be parsed or has no `rules` list.
 */
export function insertAllowRule(text: string, host: string): AllowHostInsertion {
  // Normalizing here as well as at the call site keeps the idempotence check
  // (and the generated rule) independent of the caller's spelling.
  const normalized = normalizeAllowHost(host)
  const doc = parseDocument(text)
  // `parseDocument` collects syntax errors instead of throwing, and `String(doc)`
  // would happily re-emit a partially-understood document — refusing here is what
  // keeps "unparseable file" from ever meaning "overwritten file".
  if (doc.errors.length > 0) {
    throw new RuleError(`cannot edit the rule file: ${doc.errors[0]?.message ?? 'invalid YAML'}`)
  }
  const rule = { match: { network: { domains: [normalized] } }, action: 'allow', reason: allowHostReason(normalized) }
  if (doc.contents === null) {
    // An empty or comment-only file: the comments stay ahead of the new key.
    doc.set('rules', doc.createNode([rule]))
    return { text: String(doc), inserted: true }
  }
  if (!isMap(doc.contents)) {
    throw new RuleError('cannot edit the rule file: the document root must be a mapping with a "rules" list')
  }
  if (!doc.has('rules')) throw new RuleError('cannot edit the rule file: the document has no "rules" list')
  const rules = doc.get('rules')
  if (!isSeq(rules)) throw new RuleError('cannot edit the rule file: "rules" must be a list')
  if (headAllowHost(rules) === normalized) return { text, inserted: false }
  rules.items.unshift(doc.createNode(rule))
  return { text: String(doc), inserted: true }
}

/**
 * The host of the first rule, when that rule is exactly the allow rule this
 * action generates: `action: allow`, enabled, and a `match` whose only
 * dimension is a single `network.domains` entry. Anything else — a different
 * action, a disabled rule, or a rule narrowed by ports/schemes/tools/agents —
 * returns undefined, so an existing narrower rule can never make the action
 * skip the write that would actually unblock the connection.
 * @param rules - the parsed `rules` sequence.
 * @returns the normalized head host, or undefined.
 */
function headAllowHost(rules: YAMLSeq): string | undefined {
  const first = rules.items[0]
  if (!isMap(first)) return undefined
  const record: unknown = first.toJSON()
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return undefined
  const rule = record as Record<string, unknown>
  if (rule['action'] !== 'allow' || rule['enabled'] === false) return undefined
  const match = rule['match']
  if (typeof match !== 'object' || match === null || Array.isArray(match)) return undefined
  const dimensions = Object.keys(match)
  if (dimensions.length !== 1 || dimensions[0] !== 'network') return undefined
  const network = (match as Record<string, unknown>)['network']
  if (typeof network !== 'object' || network === null || Array.isArray(network)) return undefined
  const scopes = Object.keys(network)
  if (scopes.length !== 1 || scopes[0] !== 'domains') return undefined
  const domains = (network as Record<string, unknown>)['domains']
  if (!Array.isArray(domains) || domains.length !== 1) return undefined
  const only: unknown = domains[0]
  return typeof only === 'string' ? normalizeAllowHost(only) : undefined
}

/** Everything {@link resolveAllowHostTarget} needs, injected so the choice is pure and testable. */
export interface AllowHostTargetInput {
  /** The workspace the request named, or null for a host-level (session-less) block. */
  readonly cwd: string | null
  /** The absolute workspace roots whose rule chains are currently loaded (the cwd whitelist). */
  readonly loadedCwds: readonly string[]
  /** The paths the editor/action may touch (`PermissionRulesRuntime.knownRuleSources()`). */
  readonly knownSources: readonly string[]
  /** The configured `rulesFile`: relative to a workspace, or absolute for every one. */
  readonly rulesFile: string
  /** The configured `fallbackPath`, or undefined when unset. */
  readonly fallbackPath: string | undefined
  /** The host process's working directory (the session-less workspace). */
  readonly processCwd: string
  /** The shipped baseline path when the baseline is enabled; never writable. */
  readonly builtinPath: string | undefined
  /** Existence probe for the host-level project file. */
  readonly exists: (path: string) => boolean
}

/**
 * The one rule file this action may write for a request: the nearest file of
 * the chain that will actually judge the connection.
 *
 * With a workspace cwd the target is that workspace's project file (the
 * absolute `rulesFile` when one is configured), and the cwd must be a
 * workspace whose chain is loaded — an unknown cwd is refused instead of being
 * turned into a path.
 *
 * Without one, the order mirrors `resolveUserSources(process.cwd())` exactly,
 * so the file written is the file the host chain reads: the absolute
 * `rulesFile`, else `<processCwd>/<rulesFile>` when it already exists, else
 * the configured fallback, else `<processCwd>/<rulesFile>` (created — the
 * host chain picks it up on the next load).
 *
 * The result must be a known rule source and must never be the built-in
 * baseline.
 *
 * @param input - the injected config, cwd, and source state.
 * @returns the absolute path to write.
 * @throws RuleError when the request names an unknown workspace or resolves to
 *   a path outside the writable set.
 */
export function resolveAllowHostTarget(input: AllowHostTargetInput): string {
  const target = input.cwd === null ? hostTarget(input) : workspaceTarget(input, input.cwd)
  if (input.builtinPath !== undefined && samePath(target, input.builtinPath)) {
    throw new RuleError(`refusing to write ${target}: the built-in ruleset is read-only`)
  }
  if (!input.knownSources.some(source => samePath(source, target))) {
    throw new RuleError(`refusing to write ${target}: not a known rule source`)
  }
  return target
}

/** The project file of one workspace (the absolute `rulesFile` when one is configured). */
function projectFile(rulesFile: string, cwd: string): string {
  return isAbsolute(rulesFile) ? rulesFile : join(cwd, rulesFile)
}

/** The target for a request that named a workspace. */
function workspaceTarget(input: AllowHostTargetInput, cwd: string): string {
  const owner = input.loadedCwds.find(loaded => samePath(loaded, cwd))
  if (owner === undefined) {
    throw new RuleError(`refusing to allow for ${JSON.stringify(cwd)}: not a workspace whose rules are loaded`)
  }
  return projectFile(input.rulesFile, owner)
}

/** The target for a host-level (session-less) request — the same order the host chain resolves in. */
function hostTarget(input: AllowHostTargetInput): string {
  if (isAbsolute(input.rulesFile)) return input.rulesFile
  const project = join(input.processCwd, input.rulesFile)
  if (input.exists(project)) return project
  const fallback = input.fallbackPath
  if (fallback === undefined) return project
  return isAbsolute(fallback) ? fallback : resolve(fallback)
}

/** Path equality as the per-workspace cache key treats it: resolved, and case-folded on Windows. */
function samePath(a: string, b: string): boolean {
  const left = resolve(a)
  const right = resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}
