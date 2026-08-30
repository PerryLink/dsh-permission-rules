# AGENTS.md

Standalone DeepSeek Harness plugin repository (`dsh-permission-rules`). Development follows the dsh-plugin-guide skill and the official plugin contract; this file records repo-local decisions.

## Layout

- `src/index.ts` — function-plugin contract (`name`/`inject`/`Config`/`apply`; NO default export — the Loader unwraps `exports.default ?? exports`). Injects `commands` + `tools`.
- `src/config.ts` — Schemastery schema + explicit `resolveConfig` (no hidden `?? default` in `run()` paths); closed enums and boolean flags are validated at resolution so plain-JS mounts fail loud too.
- `src/glob.ts` — strict glob→RegExp compiler + the backtracking guards: `maxGlobStars` caps unbounded star expansions, and regex-mode patterns reject nested unbounded quantifiers and quantified overlapping literal alternations. Bad patterns throw at compile time (load), never silently match nothing.
- `src/rules.ts` — the pure core: YAML document validation, pattern compilation (incl. `!pattern` negation), first-match evaluation, the `agents` identity dimension (`main`/`subagent`/`preset:<name>` selectors against session-header candidates; unknown identity never matches — fail closed), nested path-candidate extraction, `when`/`absent` dimensions, chain merging (`compileRulesChain`), shadow detection (`findUnreachableRules`). No fs/clock/process state.
- `src/prose.ts` — `/rules` output vocabulary in five languages (`en`/`zh` reference, `es`/`pt`/`hi` community) + `describeRule` dimension tokens (incl. the `src` source-attribution token). Rule `reason`s are never translated.
- `src/events.ts` — `permissionRules/decision` SessionEventMap member (declaration merging, incl. the `outcome` field) + `AuditAppend`, the append surface that requests the envelope's `ignorable: true` marker.
- `src/runtime.ts` — `tools/pre-execute` listener, per-cwd rule-chain loading (project chain by cwd / `searchUp` walk → fallback → empty), `permissionRules/decision` audit, `/rules` command (`list | reload | decisions [n] | test [flags incl. --platform]`), Chokidar watch (LRU cache with resolved/case-folded keys, watcher reconciliation, timer cleanup, candidate watches on expected-but-absent rule files so mid-session creation is adopted). Registers itself as `ctx.permissionRulesRuntime`.
- `test/` — vitest; real `Context` + real `Session`/`Commands`/`ApprovalService` from the `0.1.1-rc.2` peers; chokidar mocked with a fake EventEmitter; the dsh-auto-review integration uses its tarball with a scripted reviewer mock.
- `docs/rules-format.md` (+ `.en.md`) — the rule file schema and the 5-rule security baseline; `docs/rules-format.schema.json` is the machine-readable schema for editor completion.
- `scripts/repair-session-logs.mjs` — one-off repair for session logs written before the marker: rewrites targeted audit rows to carry `ignorable: true` (frame-preserving zstd rewrite, backups, `scan`/`repair`/`--dry-run` modes), or removes them outright in `strip` mode for harness lines that refuse marked plugin events (the `0.1.2-alpha` line).
- `scripts/check-readme-sync.mjs` — five-language README sync gate (section structure, config-table keys, `/rules` command docs); wired into CI.
- `.github/ISSUE_TEMPLATE/*` + `.github/PULL_REQUEST_TEMPLATE.md` + `SECURITY.md` — structured issue forms (bug/feature), PR checklist, and the private vulnerability-reporting policy.

## Hard rules applied here

