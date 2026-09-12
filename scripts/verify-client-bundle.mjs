// Regression gate for the client bundle: every `require("...")` call left in
// lib/client.js must name one of the shell's platform modules
// (PLATFORM_EXTERNALS in tsdown.config.ts). The browser half is inlined whole
// except for those externals, and the shell answers the factory's `require`
// from a frozen module table that carries ONLY the platform seeds — a
// `require("process")` or `require("buffer")` (emitted when a host-only module
// with node builtins leaks into the client import graph) makes the loader
// fail with "missed the module table" and the entire plugin never mounts.
//
// Runs at the end of `scripts/prepare.mjs` (so the build AND the git-install
// `prepare` channel fail on a regression) and as its own CI step via
// `pnpm run verify:client-bundle`. Expects lib/client.js to exist — build
// first.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// The whitelist lives in tsdown.config.ts (single source of truth); parse the
// PLATFORM_EXTERNALS array literal out of it. A config that no longer carries
// the array fails HERE, loudly, rather than silently allowing everything.
const configText = readFileSync(path.join(root, 'tsdown.config.ts'), 'utf8')
const arrayMatch = /PLATFORM_EXTERNALS(?::[^=]+)?=\s*\[([\s\S]*?)\]/u.exec(configText)
if (arrayMatch === null) {
  console.error('verify-client-bundle: PLATFORM_EXTERNALS not found in tsdown.config.ts')
  process.exit(1)
}
const platformExternals = [...arrayMatch[1].matchAll(/'([^']+)'/gu)].map(match => match[1])
if (platformExternals.length === 0) {
  console.error('verify-client-bundle: PLATFORM_EXTERNALS parsed empty from tsdown.config.ts')
  process.exit(1)
}

let bundle
try {
  bundle = readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
} catch {
  console.error('verify-client-bundle: lib/client.js not found — run `pnpm run build` first')
  process.exit(1)
}

// Static requires with either quote style; computed requires (require(expr))
// cannot name a module table entry and are not emitted by the bundler.
const required = new Set()
for (const match of bundle.matchAll(/require\(\s*(["'])([^"']+)\1\s*\)/gu)) {
  required.add(match[2])
}

const unexpected = [...required].filter(specifier => !platformExternals.includes(specifier))
if (unexpected.length > 0) {
  console.error(
    'verify-client-bundle: lib/client.js requires modules outside the shell platform table:\n'
    + unexpected.map(specifier => `  require(${JSON.stringify(specifier)})`).join('\n')
    + `\nOnly the ${platformExternals.length} PLATFORM_EXTERNALS from tsdown.config.ts may stay external — `
    + 'a host-only module (node builtins, yaml, ...) leaked into the client import graph.',
  )
  process.exit(1)
}
console.log(`client-bundle: ${required.size} external require(s), all within the ${platformExternals.length} platform modules`)
