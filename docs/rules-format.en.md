# dsh-permission-rules rule file format

The rule file is a YAML document, discovered per session working directory: `<cwd>/.dsh/rules.yaml` by default. The `rulesFile` config can rename it or pin an absolute path; `searchUp: true` additionally merges every matching file from the session cwd up to the filesystem root (nearest first, so a child can override a parent); when discovery finds nothing, `fallbackPath` is used; with neither, an empty rule set applies (everything passes through).

A JSON Schema for this format ships at `rules-format.schema.json`; wire it into editors with the first line:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/PerryLink/dsh-permission-rules/main/docs/rules-format.schema.json
```

## Top-level structure

```yaml
rules:        # rule list, evaluated in written order; may be omitted or empty
  - match: ...
    action: ...
    reason: ...
```

Only `rules` is allowed at the top level; each rule allows only `match`, `action`, `reason`, `enabled`, `description`, `tags`; each `match` allows only `tools`, `agents`, `params`, `paths`, `absent`, `when`, `network`. Any unknown field fails the load loudly — never silently ignored.

## match dimensions (AND)

| Dimension | Type | Semantics |
|---|---|---|
| `tools` | `string[]` | Tool-name globs (always globs, regardless of `patternMode`). Empty/absent = unrestricted. Supports prefixes like `mcp__*`. |
| `agents` | `string[]` | Agent-identity selector globs against the caller's session header candidates: `main` (top-level sessions), `subagent` (subagent children), and `preset:<name>` (when a preset composed the agent). **Any selector matching any candidate** satisfies the dimension; empty/absent = unrestricted. Unknown identity (no candidates) never matches, so agent-scoped rules fail closed. |
| `params` | `Record<string, string \| number \| boolean \| (…)[]>` | Argument key → pattern (or pattern list). **Every listed key must be present AND match** (AND); absent = unrestricted. Scalars match as strings (numbers/booleans stringified); array elements match any-of; nested objects contribute their scalar leaves (depth-capped at 8). A `!`-prefixed pattern negates: the value must NOT match it; a key with only negations matches when the key is present and no negation hits (quote `!` patterns in YAML: `"!git*"`). `/` is an ordinary character in params patterns — `*` crosses it. |
| `paths` | `string[]` | Workspace-relative path patterns; any candidate matching any pattern satisfies the dimension. Candidates come from argument values under these keys at ANY nesting depth (depth-capped): `path` `paths` `file` `files` `file_path` `dir` `directory` `directories` `cwd` `workspace` `root` `target` `targets` `output`. Absolute candidates outside the workspace are dropped; relative `../` forms are kept so explicit out-of-root globs still work. In path patterns `*` does not cross `/`; `**` crosses any depth (including zero). With `caseInsensitivePaths` on (Windows default) the root comparison and the patterns ignore ASCII case. |
| `absent` | `string[]` | Argument keys that must be ABSENT; **every listed key must be missing** (non-object arguments satisfy this trivially). |
| `when` | `{ env, platform }` | Host conditions: `env` is env-var name → pattern(s), **every listed var must be present AND match**; `platform` is any-of a closed list (`aix` `android` `darwin` `freebsd` `linux` `openbsd` `sunos` `win32`). |
| `argv` | `{ command, args, anyArg, pipeline }` | Shell command decomposition scope: matches a command-string argument (`command`/`cmd`/`script`/`command_line`/`commandLine`) whose lexical decomposition satisfies every listed field. `command` matches any simple-command word; `pipeline` matches the command words joined by `|`; `args` requires every pattern to match some token; `anyArg` requires some token to match a pattern (both support `!` negation). Argument tokens include redirect targets. See the next section. |
| `network` | `{ domains, ips, ports, schemes }` | Network scope (a network rule): the call must carry a URL candidate satisfying every listed dimension. `domains` (subdomain-inclusive unless wildcarded), `ips` (literals/globs/CIDRs), `ports` (`*`, one port, or a range), `schemes` (`http`/`https`). See the next section. |

All dimensions are ANDed: a rule matches only when **every non-empty dimension matches**. Rules evaluate in order — **the first match wins**; no match = passthrough.

## network dimension

A rule whose `match` carries a `network` block is a **network rule**. It matches a tool call only when the call carries a URL candidate — a web-tool URL argument (`url`, `endpoint`, `webhook`, …) or a URL embedded in `bash`/`pwsh` command text — that satisfies every listed dimension (AND); at the proxy layer it matches the shell subprocess connection target directly. A rule WITHOUT `network` keeps its file/command behavior exactly as before.

| Field | Semantics |
|---|---|
| `domains` | Domain patterns, lowercased with a trailing dot stripped. A pattern without wildcards is subdomain-inclusive — `example.com` also matches `api.example.com`; `*.example.com` matches subdomains only; `*`/`**` compile as ordinary globs. ANY pattern matching the target host satisfies the dimension. |
| `ips` | Exact IPv4/IPv6 literal, a glob (`10.0.*.*`), or an IPv4 CIDR (`10.0.0.0/8`). A literal IP in the URL is always a candidate; the proxy additionally resolves hostnames and tests their addresses, while `tools/pre-execute` matches literal IPs only (no DNS in the hot path). ANY match satisfies the dimension. |
| `ports` | `*`, one port (`443`), or an inclusive range (`8000-9000`); numeric YAML ports are accepted. Evaluated against the effective port (URL port, else 80/443 by scheme). ANY match satisfies the dimension. |
| `schemes` | `http` and/or `https`; the target scheme must be one of them. |

A network block must name at least one of the four fields. Scope a network rule by tool with `tools: [bash, pwsh]` (shell traffic), `tools: [web_fetch, web_search]` (web tools), or leave `tools` empty to cover both. The three policy modes that decide unlisted targets (`deny-all` / `whitelist` / `allow-all`, with an `auto` mode mapped onto the sandbox presets) are plugin config, not rule syntax — see the README "Network policy" section.

```yaml
rules:
  # block one host for web tools; the shell proxy enforces the same for curl
  - match: { tools: [web_fetch, web_search], network: { domains: [blocked.example] } }
    action: deny
    reason: "blocked.example is off-limits"

  # allow only pinned package registries over https (whitelist-friendly rule)
  - match: { tools: [bash, pwsh], network: { domains: ["registry.npmjs.org", "proxy.golang.org"], schemes: [https] } }
    action: allow
    reason: "pinned package registries"