- Waterfall listener (`tools/pre-execute`) always calls `next()` unless it claims the call with `deny`/`ask`. An `allow` hit is NEVER short-circuited. Under `enforce: false` (dry-run) even deny/ask hits delegate — the record keeps the would-be action with `dryRun: true` plus the real downstream `outcome`.
- Model-visible ⟺ logged: the only model-visible plugin content is the deny/ask reason materialized by the tools registry into the tool result; the `permissionRules/decision` audit event carries the same `callId` and reason for reconstruction, and its `outcome` records the FINAL pre-execute decision (an allow hit followed by a downstream deny is logged as denied).
- Log-only audit: `permissionRules/decision` is never injected into the model context, and is appended with `{ ignorable: true }` via the `AuditAppend` surface. The `0.1.0-rc.8`+ line stamps the marker; the `0.1.0-rc.1`–`rc.7` and `0.1.1-rc.1`–`rc.7` lines silently drop it, and the `0.1.2-alpha` line refuses plugin events on read even when marked — so the runtime detects unsafe hosts BEFORE the first append (peer-version pre-check, then a probe of the appended envelope's return value) and disables session-log audit with a one-time warning — `allowUnmarkedAudit: true` opts back in, and `scripts/repair-session-logs.mjs` repairs already-polluted logs (its `strip` mode removes audit rows where the marker cannot help).
- Loud misconfiguration: invalid YAML, unknown fields/actions, bad globs/regexes, backtracking-prone patterns, and rule counts over `maxRules` fail the load (`badFilePolicy` chooses fail vs ignore-with-warning). Deployment-level files (absolute `rulesFile`, `fallbackPath`) fail the mount. `searchUp` + absolute `rulesFile` fails `resolveConfig`.
- Backtracking bounds: a compiled glob's degree equals its star count — `maxGlobStars` (default 2) caps it exactly; regex mode rejects nested unbounded quantifiers and quantified overlapping literal alternations, while independent quantifier chains stay allowed (documented escape hatch).
- Agent identity is derived only from the session header (`origin: 'subagent'`, `agentPreset`): `main`/`subagent`/`preset:<name>` candidates. Unknown identity (agentless or header-less) yields no candidates, so `agents`-scoped rules fail closed and never match an unidentified caller.
- Watch failures warn only: a bad HMR reload keeps the previous rules and never crashes the process.
- Expected-but-absent rule files (project file not in effect, deleted fallback) are watched through their deepest existing ancestor directory — chokidar cannot reliably watch a missing path whose parent is also missing — so a file created mid-session is adopted without a manual reload. Under `searchUp` only the immediate cwd-level candidate is watched; deeper ancestors need `/rules reload`. The per-workspace cache key is `resolve(cwd)` case-folded on Windows, so differently-spelled paths to one workspace share one entry and one watcher set.
- No reviewer subagents, no model calls, no OS-sandbox changes — `ask` ends at the official approval seam; the answerer role belongs to `dsh-auto-review`.

## Docs

- Five-language READMEs (`README.md`, `README.zh.md`, `README.es.md`, `README.pt.md`, `README.hi.md`) — keep all five in sync; the English file is the source of truth. `scripts/check-readme-sync.mjs` (CI) enforces section structure, config-table keys, and `/rules` command docs.
- `docs/rules-format.md` is the Chinese reference for the rule vocabulary; `docs/rules-format.en.md` is its English twin — update both together, plus `docs/rules-format.schema.json` whenever the vocabulary changes.
- When the repo is published on GitHub, set topics `dsh`, `dsh-plugin`, `deepseek-harness`, `deepseek`, `cordis`, `permission`, `approval`, `ai-safety` (the ecosystem's visibility channel is the `dsh-plugin` topic; see dsh-plugin-guide §9).
- License is Apache-2.0 (`LICENSE` + the package.json `license` field).
- Community engineering: GitHub Discussions enabled (welcome post in Announcements); `main` branch protection requires all six `gates` matrix check statuses (os `ubuntu-latest`/`macos-latest`/`windows-latest` × node `22`/`24`, strict off), allows force pushes, and does NOT require PR reviews — maintainer direct pushes stay available, PRs with a red CI cannot merge. The About homepage points at the npm package page and topics mirror `package.json` keywords.

## Build

`typescript` + `tsdown` are regular `dependencies` on purpose: pnpm does not install devDependencies of git-hosted packages, and the git channel's `prepare` must build with production dependencies alone. `scripts/prepare.mjs` is the single build entry; it runs tsdown FIRST, then tsc declarations into `lib/types` — tsdown's `clean: true` wipes `lib/`, so the reverse order would delete the fresh declarations.

The repo's `pnpm-workspace.yaml` declares `allowBuilds: { esbuild: true }`: pnpm's isolated prepare env for git-hosted packages reads the dependency's shipped workspace file, and without that entry both local installs and git installs fail with `ERR_PNPM_IGNORED_BUILDS` on esbuild's (harmless platform-binary validation) postinstall. The package.json `pnpm` field is NOT usable for this — pnpm 11 ignores it. Git users still need the single `allowBuilds` key for `dsh-permission-rules` itself, which the `dsh` CLI prints verbatim.

## Checks

`pnpm run typecheck && pnpm run lint && pnpm test && pnpm run test:coverage && pnpm run build && pnpm pack && node scripts/check-readme-sync.mjs`.

## Integration dependency

`test/integration.spec.ts` imports `dsh-auto-review` from `vendor/dsh-auto-review-0.6.0.tgz` — a COMMITTED build artifact of the sibling repo (regenerate with `pnpm --dir ../dsh-auto-review pack --pack-destination <this repo>/vendor`). It must stay in the tree because the git install channel's isolated `prepare` installs devDependencies and would fail on a missing `file:` target. The shipped tarball carries runtime JS without `.d.ts`, so `tsconfig.test.json` maps the package name onto `test/auto-review.d.ts` for types while runtime resolution loads the real bundle.
