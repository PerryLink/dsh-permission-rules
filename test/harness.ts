/**
 * Shared test harness: real Cordis Context + real Session/Commands/
 * ApprovalService from the `0.1.0-rc.6` peers, scripted subagent/tools
 * mocks for the dsh-auto-review integration, and a minimal fake Agent.
 * @module dsh-permission-rules/test/harness
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import Commands from '@deepseek-ai/dsh-commands'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'

/** Scripted reviewer verdict for the mock subagent provider. */
export interface ScriptedReview {
  readonly decision: 'allow' | 'deny'
  readonly reason: string
  readonly riskLevel?: 'low' | 'medium' | 'high'
}

/** Mock `ctx.subagents` service recording every start request. */
export interface MockSubagents {
  getProvider(name: string): object | undefined
  start(name: string, request: SubagentStartRequest): Promise<SubagentRun>
  readonly starts: { name: string; request: SubagentStartRequest }[]
}

/** Mock `ctx.tools` service (the integration test needs no real registry). */
export interface MockTools {
  get(_name: string): undefined
  restrict(_filter: unknown): () => void
}

/**
 * A structurally complete fake agent: real session, real context, recorded
 * injected messages; everything driver-shaped is a no-op.
 * @param session - the agent's session.
 * @param injected - array receiving `agent.inject()` messages.
 * @returns the fake agent.
 */
export function makeAgent(session: Session, injected: UserMessage[] = []): Agent {
  const fake = {
    id: session.id,
    options: {},
    session,
    inbox: {},
    status: 'idle',
    ctx: new Context(),
    cancel: () => undefined,
    whenIdle: async () => undefined,
    runMaintenance: async (task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal),
    send: () => undefined,
    followup: () => undefined,
    steer: () => undefined,
    inject: (message: UserMessage) => {
      injected.push(message)
    },
  }
  return fake as unknown as Agent
}

/** Build a complete ToolExecution-shaped pending call for the pre-execute waterfall. */
export function makeExec(overrides: Partial<ToolExecution> & Pick<ToolExecution, 'name' | 'arguments'>): ToolExecution {
  const callId = overrides.callId ?? CallId('call-1')
  return {
    token: Symbol('exec-token'),
    callId,
    rootCallId: callId,
    signal: new AbortController().signal,
    ...overrides,
  } as ToolExecution
}

/** Build the scripted subagent service (auto-review integration). */
export function makeSubagents(script: () => ScriptedReview): MockSubagents {
  const starts: { name: string; request: SubagentStartRequest }[] = []
  return {
    getProvider(name: string): object | undefined {
      return name === 'mock' ? {} : undefined
    },
    async start(name: string, request: SubagentStartRequest): Promise<SubagentRun> {
      starts.push({ name, request })
      const behavior = script()
      return {
        id: SessionId('reviewer-session'),
        localAgent: undefined,
        result: Promise.resolve({
          output: [],
          structured: behavior,
          stopReason: 'completed',
        }) as SubagentRun['result'],
        dispose: async () => undefined,
      }
    },
    starts,
  }
}

/** A fresh temp workspace directory (removed on teardown by the caller). */
export function tempWorkspace(prefix = 'dsh-permission-rules'): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`))
}

/** Remove a temp workspace tree. */
export function removeWorkspace(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

/** Everything a mounted harness hands back to a test. */
export interface Harness {
  readonly ctx: Context
  readonly session: Session
  readonly agent: Agent
  readonly injected: UserMessage[]
  readonly cwd: string
  readonly subagents: MockSubagents
}

/**
 * Mount the plugin with real session store, real commands registry,
 * optional real approval service, and scripted subagent/tools mocks.
 * @param pluginConfig - raw plugin config.
 * @param options - workspace dir, approval mount flag, reviewer script.
 * @returns the mounted harness.
 */
export async function mountHarness(
  pluginConfig: Record<string, unknown>,
  options: {
    cwd?: string
    approval?: boolean
    reviewer?: () => ScriptedReview
  } = {},
): Promise<Harness> {
  const cwd = options.cwd ?? tempWorkspace()
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('harness-session'), { meta: { cwd } })
  session.append('turn/start', { turn: 1 })
  if (options.approval === true) await ctx.plugin(ApprovalService, {})
  const subagents = makeSubagents(options.reviewer ?? (() => ({ decision: 'allow', reason: 'looks safe' })))
  ctx.provide('subagents', subagents as never)
  ctx.provide('tools', { get: () => undefined, restrict: () => () => undefined } as never)
  await ctx.plugin(Commands)
  const plugin = await import('../src/index.ts')
  // Watch off by default: only the chokidar-mocked watch.spec passes
  // `watch: true`. Real chokidar watchers on the temp workspaces trip a
  // libuv assertion (src\win\fs-event.c) on Windows + Node 24 when the
  // dirs are removed mid-test, crashing the coverage worker.
  await ctx.plugin(plugin as unknown as import('@deepseek-ai/cordis').Plugin, { watch: false, ...pluginConfig })
  const injected: UserMessage[] = []
  const agent = makeAgent(session, injected)
  return { ctx, session, agent, injected, cwd, subagents }
}

/** Dispatch the `tools/pre-execute` waterfall with a downstream decision. */
export async function dispatchPreExecute(
  ctx: Context,
  exec: ToolExecution,
  downstream: () => Promise<PreToolDecision> = () => Promise.resolve({ kind: 'allow' }),
): Promise<PreToolDecision> {
  return (ctx.waterfall as unknown as (
    name: string,
    execution: ToolExecution,
    init: () => Promise<PreToolDecision>,
  ) => Promise<PreToolDecision>)('tools/pre-execute', exec, downstream)
}

/** The mock commands registry is replaced by the REAL one in this harness. */
export type { CommandDefinition }
