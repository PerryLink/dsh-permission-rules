/**
 * Host Typert manifest tests: the hand-written `./typert` face must carry
 * the package identity, an empty schema/model surface (the loader fills
 * these), and — critically — the SAME frozen invocation descriptor objects
 * the client Remote contribution registers, so both faces of the wire
 * vocabulary can never drift apart.
 * @module dsh-permission-rules/test/typert-host
 */

import { describe, expect, it } from 'vitest'
import { TYPERT } from '../src/typert.host.ts'
import { PERMISSION_RULES_INVOCATIONS } from '../src/wire.ts'

describe('host Typert manifest', () => {
  it('names the package with the host face and an empty schema surface', () => {
    expect(TYPERT.package).toBe('dsh-permission-rules')
    expect(TYPERT.face).toBe('host')
    expect(TYPERT.schemas).toEqual([])
    expect(Object.isFrozen(TYPERT)).toBe(true)
    expect(Object.isFrozen(TYPERT.schemas)).toBe(true)
  })

  it('registers the canonical invocation list by identity, never a copy', () => {
    expect(TYPERT.invocations).toBe(PERMISSION_RULES_INVOCATIONS)
    expect(TYPERT.invocations).toHaveLength(4)
    expect(new Set(TYPERT.invocations.map(invocation => invocation.id))).toEqual(
      new Set([
        'dsh-permission-rules#permissionRules/networkStatus',
        'dsh-permission-rules#permissionRules/rulesRead',
        'dsh-permission-rules#permissionRules/rulesSave',
        'dsh-permission-rules#permissionRules/reload',
      ]),
    )
  })

  it('declares an empty model surface (services/events/objects)', () => {
    expect(TYPERT.model).toEqual({ services: [], events: [], objects: [] })
    expect(Object.isFrozen(TYPERT.model)).toBe(true)
    expect(Object.isFrozen(TYPERT.model.services)).toBe(true)
    expect(Object.isFrozen(TYPERT.model.events)).toBe(true)
    expect(Object.isFrozen(TYPERT.model.objects)).toBe(true)
  })
})
