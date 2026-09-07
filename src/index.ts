/**
 * `dsh-permission-rules` — Claude Code-style declarative permission rules
 * for DeepSeek Harness. A `tools/pre-execute` waterfall listener evaluates
 * an ordered `allow`/`deny`/`ask` rule list (tool-name globs, agent
 * selectors, argument glob/regex matching, workspace-path matching) per
 * session cwd; deny and ask decisions short-circuit the chain, while allow
 * and passthrough always delegate via `next()`. Under `enforce: false` the
 * plugin audits what it WOULD decide and lets everything through (dry-run
 * policy rollout). `ask` rides the official approval seam, where answerers
 * such as `dsh-auto-review` or a human UI decide — the plugin itself never
 * runs a reviewer. Every decision is audit-logged.
 *
 * Function plugin — no default export (the Loader unwraps
 * `exports.default ?? exports`, and a stray default would discard
 * `name`/`inject`/`Config`/`apply`).
 * @module dsh-permission-rules
 */

import { apply } from './runtime.ts'

export const name = 'permission-rules'
/** Consumer — the /rules command handler and the tools/pre-execute waterfall listener consume the injected commands/tools services. */
export const inject = ['commands', 'tools']

/** Service Provider — the runtime registers the tools/pre-execute listener, /rules command, audit events, and ctx.permissionRulesRuntime. */
export { apply }
export { PermissionRulesRuntime, isUnmarkedHostVersion } from './runtime.ts'
/** Service Definition — the public contract: Config schema, rule vocabulary, and the permissionRules/decision session-event type. */
export * from './config.ts'
export * from './events.ts'
export * from './rules.ts'
export * from './glob.ts'
export * from './shell.ts'
export * from './builtin-rules.ts'
export * from './network.ts'
export * from './proxy.ts'
