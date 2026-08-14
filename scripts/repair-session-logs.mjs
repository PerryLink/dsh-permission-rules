/**
 * Repair DSH JSONL session logs that were written before `Session.append`
 * exposed the `ignorable` envelope marker. Out-of-repo plugin events
 * (`permissionRules/decision`, `autoReview/verdict`, `autoReview/state`) were
 * appended unmarked, so the persistence read path refuses those logs with
 * `SessionFormatUnsupportedError` ("unknown to this harness and not marked
 * ignorable").
 *
 * This script rewrites ONLY the targeted log-only audit rows, adding
 * `ignorable: true` to their envelopes; every other byte is preserved. Each
 * modified artifact is backed up to `<file>.bak-<epoch>` before replacement.
 *
 * It understands both physical encodings of the JSONL backend:
 *   - `session.jsonl.zstd` — a concatenation of checksummed Zstandard frames
 *     (frame 1 = header line, later frames = durable append batches); each
 *     frame is decompressed, filtered, and recompressed independently so
 *     frame boundaries survive.
 *   - `session.jsonl` — plaintext JSONL lines.
 *
 * Usage:
 *   node scripts/repair-session-logs.mjs scan [--home DIR]      # report foreign rows, change nothing
 *   node scripts/repair-session-logs.mjs repair [--home DIR] [--dry-run]
 *   node scripts/repair-session-logs.mjs repair --types a/b,c/d
 *
 * `--home` defaults to `$env:DSH_HOME/sessions` or `~/.dsh/sessions`.
 * The default target set is the log-only audit vocabulary owned by the
 * dsh-permission-rules / dsh-auto-review plugins; only types you understand
 * to be reconstruction-safe may be added via `--types`.
 */

import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const ZSTD_MAGIC = 0xfd2fb528
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

const DEFAULT_TARGET_TYPES = [
  'permissionRules/decision',
  'autoReview/verdict',
  'autoReview/state',
]

/** Row types that are storage records, never session events (leave untouched). */
const STORAGE_ROW_TYPES = new Set([
  'text-chunks',
  'reasoning-chunks',
  'tool-call-chunks',
])

/**
 * The harness build's generated event vocabulary
 * (`KNOWN_SESSION_EVENT_TYPES`, `packages/core/session/src/known-event-types.ts`).
 * Rows whose type is outside this set are what the read path refuses when the
 * envelope lacks `ignorable: true`; the scan reports them so nothing is missed.
 * Regenerate this list from the harness checkout when it changes.
 */
const KNOWN_SESSION_EVENT_TYPES = new Set([
  'agent-preset/selected',
  'agent/inbox/spliced',
  'approval/asked',
  'approval/decided',
  'approval/policy',
  'assistant/chunk',
  'assistant/message',
  'command/done',
  'command/run',
  'compaction/end',
  'compaction/prune',
  'compaction/start',
  'compaction/summary',
  'feedback/record',
  'goal/change',
  'hook/invoked',
  'hook/result',
  'llm/retry',
  'llm/retry-started',
  'permission/preset',
  'plan/mode',
  'request/context',
  'request/header',
  'sandbox/mode',
  'schedule/change',
  'session/end-seed',
  'session/title',
  'session/title-llm-request',
  'step/end',
  'step/start',
  'subagent/descriptor',
  'todo/write',
  'tool-workflow/agent-end',
  'tool-workflow/agent-start',
  'tool-workflow/run-end',
  'tool-workflow/run-start',
  'tool/call',
  'tool/code-dispatch',
  'tool/code-dispatch-start',
  'tool/result',
  'turn/end',
  'turn/start',
  'user/message',
  'web/deepseek-search-llm-request',
])

/**
 * Locate complete Zstandard frame ranges in a concatenated stream, mirroring
 * the JSONL backend's structural scan. Throws on corrupt structure; a trailing
 * incomplete frame is reported as `tornStart` and skipped.
 * @param {Buffer} buffer - the raw artifact bytes.
 * @returns {{ frames: {start:number,end:number}[], tornStart?: number }}
 */
