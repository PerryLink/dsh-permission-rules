/**
 * Pure lexical shell-command decomposition: split one command line into
 * simple commands (pipeline/control-operator separated) and each simple
 * command into its command word, argument tokens, and redirect targets.
 * No external dependency — quotes, escapes, pipes, control operators, and
 * redirects are handled by a small character-level state machine — so the
 * `argv` match dimension can match individual argument tokens precisely
 * instead of the substring globs `params.command` is limited to.
 *
 * Best-effort by design: this is NOT a POSIX parser. Command substitution
 * (`$(...)`), backticks, brace expansion, and arithmetic are treated as
 * ordinary characters; the goal is token extraction for permission
 * matching, not shell emulation.
 * @module dsh-permission-rules/shell
 */

/** One simple command: a command word plus its argument tokens and redirect targets. */
export interface ShellSimpleCommand {
  /** The command word (first non-redirect token), quotes/escapes resolved; `''` when absent. */
  readonly command: string
  /** Argument tokens following the command, quotes/escapes resolved, in order. */
  readonly args: readonly string[]
  /** Redirect-target tokens (the word after `>`, `>>`, `<`, `<<`, `<<<`, `2>`, `&>`, …), in order. */
  readonly redirects: readonly string[]
}

/** The decomposition of one shell command line into its simple commands. */
export interface ShellDecomposition {
  /** Simple commands in textual order, split on `|`, `||`, `;`, `&`, `&&`, and newlines. */
  readonly commands: readonly ShellSimpleCommand[]
}

/** One token of the current simple command. */
interface Word {
  readonly text: string
  readonly redirect: boolean
}

/**
 * Decompose one shell command line into its simple commands and, within
 * each, its command word, argument tokens, and redirect targets. Empty
 * input yields an empty decomposition.
 * @param text - the raw command line.
 * @returns the decomposition.
 */
export function decomposeShellCommand(text: string): ShellDecomposition {
  const commands: ShellSimpleCommand[] = []
  let words: Word[] = []
  let buffer = ''
  let started = false
  let redirect = false

  const flush = (): void => {
    if (!started) return
    words.push({ text: buffer, redirect })
    buffer = ''
    started = false
    redirect = false
  }

  const endCommand = (): void => {
    flush()
    if (words.length === 0) return
    const commandIndex = words.findIndex(word => !word.redirect)
    const command = commandIndex < 0 ? '' : (words[commandIndex]?.text ?? '')
    const args: string[] = []
    const redirects: string[] = []
    words.forEach((word, index) => {
      if (index === commandIndex) return
      if (word.redirect) redirects.push(word.text)
      else args.push(word.text)
    })
    commands.push({ command, args, redirects })
    words = []
  }

  // End the current word because a redirect operator starts. A bare file
  // descriptor prefix (`2`, `1`, or any digit run) is NOT an argument — the
  // shell binds it to the following redirect — so it is dropped.
  const endWordBeforeRedirect = (): void => {
    if (started && /^\d+$/.test(buffer)) {
      buffer = ''
      started = false
      return
    }
    flush()
  }

  let i = 0
  while (i < text.length) {
    const ch = text[i] as string
    if (ch === '\\') {
      const next = text[i + 1]
      buffer += next ?? '\\'
      started = true
      i += 2
      continue
    }
    if (ch === "'") {
      started = true
      i += 1
      while (i < text.length && text[i] !== "'") {
        buffer += text[i]
        i += 1
      }
      i += 1 // skip the closing quote (or run off the end)
      continue
    }
    if (ch === '"') {
      started = true
      i += 1
      while (i < text.length && text[i] !== '"') {
        const next = text[i + 1]
        if (text[i] === '\\' && (next === '"' || next === '\\' || next === '$' || next === '`')) {
          buffer += next
          i += 2
        } else {
          buffer += text[i]
          i += 1
        }
      }
      i += 1 // skip the closing quote (or run off the end)
      continue
    }
    if (ch === '\n') {
      flush()
      endCommand()
      i += 1
      continue
    }
    if (ch === ' ' || ch === '\t') {
      flush()
      i += 1
      continue
    }
    if (ch === '|') {
      flush()
      i += text[i + 1] === '|' ? 2 : 1
      endCommand()
      continue
    }
    if (ch === ';') {
      flush()
      endCommand()
      i += 1
      continue
    }
    if (ch === '&') {
      flush()
      const next = text[i + 1]
      if (next === '&') {
        i += 2
        endCommand()
        continue
      }
      if (next === '>') {
        i += text[i + 2] === '>' ? 3 : 2
        redirect = true
        continue
      }
      i += 1
      endCommand()
      continue
    }
    if (ch === '>') {
      endWordBeforeRedirect()
      i += text[i + 1] === '>' ? 2 : 1
      redirect = true
      continue
    }
    if (ch === '<') {
      endWordBeforeRedirect()
      if (text[i + 1] === '<') {
        i += text[i + 2] === '<' ? 3 : 2
      } else {
        i += 1
      }
      redirect = true
      continue
    }
    buffer += ch
    started = true
    i += 1
  }
  endCommand()
  return { commands }
}
