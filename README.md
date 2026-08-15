<div align="center">

# 🛡️ dsh-permission-rules

**Claude Code-style declarative permission rules for DeepSeek Harness.**

*Rules decide what is known. A reviewer model decides what is not.*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-permission-rules/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-permission-rules/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-permission-rules?label=version)](https://github.com/PerryLink/dsh-permission-rules/releases)

[English](README.md) · [简体中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

</div>

---

## What it does

`dsh-permission-rules` puts an ordered **`allow` / `deny` / `ask`** rule list in front of every tool call on the `tools/pre-execute` waterfall — deterministic, instant, auditable, and written by you in plain YAML:

- **`deny`** blocks the call. The rule's `reason` becomes the model-visible error, so the agent learns *why* instead of retrying blindly.
- **`ask`** rides the official approval seam. Mount `dsh-auto-review` alongside and the question is settled by a second model; otherwise a human answers; with neither, the harness fails closed.
- **`allow`** (and no-match) strictly delegates via `next()` — downstream listeners are never short-circuited.

Every hit **and** every passthrough is audit-logged as a `permissionRules/decision` session event (log-only — nothing extra is injected into the model context).

```text
tools/pre-execute waterfall                     approval/request waterfall (answerer chain)
        │                                                   │
  dsh-permission-rules                                dsh-auto-review answerer
   · first-match rules in file order       ┌───────────────┴──────────────┐
   · deny/ask claim the call               │ AI verdict (second model)     │ no ── next() ──▶ human UI
   · allow/passthrough → next()            └───────────────┬──────────────┘
        │ deny ──▶ denied tool result                     │ allowed-once / rejected
        │ ask  ──▶ ctx.approval ──────────────────────────┘
        │
   audit: permissionRules/decision → approval/asked → autoReview/verdict → approval/decided
```

## Why rules *and* a reviewer?

A second model answers *"is THIS call okay?"* with judgment, but costs a round-trip and can be wrong. Declarative rules answer deterministically, instantly, and without a model — but only cover what an admin wrote down. Combined, you get the **"rules first, AI backstop"** loop: rules decide the known, the reviewer decides the unknown.

## Features

- ✅ **Three-state semantics** — `allow`, `deny`, `ask`, evaluated in file order, first match wins
- ✅ **Rich matching** — tool-name globs (including `mcp__*`), agent-identity selectors (`main` / `subagent` / `preset:*`), argument key/value globs **or** regexes (with `!pattern` negation and an `absent` key dimension), workspace-relative path globs extracted from documented argument keys at **any nesting depth**, and `when` host conditions (env vars, platform)
- ✅ **Hierarchical rule files** — optional `searchUp` merges every `.dsh/rules.yaml` from the session cwd to the filesystem root, nearest first, so a child project can override parent rules
- ✅ **Rule metadata** — `enabled: false`, `description`, `tags`; `/rules` warns about rules shadowed by an earlier catch-all
- ✅ **Waterfall-safe** — `allow`/passthrough always call `next()`; only `deny`/`ask` short-circuit
- ✅ **Official approval seam** — `ask` flows through `ctx.approval`; never re-implemented, never bypassed
- ✅ **Full audit** — `permissionRules/decision` events carry the rule action, the workspace cwd, AND the final outcome for every call; `/rules decisions` replays the trail in-session
- ✅ **Dry-run rollout** — `enforce: false` audits what the policy *would* do (would-be action + real downstream outcome, `dryRun`-marked) while passing every call through; safe policy trialing in production
- ✅ **Dry-run testing** — `/rules test <tool> <json-args>` evaluates the active rules without executing anything, with `--cwd`, `--env`, `--agent`, and `--platform` overrides for every match dimension
- ✅ **Hot reload** — Chokidar watch with debounce; a broken edit keeps the previous rules, never crashes; a rule file created mid-session (the project file or the fallback) is adopted automatically, no manual reload
- ✅ **Fail loud** — invalid YAML, unknown actions/fields, bad globs/regexes, backtracking-prone patterns, or > `maxRules` fail the load
- ✅ **Bounded hot path** — precompiled matchers, O(rules × patterns), capped by `maxRules`; glob backtracking degree capped by `maxGlobStars`

## Quick start

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add "github:PerryLink/dsh-permission-rules#main"

# or from a packed tarball (built artifacts, no build permission needed)
pnpm pack
dsh plugin --profile web add ./dsh-permission-rules-0.4.0.tgz

# 2. restart
dsh --profile web
```

Then create the rules file for your project and start a session in it:

```yaml
# <project>/.dsh/rules.yaml
rules:
  - match: { tools: [bash, pwsh], params: { command: "git push*" }, paths: ["**/secrets/**"] }
    action: deny
    reason: "No pushes from protected paths"

  - match: { tools: [edit, write] }
    action: ask
    reason: "File writes need confirmation"
```

```sh
dsh --profile web --dump-config | grep -A4 'id: permission-rules'   # verify the row
```

A complete 5-rule security baseline and the full schema live in [docs/rules-format.en.md](docs/rules-format.en.md).

## Configuration

All tunables are Schemastery `Config` fields (changeable from cordis.yml). An id-targeted override replaces the whole row — restate every key you need.

| Key | Default | Meaning |
|---|---|---|
| `rulesFile` | `.dsh/rules.yaml` | Rule file location; relative = resolved against the calling session's cwd, absolute = global and validated at mount |
| `fallbackPath` | *(none)* | Rule file used when per-cwd discovery finds nothing; validated at mount |
| `badFilePolicy` | `fail` | Bad rule file: `fail` errors the pending tool call loudly (reloads keep the previous rules); `ignore-with-warning` warns and continues empty |
| `maxRules` | `256` | Hard cap on rule count across the effective source chain; larger files fail the load |
| `maxCachedWorkspaces` | `512` | Hard cap on cached per-workspace rule loads; the least-recently-used workspace (and its watcher) is evicted beyond it |
| `patternMode` | `glob` | `params`/`paths`/`when.env` pattern flavor: `glob` or `regex` (tool names are always globs) |
| `watch` | `true` | Chokidar watch + reload on change |
| `watchStabilityThresholdMs` | `200` | Reload debounce window (ms) |
| `language` | `en` | `/rules` output language: `en`, `zh`, `es`, `pt`, `hi` (`en`/`zh` are the reference translations) |
| `caseInsensitivePaths` | *(win32)* | `paths` patterns and workspace-root comparison ignore ASCII case; defaults to `true` on Windows, `false` elsewhere |
| `audit` | `all` | Audit granularity: `all` logs every hit AND passthrough; `hits` skips passthrough events |
| `searchUp` | `false` | Walk parent directories from the session cwd and merge every found rule file, nearest first |
| `maxGlobStars` | `2` | Hard cap on unbounded `*`/`**` quantifiers per glob pattern (backtracking-degree bound) |
| `enforce` | `true` | `false` = dry-run mode: deny/ask hits are audit-logged with a `dryRun` marker (would-be action + real downstream outcome) and every call passes through — trial a policy before enforcing it |

### Session commands

```
/rules                        list the active rules, their source files, and any last-reload error
/rules list                   explicit alias for the bare listing
/rules reload                 re-read the rule-file chain for this workspace
/rules decisions [n]          show the last n permission decisions of this session (default 10)
/rules test <tool> <json>     dry-evaluate the rules against a hypothetical call, e.g. /rules test bash {"command":"git push origin main"}
```

`/rules test` also accepts leading flags: `--cwd <dir>` evaluates against another workspace, `--env KEY=VALUE` (repeatable) overrides host env for `when.env`, `--agent <selector>` (repeatable) supplies identity candidates for the `agents` dimension, and `--platform <name>` overrides the host platform for `when.platform`. In multi-file chains (e.g. `searchUp`), every listed rule line is attributed to its own source file.

Command output is UI-only — the model learns the rules only through the tool results they produce. `language` picks the output language. A JSON Schema for the rule file ships at [docs/rules-format.schema.json](docs/rules-format.schema.json) (wire it up with `# yaml-language-server: $schema=...` for editor completion).

## Collaborating with dsh-auto-review

- `dsh-permission-rules` produces `ask`; `dsh-auto-review` answers on the `approval/request` waterfall with a read-only second-model verdict (or delegates to humans). Mount both for the full closed loop.
- Integration-tested (`test/integration.spec.ts`): `permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`, with the reviewer replaced by a scripted mock.
- The `never` approval policy and every fail-closed guarantee of the [official harness](https://github.com/deepseek-ai/deepseek-harness) stay untouched.

## Security boundaries

- **Policy, not a kernel.** `paths` candidates come only from a documented set of argument keys (at any nesting depth, depth-capped), and only workspace-relative paths match.
- **No reviewer here.** The plugin never spawns subagents or calls models — producing an `ask` decision is the end of its work.
- **No sandbox changes.** OS-level sandbox policy belongs to the sandbox seam, not this plugin.
- **Loud misconfiguration.** Unknown YAML fields, unknown actions, and bad patterns are rejected at load, never silently ignored.
- **Backtracking bounds.** Glob patterns are capped at `maxGlobStars` unbounded star expansions; regex-mode patterns reject nested unbounded quantifiers and quantified overlapping literal alternations. (Regex chains like `\d+\.\d+\.\d+` stay allowed — regex mode is the escape hatch, glob mode is the guarded default.)

## Related work

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) — two-state allow/deny classifier with its own file-log audit; this plugin adds the full three-state semantics, declarative YAML rules, session-log audit, and `next()`-safe delegation.
- `Drifter-yh/dsh-tool-policy` — deny-by-default tool policy; documented here to avoid duplicate implementation.
- `dsh-auto-review` — the AI-backstop half of the loop this plugin fronts.

## Known limitations

- `permissionRules/decision` is appended with the envelope's `ignorable: true` marker, so any harness build loads the log — readers that do not know the out-of-repo type simply skip the audit record instead of refusing the session. (rc.6 hosts accept and ignore the marker, keeping the exact pre-marker behavior; sessions written on rc.6 hosts lack the marker and may need `scripts/repair-session-logs.mjs` before loading on hosts with required-on-read semantics.)
- `paths` candidates are heuristic: only the documented argument keys feed path matching, and workspace-relative matching is ASCII-case-insensitive only when `caseInsensitivePaths` is on.
- Globs are a conservative subset (no brace expansion) — write two patterns, or use regex mode.
- The regex backtracking guard is structural, not exhaustive: alternation-ambiguity cases without literal prefixes (e.g. crafted lookarounds) are the author's responsibility; prefer glob mode for untrusted files.

## Session log repair

Session logs written before the `ignorable` marker existed can be refused by newer harness builds (`SessionFormatUnsupportedError`). The shipped `scripts/repair-session-logs.mjs` rewrites only the targeted audit rows to carry `ignorable: true`, frame-preserving, with backups:

```sh
node scripts/repair-session-logs.mjs scan [--home DIR]      # report foreign rows, change nothing
node scripts/repair-session-logs.mjs repair [--home DIR] [--dry-run]
```

`--home` defaults to `$DSH_HOME/sessions` (or `~/.dsh/sessions`). See the script header for the full contract.

## Development

```sh
pnpm install        # node ^22.19 || >=24
pnpm run typecheck  # tsc, src + tests
pnpm run lint       # eslint, src + tests + scripts
pnpm test           # vitest: 133 tests, 8 suites
pnpm run test:coverage  # coverage gate (90/80/90/90)
pnpm run build      # tsc declarations + tsdown bundles (lib/)
pnpm run pack:check # build + pack (the published artifact)
node scripts/check-readme-sync.mjs  # five-language README sync gate (also in CI)
```

See [VERIFICATION.md](VERIFICATION.md) for the headless end-to-end verification record (deny blocking a shell tool, ask routing through the approval seam, `--dump-config`).

## License

[Apache License 2.0](LICENSE) © 2026 dsh-permission-rules contributors
