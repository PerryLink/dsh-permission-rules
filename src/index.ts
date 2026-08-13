/**
 * `dsh-permission-rules` — Claude Code-style declarative permission rules
 * for DeepSeek Harness. A `tools/pre-execute` waterfall listener evaluates
 * an ordered `allow`/`deny`/`ask` rule list (tool-name globs, argument
 * glob/regex matching, workspace-path matching) per session cwd; deny and
 * ask decisions short-circuit the chain, while allow and passthrough always
 * delegate via `next()`. `ask` rides the official approval seam, where
 * answerers such as `dsh-auto-review` or a human UI decide — the plugin
 * itself never runs a reviewer. Every decision is audit-logged.
 *
 * Function plugin — no default export (the Loader unwraps
 * `exports.default ?? exports`, and a stray default would discard
 * `name`/`inject`/`Config`/`apply`).
 * @module dsh-permission-rules
 */

import { apply } from './runtime.ts'

export const name = 'permission-rules'
export const inject = ['commands']

export { apply }
export { PermissionRulesRuntime } from './runtime.ts'
export * from './config.ts'
export * from './events.ts'
export * from './rules.ts'
export * from './glob.ts'
