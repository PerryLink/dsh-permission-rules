# Changelog

All notable changes to dsh-permission-rules are recorded here, newest first.

## v0.4.2 — 2026-08-15

### Ecosystem intake

- Declares the DSH Hub Workshop intake manifest in `package.json#dshWorkshop` (`omdsh-workshop-package/v1`): `harness-profile` integration via the bundle patch, transactional install with generation rollback, restart-profile activation with supported dispose, structured permissions (`files:read`, `files:watch`, `session:append`, `network:none`), RC.6 compatibility, and a named `/rules` command capability. Runtime evidence paths stay `null` — author-declared only until Harness-produced lifecycle evidence exists.

## v0.4.1 — 2026-08-15

### Audit safety on every host (fixes [#2](https://github.com/PerryLink/dsh-permission-rules/issues/2))

- Hosts whose `Session.append` predates the `ignorable` envelope marker (the `0.1.0-rc.6` line) silently drop the marker, writing audit events that make sessions unresumable on stricter harness builds (`SessionFormatUnsupportedError`). The runtime now detects such hosts BEFORE the first append (peer-version pre-check) and re-checks after the first append (probe of the returned envelope), then degrades gracefully: session-log audit is disabled with a one-time warning so session logs stay loadable everywhere.
- New `allowUnmarkedAudit` config (default `false`): set `true` to opt back into the in-session audit trail on pre-marker hosts (accepting that those sessions may need `scripts/repair-session-logs.mjs` before loading on a newer harness). `/rules decisions` explains the disabled audit on degraded hosts.
- `events.ts` no longer claims rc.6 hosts are harmless ("no failure either way") — the failure mode is documented accurately, and `isMarkedAuditEvent`/`isUnmarkedHostVersion` ship as exported capability helpers.
- Thanks to [@22xuan](https://github.com/22xuan) for the detailed report and the upstream harness discussion; credited in the README Acknowledgments.

### Engineering

- 139 tests across 9 suites: new `audit-support.spec.ts` covers the version-line classification, the envelope probe, the pre-append degradation, the opt-in, and the `/rules decisions` notice. Five-language READMEs (config table, Known limitations, Acknowledgments), AGENTS.md, CHANGELOG, and VERIFICATION updated.

## v0.4.0 — 2026-08-15

### Hot reload and workspace identity

- **Mid-session rule-file creation is adopted automatically.** Expected-but-absent rule files (the project file when it is not in effect, a fallback deleted after mount) are now watched through their deepest existing ancestor directory (chokidar cannot reliably watch a missing path whose parent is also missing), so creating `.dsh/rules.yaml` — or recreating it after a fallback took over — takes effect without a manual `/rules reload`. Under `searchUp`, only the immediate cwd-level candidate is watched; deeper ancestors still need a reload.
- The per-workspace cache key is now the resolved cwd, case-folded on Windows: differently-spelled paths to the same workspace share one cache entry and one watcher set instead of doubling both.

### Commands and observability

- `/rules test` accepts `--platform <name>` (one of the closed platform list): the `when.platform` match dimension is now dry-testable on any host, completing the flag coverage of every match dimension.
- `/rules` lists each rule with its own source file in multi-file chains (`searchUp`), via a localized `src:` attribution token; `/rules list` is an explicit alias for the bare listing.
- All five output languages carry the new `testBadPlatform` message, the updated usage strings, and the `src` token.

### Engineering

- 133 tests across 8 suites (new coverage: creation-adoption watch paths, fallback recreation, cache-key dedup, `--platform`, `list`, source attribution); coverage gate held. Five-language READMEs, both rules-format references, AGENTS.md, and the `/rules` command hint updated.
- The test harness now mounts with `watch: false` by default (only the chokidar-mocked watch suite opts in): real watchers on temp workspaces tripped a Node 24 + Windows libuv assertion (`src\win\fs-event.c`) when dirs were removed mid-test — the pre-existing cause of the red windows-latest/Node 24 matrix cells since v0.3.0.

## v0.3.0 — 2026-08-14

### Rules vocabulary

- New `match.agents` dimension: selector globs (`main`, `subagent`, `preset:<name>`) matched against the caller's session-header identity, ANDed with the other dimensions; unknown identity never matches (fail closed), so agent-scoped rules cannot leak onto unidentified callers.
- Path normalization: a candidate equal to the workspace root itself is dropped explicitly, and the root comparison only ignores case when `caseInsensitivePaths` is on.

### Dry-run rollout and audit fidelity

- `enforce: false` dry-run mode: deny/ask hits are audit-logged with a `dryRun` marker — the record keeps the would-be action AND the real downstream outcome — while every call is delegated via `next()`. `/rules` prints a dry-run notice while the mode is active and `/rules decisions` renders `(dry-run → <outcome>)` on such rows. Trial a new policy in production before enforcing it.
- `permissionRules/decision` events now carry `cwd`, the workspace the rule chain was resolved for.

### Commands and observability

- `/rules test` accepts leading flags: `--cwd <dir>` (evaluate against another workspace's rules), `--env KEY=VALUE` (repeatable; overrides host env for `when.env`), and `--agent <selector>` (repeatable; supplies identity candidates for the `agents` dimension). Quoted JSON argument tails are preserved verbatim.
- `resolveConfig` validates the closed enums (`badFilePolicy`, `patternMode`, `language`, `audit`) and boolean flags loudly, so plain-JS mounts without the Schemastery loader also fail on bad values instead of crashing later.

### Engineering

- 125 tests across 8 suites; coverage gate held. Five-language READMEs, both rules-format references, the JSON Schema, and the `/rules` command hint updated for `agents` and `enforce`.

## v0.2.0 — 2026-08-14

### Rules vocabulary

- New match dimensions: `absent` (argument keys that must be missing) and `when` (host conditions: `env` var globs/regexes + a closed `platform` list), combined with the existing dimensions by AND.
- Negated param patterns: a `!`-prefixed pattern means the value must NOT match; a key with only negations matches when the key is present and no negation hits.
- Rule metadata: `enabled: false` (visible but inert, shown as disabled), `description`, and `tags`, all surfaced by `/rules`; unknown fields still fail the load loudly.
- Path candidates are now extracted at ANY nesting depth (capped at 8), so MCP-style `{ arguments: { path } }` shapes feed `paths` matching; nested scalar leaves feed `params` matching the same way.
- `searchUp: true` walks parent directories and merges every found rule file, nearest first (child rules override parent rules on first-match semantics); each rule's audit row names its own file.
- Windows path handling: workspace-root comparison and `paths` matching ignore ASCII case by default on Windows (`caseInsensitivePaths`, default = the host platform), closing the case-variant rule bypass.
- A JSON Schema for the rule file ships at `docs/rules-format.schema.json` (editor completion via `# yaml-language-server: $schema=...`).

### Security hardening

- Catastrophic-backtracking guards at load time: glob patterns are capped at `maxGlobStars` (default 2) unbounded star expansions — the exact degree bound of the generated regex — and regex-mode patterns reject nested unbounded quantifiers (`(a+)+`) and quantified overlapping literal alternations (`(a|aa)+`). Chains of independent quantifiers (`\d+\.\d+\.\d+`) stay allowed by design; glob mode is the guarded default.
- Audit fidelity: `permissionRules/decision` now carries `outcome`, the FINAL pre-execute decision — an allow hit or passthrough followed by a downstream deny is logged as such instead of claiming the call was allowed.

### Commands and observability

- `/rules decisions [n]` lists the session's audit trail (default 10, newest last).
- `/rules test <tool> <json-args>` dry-evaluates the active rules against a hypothetical call — no tool executes.
- `/rules` output localizes via the new `language` config (`en`/`zh`/`es`/`pt`/`hi`; `en`/`zh` are the reference translations) and warns about rules shadowed by an earlier catch-all rule.
- The runtime registers itself as `ctx.permissionRulesRuntime` (watcher/timer counts for host introspection and tests).

### Runtime quality

- The per-workspace cache evicts least-recently-USED entries (LRU) instead of insertion-order entries; `maxCachedWorkspaces` bounds the cache (512 default).
- Watcher lifecycle: a source switch closes stale watchers; pruning a watcher also clears its pending debounce timer; `pendingReloadCount()` exposes the timers.
- `audit: 'hits'` logs only rule hits, skipping passthrough events for long sessions.
- The plugin now injects `tools` alongside `commands`, so a host without the tools service fails the mount loudly instead of silently never firing.

### Engineering

- ESLint (flat config, `@eslint/js` + `typescript-eslint`); CI matrix (3 OS × Node 22/24) with a coverage gate (90/80/90/90) and `pack:check`.
- README sync gate (`scripts/check-readme-sync.mjs`, wired into CI): the five language READMEs must share section structure, config-table keys, and `/rules` command docs.
- Release workflow: tags build, pack, verify the changelog names the version, and attach the tarball to a GitHub Release.
- `package.json` hygiene: `CHANGELOG.md` ships in the npm files, `sideEffects: false` declared, `.gitattributes` for line endings.
- Test suite grown to 106 tests across 8 suites; coverage gate held (statements 95%+ / branches 89%+ / functions 99%+ / lines 95%+).

## v0.1.0 — 2026-08-13

- First release: declarative `allow`/`deny`/`ask` rules on the `tools/pre-execute` waterfall with tool-name globs, argument glob/regex matching, and workspace-relative path matching.
- `permissionRules/decision` log-only audit for every hit and passthrough.
- `ask` rides the official approval seam (compose with `dsh-auto-review` for a second-model answerer).
- Per-workspace rule discovery (`<cwd>/.dsh/rules.yaml`), `fallbackPath`, Chokidar HMR with debounce, `/rules` session command.
- Fail-loud loading: invalid YAML, unknown fields/actions, bad globs/regexes, and rule counts over `maxRules` fail the load.
