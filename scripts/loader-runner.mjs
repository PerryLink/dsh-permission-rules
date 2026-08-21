// scripts/loader-runner.mjs — real Loader composition runner for
// dsh-permission-rules (community five-layer model, layer 4). An independent
// process boots a real Context, mounts the vendored Loader with the Include
// builtin, reads the given cordis.yml (session + system-prompt + tools +
// commands service rows, then the plugin row), and asserts the plugin's
// contributions through the authoritative registries plus one real behavior:
// the /rules command over an empty workspace. This proves the built entry
// loads under plain Node (A1) and that inject + config resolution worked.
//
// Usage: node scripts/loader-runner.mjs <cordis.yml>
// Exit 0 prints DSH_LOADER_RESULT <json>; any load or assertion failure exits
// non-zero with the reason on stderr (used by the invalid-config regression).

import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const configArgument = process.argv[2]
if (configArgument === undefined) {
  console.error('usage: loader-runner.mjs <cordis.yml>')
  process.exit(2)
}

const configPath = resolve(configArgument)
const configRequire = createRequire(resolve(import.meta.dirname, '../package.json'))

const ctx = new Context()
try {
  ctx.baseUrl = `${pathToFileURL(dirname(configPath)).href}/`
  await ctx.plugin(Loader)
  ctx.loader.internal = /** @type {any} */ ({
    version: 'v2',
    async import(specifier) {
      if (specifier.startsWith('file:')) return import(specifier)
      if (specifier.startsWith('node:')) return import(specifier)
      const absolute = /^([a-zA-Z]:)?[\\/]/u.test(specifier)
      return import(pathToFileURL(absolute ? specifier : configRequire.resolve(specifier)).href)
    },
  })
  ctx.loader.builtins.include = Include
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()

  // Authoritative registries carry the plugin's contributions.
  if (ctx.get('permissionRulesRuntime') === undefined) {
    throw new Error('Loader composition: permissionRulesRuntime is missing from the context')
  }

  // An empty workspace (no rules file) drives a deterministic /rules listing.
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-permission-rules-runner-'))
  const session = ctx.sessions.create(SessionId('dsh-permission-rules-loader-runner'), { meta: { cwd } })
  const agent = /** @type {any} */ ({
    id: session.id,
    options: {},
    session,
    inbox: {},
    status: 'idle',
    ctx,
    cancel: () => undefined,
    whenIdle: async () => undefined,
    runMaintenance: async (task) => task(new AbortController().signal),
    send: () => undefined,
    followup: () => undefined,
    steer: () => undefined,
    inject: () => undefined,
  })
  if (ctx.commands.list(agent).find(entry => entry.name === 'rules') === undefined) {
    throw new Error('Loader composition: /rules command is missing from the commands registry')
  }

  // Real behavior: /rules lists the (empty) rule set.
  const execution = await ctx.commands.execute(agent, '/rules', [], new AbortController().signal)
  const text = execution?.result?.text ?? ''
  if (execution?.result?.kind !== 'success' || !text.includes('No permission rules active')) {
    throw new Error(`Loader composition: /rules returned ${JSON.stringify(execution?.result)}`)
  }

  const summary = {
    runtime: 'permissionRulesRuntime',
    command: 'rules',
    commands: ctx.commands.list(agent).map(entry => entry.name),
    emptyRules: text.includes('No permission rules active'),
  }
  process.stdout.write(`DSH_LOADER_RESULT ${JSON.stringify(summary)}\n`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
} finally {
  await ctx.fiber.dispose()
}
