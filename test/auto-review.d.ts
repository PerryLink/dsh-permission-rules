/**
 * Local type stand-in for the cross-package integration test: the
 * `dsh-auto-review` tarball ships runtime JS without declaration files, so
 * its function-plugin contract is restated here. `tsconfig.test.json`
 * maps the package name onto this file (runtime resolution still loads the
 * real tarball). Its session-event vocabulary is asserted structurally in
 * the spec instead of through its declaration merge.
 * @module dsh-permission-rules/test/auto-review.d
 */

import type { Context } from '@deepseek-ai/cordis'

export const name: string
export const inject: string[]
export const apply: (ctx: Context, config: Record<string, unknown>) => void
