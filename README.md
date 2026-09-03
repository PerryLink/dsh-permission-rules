<div align="center">

# 🛡️ dsh-permission-rules
- **1024 store channel**: `npm i -g dsh1024` once, then `dsh1024 plugin --profile web add dsh-permission-rules` (counts toward the [deepseek1024.com](https://deepseek1024.com) install ranking).
[![Gitee](https://img.shields.io/badge/Gitee-mirror-c71d23?logo=gitee)](https://gitee.com/perrylink/dsh-permission-rules)

**Claude Code-style declarative permission rules for DeepSeek Harness.**

*Rules decide what is known. A reviewer model decides what is not.*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-permission-rules/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-permission-rules/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-permission-rules?label=version)](https://github.com/PerryLink/dsh-permission-rules/releases)
[![npm version](https://img.shields.io/npm/v/dsh-permission-rules)](https://www.npmjs.com/package/dsh-permission-rules)
[![npm downloads](https://img.shields.io/npm/dm/dsh-permission-rules)](https://www.npmjs.com/package/dsh-permission-rules)

[English](README.md) · [简体中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

</div>

---

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.1.2-alpha.5` (adapted 2026-09-02): the session envelope keeps its ignorable field for stored-log read compatibility only - Session.append still cannot stamp it, so audit-gate behavior is unchanged. |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | All (host + web settings client) |
| Model | Any (deny/ask reasons surface through tool results) |

## What you get

`dsh-permission-rules` puts an ordered **`allow` / `deny` / `ask`** rule list in front of every tool call on the `tools/pre-execute` waterfall — deterministic, instant, auditable, and written by you in plain YAML:

- **`deny`** blocks the call; the rule's `reason` becomes the model-visible error.
- **`ask`** rides the official approval seam (mount `dsh-auto-review` for a second-model answerer, or a human answers; with neither, the harness fails closed).
- **`allow`** (and no-match) strictly delegates via `next()` — downstream listeners are never short-circuited.

Every hit **and** every passthrough is audit-logged as a `permissionRules/decision` session event (log-only — nothing extra is injected into the model context).

- **Rich matching** — tool-name globs (including `mcp__*`), agent-identity selectors (`main` / `subagent` / `preset:*`), argument key/value globs **or** regexes (with `!pattern` negation and an `absent` key dimension), workspace-relative path globs at **any nesting depth**, `when` host conditions (env vars, platform), and **shell command decomposition** (`argv`: command word, argument tokens, pipeline signature) for token-precise command matching.
- **Built-in high-risk baseline** — a shipped deny/ask ruleset (destructive commands, privilege escalation, download-and-execute, sensitive paths) enabled by default and appended after user rules so a nearer user rule can override it; toggle with `builtin.enabled`.
- **Hierarchical rule files** — optional `searchUp` merges every `.dsh/rules.yaml` from the session cwd to the filesystem root, nearest first.
- **Dry-run rollout** — `enforce: false` audits what the policy *would* do while passing every call through.
- **Hot reload** — Chokidar watch with debounce; a broken edit keeps the previous rules, never crashes.
- **Fail loud** — invalid YAML, unknown actions/fields, bad globs/regexes, backtracking-prone patterns, or more than `maxRules` rules fail the load.

## Rule syntax

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

- **Match dimensions** — `tools` (globs, incl. `mcp__*`), `agents` (`main` / `subagent` / `preset:<name>`; unknown identity never matches — fail closed), `params` (key/value globs or regexes, `!pattern` negation, `absent` key dimension), `paths` (workspace-relative globs extracted at any nesting depth), `when` (`env` var globs/regexes + a closed `platform` list), and `network` (`domains` / `ips` / `ports` / `schemes` — globs, wildcards, CIDRs, port ranges).
- **Actions** — `allow` / `deny` / `ask`, evaluated in file order, first match wins.
- **Rule metadata** — `enabled: false` (visible but inert), `description`, `tags`; unknown fields fail the load.
- **Schema** — a JSON Schema ships at [docs/rules-format.schema.json](docs/rules-format.schema.json) (editor completion via `# yaml-language-server: $schema=...`); the full vocabulary and a 5-rule security baseline live in [docs/rules-format.en.md](docs/rules-format.en.md).

## Network policy

A Codex-style **process-level network policy**: shell subprocess traffic flows through a built-in local **HTTP/CONNECT proxy**, and every connection is decided by ordered network rules or by three modes mapped onto the official sandbox presets:

- **`deny-all`** — the read-only sandbox preset: block all outbound.
- **`whitelist`** — the workspace-write preset: allow listed targets, `unlisted: ask` (or `deny`) for the rest.
- **`allow-all`** — the danger-full-access preset: allow everything.
- **`auto`** (default) — follows the sandbox preset; on hosts without the sandbox-policy service it resolves to `autoFallback` (`allow-all`).

- **Matching** — `match.network` with `domains` / `ips` / `ports` / `schemes` (globs, wildcards, CIDRs, port ranges; numeric YAML ports are accepted). URL-candidate extraction on the `tools/pre-execute` hot path fires on web-tool arguments and URLs embedded in bash/pwsh command text; loopback targets can short-circuit rules per `loopback` policy.
- **Audit** — denied connections append `permissionRules/network` to the owning session (same adaptive `ignorable` gate), with block counters and recent interceptions in `/rules network` and the settings page.

## Quick start

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add "github:PerryLink/dsh-permission-rules#main"

# or from npm (published releases)
dsh plugin --profile web add dsh-permission-rules

# 2. restart and verify the row
dsh --profile web --dump-config | grep -A4 'id: permission-rules'
```

## Install & uninstall

- **git channel** (latest `main`): `dsh plugin --profile web add "github:PerryLink/dsh-permission-rules#main"` — the `prepare` script builds with production dependencies only.
- **npm channel** (published releases): `dsh plugin --profile web add dsh-permission-rules`.
- **tarball channel**: `pnpm pack` in this repo, then `dsh plugin --profile web add ./dsh-permission-rules-<version>.tgz`.
- **uninstall**: `dsh plugin --profile web remove dsh-permission-rules`.

## Configuration

All tunables are Schemastery `Config` fields (changeable from cordis.yml). An id-targeted override replaces the whole row — restate every key you need.

| Key | Default | Meaning |
|---|---|---|
| `rulesFile` | `.dsh/rules.yaml` | Rule file location; relative = resolved against the calling session's cwd, absolute = global and validated at mount |
| `fallbackPath` | *(none)* | Rule file used when per-cwd discovery finds nothing; validated at mount |
| `badFilePolicy` | `fail` | Bad rule file: `fail` errors the pending tool call loudly; `ignore-with-warning` warns and continues empty |
| `maxRules` | `256` | Hard cap on rule count across the effective source chain |
| `maxCachedWorkspaces` | `512` | Hard cap on cached per-workspace rule loads (LRU eviction) |
| `patternMode` | `glob` | `params`/`paths`/`when.env` pattern flavor: `glob` or `regex` (tool names are always globs) |
| `watch` | `true` | Chokidar watch + reload on change |
| `watchStabilityThresholdMs` | `200` | Reload debounce window (ms) |
| `language` | `en` | `/rules` output language: `en`, `zh`, `es`, `pt`, `hi` |
| `caseInsensitivePaths` | *(win32)* | `paths` patterns and workspace-root comparison ignore ASCII case; `true` on Windows |
| `audit` | `all` | Audit granularity: `all` logs every hit AND passthrough; `hits` skips passthrough events |
| `searchUp` | `false` | Walk parent directories from the session cwd and merge every found rule file, nearest first |
| `maxGlobStars` | `2` | Hard cap on unbounded `*`/`**` quantifiers per glob pattern |
| `enforce` | `true` | `false` = dry-run mode: deny/ask hits are audit-logged with a `dryRun` marker and every call passes through |
| `allowUnmarkedAudit` | `false` | Pre-marker hosts drop the `ignorable` marker; the plugin disables session-log audit with a warning. Set `true` to opt back in |
| `network.enabled` | `true` | Master switch for the proxy, env injection, and web-tool mode defaults |
| `network.mode` | `auto` | Policy mode: `auto` follows the sandbox preset, or `deny-all` / `whitelist` / `allow-all` |
| `network.autoFallback` | `allow-all` | Mode used when `auto` has no sandbox-policy service |
| `network.unlisted` | `ask` | Whitelist-mode handling of targets no rule matched: `ask` or `deny` |
| `network.proxyBind` | `127.0.0.1` | Local proxy bind address (loopback only) |
| `network.proxyPort` | `0` | Local proxy port; `0` picks a free ephemeral port |
| `network.proxyMaxRecent` | `100` | Cap on recent-block records kept for the settings page |
| `network.loopback` | `allow` | Loopback targets: `allow` (Codex parity) or `policy` |
| `network.injectEnv` | `true` | Whether proxy environment variables are injected for subprocesses |
| `network.noProxy` | `clear` | Subprocess NO_PROXY handling: `clear` enforces the policy or `preserve` |
| `builtin.enabled` | `true` | Built-in high-risk baseline: `false` disables the shipped deny/ask ruleset entirely |
| `builtin.path` | *(shipped)* | Replacement baseline file (absolute, or relative to `process.cwd()`); validated at mount |

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `tools/pre-execute` | listener | First-match allow/deny/ask rules + network URL-candidate extraction |
| `/rules` | command | `list` · `reload` · `decisions [n]` · `test <tool> <json>` |
| `permissionRules/decision` | event | Log-only audit for every hit and passthrough |
| `permissionRules/network` | event | Proxy-layer audit for blocked connections |
| HTTP/CONNECT proxy | service | Built-in local proxy governing shell subprocess traffic |
| settings page | client | Network-mode editor, rule editor, block counters, recent interceptions |

```
/rules                        list the active rules, their source files, and any last-reload error
/rules list                   explicit alias for the bare listing
/rules reload                 re-read the rule-file chain for this workspace
/rules decisions [n]          show the last n permission decisions of this session (default 10)
/rules test <tool> <json>     dry-evaluate the rules against a hypothetical call
```

`/rules test` also accepts leading flags: `--cwd <dir>`, `--env KEY=VALUE` (repeatable), `--agent <selector>` (repeatable), and `--platform <name>`. In multi-file chains (e.g. `searchUp`), every listed rule line is attributed to its own source file.

## Permissions & data

- **Permissions**: declares `files:read`, `files:watch`, `files:write`, `session:append`, and `network:outbound` in its workshop manifest. `ask` decisions ride the official approval seam — nothing is re-implemented or bypassed.
- **Data**: rule files are read from disk; no rule data is written. No model calls, no reviewer subagents.
- **Session log**: `permissionRules/decision` is never injected into the model context and is appended with the envelope's `ignorable: true` marker so any harness build loads the log.

## Security boundaries

- **Policy, not a kernel.** `paths` candidates come only from a documented set of argument keys (at any nesting depth, depth-capped), and only workspace-relative paths match.
- **No reviewer here.** The plugin never spawns subagents or calls models — producing an `ask` decision is the end of its work.
- **No sandbox changes.** OS-level sandbox policy belongs to the sandbox seam, not this plugin.
- **Loud misconfiguration.** Unknown YAML fields, unknown actions, and bad patterns are rejected at load.
- **Backtracking bounds.** Glob patterns are capped at `maxGlobStars` unbounded star expansions; regex-mode patterns reject nested unbounded quantifiers and quantified overlapping literal alternations.

## Known limitations

- **Audit marker on pre-marker and refusing hosts.** `permissionRules/decision` is appended with `ignorable: true`; hosts whose `Session.append` predates the marker (the `0.1.0-rc.1`–`rc.7` and `0.1.1-rc.1`–`rc.7` lines) silently drop it, and the `0.1.2-alpha` line refuses plugin events on read even when marked — the runtime detects both before the first append and disables session-log audit with a one-time warning. Set `allowUnmarkedAudit: true` to opt back in; repair already-written logs with `scripts/repair-session-logs.mjs` (its `strip` mode removes audit rows where the marker cannot help).
- **Path candidates are heuristic.** Only the documented argument keys feed path matching, and workspace-relative matching is ASCII-case-insensitive only when `caseInsensitivePaths` is on.
- **Globs are a conservative subset.** No brace expansion — write two patterns, or use regex mode.
- **The regex backtracking guard is structural, not exhaustive.** Prefer glob mode for untrusted files.

## Collaborating with dsh-auto-review

- `dsh-permission-rules` produces `ask`; `dsh-auto-review` answers on the `approval/request` waterfall with a read-only second-model verdict (or delegates to humans). Mount both for the full closed loop.
- Integration-tested: `permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`, with the reviewer replaced by a scripted mock.
- The `never` approval policy and every fail-closed guarantee of the official harness stay untouched.

## Session log repair

Session logs written before the `ignorable` marker existed can be refused by newer harness builds (`SessionFormatUnsupportedError`). The shipped `scripts/repair-session-logs.mjs` rewrites only the targeted audit rows to carry `ignorable: true`, frame-preserving, with backups:

```sh
node scripts/repair-session-logs.mjs scan [--home DIR]      # report foreign rows, change nothing
node scripts/repair-session-logs.mjs repair [--home DIR] [--dry-run]
```

`--home` defaults to `$DSH_HOME/sessions` (or `~/.dsh/sessions`).

## Development

```sh
pnpm install            # node ^22.19 || >=24
pnpm run typecheck      # tsc, src + tests
pnpm run lint           # eslint, src + tests + scripts
pnpm test               # vitest: 236 tests, 20 files
pnpm run test:coverage  # coverage gate (90/80/90/90)
pnpm run build          # tsc declarations + tsdown bundles (lib/)
pnpm run pack:check     # build + pack (the published artifact)
node scripts/check-readme-sync.mjs   # five-language README sync gate (also in CI)
```

See [VERIFICATION.md](VERIFICATION.md) for the headless end-to-end verification record.

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `permission`, `policy`, `allow-deny-ask`, `approval`, `safety`, `network`, `network-policy`, `proxy`

## Contributors

- [@PerryLink](https://github.com/PerryLink) — creator and maintainer: rule vocabulary and evaluation, runtime, HMR watch, session-log audit, network policy + proxy, and the five-language docs.
- [@22xuan](https://github.com/22xuan) — the detailed report on rc.6 hosts silently dropping the audit event's `ignorable` marker ([#2](https://github.com/PerryLink/dsh-permission-rules/issues/2)) and the upstream harness discussion; the v0.4.1 runtime host-capability detection and the documentation correction drew directly from that analysis.
- [@sjh9714](https://github.com/sjh9714) — proposed the shared rule-syntax test-vector corpus ([#4](https://github.com/PerryLink/dsh-permission-rules/issues/4), [#5](https://github.com/PerryLink/dsh-permission-rules/issues/5)), shipped in v0.5.1 as `docs/rule-test-vectors/`, and supplied the AST-decomposition boundary cases on the [design discussion](https://github.com/PerryLink/dsh-permission-rules/discussions/10).
- [@weipeng1999](https://github.com/weipeng1999) — the AST-based command-decomposition feature proposal ([#8](https://github.com/PerryLink/dsh-permission-rules/issues/8)) behind the design discussion.
- [@alexchenzl](https://github.com/alexchenzl) — the DSH Directory listing request ([#7](https://github.com/PerryLink/dsh-permission-rules/issues/7)).
- [@zl190](https://github.com/zl190) — reported and verified the `0.1.0-rc.7` harness compatibility gap ([PR #9](https://github.com/PerryLink/dsh-permission-rules/pulls/9)).
- [@cuohua](https://github.com/cuohua) — reported that the `0.1.1-rc` line still drops the `ignorable` marker even though the version gate covered only `0.1.0` ([#11](https://github.com/PerryLink/dsh-permission-rules/issues/11)); the widened gate drew directly from that analysis.

## PerryLink DSH Plugin Family

This project is one of the [33 DeepSeek Harness plugins](https://github.com/PerryLink) maintained by [PerryLink](https://github.com/PerryLink). If this one helps you, the others likely will too:

| Plugin | One-liner |
|---|---|
| **[dsh-dsh-auto-review](https://github.com/PerryLink/dsh-dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default | |
| **[dsh-dsh-background-agents](https://github.com/PerryLink/dsh-dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | |
| **[dsh-dsh-budget](https://github.com/PerryLink/dsh-dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | |
| **[dsh-dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore | |
| **[dsh-dsh-claude-move](https://github.com/PerryLink/dsh-dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | |
| **[dsh-dsh-click](https://github.com/PerryLink/dsh-dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. | |
| **[dsh-dsh-composer-history](https://github.com/PerryLink/dsh-dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search | |
| **[dsh-dsh-data-quality](https://github.com/PerryLink/dsh-dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) | |
| **[dsh-dsh-defend](https://github.com/PerryLink/dsh-dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | |
| **[dsh-dsh-doublecheck](https://github.com/PerryLink/dsh-dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review | |
| **[dsh-dsh-draw](https://github.com/PerryLink/dsh-dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | |
| **[dsh-dsh-fast](https://github.com/PerryLink/dsh-dsh-fast)** | Read-only performance diagnostics for DeepSeek Harness. | |
| **[dsh-dsh-fund-research](https://github.com/PerryLink/dsh-dsh-fund-research)** | Deterministic research reports for Chinese public mutual funds | |
| **[dsh-dsh-github](https://github.com/PerryLink/dsh-dsh-github)** | GitHub PR/issues integration for DSH, every write gated by approval | |
| **[dsh-dsh-industry-research](https://github.com/PerryLink/dsh-dsh-industry-research)** | Industry research orchestration that seals its deliverables through this plugin's `ctx.researchReport.assemble` | |
| **[dsh-dsh-library](https://github.com/PerryLink/dsh-dsh-library)** | Local document knowledge base for DeepSeek Harness. | |
| **[dsh-dsh-local-ai](https://github.com/PerryLink/dsh-dsh-local-ai)** | Local-model (Ollama) integration for DeepSeek Harness. | |
| **[dsh-dsh-lsp-actions](https://github.com/PerryLink/dsh-dsh-lsp-actions)** | LSP diagnostics, formatting, completion, code actions and rename over language servers | |
| **[dsh-dsh-mask](https://github.com/PerryLink/dsh-dsh-mask)** | PII masking middleware: anonymize at the model boundary, restore at the display layer | |
| **[dsh-dsh-mcp-panel](https://github.com/PerryLink/dsh-dsh-mcp-panel)** | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors | |
| **[dsh-dsh-memento](https://github.com/PerryLink/dsh-dsh-memento)** | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool | |
| **[dsh-dsh-observe](https://github.com/PerryLink/dsh-dsh-observe)** | OpenTelemetry and Langfuse observability exporter for DeepSeek Harness. | |
| **[dsh-dsh-output-styles](https://github.com/PerryLink/dsh-dsh-output-styles)** | Claude Code outputStyles-equivalent runtime style switching | |
| **[dsh-dsh-plugin-guide](https://github.com/PerryLink/dsh-dsh-plugin-guide)** | Plugin-development knowledge base as an on-demand agent skill | |
| **[dsh-dsh-research-report](https://github.com/PerryLink/dsh-dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions | |
| **[dsh-dsh-score](https://github.com/PerryLink/dsh-dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. | |
| **[dsh-dsh-session-pin](https://github.com/PerryLink/dsh-dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | |
| **[dsh-dsh-session-sync](https://github.com/PerryLink/dsh-dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. | |
| **[dsh-dsh-skill-pack-security](https://github.com/PerryLink/dsh-dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review | |
| **[dsh-dsh-talk](https://github.com/PerryLink/dsh-dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. | |
| **[dsh-dsh-test-drive](https://github.com/PerryLink/dsh-dsh-test-drive)** | Isolated install-and-smoke test drives for DeepSeek Harness plugins. | |
| **[dsh-dsh-translate](https://github.com/PerryLink/dsh-dsh-translate)** | Vendor parameter translation and deterministic JSON repair for DeepSeek Harness. | |

### Install from the DSH Desktop Market

All PerryLink plugins are browsable in the built-in DSH Desktop Market: **Market → Sources → add source → paste** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ select it**. Installation still goes through the Market's npm-identity verification and your confirmation.

## License

[Apache License 2.0](LICENSE) © 2026 dsh-permission-rules contributors
