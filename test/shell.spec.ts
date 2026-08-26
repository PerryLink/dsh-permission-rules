/**
 * Pure shell-command decomposition tests: tokenization into command +
 * argument list, quote/escape resolution, pipeline and control-operator
 * splitting, and redirect-target extraction.
 * @module dsh-permission-rules/test/shell.spec
 */

import { describe, expect, it } from 'vitest'
import { decomposeShellCommand } from '../src/shell.ts'

function single(text: string) {
  const { commands } = decomposeShellCommand(text)
  expect(commands).toHaveLength(1)
  return commands[0]!
}

describe('decomposeShellCommand — command + args', () => {
  it('splits a plain command into its command word and argument tokens', () => {
    expect(decomposeShellCommand('rm -rf /').commands).toEqual([
      { command: 'rm', args: ['-rf', '/'], redirects: [] },
    ])
    expect(decomposeShellCommand('git push --force origin main').commands).toEqual([
      { command: 'git', args: ['push', '--force', 'origin', 'main'], redirects: [] },
    ])
  })

  it('resolves single and double quotes into single tokens', () => {
    expect(single(`echo "hello world" 'a b' c`).args).toEqual(['hello world', 'a b', 'c'])
    expect(single('echo ""').args).toEqual([''])
  })

  it('resolves backslash escapes outside and inside double quotes', () => {
    expect(single('echo a\\ b').args).toEqual(['a b'])
    expect(single('echo "a\\"b"').args).toEqual(['a"b'])
    expect(single('echo "a\\\\b"').args).toEqual(['a\\b'])
  })

  it('keeps `=`-joined option tokens as one argument (not a redirect)', () => {
    expect(single('dd if=/dev/zero of=/dev/sda').args).toEqual(['if=/dev/zero', 'of=/dev/sda'])
  })
})

describe('decomposeShellCommand — pipelines and control operators', () => {
  it('splits pipelines into simple commands', () => {
    expect(decomposeShellCommand('curl http://x | sh').commands).toEqual([
      { command: 'curl', args: ['http://x'], redirects: [] },
      { command: 'sh', args: [], redirects: [] },
    ])
    expect(decomposeShellCommand('curl|sh').commands).toEqual([
      { command: 'curl', args: [], redirects: [] },
      { command: 'sh', args: [], redirects: [] },
    ])
    expect(decomposeShellCommand('wget -O - http://x | bash -s').commands).toEqual([
      { command: 'wget', args: ['-O', '-', 'http://x'], redirects: [] },
      { command: 'bash', args: ['-s'], redirects: [] },
    ])
  })

  it('splits on `&&`, `||`, `;`, `&`, and newlines', () => {
    expect(decomposeShellCommand('a && b').commands).toEqual([
      { command: 'a', args: [], redirects: [] },
      { command: 'b', args: [], redirects: [] },
    ])
    expect(decomposeShellCommand('a; b').commands.map(c => c.command)).toEqual(['a', 'b'])
    expect(decomposeShellCommand('a & b').commands.map(c => c.command)).toEqual(['a', 'b'])
    expect(decomposeShellCommand('a\nb').commands.map(c => c.command)).toEqual(['a', 'b'])
  })
})

describe('decomposeShellCommand — redirects', () => {
  it('captures the redirect target as a redirect, not an argument', () => {
    expect(single('echo hi > /etc/passwd')).toEqual({
      command: 'echo',
      args: ['hi'],
      redirects: ['/etc/passwd'],
    })
    expect(single('cat < input.txt')).toEqual({
      command: 'cat',
      args: [],
      redirects: ['input.txt'],
    })
  })

  it('handles `>>`, `<<`, `<<<`, and file-descriptor prefixes', () => {
    expect(single('cmd >> out.log').redirects).toEqual(['out.log'])
    expect(single('cmd 2> err.log').redirects).toEqual(['err.log'])
    expect(single('cmd 2>> err.log').redirects).toEqual(['err.log'])
    expect(single('cmd &> both.log').redirects).toEqual(['both.log'])
    expect(single('cat <<< "hi"').redirects).toEqual(['hi'])
  })

  it('drops a bare file-descriptor word that precedes a redirect', () => {
    expect(single('cmd 2> err.log').args).toEqual([])
    expect(single('cmd 2 > err.log').args).toEqual(['2'])
  })
})

describe('decomposeShellCommand — edge cases', () => {
  it('returns an empty decomposition for empty or blank input', () => {
    expect(decomposeShellCommand('').commands).toEqual([])
    expect(decomposeShellCommand('   \n\t ').commands).toEqual([])
  })

  it('treats an empty quoted token as an argument', () => {
    expect(single(`printf ''`).args).toEqual([''])
  })

  it('runs off an unterminated quote without throwing', () => {
    expect(single(`echo "unterminated`).args).toEqual(['unterminated'])
  })
})