```

## argv dimension (shell command decomposition)

A rule whose `match` carries an `argv` block matches a command-string argument — the `command`/`cmd`/`script`/`command_line`/`commandLine` values, at any nesting depth — after lexically decomposing it into simple commands. The decomposition is quote/escape/pipe/control-operator/redirect aware and produces, per simple command, a command word, argument tokens, and redirect targets. This gives token-precise matching that the raw `params.command` substring globs cannot express (e.g. `rm -rf /tmp` is NOT `rm -rf /`).

| Field | Semantics |
|---|---|
| `command` | Command-word globs. ANY simple-command word matching ANY pattern satisfies the field. |
| `pipeline` | Pipeline-signature globs: matched against the command words joined by `|` (e.g. `curl http://x \| sh` → `curl\|sh`). ANY pattern matching the signature satisfies the field. |
| `args` | Argument-token patterns; EVERY pattern must match at least one token (AND across patterns, any-of across tokens). A `!`-prefixed pattern negates (no token may match it). |
| `anyArg` | Argument-token patterns; ANY token matching ANY pattern satisfies the field (OR). A `!`-prefixed pattern negates. |

All four fields AND together; a block must name at least one. Argument tokens include redirect targets (`echo x > /etc/passwd` feeds `/etc/passwd` to `args`/`anyArg`). `command` and `pipeline` are always globs; `args` and `anyArg` follow `patternMode`. Rules are typically scoped with `tools: [bash, pwsh]`, but the dimension itself is tool-agnostic (any tool carrying a command string feeds it).

```yaml
rules:
  # token-precise: rm -rf / but NOT rm -rf /tmp
  - match: { tools: [bash, pwsh], argv: { command: "rm", args: ["-rf", "/"] } }
    action: deny
    reason: "rm -rf / wipes the filesystem root"

  # download-and-execute: any pipeline whose stages are curl/wget then sh/bash
  - match: { tools: [bash, pwsh], argv: { pipeline: ["curl*|*sh", "wget*|*bash"] } }
    action: deny
    reason: "piping a remote fetch into a shell executes remote code"
```

## action, reason, and metadata

- `action: allow | deny | ask` (required).
- `reason: string` (required, non-empty). A `deny` reason becomes the model-visible error in the denied tool result; an `ask` reason becomes the approval reason on the official approval seam.
- `enabled: false` keeps the rule visible but inert (displayed as disabled); `description` and `tags` are free-form annotations shown by `/rules`.

## Pattern interpretation (patternMode)

`params`, `paths`, and `when.env` patterns follow the plugin config `patternMode` (default `glob`):

