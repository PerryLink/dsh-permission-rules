/**
 * `/rules` command tests through the REAL `dsh-commands` registry:
 * listing with source path, reload picking up edits, reload failure
 * keeping previous rules, and unknown-argument handling.
 * @module dsh-permission-rules/test/command.spec
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mountHarness, removeWorkspace, tempWorkspace } from './harness.ts'

const GOOD_1 = `
rules:
  - match: { tools: [bash, pwsh], params: { command: "git push*" }, paths: ["**/secrets/**"] }
    action: deny
    reason: "禁止 push 到受保护路径"
  - match: { tools: [edit, write] }
    action: ask
    reason: "写文件需要确认"
`
const GOOD_2 = 'rules:\n  - match: { tools: [read] }\n    action: allow\n    reason: reads fine\n'

function workspaceWithRules(body = GOOD_1): string {
  const cwd = tempWorkspace()
  mkdirSync(join(cwd, '.dsh'), { recursive: true })
  writeFileSync(join(cwd, '.dsh', 'rules.yaml'), body, 'utf8')
  return cwd
}

describe('/rules command', () => {
  it('lists the active rules with their source path and 1-based numbers', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({}, { cwd })
    try {
      const execution = await harness.ctx.commands.execute(harness.agent, '/rules', new AbortController().signal)
      expect(execution?.result.kind).toBe('success')
      const text = execution?.result.kind === 'success' ? execution.result.text ?? '' : ''
      expect(text).toContain('2 rule(s)')
      expect(text).toContain(join(cwd, '.dsh', 'rules.yaml'))
      expect(text).toContain('1. deny [tools:bash,pwsh params:command=git push* paths:**/secrets/**]: 禁止 push 到受保护路径')
      expect(text).toContain('2. ask [tools:edit,write]: 写文件需要确认')
      expect(text).toContain('Usage: /rules [reload]')
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('reports the empty rule set when no file exists', async () => {
    const cwd = tempWorkspace()
    const harness = await mountHarness({}, { cwd })
    try {
      const execution = await harness.ctx.commands.execute(harness.agent, '/rules', new AbortController().signal)
      const text = execution?.result.kind === 'success' ? execution.result.text ?? '' : ''
      expect(text).toContain('No permission rules active')
      expect(text).toContain(cwd)
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('reload re-reads the file and reports the new rule count', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({}, { cwd })
    try {
      writeFileSync(join(cwd, '.dsh', 'rules.yaml'), GOOD_2, 'utf8')
      const execution = await harness.ctx.commands.execute(harness.agent, '/rules reload', new AbortController().signal)
      expect(execution?.result.kind).toBe('success')
      const text = execution?.result.kind === 'success' ? execution.result.text ?? '' : ''
      expect(text).toContain('Reloaded 1 rule(s)')
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('reload of a broken file reports the error and keeps the previous rules', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({}, { cwd })
    try {
      // Load the good file first so there IS a previous rule set to keep.
      await harness.ctx.commands.execute(harness.agent, '/rules', new AbortController().signal)
      writeFileSync(join(cwd, '.dsh', 'rules.yaml'), 'rules: {', 'utf8')
      const execution = await harness.ctx.commands.execute(harness.agent, '/rules reload', new AbortController().signal)
      expect(execution?.result.kind).toBe('error')
      const text = execution?.result.kind === 'error' ? execution.result.text : ''
      expect(text).toContain('Reload failed')
      expect(text).toContain('previous rules are still active')
      // The old rules still decide.
      const status = await harness.ctx.commands.execute(harness.agent, '/rules', new AbortController().signal)
      const statusText = status?.result.kind === 'success' ? status.result.text ?? '' : ''
      expect(statusText).toContain('2 rule(s)')
      expect(statusText).toContain('last reload failed')
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('rejects unknown arguments with a usage hint', async () => {
    const cwd = workspaceWithRules()
    const harness = await mountHarness({}, { cwd })
    try {
      const execution = await harness.ctx.commands.execute(harness.agent, '/rules nuke', new AbortController().signal)
      expect(execution?.result.kind).toBe('error')
      const text = execution?.result.kind === 'error' ? execution.result.text : ''
      expect(text).toContain('Unknown /rules argument "nuke"')
    } finally {
      removeWorkspace(cwd)
    }
  })

  it('a bad file under the fail policy surfaces as a command error instead of throwing', async () => {
    const cwd = tempWorkspace()
    mkdirSync(join(cwd, '.dsh'), { recursive: true })
    writeFileSync(join(cwd, '.dsh', 'rules.yaml'), 'rules:\n  - match: {}\n    action: maybe\n    reason: x\n', 'utf8')
    const harness = await mountHarness({}, { cwd })
    try {
      const execution = await harness.ctx.commands.execute(harness.agent, '/rules', new AbortController().signal)
      expect(execution?.result.kind).toBe('error')
      const text = execution?.result.kind === 'error' ? execution.result.text : ''
      expect(text).toContain('action must be one of')
    } finally {
      removeWorkspace(cwd)
    }
  })
})
