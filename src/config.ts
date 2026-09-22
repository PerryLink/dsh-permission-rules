/**
 * Config schema and resolution for `dsh-permission-rules`. Every tunable is
 * a validated {@link Config} field changeable from cordis.yml; the
 * resolution step validates the numeric bounds and compiles nothing — rule
 * files are external documents resolved per session cwd at load time.
 *
 * Since the `0.1.7-alpha` settings contract every field is declared
 * `.volatile()`, so the Loader hands `apply` a live reference per field
 * ({@link LiveConfig}) and the settings surface edits them in place. The
 * numeric bounds live in the SCHEMA (`min`/`max`/`step`) as well as in
 * {@link resolveConfig}: the config editor resolves the merged config
 * against this schema before it persists anything, so an out-of-range value
 * is still refused at write time — the tradeoff the removed
 * `settings.register(..., { validate })` callback used to carry.
 * @module dsh-permission-rules/config
 */

import { isAbsolute } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { PatternMode } from './rules.ts'
import type { NetworkMode, UnlistedAction } from './network.ts'
import { NETWORK_MODES } from './network.ts'
import { resolveBuiltinRulesPath } from './builtin-rules.ts'
import type { UiLanguage } from './prose.ts'

/** What happens when a discovered rule file exists but cannot be parsed or compiled. */
export type BadFilePolicy = 'fail' | 'ignore-with-warning'

/** Which decisions are audit-logged: every call, or only rule hits. */
export type AuditGranularity = 'all' | 'hits'

/** Loopback-target handling at the proxy layer. */
export type LoopbackPolicy = 'allow' | 'policy'

/** NO_PROXY handling for policy-injected subprocess environment. */
export type NoProxyPolicy = 'clear' | 'preserve'

/** The built-in high-risk baseline block. */
export interface BuiltinConfig {
  /** Master switch: `false` disables the shipped high-risk baseline entirely. */
  enabled?: boolean
  /** Absolute (or process.cwd()-relative) path to a replacement baseline; unset uses the shipped file. */
  path?: string
}

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
  /**
   * Upstream proxy for connections this proxy ALLOWS: `off` (default — dial
   * directly), `inherit` (reuse the proxy names from the launch environment),
   * or an explicit `http(s)://` proxy URL. A blocked connection never reaches
   * it, and `ips`-scoped decisions plus loopback targets are never chained —
   * see the network section of the READMEs.
   */
  upstreamProxy?: UpstreamProxySetting
  /**
   * Whether the settings page may run its "allow this host" action, which
   * writes one minimal `domains` allow rule into the nearest effective rule
   * file (`true` by default). `false` hides the button and makes the
   * `permissionRules/allowHost` RPC refuse: the page's rule EDITOR is
   * strictly wider (it writes arbitrary rule text) and is not affected, so
   * this is a narrow safety switch for deployments that want rule changes to
   * stay a deliberate, hand-written act.
   */
  allowHostAction?: boolean
}

/** Upstream chaining setting: `off`, `inherit`, or an explicit http(s) proxy URL. */
export type UpstreamProxySetting = 'off' | 'inherit' | string

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
   * Declared `| undefined` because a live reference to a field the schema
   * gives no default reports an absent value explicitly.
   */
  fallbackPath?: string | undefined
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
  network?: NetworkConfig | undefined
  /** Built-in high-risk baseline (all optional; defaults inside). */
  builtin?: BuiltinConfig | undefined
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
  readonly upstreamProxy: UpstreamProxySetting
  readonly allowHostAction: boolean
}

/** Builtin baseline after {@link resolveConfig}: the switch plus the resolved absolute path. */
export interface ResolvedBuiltinConfig {
  readonly enabled: boolean
  /** Absolute path of the baseline file (shipped or the resolved `builtin.path`). */
  readonly path: string
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
  readonly builtin: ResolvedBuiltinConfig
}

