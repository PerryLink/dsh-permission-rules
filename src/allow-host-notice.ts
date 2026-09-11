/**
 * The client-safe half of the settings-page "allow this host" action: the
 * workspace choices offered for a host-level block ({@link allowHostWorkspaces})
 * and the notice mapping ({@link allowHostNotice}).
 *
 * These live in their own module — separate from the host-only
 * `./allow-host.ts` — because the settings page (the browser bundle built
 * from `src/client/index.ts`) imports them, and the client bundler inlines
 * every value import it meets. A single `import { allowHostNotice } from
 * '../allow-host.ts'` used to drag the whole host module — `node:path`,
 * `node:net`, `yaml`, `process.platform` — into `lib/client.js` as external
 * `require("process")`/`require("buffer")` calls the shell's frozen module
 * table cannot answer, which made the entire plugin fail to load.
 *
 * The hard rule for this module: NO runtime imports beyond pure type-only
 * references to `./wire.ts`. Anything that needs a node builtin, the yaml
 * parser, or the rule compiler belongs in `./allow-host.ts` (or deeper),
 * never here.
 * @module dsh-permission-rules/allow-host-notice
 */

import type { AllowHostResult, RuleSourceView } from './wire.ts'

/**
 * The workspaces a host-level block may be allowed in: the distinct non-null
 * `cwd`s of the loaded rule sources.
 *
 * A block with no cwd was judged by the proxy's session-less host chain, which
 * any loaded workspace chain outranks the moment one exists — so writing the
 * host file can leave the connection blocked while the rule sits in a file
 * nothing consults. The settings page therefore offers these workspaces and
 * sends the chosen one as the request's cwd; when there is exactly one (or
 * none), there is nothing to choose between.
 * @param sources - the snapshot's rule sources.
 * @returns the distinct workspace roots, in source order.
 */
export function allowHostWorkspaces(sources: readonly RuleSourceView[]): string[] {
  const seen = new Set<string>()
  const workspaces: string[] = []
  for (const source of sources) {
    if (source.cwd === null || seen.has(source.cwd)) continue
    seen.add(source.cwd)
    workspaces.push(source.cwd)
  }
  return workspaces
}

/** The locale keys the allow action reports through. */
export type AllowHostNoticeKey = 'allowHostSaved' | 'allowHostAlready' | 'allowHostStillBlocked' | 'allowHostFailed'

/** The notice one action result maps onto: a locale key plus its interpolation values. */
export interface AllowHostNotice {
  readonly ok: boolean
  readonly key: AllowHostNoticeKey
  readonly vars: Record<string, string | number>
}

/**
 * Map an action result onto the page notice.
 *
 * A non-`allow` outcome outranks `alreadyAllowed`: the whole point of
 * returning the RECOMPUTED decision is that the page can never say "allowed"
 * while the connection is still blocked (a nearer chain with an earlier deny,
 * or a mode default, still wins). `alreadyAllowed` therefore only ever reads
 * as success when the decision really is `allow`.
 * @param result - the `permissionRules/allowHost` result.
 * @returns the notice to render.
 */
export function allowHostNotice(result: AllowHostResult): AllowHostNotice {
  if (!result.ok) return { ok: false, key: 'allowHostFailed', vars: { error: result.error ?? 'unknown error' } }
  if (result.outcome !== 'allow') {
    return { ok: false, key: 'allowHostStillBlocked', vars: { outcome: result.outcome ?? 'unknown' } }
  }
  if (result.alreadyAllowed) return { ok: true, key: 'allowHostAlready', vars: {} }
  return { ok: true, key: 'allowHostSaved', vars: { path: result.path ?? '', reloaded: result.reloaded } }
}
