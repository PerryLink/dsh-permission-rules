/**
 * Client-half locale lifecycle: the browser entry registers its dictionaries
 * through `locale.register`, whose returned disposer is the ONLY unregister
 * path (the real registry throws on a duplicate namespace). Disposing the
 * plugin fiber must release the namespace so a remount (HMR / re-enable)
 * re-registers cleanly instead of failing the mount.
 * @module dsh-permission-rules/test/client-locale
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as client from '../src/client/index.ts'

/** Duplicate-strict stand-in for the host locale service. */
function fakeLocale() {
  const registrations = new Set<string>()
  return {
    registrations,
    register(namespace: string, _dictionaries: unknown): () => void {
      if (registrations.has(namespace)) throw new Error(`locale namespace "${namespace}" already has locale "en"`)
      registrations.add(namespace)
      return () => { registrations.delete(namespace) }
    },
    bind: (namespace: string) => (key: string) => `${namespace}.${key}`,
  }
}

describe('client locale dictionaries lifecycle', () => {
  it('unregisters the dictionaries on dispose and re-registers cleanly on remount', async () => {
    const ctx = new Context()
    try {
      const locale = fakeLocale()
      ctx.provide('locale', locale as never)
      ctx.provide('remote', { $mount: async () => {} } as never)
      ctx.provide('slots', { inject: () => () => {}, register: () => () => {} } as never)

      const first = await ctx.plugin(client)
      expect(locale.registrations.has(client.NS)).toBe(true)

      await first.dispose()
      expect(locale.registrations.has(client.NS)).toBe(false)

      // A remount must not trip the registry's duplicate-namespace rejection.
      const second = await ctx.plugin(client)
      expect(locale.registrations.has(client.NS)).toBe(true)
      await second.dispose()
      expect(locale.registrations.has(client.NS)).toBe(false)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
