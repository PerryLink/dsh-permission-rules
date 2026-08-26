/**
 * The shipped high-risk permission baseline: the absolute path of the
 * bundled `rules/builtin-high-risk.yaml` data file and the resolution of a
 * possibly-custom builtin path. The shipped path is computed relative to
 * THIS module so it resolves identically from the source plane (tests,
 * where this file lives under `src/`) and the bundled plane (where it is
 * inlined into `lib/index.js`, one directory below the package root).
 * @module dsh-permission-rules/builtin-rules
 */

import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** File name of the bundled baseline, under the package's `rules/` directory. */
export const BUILTIN_RULES_FILE = 'builtin-high-risk.yaml'

/**
 * Absolute path of the shipped baseline. Not existence-checked here — a
 * missing file is a mount-time failure in {@link PermissionRulesRuntime},
 * never a silent skip.
 */
export const SHIPPED_BUILTIN_RULES: string = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'rules', BUILTIN_RULES_FILE)

/**
 * Resolve the builtin ruleset path: an explicit `builtin.path` (absolute
 * as-is, relative against `process.cwd()` — mirroring `fallbackPath`), else
 * the shipped file.
 * @param custom - the optional `builtin.path` config value.
 * @returns the absolute builtin ruleset path.
 */
export function resolveBuiltinRulesPath(custom: string | undefined): string {
  if (custom === undefined) return SHIPPED_BUILTIN_RULES
  return isAbsolute(custom) ? custom : resolve(custom)
}
