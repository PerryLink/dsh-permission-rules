/**
 * The settings-page wire vocabulary: the snapshot/rule-editor types served
 * over the `permissionRules` Typert Remote namespace, their zod v4
 * validation schemas (the strict codec both Typert faces carry), and the
 * invocation descriptors shared verbatim by the host `./typert` manifest
 * and the client Remote contribution. One canonical source for both faces
 * keeps the host and client codecs from ever drifting apart.
 * @module dsh-permission-rules/wire
 */

import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

/** The three network policy modes (wire vocabulary). */
export type NetworkModeWire = 'deny-all' | 'whitelist' | 'allow-all'

/** One recent proxy-layer block, sanitized for display. */
export interface NetworkBlockView {
  /** Epoch ms of the block. */
  time: number
  /** Attributed shell tool (`bash`/`pwsh`) or `subprocess`. */
  tool: string
  /** Whether an in-flight shell execution could be named. */
  attributed: boolean
  /** Blocked target host. */
  domain: string
  scheme: 'http' | 'https' | null
  port: number | null
  action: 'deny' | 'ask'
  mode: NetworkModeWire
  /** Whether a rule (true) or the mode default (false) blocked the target. */
  matched: boolean
  source: string
  ruleIndex: number | null
  reason: string | null
}

/** One rule file the editor may read/write (a known rule source only). */
export interface RuleSourceView {
  path: string
  exists: boolean
  /** The workspace the source belongs to, or null for the deployment fallback. */
  cwd: string | null
}

/** The complete settings-page snapshot served by `permissionRules/networkStatus`. */
export interface PermissionRulesSnapshot {
  enabled: boolean
  mode: NetworkModeWire
  /** The configured mode knob (`auto` or an explicit mode). */
  configuredMode: 'auto' | NetworkModeWire
  /** The sandbox preset `auto` mapped from, or null. */
  sandboxMode: string | null
  proxyPort: number
  proxyActive: boolean
  denied: number
  askBlocked: number
  recent: readonly NetworkBlockView[]
  sources: readonly RuleSourceView[]
}

/** Strict wire schema for {@link PermissionRulesSnapshot}. */
export const PERMISSION_RULES_SNAPSHOT_SCHEMA = z.object({
  enabled: z.boolean(),
  mode: z.union([z.literal('deny-all'), z.literal('whitelist'), z.literal('allow-all')]),
  configuredMode: z.union([z.literal('auto'), z.literal('deny-all'), z.literal('whitelist'), z.literal('allow-all')]),
  sandboxMode: z.string().nullable(),
  proxyPort: z.number().int(),
  proxyActive: z.boolean(),
  denied: z.number().int(),
  askBlocked: z.number().int(),
  recent: z.array(z.object({
    time: z.number().int(),
    tool: z.string(),
    attributed: z.boolean(),
    domain: z.string(),
    scheme: z.union([z.literal('http'), z.literal('https'), z.null()]),
    port: z.number().int().nullable(),
    action: z.union([z.literal('deny'), z.literal('ask')]),
    mode: z.union([z.literal('deny-all'), z.literal('whitelist'), z.literal('allow-all')]),
    matched: z.boolean(),
    source: z.string(),
    ruleIndex: z.number().int().nullable(),
    reason: z.string().nullable(),
  })),
  sources: z.array(z.object({
    path: z.string(),
    exists: z.boolean(),
    cwd: z.string().nullable(),
  })),
})

/** Result of `permissionRules/rulesRead`. */
export interface RulesReadResult {
  path: string
  exists: boolean
  text: string
  error: string | null
}

/** Strict wire schema for {@link RulesReadResult}. */
export const RULES_READ_SCHEMA = z.object({
  path: z.string(),
  exists: z.boolean(),
  text: z.string(),
  error: z.string().nullable(),
})

/** Result of `permissionRules/rulesSave`. */
export interface RulesSaveResult {
  ok: boolean
  error: string | null
  reloaded: number | null
}

/** Strict wire schema for {@link RulesSaveResult}. */
export const RULES_SAVE_SCHEMA = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
  reloaded: z.number().int().nullable(),
})

/** Result of `permissionRules/reload`. */
export interface RulesReloadResult {
  ok: boolean
  error: string | null
}

