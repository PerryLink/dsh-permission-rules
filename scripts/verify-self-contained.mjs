// Rejects dependency specs that leave the repository root (file/link/portal/
// workspace/git/http paths) so the published package stays installable from
// the registry or a tarball with no external references.
//
// `devDependencies` is deliberately NOT scanned here: it is never published,
// and this repo intentionally keeps a committed `vendor/dsh-auto-review-*.tgz`
// under a `file:` devDependency for the local integration test and the
// git-install `prepare` channel (pnpm installs devDependencies of git-hosted
// packages, so the tarball must stay in the tree). The published surface is
// `dependencies` + `optionalDependencies` + `peerDependencies`; `files` (an
// allowlist) excludes `vendor/`, so the fixture never ships.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

const failures = []
const check = (deps, label) => {
  for (const [name, spec] of Object.entries(deps ?? {})) {
    if (/^(?:file|link|portal|workspace|git\+|https?):/iu.test(spec) || spec.startsWith('.') || path.isAbsolute(spec)) {
      failures.push(`${label} "${name}" uses out-of-repo spec ${JSON.stringify(spec)}`)
    }
  }
}
check(pkg.dependencies, 'dependencies')
check(pkg.optionalDependencies, 'optionalDependencies')
check(pkg.peerDependencies, 'peerDependencies')

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('self-contained: published dependency specs resolve from the registry')
