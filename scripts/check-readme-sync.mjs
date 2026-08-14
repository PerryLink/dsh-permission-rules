#!/usr/bin/env node
/**
 * README synchronization gate: the five language READMEs must expose the
 * same structure — the same number of `## ` sections and the same
 * config-table keys as the English source of truth — and must document the
 * same `/rules` subcommands. Exits non-zero with a report on drift, so CI
 * refuses a one-language doc update.
 *
 * Usage: node scripts/check-readme-sync.mjs
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const files = ['README.md', 'README.zh.md', 'README.es.md', 'README.pt.md', 'README.hi.md']
const texts = new Map(files.map(file => [file, readFileSync(join(root, file), 'utf8')]))

const sectionCount = text => (text.match(/^## /gm) ?? []).length
const configKeys = text => [...text.matchAll(/^\| `([a-zA-Z]+)` \|/gm)].map(match => match[1])
const hasCommands = text => ['/rules reload', '/rules decisions', '/rules test'].every(token => text.includes(token))

const reference = texts.get('README.md')
const errors = []
for (const file of files) {
  const text = texts.get(file)
  if (sectionCount(text) !== sectionCount(reference)) {
    errors.push(`${file}: ${sectionCount(text)} '## ' sections, expected ${sectionCount(reference)}`)
  }
  const keys = configKeys(text)
  const expected = configKeys(reference)
  const missing = expected.filter(key => !keys.includes(key))
  const extra = keys.filter(key => !expected.includes(key))
  if (missing.length > 0 || extra.length > 0) {
    errors.push(`${file}: config table drift (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`)
  }
  if (!hasCommands(text)) {
    errors.push(`${file}: missing one of the /rules reload | decisions | test command docs`)
  }
}

if (errors.length > 0) {
  console.error('README sync check FAILED:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}
console.log(`README sync check passed (${files.length} files, ${sectionCount(reference)} sections, ${configKeys(reference).length} config keys).`)