/**
 * Mark one schema field as a live reference, where the host can.
 *
 * `.volatile()` first appeared in `@deepseek-ai/schemastery` 3.18.3, and this
 * schema is built while the plugin module is evaluated — an unguarded call
 * would turn every host line the package's peer ranges still advertise
 * (`0.1.2-rc`, `0.1.5-alpha`, `0.1.6-0`) into a hard mount crash. Probed
 * instead: on a Schemastery without the method the field stays an ordinary
 * value, the Loader hands `apply` a plain config ({@link plainConfig} passes
 * it straight through), and the plugin runs exactly as it did before live
 * forms existed — only the settings form is unavailable there, which is the
 * same degradation as a host that composes no settings service at all.
 * @param schema - the field schema.
 * @returns the same field schema, live where supported.
 */
function live<S extends { volatile(): unknown }>(schema: S): ReturnType<S['volatile']> {
  const builder = schema as { volatile?: () => ReturnType<S['volatile']> }
  return typeof builder.volatile === 'function'
    ? builder.volatile()
    : (schema as unknown as ReturnType<S['volatile']>)
}

/**
 * Schemastery schema: the loader validates and fills defaults before
 * `apply`. Every field is live (see {@link live}), so on a `0.1.7-alpha`
 * host the Loader hands `apply` a reference per field and the settings
 * surface can edit each one in place. `network` and `builtin` are marked
 * live as WHOLE objects — Schemastery refuses a volatile inside a volatile,
 * and the only supported shape is a fixed object path.
 *
 * The numeric bounds are declared here (not only in {@link resolveConfig})
 * because the config editor resolves the merged config against THIS schema
 * before persisting it: an out-of-range edit is refused at write time
 * instead of disabling the plugin on the next read.
 */
export const Config = z.object({
  rulesFile: live(z.string().default('.dsh/rules.yaml')),
  fallbackPath: live(z.string()),
  badFilePolicy: live(z.union(['fail', 'ignore-with-warning'] as const).default('fail')),
  maxRules: live(z.number().step(1).min(1).default(256)),
  maxCachedWorkspaces: live(z.number().step(1).min(1).default(512)),
  patternMode: live(z.union(['glob', 'regex'] as const).default('glob')),
  watch: live(z.boolean().default(true)),
  watchStabilityThresholdMs: live(z.number().step(1).min(0).default(200)),
  language: live(z.union(['en', 'zh', 'es', 'pt', 'hi'] as const).default('en')),
  caseInsensitivePaths: live(z.boolean().default(process.platform === 'win32')),
  audit: live(z.union(['all', 'hits'] as const).default('all')),
  searchUp: live(z.boolean().default(false)),
  maxGlobStars: live(z.number().step(1).min(1).default(2)),
  enforce: live(z.boolean().default(true)),
  allowUnmarkedAudit: live(z.boolean().default(false)),
  network: live(z.object({
    enabled: z.boolean().default(true),
    mode: z.union(['auto', ...NETWORK_MODES] as const).default('auto'),
    autoFallback: z.union(NETWORK_MODES as [NetworkMode, ...NetworkMode[]]).default('allow-all'),
    unlisted: z.union(['ask', 'deny'] as const).default('ask'),
    proxyBind: z.string().default('127.0.0.1'),
    proxyPort: z.number().step(1).min(0).max(65535).default(0),
    proxyMaxRecent: z.number().step(1).min(1).default(100),
    loopback: z.union(['allow', 'policy'] as const).default('allow'),
    injectEnv: z.boolean().default(true),
    noProxy: z.union(['clear', 'preserve'] as const).default('clear'),
    upstreamProxy: z.string().default('off'),
    allowHostAction: z.boolean().default(true),
  })),
  builtin: live(z.object({
    enabled: z.boolean().default(true),
    path: z.string(),
  })),
})

/** The Loader-delivered config: every field is a live reference to its current value. */
export type LiveConfig = ReturnType<typeof Config>

/** What {@link resolveConfig} accepts: the raw config, or the Loader's live one. */
export type ConfigInput = Config | LiveConfig

/**
 * Whether `value` is the Loader's live config rather than a plain one.
 * `rulesFile` is the discriminator: it always has a schema default, so the
 * Loader always materializes its reference, plain or absent.
 * @param value - a raw or live config.
 * @returns true when the fields are live references.
 */
function isLiveConfig(value: ConfigInput): value is LiveConfig {
  return typeof (value as { rulesFile?: { get?: unknown } }).rulesFile?.get === 'function'
}

