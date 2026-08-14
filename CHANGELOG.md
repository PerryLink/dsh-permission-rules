# Changelog

All notable changes to dsh-permission-rules are recorded here, newest first.

## Unreleased

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
