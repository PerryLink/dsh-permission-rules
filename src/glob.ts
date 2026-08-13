/**
 * Strict glob→RegExp compilation for rule patterns. A conservative,
 * validated subset: `*` (within one path segment), `**` (any depth,
 * including zero), `?` (one character), `[abc]` / `[!abc]` character
 * classes, and `\x` escapes. Unbalanced brackets, empty classes, and
 * trailing escapes throw at compile time — a bad glob must fail loudly at
 * load, never silently match nothing at runtime.
 * @module dsh-permission-rules/glob
 */

/** Raised by {@link compileGlob} on a syntactically invalid pattern. */
export class GlobError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'GlobError'
  }
}

/**
 * Compile one glob pattern to an anchored regular expression.
 * @param pattern - the glob source.
 * @param options.segments - `true` keeps `*`/`?` inside one path segment
 *   (for `paths` patterns); `false` lets them cross `/` (for `params`
 *   patterns, where `/` is an ordinary character).
 * @returns a RegExp matching the whole candidate string.
 * @throws {@link GlobError} on unbalanced `[`, empty classes, or a trailing escape.
 */
export function compileGlob(pattern: string, options: { segments: boolean }): RegExp {
  let out = ''
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
        i += 2
        while (pattern[i] === '*') i += 1
        if (pattern[i] === '/') i += 1
        continue
      }
      // A single star never crosses a path separator.
      out += options.segments ? '[^/]*' : '.*'
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
  try {
    return new RegExp(`^${out}$`, 'u')
  } catch (error) {
    throw new GlobError(`glob ${JSON.stringify(pattern)} compiles to an invalid regular expression: ${String(error)}`)
  }
}

/** Escape one literal character for a RegExp source. */
function escapeRegExpChar(ch: string): string {
  // eslint-disable-next-line no-control-regex
  return /[.*+?^${}()|[\]\\/]/.test(ch) ? `\\${ch}` : ch
}

/** Compile one pattern as an unanchored regex, rethrowing loudly. */
export function compilePatternRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'u')
  } catch (error) {
    throw new TypeError(`pattern ${JSON.stringify(pattern)} is not a valid regular expression: ${String(error)}`)
  }
}
