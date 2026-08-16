/**
 * Config schema and resolution for `dsh-permission-rules`. Every tunable is
 * a validated {@link Config} field changeable from cordis.yml; the
 * resolution step validates the numeric bounds and compiles nothing — rule
 * files are external documents resolved per session cwd at load time.
 * @module dsh-permission-rules/config
 */

import { isAbsolute } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { PatternMode } from './rules.ts'
import type { NetworkMode, UnlistedAction } from './network.ts'
import { NETWORK_MODES } from './network.ts'
import type { UiLanguage } from './prose.ts'

/** What happens when a discovered rule file exists but cannot be parsed or compiled. */
export type BadFilePolicy = 'fail' | 'ignore-with-warning'

/** Which decisions are audit-logged: every call, or only rule hits. */
export type AuditGranularity = 'all' | 'hits'

/** Loopback-target handling at the proxy layer. */
export type LoopbackPolicy = 'allow' | 'policy'

/** NO_PROXY handling for policy-injected subprocess environment. */
export type NoProxyPolicy = 'clear' | 'preserve'

/**
 * The process-level network policy block. Every field is optional —
 * {@link ResolvedConfig} supplies the defaults. `mode: 'auto'` maps the
 * official sandbox preset onto the three network modes (read-only →
 * deny-all, workspace-write → whitelist, danger-full-access → allow-all);
 * on hosts without the sandbox-policy service `auto` resolves to
 * `autoFallback` (`allow-all` by default, so pre-network hosts keep their
 * permissive behavior until configured).
 */
export interface NetworkConfig {
  /** Master switch: `false` disables the proxy, the env injection, and the web-tool mode defaults. */
  enabled?: boolean
  /** Policy mode: `auto` follows the sandbox preset, or an explicit mode. */
  mode?: 'auto' | NetworkMode
  /** Mode used when `mode: 'auto'` and the sandbox-policy service is absent or unknown. */
  autoFallback?: NetworkMode
  /** Whitelist-mode handling of targets no rule matched: `ask` (default) or `deny`. */
  unlisted?: UnlistedAction
  /** Local proxy bind address (loopback only — the proxy never listens publicly). */
  proxyBind?: string
  /** Local proxy port; `0` picks a free ephemeral port. */
  proxyPort?: number
  /** Cap on recent-block records kept for the settings page. */
  proxyMaxRecent?: number
  /** Loopback targets: `allow` (default, Codex parity) or `policy` (evaluated like any target). */
  loopback?: LoopbackPolicy
  /** Whether proxy environment variables are injected for subprocesses. */
  injectEnv?: boolean
  /** Subprocess NO_PROXY handling: `clear` enforces the policy (default) or `preserve` keeps ambient values. */
  noProxy?: NoProxyPolicy
}

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
  /** Hard cap on the number of rules across the effective source chain; a larger chain fails the load. */
  maxRules?: number
  /** Hard cap on cached per-workspace rule loads; the least-recently-used workspace is evicted beyond it. */
  maxCachedWorkspaces?: number
  /** How `params`, `paths`, and `when.env` patterns are interpreted: `'glob'` (default) or `'regex'`. */
  patternMode?: PatternMode
  /** Whether the loaded rule file is watched and reloaded on change. */
  watch?: boolean
  /** Debounce window for watch-driven reloads, in milliseconds. */
  watchStabilityThresholdMs?: number
  /** Language of the `/rules` command output: `'en'` (default), `'zh'`, `'es'`, `'pt'`, or `'hi'`. */
  language?: UiLanguage
  /** Whether `paths` patterns (and workspace-root comparison) ignore ASCII case; defaults to `true` on Windows. */
  caseInsensitivePaths?: boolean
  /** Audit granularity: `'all'` logs every hit AND passthrough; `'hits'` skips passthrough events. */
  audit?: AuditGranularity
  /** Walk parent directories of the session cwd and merge every found rule file (nearest first). */
  searchUp?: boolean
  /** Hard cap on unbounded `*`/`**` quantifiers per glob pattern (backtracking-degree bound). */
  maxGlobStars?: number
  /**
   * Whether decisions are enforced: `false` puts the plugin in dry-run
   * mode — deny/ask hits are audit-logged with a `dryRun` marker and every
   * call is delegated via `next()` untouched. Useful for evaluating a new
   * policy in production before enforcing it.
   */
  enforce?: boolean
  /**
   * Whether to keep appending audit events to the session log on hosts
   * whose `Session.append` predates the `ignorable` envelope marker
   * (the `0.1.0-rc.6` line). Defaults to `false`: such hosts write the
   * events UNMARKED, which makes the session unresumable on stricter
   * hosts, so the runtime detects the host and disables session-log audit
   * with a one-time warning instead. Set `true` to opt back into the
   * in-session audit trail (and accept that those sessions may need
   * `scripts/repair-session-logs.mjs` before loading on a newer harness).
   */
  allowUnmarkedAudit?: boolean
  /** Process-level network policy (all optional; defaults inside). */
  network?: NetworkConfig
}

