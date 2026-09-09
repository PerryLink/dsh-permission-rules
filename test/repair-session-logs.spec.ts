/**
 * The shipped `scripts/repair-session-logs.mjs` end to end on synthetic
 * fixtures: every generation-addressed log basename (`session.jsonl`,
 * `session.v1.jsonl`, `session.v2.jsonl`, `session.v3.jsonl`, each
 * optionally `.zstd`-compressed) is discovered, the embedded
 * `KNOWN_SESSION_EVENT_TYPES` copy covers the harness catalog closely enough
 * that a native v3 log scans clean, `repair` stamps unmarked audit rows in
 * both physical encodings with backups, and `strip` removes targeted rows
 * from any generation. Fixtures live in `%TEMP%`; no real session data is
 * read.
 * @module dsh-permission-rules/test/repair-session-logs.spec
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../scripts/repair-session-logs.mjs', import.meta.url))
const CHECKSUM = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

const HEADER = JSON.stringify({ type: 'session', version: 3, id: 'fixture' })
const DECISION = JSON.stringify({ type: 'permissionRules/decision', seq: 1, time: 1, data: { toolName: 'bash', source: '', action: 'allow', cwd: '/fixture' } })
const MARKED_DECISION = JSON.stringify({ type: 'permissionRules/decision', seq: 2, time: 2, ignorable: true, data: { toolName: 'bash', source: '', action: 'allow', cwd: '/fixture' } })
const SYSTEM_MESSAGE = JSON.stringify({ type: 'system/message', seq: 3, time: 3, data: { text: 'fixture' } })
// V3 renamed code-dispatch to ptc-dispatch; the union keeps both spellings known.
const PTC_DISPATCH = JSON.stringify({ type: 'tool/ptc-dispatch', seq: 4, time: 4, data: {} })
const CODE_DISPATCH = JSON.stringify({ type: 'tool/code-dispatch', seq: 5, time: 5, data: {} })
const CHUNK = JSON.stringify({ type: 'assistant/chunk', seq: 6, time: 6, data: {} })

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

/** Build one temp `DSH_HOME`-shaped root with a fixture log per generation. */
function fixtureHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-permission-rules-repair-'))
  homes.push(home)
  const sessions = join(home, 'sessions')
  for (const dir of ['v1', 'v2', 'v3', 'v3-zstd', 'v1-nominal']) mkdirSync(join(sessions, dir), { recursive: true })
  writeFileSync(join(sessions, 'v1', 'session.jsonl'), `${HEADER}\n${DECISION}\n`, 'utf8')
  writeFileSync(join(sessions, 'v2', 'session.v2.jsonl'), `${HEADER}\n${MARKED_DECISION}\n`, 'utf8')
  writeFileSync(join(sessions, 'v3', 'session.v3.jsonl'), `${HEADER}\n${SYSTEM_MESSAGE}\n${PTC_DISPATCH}\n${CODE_DISPATCH}\n${CHUNK}\n${DECISION}\n`, 'utf8')
  writeFileSync(join(sessions, 'v3-zstd', 'session.v3.jsonl.zstd'), zstdCompressSync(`${HEADER}\n${DECISION}\n`, CHECKSUM))
  writeFileSync(join(sessions, 'v1-nominal', 'session.v1.jsonl'), `${HEADER}\n`, 'utf8')
  // Backups and temp names are not generations: discovery must skip them.
  writeFileSync(join(sessions, 'v3', 'session.v3.jsonl.bak-1'), `${HEADER}\n${DECISION}\n`, 'utf8')
  writeFileSync(join(sessions, 'v1', 'session.jsonl.tmp'), `${HEADER}\n`, 'utf8')
  return home
}

/** Run the repair script against one fixture root. */
function run(home: string, ...argv: string[]): string {
  return execFileSync(process.execPath, [SCRIPT, ...argv, '--home', home], { encoding: 'utf8' })
}

describe('repair-session-logs discovery and vocabulary', () => {
  it('discovers every generation-addressed log and does not misreport the v3 catalog as foreign', () => {
    const home = fixtureHome()
    const scan = run(home, 'scan')
    expect(scan).toContain('5 log(s) scanned')
    // Only the plugin audit rows are foreign; the harness vocabulary (incl.
    // the v1/v2-only spellings) stays out of the report.
    expect(scan).toContain('permissionRules/decision: 4 rows (targeted')
    for (const known of ['system/message:', 'tool/ptc-dispatch:', 'tool/code-dispatch:', 'assistant/chunk:']) {
      expect(scan).not.toContain(known)
    }
  })

  it('repairs unmarked rows in plaintext and zstd logs with backups, then scans clean', () => {
    const home = fixtureHome()
    const repair = run(home, 'repair')
    expect(repair).toContain('session.v3.jsonl (1 row(s) marked ignorable')
    const sessions = join(home, 'sessions')
    const v3 = join(sessions, 'v3', 'session.v3.jsonl')
    const v3z = join(sessions, 'v3-zstd', 'session.v3.jsonl.zstd')
    // Plaintext rows are stamped in place, and the zstd frames decompress to
    // the same stamped row.
    expect(readFileSync(v3, 'utf8')).toContain('"ignorable":true')
    expect(zstdDecompressSync(readFileSync(v3z)).toString('utf8')).toContain('"ignorable":true')
    // Every rewritten artifact kept a backup.
    expect(readdirSync(join(sessions, 'v1')).some(entry => entry.startsWith('session.jsonl.bak-'))).toBe(true)
    expect(readdirSync(join(sessions, 'v3-zstd')).some(entry => entry.startsWith('session.v3.jsonl.zstd.bak-'))).toBe(true)
    // Already-marked v2 rows are byte-identical, and the second scan is clean.
    expect(readFileSync(join(sessions, 'v2', 'session.v2.jsonl'), 'utf8')).toBe(`${HEADER}\n${MARKED_DECISION}\n`)
    expect(run(home, 'scan')).toContain('5 log(s) scanned, 0 affected')
  })

  it('strips targeted rows from v2 logs too, so a v2→v3 migration cannot see them', () => {
    const home = fixtureHome()
    const strip = run(home, 'strip', '--dry-run')
    expect(strip).toContain('session.v2.jsonl: 1 row(s)')
    expect(strip).toContain('session.v3.jsonl: 1 row(s)')
    expect(strip).toContain('session.v3.jsonl.zstd: 1 row(s)')
  })
})