/**
 * Unwrap the Loader's live references into the plain config
 * {@link resolveConfig} validates. Reading each reference HERE is what keeps
 * a caller's config source lazy: call it inside the closure, never at
 * closure-construction time, or a live edit stops being visible.
 * @param config - the raw config, or the Loader's live one.
 * @returns the plain raw config (the input itself when it was already plain).
 */
export function plainConfig(config: ConfigInput): Config {
  if (!isLiveConfig(config)) return config
  return {
    rulesFile: config.rulesFile.get(),
    fallbackPath: config.fallbackPath.get(),
    badFilePolicy: config.badFilePolicy.get(),
    maxRules: config.maxRules.get(),
    maxCachedWorkspaces: config.maxCachedWorkspaces.get(),
    patternMode: config.patternMode.get(),
    watch: config.watch.get(),
    watchStabilityThresholdMs: config.watchStabilityThresholdMs.get(),
    language: config.language.get(),
    caseInsensitivePaths: config.caseInsensitivePaths.get(),
    audit: config.audit.get(),
    searchUp: config.searchUp.get(),
    maxGlobStars: config.maxGlobStars.get(),
    enforce: config.enforce.get(),
    allowUnmarkedAudit: config.allowUnmarkedAudit.get(),
    network: config.network.get(),
    builtin: config.builtin.get(),
  }
}

/**
 * Validate raw values and fill explicit defaults. A `maxRules`,
 * `maxCachedWorkspaces`, or `maxGlobStars` that is not a positive safe
 * integer, a non-positive stability window, `searchUp` combined with an
 * absolute `rulesFile`, a value outside a closed enum, or a non-boolean
 * flag throws here — misconfiguration fails loud at mount even when the
 * plugin is mounted without the Schemastery loader.
 *
 * Accepts the Loader's live config directly and unwraps it through
 * {@link plainConfig}, so a caller can keep this call inside its config
 * source and see every live edit on the next read.
 * @param input - raw (possibly partial) plugin config, or the Loader's live one.
 * @returns the fully resolved config.
 */
export function resolveConfig(input: ConfigInput = {}): ResolvedConfig {
  const config = plainConfig(input)
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
  const builtin = resolveBuiltinConfig(config.builtin)
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
    builtin,
  }
}

/** Validate and default the optional `builtin` block; bad values fail the mount loudly. */
function resolveBuiltinConfig(raw: BuiltinConfig | undefined): ResolvedBuiltinConfig {
  assertBoolean('builtin.enabled', raw?.enabled ?? true)
  const path = resolveBuiltinRulesPath(raw?.path)
  return { enabled: raw?.enabled ?? true, path }
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
  assertBoolean('network.allowHostAction', raw?.allowHostAction ?? true)
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
  const upstreamProxy = raw?.upstreamProxy ?? 'off'
  assertUpstreamProxy(upstreamProxy)
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
    upstreamProxy,
    allowHostAction: raw?.allowHostAction ?? true,
  }
}

/**
 * Throw unless `value` is `off`, `inherit`, or a usable http(s) proxy URL.
 *
 * Node has no SOCKS client, and the harness's own policy refuses a proxy URL it
 * cannot express for a scheme, so a SOCKS value is rejected at the mount with an
 * actionable message instead of failing at connect time. `''` is rejected too:
 * an empty string reads as "no upstream" but silently disables chaining.
 */
function assertUpstreamProxy(value: string): void {
  const invalid = (detail: string): TypeError =>
    new TypeError(`network.upstreamProxy must be "off" | "inherit" | an http(s) proxy URL, got ${JSON.stringify(value)}${detail}`)
  if (value === 'off' || value === 'inherit') return
  if (typeof value !== 'string' || value.trim().length === 0) throw invalid('')
  let parsed: URL | undefined
  try {
    parsed = new URL(value)
  } catch {
    parsed = undefined
  }
  if (parsed === undefined) throw invalid('')
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw invalid(` (${parsed.protocol}// is not supported: Node has no SOCKS client, so give an http:// or https:// proxy)`)
  }
  if (parsed.hostname.length === 0) throw invalid(' (it must name a host)')
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