/** Network config after {@link resolveConfig}: every optional field has its explicit default. */
export interface ResolvedNetworkConfig {
  readonly enabled: boolean
  readonly mode: 'auto' | NetworkMode
  readonly autoFallback: NetworkMode
  readonly unlisted: UnlistedAction
  readonly proxyBind: string
  readonly proxyPort: number
  readonly proxyMaxRecent: number
  readonly loopback: LoopbackPolicy
  readonly injectEnv: boolean
  readonly noProxy: NoProxyPolicy
}

/** Config after {@link resolveConfig}: every optional field has its explicit default. */
export interface ResolvedConfig {
  readonly rulesFile: string
  readonly fallbackPath: string | undefined
  readonly badFilePolicy: BadFilePolicy
  readonly maxRules: number
  readonly maxCachedWorkspaces: number
  readonly patternMode: PatternMode
  readonly watch: boolean
  readonly watchStabilityThresholdMs: number
  readonly language: UiLanguage
  readonly caseInsensitivePaths: boolean
  readonly audit: AuditGranularity
  readonly searchUp: boolean
  readonly maxGlobStars: number
  readonly enforce: boolean
  readonly allowUnmarkedAudit: boolean
  readonly network: ResolvedNetworkConfig
}

/** Schemastery schema: the loader validates and fills defaults before `apply`. */
export const Config: z<Config> = z.object({
  rulesFile: z.string().default('.dsh/rules.yaml'),
  fallbackPath: z.string(),
  badFilePolicy: z.union(['fail', 'ignore-with-warning'] as const).default('fail'),
  maxRules: z.number().default(256),
  maxCachedWorkspaces: z.number().default(512),
  patternMode: z.union(['glob', 'regex'] as const).default('glob'),
  watch: z.boolean().default(true),
  watchStabilityThresholdMs: z.number().default(200),
  language: z.union(['en', 'zh', 'es', 'pt', 'hi'] as const).default('en'),
  caseInsensitivePaths: z.boolean().default(process.platform === 'win32'),
  audit: z.union(['all', 'hits'] as const).default('all'),
  searchUp: z.boolean().default(false),
  maxGlobStars: z.number().default(2),
  enforce: z.boolean().default(true),
  allowUnmarkedAudit: z.boolean().default(false),
  network: z.object({
    enabled: z.boolean().default(true),
    mode: z.union(['auto', ...NETWORK_MODES] as const).default('auto'),
    autoFallback: z.union(NETWORK_MODES as [NetworkMode, ...NetworkMode[]]).default('allow-all'),
    unlisted: z.union(['ask', 'deny'] as const).default('ask'),
    proxyBind: z.string().default('127.0.0.1'),
    proxyPort: z.number().default(0),
    proxyMaxRecent: z.number().default(100),
    loopback: z.union(['allow', 'policy'] as const).default('allow'),
    injectEnv: z.boolean().default(true),
    noProxy: z.union(['clear', 'preserve'] as const).default('clear'),
  }),
})

