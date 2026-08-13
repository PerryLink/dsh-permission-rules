/**
 * Config schema and resolution for `dsh-permission-rules`. Every tunable is
 * a validated {@link Config} field changeable from cordis.yml; the
 * resolution step validates the numeric bounds and compiles nothing — rule
 * files are external documents resolved per session cwd at load time.
 * @module dsh-permission-rules/config
 */

import z from '@deepseek-ai/schemastery'
import type { PatternMode } from './rules.ts'

/** What happens when a discovered rule file exists but cannot be parsed or compiled. */
export type BadFilePolicy = 'fail' | 'ignore-with-warning'

/** Raw plugin config — every field optional; {@link Config} supplies the defaults. */
export interface Config {
  /**
   * Rule file location. A relative value is resolved against the calling
   * session's workspace cwd (so `<cwd>/.dsh/rules.yaml` by default); an
   * absolute value is used as-is for every session.
   */
  rulesFile?: string
  /**
   * Fallback rule file used when per-cwd discovery finds no rule file.
   * Absolute, or relative to `process.cwd()`. Unset = an empty rule set.
   */
  fallbackPath?: string
  /**
   * How an unreadable/invalid rule file is handled at load: `'fail'` throws
   * (the pending tool call errors loudly; HMR reloads keep the previous
   * rules and report the error), `'ignore-with-warning'` logs a warning and
   * continues with an empty (initial) or previous (reload) rule set.
   */
  badFilePolicy?: BadFilePolicy
  /** Hard cap on the number of rules; a larger file fails the load. */
  maxRules?: number
  /** How `params` and `paths` patterns are interpreted: `'glob'` (default) or `'regex'`. */
  patternMode?: PatternMode
  /** Whether the loaded rule file is watched and reloaded on change. */
  watch?: boolean
  /** Debounce window for watch-driven reloads, in milliseconds. */
  watchStabilityThresholdMs?: number
}

/** Config after {@link resolveConfig}: every optional field has its explicit default. */
export interface ResolvedConfig {
  readonly rulesFile: string
  readonly fallbackPath: string | undefined
  readonly badFilePolicy: BadFilePolicy
  readonly maxRules: number
  readonly patternMode: PatternMode
  readonly watch: boolean
  readonly watchStabilityThresholdMs: number
}

/** Schemastery schema: the loader validates and fills defaults before `apply`. */
export const Config: z<Config> = z.object({
  rulesFile: z.string().default('.dsh/rules.yaml'),
  fallbackPath: z.string(),
  badFilePolicy: z.union(['fail', 'ignore-with-warning'] as const).default('fail'),
  maxRules: z.number().default(256),
  patternMode: z.union(['glob', 'regex'] as const).default('glob'),
  watch: z.boolean().default(true),
  watchStabilityThresholdMs: z.number().default(200),
})

/**
 * Validate raw values and fill explicit defaults. A `maxRules` that is not
 * a positive safe integer or a non-positive stability window throws here —
 * misconfiguration fails loud at mount.
 * @param config - raw (possibly partial) plugin config.
 * @returns the fully resolved config.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const maxRules = config.maxRules ?? 256
  if (!Number.isSafeInteger(maxRules) || maxRules <= 0) {
    throw new TypeError(`maxRules must be a positive safe integer, got ${String(config.maxRules)}`)
  }
  const watchStabilityThresholdMs = config.watchStabilityThresholdMs ?? 200
  if (!Number.isSafeInteger(watchStabilityThresholdMs) || watchStabilityThresholdMs < 0) {
    throw new TypeError(`watchStabilityThresholdMs must be a non-negative safe integer, got ${String(config.watchStabilityThresholdMs)}`)
  }
  return {
    rulesFile: config.rulesFile ?? '.dsh/rules.yaml',
    fallbackPath: config.fallbackPath,
    badFilePolicy: config.badFilePolicy ?? 'fail',
    maxRules,
    patternMode: config.patternMode ?? 'glob',
    watch: config.watch ?? true,
    watchStabilityThresholdMs,
  }
}