function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt Zstandard stream: invalid frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) {
      throw new Error(`corrupt Zstandard stream: reserved frame-header bit at byte ${offset - 1}`)
    }
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) {
        throw new Error(`corrupt Zstandard stream: reserved block type at byte ${offset - 3}`)
      }
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if ((descriptor & 0x04) !== 0) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/** Split decompressed text into final-newline-terminated lines. */
function splitLines(text) {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/**
 * Apply the ignorable marker to targeted audit rows in one JSONL frame.
 * @param {string} text - the frame plaintext.
 * @param {Set<string>} targetTypes - event types to mark.
 * @param {Map<string, number>} foreignSeen - scan accumulator: type -> row count.
 * @returns {{ text: string, changed: number }}
 */
function filterFrame(text, targetTypes, foreignSeen) {
  const lines = splitLines(text)
  let changed = 0
  const out = lines.map(line => {
    if (line.length === 0) return line
    let row
    try {
      row = JSON.parse(line)
    } catch {
      return line // preserve unparsable bytes exactly; the reader owns the refusal
    }
    if (typeof row !== 'object' || row === null) return line
    const type = row.type
    if (typeof type !== 'string' || STORAGE_ROW_TYPES.has(type)) return line
    if (type === 'session') return line // header row: never an event
    if (!KNOWN_SESSION_EVENT_TYPES.has(type)) {
      foreignSeen.set(type, (foreignSeen.get(type) ?? 0) + 1)
    }
    if (targetTypes.has(type)) {
      if (row.ignorable === true) return line
      row.ignorable = true
      changed += 1
      return JSON.stringify(row)
    }
    return line
  })
  return { text: out.join('\n') + '\n', changed }
}

/** Find every session artifact under a sessions root. */
function findLogs(root) {
  const found = []
  const walk = dir => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full)
      else if (entry === 'session.jsonl' || entry === 'session.jsonl.zstd') found.push(full)
    }
  }
  walk(root)
  return found
}

/** Read a log into { headerFrame, frames: [{text, start, end}] }. */
function readLog(path) {
  const buffer = readFileSync(path)
  if (path.endsWith('.zstd')) {
    const { frames, tornStart } = scanZstdFrames(buffer)
    if (frames.length === 0) throw new Error(`${path}: no complete Zstandard frame`)
    return {
      compressed: true,
      frames: frames.map(range => ({
        ...range,
        text: zstdDecompressSync(buffer.subarray(range.start, range.end)).toString('utf8'),
      })),
      tornStart,
      buffer,
    }
  }
  return {
    compressed: false,
    frames: [{ start: 0, end: buffer.length, text: buffer.toString('utf8') }],
    tornStart: undefined,
    buffer,
  }
}

function parseArgs(argv) {
  const args = { mode: undefined, home: undefined, dryRun: false, types: DEFAULT_TARGET_TYPES }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === 'scan' || arg === 'repair') args.mode = arg
    else if (arg === '--home') args.home = argv[++i]
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--types') args.types = argv[++i].split(',')
  }
  return args
}

function usage() {
  console.error('usage: node repair-session-logs.mjs scan|repair [--home DIR] [--dry-run] [--types a/b,c/d]')
  process.exit(2)
}

const args = parseArgs(process.argv.slice(2))
if (args.mode === undefined) usage()
const home = args.home ?? process.env.DSH_HOME
const root = home !== undefined ? resolve(home, 'sessions') : join(homedir(), '.dsh', 'sessions')
if (!existsSync(root)) {
  console.error(`sessions root not found: ${root}`)
  process.exit(1)
}
const targetTypes = new Set(args.types)

const logs = findLogs(root)
if (logs.length === 0) {
  console.log(`no session logs found under ${root}`)
  process.exit(0)
}

let scanned = 0
let affectedFiles = 0
let marked = 0
const foreignSeen = new Map()
const failures = []

for (const path of logs) {
  let log
  try {
    log = readLog(path)
  } catch (error) {
    failures.push(`${path}: ${error.message}`)
    continue
  }
  if (log.tornStart !== undefined) {
    console.warn(`warn: ${path} ends in a torn Zstandard frame at byte ${log.tornStart}; trailing bytes are left untouched`)
  }
  let fileChanged = 0
  const newFrames = []
  for (const frame of log.frames) {
    const { text, changed } = filterFrame(frame.text, targetTypes, foreignSeen)
    newFrames.push({ ...frame, text })
    fileChanged += changed
  }
  scanned += 1
  if (fileChanged > 0) {
    affectedFiles += 1
    marked += fileChanged
    if (args.mode === 'repair' && !args.dryRun) {
      const backup = `${path}.bak-${Date.now()}`
      renameSync(path, backup)
      const content = log.compressed
        ? Buffer.concat(newFrames.map(frame => zstdCompressSync(frame.text, CHECKSUM_OPTIONS)))
        : Buffer.from(newFrames[0].text, 'utf8')
      writeFileSync(path, content)
      console.log(`repaired ${path} (${fileChanged} row(s) marked ignorable; backup: ${backup})`)
    } else {
      console.log(`${args.dryRun ? '[dry-run] would repair' : 'would repair'} ${path}: ${fileChanged} row(s)`)
    }
  }
}

if (foreignSeen.size > 0) {
  console.log('\nforeign (non-harness) event rows found by type:')
  for (const [type, count] of [...foreignSeen.entries()].sort()) {
    const action = targetTypes.has(type) ? 'targeted for ignorable repair' : 'NOT targeted — investigate before touching'
    console.log(`  ${type}: ${count} rows (${action})`)
  }
}
for (const failure of failures) console.error(`error: ${failure}`)
console.log(`\n${scanned} log(s) scanned, ${affectedFiles} affected, ${marked} row(s) would be marked${args.mode === 'repair' && !args.dryRun ? ' (repaired)' : ''}`)
process.exit(failures.length > 0 ? 1 : 0)