/**
 * Validate raw values and fill explicit defaults. A `maxRules`,
 * `maxCachedWorkspaces`, or `maxGlobStars` that is not a positive safe
 * integer, a non-positive stability window, `searchUp` combined with an
 * absolute `rulesFile`, a value outside a closed enum, or a non-boolean
 * flag throws here — misconfiguration fails loud at mount even when the
 * plugin is mounted without the Schemastery loader.
 * @param config - raw (possibly partial) plugin config.
 * @returns the fully resolved config.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const rulesFile = config.rulesFile ?? '.dsh/rules.yaml'
  const searchUp = config.searchUp ?? false
  if (searchUp && isAbsolute(rulesFile)) {
    throw new TypeError(`searchUp cannot be combined with an absolute rulesFile (${JSON.stringify(rulesFile)}): parent-directory walking needs a relative file name`)
  }
  const maxRules = config.maxRules ?? 256
  if (!Number.isSafeInteger(maxRules) || maxRules <= 0) {
    throw new TypeError(`maxRules must be a positive safe integer, got ${String(config.maxRules)}`)
  }
  const watchStabilityThresholdMs = config.watchStabilityThresholdMs ?? 200
  if (!Number.isSafeInteger(watchStabilityThresholdMs) || watchStabilityThresholdMs < 0) {
    throw new TypeError(`watchStabilityThresholdMs must be a non-negative safe integer, got ${String(config.watchStabilityThresholdMs)}`)
  }
  const maxCachedWorkspaces = config.maxCachedWorkspaces ?? 512
  if (!Number.isSafeInteger(maxCachedWorkspaces) || maxCachedWorkspaces <= 0) {
    throw new TypeError(`maxCachedWorkspaces must be a positive safe integer, got ${String(config.maxCachedWorkspaces)}`)
  }
  const maxGlobStars = config.maxGlobStars ?? 2
  if (!Number.isSafeInteger(maxGlobStars) || maxGlobStars <= 0) {
    throw new TypeError(`maxGlobStars must be a positive safe integer, got ${String(config.maxGlobStars)}`)
  }
  assertEnum('badFilePolicy', config.badFilePolicy ?? 'fail', ['fail', 'ignore-with-warning'])
  assertEnum('patternMode', config.patternMode ?? 'glob', ['glob', 'regex'])
  assertEnum('language', config.language ?? 'en', ['en', 'zh', 'es', 'pt', 'hi'])
  assertEnum('audit', config.audit ?? 'all', ['all', 'hits'])
  assertBoolean('watch', config.watch ?? true)
  assertBoolean('searchUp', searchUp)
  assertBoolean('caseInsensitivePaths', config.caseInsensitivePaths ?? process.platform === 'win32')
  assertBoolean('enforce', config.enforce ?? true)
  assertBoolean('allowUnmarkedAudit', config.allowUnmarkedAudit ?? false)
  const network = resolveNetworkConfig(config.network)
  return {
    rulesFile,
    fallbackPath: config.fallbackPath,
    badFilePolicy: config.badFilePolicy ?? 'fail',
    maxRules,
    maxCachedWorkspaces,
    patternMode: config.patternMode ?? 'glob',
    watch: config.watch ?? true,
    watchStabilityThresholdMs,
    language: config.language ?? 'en',
    caseInsensitivePaths: config.caseInsensitivePaths ?? process.platform === 'win32',
    audit: config.audit ?? 'all',
    searchUp,
    maxGlobStars,
    enforce: config.enforce ?? true,
    allowUnmarkedAudit: config.allowUnmarkedAudit ?? false,
    network,
  }
}

/** Validate and default the optional `network` block; bad values fail the mount loudly. */
function resolveNetworkConfig(raw: NetworkConfig | undefined): ResolvedNetworkConfig {
  const mode = raw?.mode ?? 'auto'
  if (mode !== 'auto') assertEnum('network.mode', mode, NETWORK_MODES)
  const autoFallback = raw?.autoFallback ?? 'allow-all'
  assertEnum('network.autoFallback', autoFallback, NETWORK_MODES)
  const unlisted = raw?.unlisted ?? 'ask'
  assertEnum('network.unlisted', unlisted, ['ask', 'deny'])
  const loopback = raw?.loopback ?? 'allow'
  assertEnum('network.loopback', loopback, ['allow', 'policy'])
  const noProxy = raw?.noProxy ?? 'clear'
  assertEnum('network.noProxy', noProxy, ['clear', 'preserve'])
  assertBoolean('network.enabled', raw?.enabled ?? true)
  assertBoolean('network.injectEnv', raw?.injectEnv ?? true)
  const proxyBind = raw?.proxyBind ?? '127.0.0.1'
  if (typeof proxyBind !== 'string' || proxyBind.trim().length === 0) {
    throw new TypeError(`network.proxyBind must be a non-empty string, got ${typeof proxyBind}`)
  }
  const proxyPort = raw?.proxyPort ?? 0
  if (!Number.isSafeInteger(proxyPort) || proxyPort < 0 || proxyPort > 65535) {
    throw new TypeError(`network.proxyPort must be an integer 0-65535, got ${String(raw?.proxyPort)}`)
  }
  const proxyMaxRecent = raw?.proxyMaxRecent ?? 100
  if (!Number.isSafeInteger(proxyMaxRecent) || proxyMaxRecent <= 0) {
    throw new TypeError(`network.proxyMaxRecent must be a positive safe integer, got ${String(raw?.proxyMaxRecent)}`)
  }
  return {
    enabled: raw?.enabled ?? true,
    mode: mode as 'auto' | NetworkMode,
    autoFallback,
    unlisted,
    proxyBind: proxyBind.trim(),
    proxyPort,
    proxyMaxRecent,
    loopback,
    injectEnv: raw?.injectEnv ?? true,
    noProxy,
  }
}

/** Throw unless `key` is one of `allowed` (TypeScript's closed enums are not runtime checks). */
function assertEnum<T extends string>(key: string, value: string, allowed: readonly T[]): asserts value is T {
  if (!allowed.includes(value as T)) {
    throw new TypeError(`${key} must be one of ${allowed.map(item => JSON.stringify(item)).join(' | ')}, got ${JSON.stringify(value)}`)
  }
}

/** Throw unless `key` is a boolean (plain-JS mounts bypass the Schemastery coercion). */
function assertBoolean(key: string, value: boolean): void {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${key} must be a boolean, got ${typeof value}`)
  }
}