/** Strict wire schema for {@link RulesReloadResult}. */
export const RULES_RELOAD_SCHEMA = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
})

/** The `permissionRules/networkStatus` invocation descriptor (no parameters). */
export const NETWORK_STATUS_DESCRIPTOR = Object.freeze({
  id: 'dsh-permission-rules#permissionRules/networkStatus',
  service: 'permissionRules',
  namespace: 'permissionRules',
  method: 'networkStatus',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([]),
  result: Object.freeze({
    mode: 'strict',
    typeSymbol: 'dsh-permission-rules/types#PermissionRulesSnapshot',
    schema: PERMISSION_RULES_SNAPSHOT_SCHEMA,
  }),
  sourceLocation: Object.freeze({ file: 'src/wire.ts', line: 1, column: 1 }),
} as const) satisfies InvocationDescriptor

/** The `permissionRules/rulesRead` invocation descriptor. */
export const RULES_READ_DESCRIPTOR = Object.freeze({
  id: 'dsh-permission-rules#permissionRules/rulesRead',
  service: 'permissionRules',
  namespace: 'permissionRules',
  method: 'rulesRead',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([Object.freeze({
    name: 'path',
    wire: 'path',
    source: 'json',
    codec: Object.freeze({
      mode: 'strict',
      typeSymbol: 'dsh-permission-rules/types#RulesReadRequestPath',
      schema: z.string(),
    }),
  } satisfies InvocationDescriptor['parameters'][number])]),
  result: Object.freeze({
    mode: 'strict',
    typeSymbol: 'dsh-permission-rules/types#RulesReadResult',
    schema: RULES_READ_SCHEMA,
  }),
  sourceLocation: Object.freeze({ file: 'src/wire.ts', line: 1, column: 1 }),
} as const) satisfies InvocationDescriptor

/** The `permissionRules/rulesSave` invocation descriptor. */
export const RULES_SAVE_DESCRIPTOR = Object.freeze({
  id: 'dsh-permission-rules#permissionRules/rulesSave',
  service: 'permissionRules',
  namespace: 'permissionRules',
  method: 'rulesSave',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([
    Object.freeze({
      name: 'path',
      wire: 'path',
      source: 'json',
      codec: Object.freeze({
        mode: 'strict',
        typeSymbol: 'dsh-permission-rules/types#RulesSaveRequestPath',
        schema: z.string(),
      }),
    } satisfies InvocationDescriptor['parameters'][number]),
    Object.freeze({
      name: 'text',
      wire: 'text',
      source: 'json',
      codec: Object.freeze({
        mode: 'strict',
        typeSymbol: 'dsh-permission-rules/types#RulesSaveRequestText',
        schema: z.string(),
      }),
    } satisfies InvocationDescriptor['parameters'][number]),
  ]),
  result: Object.freeze({
    mode: 'strict',
    typeSymbol: 'dsh-permission-rules/types#RulesSaveResult',
    schema: RULES_SAVE_SCHEMA,
  }),
  sourceLocation: Object.freeze({ file: 'src/wire.ts', line: 1, column: 1 }),
} as const) satisfies InvocationDescriptor

/** The `permissionRules/reload` invocation descriptor (no parameters). */
export const RULES_RELOAD_DESCRIPTOR = Object.freeze({
  id: 'dsh-permission-rules#permissionRules/reload',
  service: 'permissionRules',
  namespace: 'permissionRules',
  method: 'reload',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([]),
  result: Object.freeze({
    mode: 'strict',
    typeSymbol: 'dsh-permission-rules/types#RulesReloadResult',
    schema: RULES_RELOAD_SCHEMA,
  }),
  sourceLocation: Object.freeze({ file: 'src/wire.ts', line: 1, column: 1 }),
} as const) satisfies InvocationDescriptor

/**
 * The canonical invocation list both Typert faces register — the host
 * manifest and the client contribution share these exact descriptor
 * objects, so the two wire codecs can never drift apart.
 */
export const PERMISSION_RULES_INVOCATIONS = Object.freeze([
  NETWORK_STATUS_DESCRIPTOR,
  RULES_READ_DESCRIPTOR,
  RULES_SAVE_DESCRIPTOR,
  RULES_RELOAD_DESCRIPTOR,
])
