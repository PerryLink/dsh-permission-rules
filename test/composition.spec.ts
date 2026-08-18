/**
 * Real Loader composition suite (community five-layer model, layer 4): an
 * independent process mounts the Loader over a cordis.yml with the real
 * session/system-prompt/tools/commands service rows + the plugin row, proving
 * the BUILT entry loads under plain Node (A1) and that inject + config
 * resolution + the /rules command all work. Also carries the Schemastery
 * negative regression: an invalid config must fail loud for the expected
 * reason.
 *
 * @module dsh-permission-rules/test/composition.spec
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runner = join(repositoryRoot, 'scripts', 'loader-runner.mjs')
const builtEntry = join(repositoryRoot, 'lib', 'index.js')
const builtUrl = pathToFileURL(builtEntry).href

/** One cordis.yml: real service rows, then the plugin row with optional config. */
function configFor(pluginRow: string, configLines: string[] = []): string {
  return [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-commands'",
    `- name: ${JSON.stringify(pluginRow)}`,
    ...(configLines.length > 0 ? ['  config:', ...configLines.map(line => `    ${line}`)] : []),
    '',
  ].join('\n')
}

function runRunner(configPath: string) {
  const result = spawnSync(process.execPath, [runner, configPath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env },
    timeout: 120_000,
  })
  if (result.error !== undefined) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const temporaryRoot = mkdtempSync(join(tmpdir(), 'dsh-permission-rules-loader-'))

beforeAll(() => {
  const build = spawnSync('pnpm', ['run', 'build'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env },
    shell: process.platform === 'win32',
    timeout: 120_000,
  })
  if (build.status !== 0) {
    throw new Error(`build failed (${String(build.status)}):\n${build.stdout}\n${build.stderr}`)
  }
}, 120_000)

afterAll(() => {
  rmSync(temporaryRoot, { recursive: true, force: true })
})

describe('Loader composition', () => {
  it('mounts the built plugin and lists the empty rule set through /rules', () => {
    const configPath = join(temporaryRoot, 'valid.yml')
    writeFileSync(configPath, configFor(builtUrl, [
      'watch: false',
      'network:',
      '  enabled: false',
    ]))
    const evidence = runRunner(configPath)
    expect(evidence.status, `stderr:\n${evidence.stderr}`).toBe(0)
    expect(evidence.stdout).toContain('DSH_LOADER_RESULT')
    const marker = evidence.stdout.match(/DSH_LOADER_RESULT (.+)$/mu)
    const summary = JSON.parse(marker![1]!)
    expect(summary.runtime).toBe('permissionRulesRuntime')
    expect(summary.command).toBe('rules')
    expect(summary.emptyRules).toBe(true)
  })

  it('fails loud through the Loader for a Schemastery type error', () => {
    const configPath = join(temporaryRoot, 'invalid-type.yml')
    writeFileSync(configPath, configFor(builtUrl, ["enforce: 'yes'"]))
    const evidence = runRunner(configPath)
    expect(evidence.status).not.toBe(0)
    expect(evidence.stderr).toMatch(/expected boolean/u)
  })
})