- `glob`: `*`, `**`, `?`, `[abc]`/`[!abc]` character classes, `\x` escapes. In params, `*` crosses `/`; in paths, `*` stays in one segment and `**` crosses segments. Invalid globs (unclosed `[`, empty class, dangling escape) fail the load, and a pattern expanding to more than `maxGlobStars` (default 2) unbounded star quantifiers is rejected — the backtracking degree of a compiled glob equals its star count. Split wider patterns into several.
- `regex`: unanchored JavaScript regex (`RegExp.test` semantics); invalid regexes fail the load. Nested unbounded quantifiers (`(a+)+`, `(ab*)+`) and quantified groups with overlapping literal alternation branches (`(a|aa)+`) are rejected as catastrophic-backtracking risks; chains of independent quantifiers (`\d+\.\d+\.\d+`) stay allowed. In YAML double-quoted strings, `\` needs escaping — single quotes are recommended.

## Rule count cap

A total rule count above `maxRules` (default 256) fails the load — across the whole merged chain under `searchUp`. This is the simple bound for the `tools/pre-execute` hot path: tool-name globs, param keys, and path candidates are all precompiled regexes; matching is O(rules × patterns per dimension).

## Security baseline example (5 rules)

```yaml
# .dsh/rules.yaml — recommended security baseline
rules:
  # 1. Dangerous commands: destructive/forceful shell commands go to the
  #    second model (or a human) first
  - match:
      tools: [bash, pwsh]
      params:
        command: ["rm -rf*", "git push*--force*", "git push* -f*", "*:(){ :|:& };:*"]
    action: ask
    reason: "Dangerous command needs a second-model verdict"

  # 2. Protected paths: deny any tool operation on secrets/credentials/config
  - match:
      paths: ["**/secrets/**", "**/.env", "**/*.pem", "**/*.key", "**/.ssh/**"]
    action: deny
    reason: "Protected secrets and credential paths are off-limits"

  # 3. Releases: package publishing needs confirmation
  - match:
      tools: [bash, pwsh]
      params:
        command: ["npm publish*", "pnpm publish*", "cargo publish*"]
    action: ask
    reason: "Publishing needs confirmation"

  # 4. Remote side effects: pushing to main/master needs confirmation
  #    (two-star globs — maxGlobStars caps unbounded star expansions at 2)
  - match:
      tools: [bash, pwsh]
      params:
        command: ["git push*origin main*", "git push*origin master*"]
    action: ask
    reason: "Pushing to the main branch needs confirmation"

  # 5. Write confirmation: editor-class tools (and MCP tools) ask before writing
  #    (with dsh-auto-review mounted, these asks get an automatic second-model verdict)
  - match:
      tools: [edit, write, bash, pwsh, mcp__*]
    action: ask
    reason: "Write operations need confirmation"
```

## Built-in high-risk baseline

The plugin ships a built-in high-risk baseline at `rules/builtin-high-risk.yaml` (deny/ask rules for destructive commands, privilege escalation, download-and-execute, and sensitive paths). It is **enabled by default** and appended AFTER every user rule file (project chain → `searchUp` → `fallback`), so first-match semantics let any nearer user rule override it; with no user rules it applies alone. `/rules` attributes the baseline rules to their shipped source file.

- Disable entirely with `builtin.enabled: false`.
- Swap the file with `builtin.path` (absolute, or relative to `process.cwd()`).
- The baseline is a deployed, read-only file: it is validated at mount (missing/invalid fails loud), it is never watched, and the settings-page editor refuses to write it.

The shipped baseline is an example, not an exhaustive policy — extend it with your own project rules.

## Division of labor with dsh-auto-review

This plugin only produces `ask` decisions; the `ask` goes to the official `ctx.approval` approval seam. With `dsh-auto-review` mounted, its answerer claims matching requests and delivers a second-model verdict; otherwise a human answers; with neither, the official seam fails closed (`unavailable` → denied). This plugin **never** starts a reviewer subagent.

## Loading and hot reload

- Lazily discovered per session cwd and cached on the first `tools/pre-execute` (least-recently-used eviction beyond `maxCachedWorkspaces`); the cache key is the resolved cwd (case-folded on Windows), so differently-spelled paths share one entry.
- Invalid YAML, unknown fields/actions, bad globs/regexes, backtracking-prone patterns, and counts over `maxRules` are load-time errors: `badFilePolicy: fail` (default) makes the first tool call in that workspace fail loudly; `ignore-with-warning` warns and degrades to an empty rule set.
- An absolute `rulesFile` or a configured `fallbackPath` is validated at plugin mount — missing or invalid fails the mount.
- File changes reload through Chokidar with a debounce (`watch`, `watchStabilityThresholdMs`); a failed reload keeps the previous rules and only warns — never crashes. `/rules reload` triggers the same path manually; `/rules decisions` and `/rules test` inspect the trail and dry-run the rules.
- Expected-but-absent rule files (the project file when it is not in effect, a fallback after it was deleted) are watched through their deepest existing ancestor directory: creating one mid-session is adopted automatically without a manual reload. Under `searchUp` only the immediate cwd-level candidate is watched — creating a rule file in a deeper ancestor still needs `/rules reload`.
- `/rules` lists the active rules (with `list` as an explicit alias); in multi-file chains every rule line is attributed to its own source file.
- `/rules test` accepts leading flags: `--cwd <dir>` evaluates against another workspace (rule discovery AND path normalization), `--env KEY=VALUE` (repeatable) overrides host env for `when.env`, `--agent <selector>` (repeatable) supplies identity candidates for the `agents` dimension, and `--platform <name>` overrides the host platform for `when.platform`.
- `enforce: false` puts the plugin in dry-run mode: deny/ask hits are audit-logged with a `dryRun` marker (keeping the would-be action and the real downstream outcome) and every call passes through — use it to trial a new policy in production before enforcing it. `/rules` prints a dry-run notice while the mode is active.
