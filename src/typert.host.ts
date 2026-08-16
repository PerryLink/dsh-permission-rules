/**
 * The hand-written Typert HOST manifest for `dsh-permission-rules`,
 * exported as `./typert` so the harness's typert-loader registers the
 * `permissionRules` settings-page invocations automatically when this
 * plugin mounts. Same shape as a generator output (validated by the
 * loader): package face, empty model and schemas, and the canonical
 * invocation list shared with the client Remote contribution
 * (`src/wire.ts`).
 * @module dsh-permission-rules/typert
 */

import { PERMISSION_RULES_INVOCATIONS } from './wire.ts'

/** Host Typert manifest (validated by `@deepseek-ai/dsh-typert-loader`). */
export const TYPERT = Object.freeze({
  package: 'dsh-permission-rules',
  face: 'host',
  schemas: Object.freeze([]),
  invocations: PERMISSION_RULES_INVOCATIONS,
  model: Object.freeze({
    services: Object.freeze([]),
    events: Object.freeze([]),
    objects: Object.freeze([]),
  }),
})
