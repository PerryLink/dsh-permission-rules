<div align="center">

# 🛡️ dsh-permission-rules

**Claude Code-style declarative permission rules for DeepSeek Harness.**

*Rules decide what is known. A reviewer model decides what is not.*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![Tests](https://img.shields.io/badge/tests-58%20passed-success.svg)](#development)
[![Version](https://img.shields.io/badge/version-0.1.0-informational.svg)](package.json)

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
- ✅ **Rich matching** — tool-name globs (including `mcp__*`), argument key/value globs **or** regexes, workspace-relative path globs
- ✅ **Waterfall-safe** — `allow`/passthrough always call `next()`; only `deny`/`ask` short-circuit
- ✅ **Official approval seam** — `ask` flows through `ctx.approval`; never re-implemented, never bypassed
- ✅ **Full audit** — `permissionRules/decision` events for every hit and passthrough
- ✅ **Hot reload** — Chokidar watch with debounce; a broken edit keeps the previous rules, never crashes
- ✅ **Fail loud** — invalid YAML, unknown actions, bad globs/regexes, or > `maxRules` fail the load
- ✅ **Bounded hot path** — precompiled matchers, O(rules × patterns), capped by `maxRules`

## Quick start

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add "github:PerryLink/dsh-permission-rules#main"

# or from a packed tarball (built artifacts, no build permission needed)
pnpm pack
dsh plugin --profile web add ./dsh-permission-rules-0.1.0.tgz

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
| `maxRules` | `256` | Hard cap on rule count; larger files fail the load |
| `patternMode` | `glob` | `params`/`paths` pattern flavor: `glob` or `regex` (tool names are always globs) |
| `watch` | `true` | Chokidar watch + reload on change |
| `watchStabilityThresholdMs` | `200` | Reload debounce window (ms) |

### Session commands

```
/rules           list the active rules, their source file, and any last-reload error
/rules reload    re-read the rule file for this workspace
```

Command output is UI-only — the model learns the rules only through the tool results they produce.

## Collaborating with dsh-auto-review

- `dsh-permission-rules` produces `ask`; `dsh-auto-review` answers on the `approval/request` waterfall with a read-only second-model verdict (or delegates to humans). Mount both for the full closed loop.
- Integration-tested (`test/integration.spec.ts`): `permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`, with the reviewer replaced by a scripted mock.
- The `never` approval policy and every fail-closed guarantee of the [official harness](https://github.com/deepseek-ai/deepseek-harness) stay untouched.

## Security boundaries

- **Policy, not a kernel.** `paths` candidates come only from a documented set of argument keys, and only workspace-relative paths match.
- **No reviewer here.** The plugin never spawns subagents or calls models — producing an `ask` decision is the end of its work.
- **No sandbox changes.** OS-level sandbox policy belongs to the sandbox seam, not this plugin.
- **Loud misconfiguration.** Unknown YAML fields, unknown actions, and bad patterns are rejected at load, never silently ignored.

## Related work

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) — two-state allow/deny classifier with its own file-log audit; this plugin adds the full three-state semantics, declarative YAML rules, session-log audit, and `next()`-safe delegation.
- `Drifter-yh/dsh-tool-policy` — deny-by-default tool policy; documented here to avoid duplicate implementation.
- `dsh-auto-review` — the AI-backstop half of the loop this plugin fronts.

## Known limitations

- Out-of-repo session events (`permissionRules/decision`) are rejected by first-party readers that do not know the type — loud, not silent (the harness's pre-release stance; shared by all out-of-repo plugin events).
- `paths` candidates are heuristic: only documented argument keys feed path matching.
- Globs are a conservative subset (no brace expansion) — write two patterns, or use regex mode.

## Development

```sh
pnpm install        # node ^22.19 || >=24
pnpm run typecheck  # tsc, src + tests
pnpm test           # vitest: 58 tests, 7 suites
pnpm run build      # tsc declarations + tsdown bundles (lib/)
pnpm pack           # publish artifact
```

See [VERIFICATION.md](VERIFICATION.md) for the headless end-to-end verification record (deny blocking a shell tool, ask routing through the approval seam, `--dump-config`).

## License

[Apache License 2.0](LICENSE) © 2026 dsh-permission-rules contributors
