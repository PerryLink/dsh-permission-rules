/**
 * Strict glob→RegExp compilation and regex-safety validation for rule
 * patterns. A conservative, validated glob subset: `*` (within one path
 * segment), `**` (any depth, including zero), `?` (one character),
 * `[abc]` / `[!abc]` character classes, and `\x` escapes. Unbalanced
 * brackets, empty classes, and trailing escapes throw at compile time — a
 * bad glob must fail loudly at load, never silently match nothing at
 * runtime.
 *
 * Catastrophic-backtracking defense, tuned per pattern flavor:
 * - Glob output is fully machine-generated, so the backtracking degree is
 *   exactly the number of star expansions: each `*`/`**` emits exactly one
 *   unbounded quantifier and no group is ever emitted. {@link compileGlob}
 *   therefore caps that count via `maxStars`.
 * - User regexes (patternMode `regex`) are scanned structurally: a
 *   quantifier applied to a group containing an unbounded quantifier, and a
 *   quantified group whose literal alternation branches overlap, are
 *   rejected at load. Chains of independent top-level quantifiers
 *   (`\d+\.\d+\.\d+`) stay allowed — a documented, deliberate limitation:
 *   regex mode is the escape hatch, glob mode is the guarded default.
 * @module dsh-permission-rules/glob
 */

/** Raised by {@link compileGlob} on a syntactically invalid or over-quantified pattern. */
export class GlobError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'GlobError'
  }
}

/** Compile options for {@link compileGlob}. */
export interface GlobCompileOptions {
  /** `true` keeps `*`/`?` inside one path segment (for `paths` patterns). */
  readonly segments: boolean
  /** Compile with the `i` flag so matching ignores ASCII case. */
  readonly caseInsensitive?: boolean
  /** Hard cap on unbounded star expansions; exceeding it throws. Unset = unlimited. */
  readonly maxStars?: number
}

/**
 * Compile one glob pattern to an anchored regular expression.
 * @param pattern - the glob source.
 * @param options - segment semantics, case handling, and the star cap.
 * @returns a RegExp matching the whole candidate string.
 * @throws {@link GlobError} on unbalanced `[`, empty classes, a trailing
 *   escape, or more star expansions than `options.maxStars` allows.
 */
export function compileGlob(pattern: string, options: GlobCompileOptions): RegExp {
  let out = ''
  let stars = 0
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i] as string
    if (ch === '\\') {
      const next = pattern[i + 1]
      if (next === undefined) throw new GlobError(`glob ${JSON.stringify(pattern)} ends with a dangling escape`)
      out += escapeRegExpChar(next)
      i += 2
      continue
    }
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // `**` crosses path segments. Collapse runs of `**` and any
        // following separator into one zero-or-more-any-depth group, so
        // `a/**/b`, `a/**b`, and `a/***/b` all behave the same.
        out += '.*'
        stars += 1
        i += 2
        while (pattern[i] === '*') i += 1
        if (pattern[i] === '/') i += 1
        continue
      }
      // A single star never crosses a path separator.
      out += options.segments ? '[^/]*' : '.*'
      stars += 1
      i += 1
      continue
    }
    if (ch === '?') {
      out += options.segments ? '[^/]' : '.'
      i += 1
      continue
    }
    if (ch === '[') {
      const end = pattern.indexOf(']', i + 1)
      if (end < 0) throw new GlobError(`glob ${JSON.stringify(pattern)} has an unbalanced "["`)
      const body = pattern.slice(i + 1, end)
      if (body.length === 0) throw new GlobError(`glob ${JSON.stringify(pattern)} has an empty character class`)
      let content = body
      let negate = false
      if (content.startsWith('!')) {
        negate = true
        content = content.slice(1)
      }
      if (content.length === 0) throw new GlobError(`glob ${JSON.stringify(pattern)} has an empty character class`)
      out += `[${negate ? '^' : ''}${content.replaceAll('\\', '\\\\')}]`
      i = end + 1
      continue
    }
    if (ch === ']') throw new GlobError(`glob ${JSON.stringify(pattern)} has an unbalanced "]"`)
    out += escapeRegExpChar(ch)
    i += 1
  }
  if (options.maxStars !== undefined && stars > options.maxStars) {
    throw new GlobError(`glob ${JSON.stringify(pattern)} expands to ${stars} unbounded star quantifiers (max ${options.maxStars}); split it into several patterns`)
  }
  try {
    return new RegExp(`^${out}$`, options.caseInsensitive === true ? 'iu' : 'u')
  } catch (error) {
    throw new GlobError(`glob ${JSON.stringify(pattern)} compiles to an invalid regular expression: ${String(error)}`)
  }
}

/** Escape one literal character for a RegExp source. */
function escapeRegExpChar(ch: string): string {
  return /[.*+?^${}()|[\]\\/]/.test(ch) ? `\\${ch}` : ch
}

/**
 * Compile one pattern as an unanchored regex, rejecting syntax errors and
 * catastrophic-backtracking structures loudly.
 * @param pattern - the regex source.
 * @returns the compiled RegExp.
 * @throws TypeError when the pattern is invalid, nests an unbounded
 *   quantifier, or quantifies a group with overlapping literal alternation
 *   branches.
 */
export function compilePatternRegex(pattern: string): RegExp {
  let compiled: RegExp
  try {
    compiled = new RegExp(pattern, 'u')
  } catch (error) {
    throw new TypeError(`pattern ${JSON.stringify(pattern)} is not a valid regular expression: ${String(error)}`, { cause: error })
  }
  assertSafeRegexStructure(pattern)
  return compiled
}

