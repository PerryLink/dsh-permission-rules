<div align="center">

# 🛡️ dsh-permission-rules
- **1024 store channel**: `npm i -g dsh1024` once, then `dsh1024 plugin --profile web add dsh-permission-rules` (counts toward the [deepseek1024.com](https://deepseek1024.com) install ranking).
[![Gitee](https://img.shields.io/badge/Gitee-mirror-c71d23?logo=gitee)](https://gitee.com/perrylink/dsh-permission-rules)
[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-permission-rules?metric=downloads)](https://dshfind.com/plugins/PerryLink/dsh-permission-rules?ref=badge)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/PerryLink/dsh-permission-rules/badge)](https://api.securityscorecards.dev/projects/github.com/PerryLink/dsh-permission-rules)

**Claude Code-style declarative permission rules for DeepSeek Harness.**

*Rules decide what is known. A reviewer model decides what is not.*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh--plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![dsh-doctor](https://raw.githubusercontent.com/PerryLink/dsh-plugin-doctor/main/badges/PerryLink__dsh-permission-rules.svg)](https://github.com/PerryLink/dsh-plugin-doctor#verified-徽章)
[![DSH Market](https://raw.githubusercontent.com/2BingLing/dsh-market/master/assets/readme/badge-top-rated.svg)](https://dsh.market/)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-permission-rules/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-permission-rules/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-permission-rules?label=version)](https://github.com/PerryLink/dsh-permission-rules/releases)
[![npm version](https://img.shields.io/npm/v/dsh-permission-rules)](https://www.npmjs.com/package/dsh-permission-rules)
[![npm downloads](https://img.shields.io/npm/dm/dsh-permission-rules)](https://www.npmjs.com/package/dsh-permission-rules)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-permission-rules
```


</div>

---

**📖 Ecosystem knowledge base** — measured data, not marketing: [plugin development guide · plugin-selection data · maintenance criteria](https://perrylink.github.io/dsh-plugin-guide/).

<!-- star-cta -->
## Install & uninstall

- **git channel** (latest `main`): `dsh plugin --profile web add github:PerryLink/dsh-permission-rules` — the `prepare` script builds with production dependencies only.
- **npm channel** (published releases): `dsh plugin --profile web add dsh-permission-rules`.
- **tarball channel**: `pnpm pack` in this repo, then `dsh plugin --profile web add ./dsh-permission-rules-<version>.tgz`.
- **uninstall**: `dsh plugin --profile web remove dsh-permission-rules`.

## ⭐ 如果它帮到了你

这个插件是 [DSH 插件家族](https://github.com/PerryLink)的一员（95 个，全部 Apache-2.0）。如果你在用，**给个 star** —— 它不会解锁任何功能，但会让下一个人在搜索里更容易找到它。

*English:* part of a 95 plugin family for DeepSeek Harness. If it is useful, **a star helps the next person find it** — nothing is gated behind it.


## What is dsh-permission-rules?

Claude Code-style declarative permission rules for DeepSeek Harness.

Rules decide what is known. A reviewer model decides what is not.

![Terminal demo of dsh-permission-rules: dsh-permission-rules — deny/ask rules in one YAML file](https://raw.githubusercontent.com/PerryLink/dsh-permission-rules/main/docs/assets/dsh-permission-rules-hero.png)

![Animated terminal demo of dsh-permission-rules](https://raw.githubusercontent.com/PerryLink/dsh-permission-rules/main/docs/assets/dsh-permission-rules-demo.gif)

*The same run, animated.*

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `dsh-v0.2.1-alpha.1` (adapted 2026-09-22, full gate chain): its plugin config is the live settings contract — every field is declared `.volatile()`, the Loader hands `apply` a live reference per field, and a saved edit is committed into the running references WITHOUT remounting the plugin, with out-of-range values refused by the schema before anything is written. A host whose Schemastery predates `volatile()` (before 3.18.3) still mounts and runs this plugin — the fields simply stay ordinary values and the live config form is unavailable — because the marker is applied through a capability probe rather than assumed. `Session.append` on this line still cannot stamp the `ignorable` marker (its third argument is the surface-intent bag, and the envelope field survives for stored-log reads only), so the whole `0.2-alpha` line is pre-checked as unmarked and session-log audit stays disabled by default — `append` reads only `sourceEventSeqs`/`surfaceOp` and freezes the envelope, so it has no code path that could stamp the marker; the earlier `0.1.7-alpha` (adapted 2026-09-22), `0.1.5-rc.2` (adapted 2026-09-09) and `0.1.3-alpha` lines keep the same surface-only append signature, and every `0.2` prerelease is classified with them (a STABLE `0.2.x` release is left to the append probe, so a restored marker surface is adopted without a new plugin release). Those lines' log migrations refuse unclassified plugin events even when marked, so `strip` v1 audit rows before a `0.1.3-alpha` host opens the log and v2 audit rows before a `0.1.5-alpha` host migrates it (native v3 logs only need `repair`). |
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
- **Hot reload** — Chokidar watch with debounce; a broken edit keeps the previous rules, never crashes. On a WSL host, or for a rule file under `/mnt/<drive>`, the watch switches to polling because native change events are unreliable there.
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

- **Matching** — `match.network` with `domains` / `ips` / `ports` / `schemes` (globs, wildcards, CIDRs, port ranges; numeric YAML ports are accepted). URL-candidate extraction on the `tools/pre-execute` hot path fires on web-tool arguments and URLs embedded in bash/pwsh command text; loopback targets can short-circuit rules per `loopback` policy. IPv4-mapped IPv6 literals are normalized to their IPv4 form before matching, and the proxy connects on the addresses the decision was made on — never a second DNS resolution — a connection whose adjudication resolved no address fails closed (502) instead of dialing the name.
- **Upstream chaining** — `network.upstreamProxy` (default `off`) sends the connections this proxy **allows** through an upstream proxy: CONNECT asks the upstream for a tunnel (`CONNECT host:port`) and plain-HTTP requests are forwarded to it in absolute form. A blocked target never reaches the upstream — it still gets this plugin's structured 403. Two cases never chain even when an upstream is configured: a **loopback** target (a proxy outside this host cannot route its loopback) and any decision produced by an **`ips`-scoped rule** (chaining hands the hostname to the upstream, so "the connection lands on an address the rules saw" — issue #21 — would stop holding exactly where the rules cared about the address; those decisions keep dialing the adjudicated address directly), plus a target whose scheme has no usable upstream. The upstream's own hostname is operator configuration, not agent input, and is not adjudicated by these rules. A URL carrying credentials is never emitted raw: warnings, `/rules network` and the settings snapshot mask the password (`http://user:***@host:port`). An unreachable upstream, a timeout (10 s), or a non-2xx answer yields **502** — there is deliberately no silent fallback to a direct dial, so a misconfiguration stays visible.
- **Audit** — denied connections append `permissionRules/network` to the owning session (same adaptive `ignorable` gate), with block counters and recent interceptions in `/rules network` and the settings page.
- **Diagnosis** — blocked connections carry a `[network: …]` message naming the blocked target, the mode or rule that decided, and the remediation.
- **Allow from the settings page** — every recent interception offers an **Allow** action. It writes ONE minimal `match: { network: { domains: [<host>] } }` / `action: allow` rule at the **top** (index 0) of the nearest rule file that actually judges that connection: the project file of the workspace the block was attributed to (the absolute `rulesFile` when one is configured), or, for a session-less host-level block, the file the host chain resolves (absolute `rulesFile` → existing `<processCwd>/<rulesFile>` → configured `fallbackPath` → `<processCwd>/<rulesFile>`, created) — and when several workspaces are loaded, the page first offers a picker, because any loaded workspace chain outranks the host chain. Index 0 because rules are first-match-wins: appended after an existing `deny` the rule would be dead text. `domains` only, because that dimension is subdomain-inclusive and port/scheme-agnostic, so the host is not re-blocked on its next port; existing comments and untouched rules survive, and the text goes through the same validation gate as a hand edit. The change takes effect immediately — the cached workspace chains AND the session-less host chain are re-read, so no restart and no `/rules reload` — and the decision is recomputed, so the notice reports the REAL outcome and never claims success while the connection is still blocked. It refuses, leaving the file untouched, an unknown workspace, a target outside the known rule sources, the read-only built-in baseline, and a file it cannot read or parse; an already-allowed connection writes nothing. `network.allowHostAction: false` hides the button and makes the RPC refuse.

## Quick start

```sh
dsh plugin --profile web add github:PerryLink/dsh-permission-rules
```

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add github:PerryLink/dsh-permission-rules

# or from npm (published releases)
dsh plugin --profile web add dsh-permission-rules

# 2. restart and verify the row
dsh --profile web --dump-config | grep -A4 'id: permission-rules'
```

## Configuration

All tunables are Schemastery `Config` fields (changeable from cordis.yml). An id-targeted override replaces the whole row — restate every key you need. On a `0.1.7-alpha` host every field is declared `.volatile()`, so it is ALSO editable in place from the Plugins settings page: the edit is committed into the running references without remounting the plugin, the runtime reads the new value on its next use, and a change to `network.proxyPort`, `proxyBind`, `injectEnv` or `noProxy` rebinds the local proxy immediately. The numeric bounds live in the schema, and the config editor resolves the merged config against that schema before persisting, so an out-of-range value is refused at write time. On a host whose Schemastery predates `volatile()` these fields stay cordis.yml-only.

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
| `network.upstreamProxy` | `off` | Upstream proxy for connections this plugin ALLOWS: `off` dials directly, `inherit` reuses the launch environment's proxy names, or an explicit `http(s)://` proxy URL |
| `network.allowHostAction` | `true` | Settings-page per-block "allow this host" action: `false` hides the Allow button and makes the `permissionRules/allowHost` RPC refuse (the rule editor is not affected) |
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
| settings page | client | Network-mode editor, rule editor, block counters, recent interceptions with a per-block allow action |

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
- **Fail-closed dialing.** Plain-HTTP forwards and CONNECT tunnels connect only to adjudicated addresses; an allow whose adjudication resolved no address fails closed with 502 instead of dialing the name (issue #23).

## Known limitations

- **Audit marker on pre-marker and refusing hosts.** `permissionRules/decision` is appended with `ignorable: true`; hosts whose `Session.append` predates the marker (the `0.1.0-rc.1`–`rc.7` and `0.1.1-rc.1`–`rc.7` lines) silently drop it, the `0.1.2-rc` line ships the alpha.5 surface (no append option writes the marker), the `0.1.2-alpha` line refuses plugin events on read even when marked, and the `0.1.3-alpha` and `0.1.5-alpha` lines keep the same surface-only append signature (verified on the published `0.1.3-alpha.1`/`0.1.5-alpha.1` packages) — the runtime pre-checks all of these before the first append and disables session-log audit with a one-time warning. Cross-generation migration refuses marked audit rows too: the `0.1.3-alpha` v1→v2 gate refuses unknown v1 events, and the `0.1.5-alpha` v2→v3 gate refuses every unclassified event (its inventory is frozen to the released v2 vocabulary), so `strip` v1 rows before a 0.1.3 host opens the log and v2 rows before upgrading to a 0.1.5 host. Native v3 logs accept marked plugin rows, so they only need `repair`. Set `allowUnmarkedAudit: true` to opt back in; repair already-written logs with `scripts/repair-session-logs.mjs` (its `strip` mode removes audit rows where the marker cannot help).
- **Path candidates are heuristic.** Only the documented argument keys feed path matching, and workspace-relative matching is ASCII-case-insensitive only when `caseInsensitivePaths` is on.
- **Globs are a conservative subset.** No brace expansion — write two patterns, or use regex mode.
- **The regex backtracking guard is structural, not exhaustive.** Prefer glob mode for untrusted files.
- **The host's own outbound requests do not go through this proxy.** The injected proxy environment covers **spawned shell children** — which is what the injection is for — and any consumer that reads the proxy names at request time. It does **not** cover the host process's own `fetch`-based traffic: the launcher installs undici's global dispatcher from the **launch environment** before the first plugin mounts, that dispatcher routes by its policy rather than by the environment, and Node samples the proxy environment at start — so a plugin mounting later cannot redirect it. Consequences: provider endpoints do **not** need an allow rule, and `network.injectEnv: false` does not take the host process out of anything. Measured 2026-09-10 on Node 22; reproduce with `scripts/host-egress-probe.mjs`.
- **Upstream chaining covers only what reaches this proxy.** On `dsh-v0.1.7-alpha.1` and later, the harness's own launch-time proxy policy and its subprocess environment overlay can take precedence over the proxy names this plugin injects, so `network.upstreamProxy` describes what happens to the connections this proxy handles — it is not a claim about every outbound path in the host process.

## Collaborating with dsh-auto-review

- `dsh-permission-rules` produces `ask`; `dsh-auto-review` answers on the `approval/request` waterfall with a read-only second-model verdict (or delegates to humans). Mount both for the full closed loop.
- Integration-tested: `permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`, with the reviewer replaced by a scripted mock.
- The `never` approval policy and every fail-closed guarantee of the official harness stay untouched.

## Session log repair

Session logs written before the `ignorable` marker existed can be refused by newer harness builds (`SessionFormatUnsupportedError`). The shipped `scripts/repair-session-logs.mjs` rewrites only the targeted audit rows to carry `ignorable: true`, frame-preserving, with backups:

```sh
node scripts/repair-session-logs.mjs scan [--home DIR]      # report foreign rows, change nothing
node scripts/repair-session-logs.mjs repair [--home DIR] [--dry-run]
node scripts/repair-session-logs.mjs strip [--home DIR] [--dry-run]
```

`--home` defaults to `$DSH_HOME/sessions` (or `~/.dsh/sessions`). Every generation-addressed log is discovered by its canonical basename — `session.jsonl`, `session.v2.jsonl`, `session.v3.jsonl`, each optionally `.zstd`-compressed — so pick the mode by generation:

- **v3 (`session.v3.jsonl`, written natively by the `0.1.5-alpha` line)** — the read path accepts marked plugin rows, so `repair` is enough.
- **v2 (`session.v2.jsonl`, written by the `0.1.3-alpha` line)** — `repair` opens it on the host that wrote it, but the `0.1.5-alpha` v2→v3 migration refuses every unclassified event even when marked: run `strip` on v2 logs **before** upgrading to a `0.1.5-alpha` host.
- **v1 (`session.jsonl`)** — the `0.1.3-alpha` v1→v2 migration refuses unknown v1 events even when marked: run `strip` before a 0.1.3-or-later host first opens the log.

## Development

```sh
pnpm install            # node ^22.19 || >=24
pnpm run typecheck      # tsc, src + tests
pnpm run lint           # eslint, src + tests + scripts
pnpm test               # vitest: 24 spec files
pnpm run test:coverage  # coverage gate (90/80/90/90)
pnpm run build          # tsc declarations + tsdown bundles (lib/)
pnpm run pack:check     # build + pack (the published artifact)
node scripts/check-readme-sync.mjs   # five-language README sync gate (also in CI)
```

See [VERIFICATION.md](VERIFICATION.md) for the headless end-to-end verification record.

## Interoperability with other DSH plugins

Verified against **DSH `0.2.0-rc.2`** (the runtime this README ships for) and the high-star plugin set surveyed on 2026-10-05.

This plugin **does not interfere** with other plugins, including the widely installed high-star ones:

- **No tool-name collision.** Every tool is namespaced; no bare name owned by a shipped tool or another plugin is registered.
- **No service-key collision.** It provides `permissionRules`, `permissionRulesRuntime`; those keys are not a built-in seam and are not provided by any surveyed high-star plugin.
- **No slot collision.** It registers no client slot key, so it cannot contend for a `shadows-shipped-ui` seat.
- **No HTTP route collision.** It registers no `webServer` prefix.
- **No patch-layer collision.** The bundle patch only `insert`s its own row; it never overrides a built-in row's `config`.
- **No global mutation.** It does not patch prototypes, rewrite `process.env`, or replace the global fetch dispatcher.

**Shared event listeners are non-interfering by construction.** It observes the ordering-sensitive events `tools/post-execute`, `tools/pre-execute` with `ctx.on()` — Cordis's broadcast registration, where every listener runs and none can starve another. **Every listener here delegates through `next()`**, so the chain is never short-circuited, and a mutation is applied to the value `next()` produced rather than returned in its place:
  - `tools/post-execute` — also used by `cc-safety-net` (1576★).
  - `tools/pre-execute` — also used by `cc-safety-net` (1576★).

Static evidence: `dsh-plugin-doctor` K10–K13 report `pass` for every check on this repository.

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `permission`, `policy`, `allow-deny-ask`, `approval`, `safety`, `network`, `network-policy`, `proxy`

## Contributors

- [@am-i-dead](https://github.com/am-i-dead) — split the client-safe allow-host helpers out of the host-only module (#24).

- [@PerryLink](https://github.com/PerryLink) — creator and maintainer: rule vocabulary and evaluation, runtime, HMR watch, session-log audit, network policy + proxy, and the five-language docs.
- [@22xuan](https://github.com/22xuan) — the detailed report on rc.6 hosts silently dropping the audit event's `ignorable` marker ([#2](https://github.com/PerryLink/dsh-permission-rules/issues/2)) and the upstream harness discussion; the v0.4.1 runtime host-capability detection and the documentation correction drew directly from that analysis.
- [@sjh9714](https://github.com/sjh9714) — proposed the shared rule-syntax test-vector corpus ([#4](https://github.com/PerryLink/dsh-permission-rules/issues/4), [#5](https://github.com/PerryLink/dsh-permission-rules/issues/5)), shipped in v0.5.1 as `docs/rule-test-vectors/`, and supplied the AST-decomposition boundary cases on the [design discussion](https://github.com/PerryLink/dsh-permission-rules/discussions/10).
- [@weipeng1999](https://github.com/weipeng1999) — the AST-based command-decomposition feature proposal ([#8](https://github.com/PerryLink/dsh-permission-rules/issues/8)) behind the design discussion.
- [@alexchenzl](https://github.com/alexchenzl) — the DSH Directory listing request ([#7](https://github.com/PerryLink/dsh-permission-rules/issues/7)).
- [@zl190](https://github.com/zl190) — reported and verified the `0.1.0-rc.7` harness compatibility gap ([PR #9](https://github.com/PerryLink/dsh-permission-rules/pulls/9)).
- [@cuohua](https://github.com/cuohua) — reported that the `0.1.1-rc` line still drops the `ignorable` marker even though the version gate covered only `0.1.0` ([#11](https://github.com/PerryLink/dsh-permission-rules/issues/11)); the widened gate drew directly from that analysis.

## PerryLink DSH Plugin Family

This project is one of the **87 actively maintained** DeepSeek Harness plugins from [PerryLink](https://github.com/PerryLink). The family roster is **95** plugins in total — **5 frozen**, **3 retired** — and stays collapsed below so every README keeps a short first screen. Expand it to see every row, with the reason in the Status column.

<details>
<summary>Expand all 95 plugins</summary>

| Plugin | One-liner | Status |
|---|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** | 水产养殖投入品记录核对（按投入品用量、休药期与起捕间隔核对记录自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** | 档案归档完整性与保管期限核对（依据《档案法》及配套规定，仅提示差异，不作出定性结论） |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | Automatic strong/cheap model-tier routing with deterministic risk guards and a `/tier` command |  |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | 🚫 RETIRED — see the repo README |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** | 投标文件符合性预检（按招标文件逐条核对响应情况，仅提示差异，不作出定性结论） |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** | 投标人资格条件核对（按资格条件与证明材料核对逐条响应，仅提示差异，不作出定性结论） |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | 🧊 FROZEN — see the repo README |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | Read-only MCP server exposing the certification registry: grades, snapshots and five-dimension evidence |  |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore |  |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | 🧊 FROZEN — see the repo README |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** | 合同条款立场台账核对（按立场、风险等级与退让底线核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** | 报关单证一致性核对（按公开的报关单填制规范核对单证间字段一致性，仅提示差异，不作出定性结论） |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) |  |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | 🧊 FROZEN — see the repo README |
| **[dsh-demurrage-ledger](https://github.com/PerryLink/dsh-demurrage-ledger)** | 滞箱费台账核对（按免箱期与费率核对超期天数与金额的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review |  |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | 🧊 FROZEN — see the repo README |
| **[dsh-drill-script-check](https://github.com/PerryLink/dsh-drill-script-check)** | 应急演练脚本核对（按阶段、响应分级、指挥与资源要素核对脚本齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-eia-guide-check](https://github.com/PerryLink/dsh-eia-guide-check)** | 环评导则适用性核对（按要素、导则名称与执行标准核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-emergency-plan](https://github.com/PerryLink/dsh-emergency-plan)** | 应急预案要素齐备性与条款级页码定位（依据 GB/T 29639-2020 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-essay-rubric-check](https://github.com/PerryLink/dsh-essay-rubric-check)** | 作文量表评分核对（按评分项、原文定位与分值算术核对评分自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-evidence-check](https://github.com/PerryLink/dsh-evidence-check)** | 证据清单齐备性核对（按待证事实与证据要素核对清单自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-export-ctl-check](https://github.com/PerryLink/dsh-export-ctl-check)** | 出口管制物项核对（按管制清单、最终用途与许可证核对台账齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** | Read-only performance diagnostics for DeepSeek Harness. |  |
| **[dsh-fmea-table-check](https://github.com/PerryLink/dsh-fmea-table-check)** | FMEA 分析表要素齐备性与风险顺序数一致性核对（按公开的 FMEA 方法标准核对表内自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-forecast-penalty](https://github.com/PerryLink/dsh-forecast-penalty)** | 预测准确率考核核对（按准确率、门槛与考核单价核对考核费用的算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** | Deterministic research reports for Chinese public mutual funds |  |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** | GitHub PR/issues integration for DSH, every write gated by approval |  |
| **[dsh-gongwen-flow-check](https://github.com/PerryLink/dsh-gongwen-flow-check)** | 公文流转与办理时限核对（按公开的公文处理规范核对环节完整性与时限，仅提示差异，不作出定性结论） |  |
| **[dsh-gongwen-word-check](https://github.com/PerryLink/dsh-gongwen-word-check)** | 公文格式要素核对（按公开的党政机关公文格式标准核对版头与主体要素，仅提示差异，不作出定性结论） |  |
| **[dsh-guard-plan-qc](https://github.com/PerryLink/dsh-guard-plan-qc)** | 劳动保护与安全防护用品配置表核对（按公开的配备标准核对品名规格与配置数量，仅提示差异，不作出定性结论） |  |
| **[dsh-hazchem-check](https://github.com/PerryLink/dsh-hazchem-check)** | 危险化学品临界量与重大危险源辨识核对（按储存量与临界量核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-hazplan-check](https://github.com/PerryLink/dsh-hazplan-check)** | HAZOP 分析表要素齐备性与偏差推导一致性核对（依据公开的危险与可操作性分析标准，仅提示差异，不作出定性结论） |  |
| **[dsh-hidden-risk-map](https://github.com/PerryLink/dsh-hidden-risk-map)** | 安全隐患台账→《工贸企业重大事故隐患判定标准》（应急管理部令第10号）条款映射提示（仅提示差异，不作出定性结论） |  |
| **[dsh-hs-classify](https://github.com/PerryLink/dsh-hs-classify)** | 商品归类层级一致性核对（按章、品目、子目与商品编号的层级关系核对自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-icd-rule-check](https://github.com/PerryLink/dsh-icd-rule-check)** | ICD 合并编码与星剑号配对提示（依据 GB/T 14396-2016 与公开的 ICD 使用说明，仅提示差异，不作出定性结论） |  |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** | Industry research orchestration that seals its deliverables through this plugin's `ctx.researchReport.assemble` |  |
| **[dsh-lawcite-adapter](https://github.com/PerryLink/dsh-lawcite-adapter)** | 法条引用与文书要素核对（按名称、条号、原文与效力状态核对引用可核验性，仅提示差异，不作出定性结论） |  |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** | Laya typed decisions (`noul`/`choice`/`score`) as a first-class Cordis service and model-visible tools |  |
| **[dsh-lc-doc-check](https://github.com/PerryLink/dsh-lc-doc-check)** | 信用证单据条款核对（按单据种类、份数、期限与不符点核对交单自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-learning-gap-check](https://github.com/PerryLink/dsh-learning-gap-check)** | 能力差距与培养计划核对（按能力等级差、培养措施与完成期限核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** | Local document knowledge base for DeepSeek Harness. |  |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** | Local-model (Ollama) integration for DeepSeek Harness. |  |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** | LSP diagnostics, formatting, completion, code actions and rename over language servers |  |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** | PII masking middleware: anonymize at the model boundary, restore at the display layer |  |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors |  |
| **[dsh-medrec-qc](https://github.com/PerryLink/dsh-medrec-qc)** | 病案首页形式质控与逻辑矛盾提示（依据国卫办医发〔2016〕24号等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool |  |
| **[dsh-nsfc-form-check](https://github.com/PerryLink/dsh-nsfc-form-check)** | 国家自然科学基金申请书形式审查与匿名化提示（依据《国家自然科学基金条例》与申请人导入的当年指南，仅提示差异，不作出定性结论） |  |
| **[dsh-nurse-record-check](https://github.com/PerryLink/dsh-nurse-record-check)** | 护理记录时限、签名与评估表完整性校验（依据《病历书写基本规范》等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** | OpenTelemetry and Langfuse observability exporter for DeepSeek Harness. |  |
| **[dsh-origin-rvc-check](https://github.com/PerryLink/dsh-origin-rvc-check)** | 原产地区域价值成分核对（按 RVC 定义式与门槛核对原产地判定自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-ota-review-check](https://github.com/PerryLink/dsh-ota-review-check)** | 在线点评回复台账核对（按回复时限、问题分类与整改状态核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** | Claude Code outputStyles-equivalent runtime style switching |  |
| **[dsh-paper-doc-adapter](https://github.com/PerryLink/dsh-paper-doc-adapter)** | 试卷解析结构核对（按题型、答案、分值与 yotta 标识核对试卷结构自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** | Claude Code-style declarative allow/deny/ask permission rules with audit |  |
| **[dsh-permit-report-check](https://github.com/PerryLink/dsh-permit-report-check)** | 行政许可办理核对（按申请材料、法定时限与决定记录核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-pipeline-check](https://github.com/PerryLink/dsh-pipeline-check)** | 项目全流程文件链条核对（按环节先后与金额口径核对链条自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-pleading-draft](https://github.com/PerryLink/dsh-pleading-draft)** | 起诉状要素齐备性核对（按诉请、事实、证据、法条四要素核对文书齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** | Zero-dependency static + sandbox smoke detector for DSH plugins |  |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** | Plugin-development knowledge base as an on-demand agent skill |  |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** | Shared zero-runtime-dependency toolkit for the PerryLink DSH plugins |  |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** | One-package, one-corridor-index plugin upgrade skill: routes a repository to the matching closed corridor card |  |
| **[dsh-policy-brief-draft](https://github.com/PerryLink/dsh-policy-brief-draft)** | 政策专报要素核对（按观点、依据、出处与建议核对专报齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-power-loss-split](https://github.com/PerryLink/dsh-power-loss-split)** | 线损电量拆分与考核表核对（依据公开的线损计算口径，仅提示差异，不作出定性结论） |  |
| **[dsh-power-ticket-check](https://github.com/PerryLink/dsh-power-ticket-check)** | 电力工作票要素齐备性与签发许可顺序核对（依据现行电力安全工作规程，仅提示差异，不作出定性结论） |  |
| **[dsh-ppap-check](https://github.com/PerryLink/dsh-ppap-check)** | PPAP 提交要素齐备性核对（按公开的 PPAP 手册与提交等级核对要素齐备与版本填写，仅提示差异，不作出定性结论） |  |
| **[dsh-protest-deadline](https://github.com/PerryLink/dsh-protest-deadline)** | 质疑与投诉期限核对（按公开的政府采购质疑投诉规定核对期限与台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-railway-window](https://github.com/PerryLink/dsh-railway-window)** | 铁路施工天窗台账核对（按时间窗、时长算术与命令号核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | Multi-channel approval/question bridge: WeChat/Telegram/Feishu, session console | 🧊 FROZEN — see the repo README |
| **[dsh-repair-order-qc](https://github.com/PerryLink/dsh-repair-order-qc)** | 维修工单结算核对（按项目金额、配件工时合计与结算总额核对算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions |  |
| **[dsh-review-reply-check](https://github.com/PerryLink/dsh-review-reply-check)** | 审稿意见逐条回应覆盖核对（按意见与回应一一对应核对覆盖完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-rulefile-check](https://github.com/PerryLink/dsh-rulefile-check)** | 规则库文件自检核对（按条款引用纪律与效力上限核对规则库自身合规，仅提示差异，不作出定性结论） |  |
| **[dsh-safety-brief-check](https://github.com/PerryLink/dsh-safety-brief-check)** | 安全技术交底记录要素齐备性与签字闭环核对（依据公开的安全生产法规与检查标准，仅提示差异，不作出定性结论） |  |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. |  |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | 🚫 RETIRED — see the repo README |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. |  |
| **[dsh-site-log-check](https://github.com/PerryLink/dsh-site-log-check)** | 监理日志跨日连续性与旁站覆盖提示（依据 GB/T 50319-2013 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review |  |
| **[dsh-soe-decision-check](https://github.com/PerryLink/dsh-soe-decision-check)** | 三重一大决策台账核对（按前置研究、会议审议与决议记录核对程序留痕，仅提示差异，不作出定性结论） |  |
| **[dsh-soilwater-check](https://github.com/PerryLink/dsh-soilwater-check)** | 土壤与地下水监测台账核对（按点位、监测项目、限值与超标判定核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-sop-sync-check](https://github.com/PerryLink/dsh-sop-sync-check)** | 作业规程与 FMEA／控制计划一致性核对（按编号与版本核对三份文件是否同步，仅提示差异，不作出定性结论） |  |
| **[dsh-spc-gbt-adapter](https://github.com/PerryLink/dsh-spc-gbt-adapter)** | 控制图常数与过程能力指数核对（按 GB/T 4091 的常规控制图常数表核对控制限与 Cp/Cpk 的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. |  |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | Cross-session team rooms: shared message bus, task board and timeline | 🚫 RETIRED — see the repo README |
| **[dsh-tender-extract](https://github.com/PerryLink/dsh-tender-extract)** | 招标文件条款摘录核对（按出处与原文逐字核对摘录完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-tender-matrix](https://github.com/PerryLink/dsh-tender-matrix)** | 评标因素评分矩阵核对（按分值上限与合计核对矩阵自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** | Isolated install-and-smoke test drives for DeepSeek Harness plugins. |  |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | TickTick/Dida365 task bridge: session-header panel + 11 tools |  |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** | Vendor parameter translation and deterministic JSON repair for DeepSeek Harness. |  |
| **[dsh-warranty-calc](https://github.com/PerryLink/dsh-warranty-calc)** | 质保期与索赔金额核对（按质保期月数与里程、索赔金额算式核对自洽，仅提示差异，不作出定性结论） |  |

</details>

</details>

</details>

### Install from the DSH Desktop Market

All PerryLink plugins are browsable in the built-in DSH Desktop Market: **Market → Sources → add source → paste** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ select it**. Installation still goes through the Market's npm-identity verification and your confirmation.

## License

[Apache License 2.0](LICENSE) © 2026 dsh-permission-rules contributors