/**
 * Structural ReDoS scan. Rejects (a) an unbounded quantifier (`*`, `+`,
 * `{m,}`) applied to a group whose body contains an unbounded quantifier,
 * and (b) a quantified group whose fully-literal alternation branches
 * overlap as prefixes. Everything else — including chains of independent
 * top-level quantifiers — compiles untouched.
 * @param pattern - the already-syntax-valid regex source.
 * @throws TypeError on a rejected structure.
 */
function assertSafeRegexStructure(pattern: string): void {
  const stack: { start: number; unbounded: boolean }[] = []
  let i = 0
  const markUnbounded = (): void => {
    const top = stack[stack.length - 1]
    if (top !== undefined) top.unbounded = true
  }
  const reject = (message: string): never => {
    throw new TypeError(`pattern ${JSON.stringify(pattern)} is rejected: ${message} risks catastrophic backtracking; restructure the pattern or use glob mode`)
  }
  while (i < pattern.length) {
    const ch = pattern[i] as string
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '[') {
      i += 1
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') i += 1
        i += 1
      }
      i += 1
      continue
    }
    if (ch === '(') {
      stack.push({ start: i, unbounded: false })
      i += 1
      continue
    }
    if (ch === ')') {
      const group = stack.pop()
      // An unbalanced `)` is invalid syntax; the compile above already rejected it.
      if (group === undefined) {
        i += 1
        continue
      }
      const quantifier = quantifierAt(pattern, i + 1)
      if (quantifier !== undefined) {
        if (quantifier.unbounded) {
          if (group.unbounded) {
            reject(`quantifier ${quantifier.text} applies to a group containing an unbounded quantifier`)
          }
          if (hasAmbiguousAlternation(pattern, group.start + 1, i)) {
            reject(`quantified group ${JSON.stringify(pattern.slice(group.start, quantifier.end + 1))} has overlapping alternation branches`)
          }
          markUnbounded()
        }
        i = quantifier.end + 1
        continue
      }
      if (group.unbounded) markUnbounded()
      i += 1
      continue
    }
    if (ch === '*' || ch === '+') {
      markUnbounded()
      i += 1
      continue
    }
    if (ch === '{') {
      const parsed = parseBraceQuantifier(pattern, i)
      if (parsed !== undefined) {
        if (parsed.unbounded) markUnbounded()
        i = parsed.end + 1
        continue
      }
      // Not a quantifier (a `\p{L}`-style body is reached after its escape
      // was skipped above): an ordinary literal.
      i += 1
      continue
    }
    // `?` is always bounded; literals, `.`, `|`, `^`, `$` pass through.
    i += 1
  }
}

/** One parsed quantifier token, when the character at `index` starts one. */
function quantifierAt(pattern: string, index: number): { text: string; end: number; unbounded: boolean } | undefined {
  const ch = pattern[index]
  if (ch === '*' || ch === '+') return { text: ch, end: index, unbounded: true }
  if (ch === '?') return { text: ch, end: index, unbounded: false }
  if (ch === '{') return parseBraceQuantifier(pattern, index)
  return undefined
}

/** Parse `{m}`, `{m,}`, or `{m,n}` at `start`; other braces are not quantifiers. */
function parseBraceQuantifier(pattern: string, start: number): { text: string; end: number; unbounded: boolean } | undefined {
  const close = pattern.indexOf('}', start + 1)
  if (close < 0) return undefined
  const body = pattern.slice(start + 1, close)
  if (!/^\d+(,\d*)?$/.test(body)) return undefined
  const unbounded = body.includes(',') && body.endsWith(',')
  return { text: pattern.slice(start, close + 1), end: close, unbounded }
}

/**
 * Whether a group body (between the parens) contains a top-level
 * alternation with two fully-literal branches where one is a prefix of the
 * other — the `(a|aa)+` ambiguity that makes repetition exponential.
 * @param pattern - the full pattern.
 * @param start - index just after the group's `(`.
 * @param end - index of the group's `)`.
 * @returns true when such an overlap exists.
 */
function hasAmbiguousAlternation(pattern: string, start: number, end: number): boolean {
  const branches: string[] = []
  let depth = 0
  let branchStart = start
  let hasPipe = false
  for (let i = start; i < end; i += 1) {
    const ch = pattern[i] as string
    if (ch === '\\') {
      i += 1
      continue
    }
    if (ch === '[') {
      while (i < end && pattern[i] !== ']') {
        if (pattern[i] === '\\') i += 1
        i += 1
      }
      continue
    }
    if (ch === '(') {
      depth += 1
      continue
    }
    if (ch === ')') {
      depth -= 1
      continue
    }
    if (ch === '|' && depth === 0) {
      hasPipe = true
      branches.push(pattern.slice(branchStart, i))
      branchStart = i + 1
    }
  }
  if (!hasPipe) return false
  branches.push(pattern.slice(branchStart, end))
  for (let a = 0; a < branches.length; a += 1) {
    for (let b = a + 1; b < branches.length; b += 1) {
      if (literalPrefixOf(branches[a] as string, branches[b] as string)) return true
    }
  }
  return false
}

/** True when two fully-literal branches share their complete shorter text as a prefix. */
function literalPrefixOf(x: string, y: string): boolean {
  const literal = /^[^*+?()|[\]{}^$.\\]+$/
  if (!literal.test(x) || !literal.test(y)) return false
  const min = Math.min(x.length, y.length)
  return x.slice(0, min) === y.slice(0, min)
}
