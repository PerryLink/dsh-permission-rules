# dsh-permission-rules rule file format

The rule file is a YAML document, discovered per session working directory: `<cwd>/.dsh/rules.yaml` by default. The `rulesFile` config can rename it or pin an absolute path; when discovery finds nothing, `fallbackPath` is used; with neither, an empty rule set applies (everything passes through).

## Top-level structure

```yaml
rules:        # rule list, evaluated in written order; may be omitted or empty
  - match: ...
    action: ...
    reason: ...
```

Only `rules` is allowed at the top level; each rule allows only `match`, `action`, `reason`; each `match` allows only `tools`, `params`, `paths`. Any unknown field fails the load loudly — never silently ignored.

## match dimensions (AND)

| Dimension | Type | Semantics |
|---|---|---|
| `tools` | `string[]` | Tool-name globs (always globs, regardless of `patternMode`). Empty/absent = unrestricted. Supports prefixes like `mcp__*`. |
| `params` | `Record<string, string \| number \| boolean \| (…)[]>` | Argument key → pattern (or pattern list, any-of). **Every listed key must be present AND match** (AND); absent = unrestricted. Scalar values match as strings (numbers/booleans stringified); array values match if any element matches; object values never match. `/` is an ordinary character in params patterns — `*` crosses it. |
| `paths` | `string[]` | Workspace-relative path patterns; any candidate matching any pattern satisfies the dimension. Candidates come from top-level argument values under these keys (strings, or string elements of arrays): `path` `paths` `file` `files` `file_path` `dir` `directory` `directories` `cwd` `workspace` `root` `target` `targets` `output`. Absolute candidates outside the workspace are dropped; relative `../` forms are kept so explicit out-of-root globs still work. In path patterns `*` does not cross `/`; `**` crosses any depth (including zero). |

The three dimensions are ANDed: a rule matches only when **every non-empty dimension matches**. Rules evaluate in order — **the first match wins**; no match = passthrough.

## action and reason

- `action: allow | deny | ask` (required).
- `reason: string` (required, non-empty). A `deny` reason becomes the model-visible error in the denied tool result; an `ask` reason becomes the approval reason on the official approval seam.

## Pattern interpretation (patternMode)

`params` and `paths` patterns follow the plugin config `patternMode` (default `glob`):

- `glob`: `*`, `**`, `?`, `[abc]`/`[!abc]` character classes, `\x` escapes. In params, `*` crosses `/`; in paths, `*` stays in one segment and `**` crosses segments. Invalid globs (unclosed `[`, empty class, dangling escape) fail the load.
- `regex`: unanchored JavaScript regex (`RegExp.test` semantics); invalid regexes fail the load. In YAML double-quoted strings, `\` needs escaping — single quotes are recommended.

## Rule count cap

A rule count above `maxRules` (default 256) fails the load. This is the simple bound for the `tools/pre-execute` hot path: tool-name globs, param keys, and path candidates are all precompiled regexes; matching is O(rules × patterns per dimension).

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
  - match:
      tools: [bash, pwsh]
      params:
        command: ["git push*origin*main*", "git push*origin*master*"]
    action: ask
    reason: "Pushing to the main branch needs confirmation"

  # 5. Write confirmation: editor-class tools (and MCP tools) ask before writing
  #    (with dsh-auto-review mounted, these asks get an automatic second-model verdict)
  - match:
      tools: [edit, write, bash, pwsh, mcp__*]
    action: ask
    reason: "Write operations need confirmation"
```

## Division of labor with dsh-auto-review

This plugin only produces `ask` decisions; the `ask` goes to the official `ctx.approval` approval seam. With `dsh-auto-review` mounted, its answerer claims matching requests and delivers a second-model verdict; otherwise a human answers; with neither, the official seam fails closed (`unavailable` → denied). This plugin **never** starts a reviewer subagent.

## Loading and hot reload

- Lazily discovered per session cwd and cached on the first `tools/pre-execute`.
- Invalid YAML, unknown actions, bad globs, and counts over `maxRules` are load-time errors: `badFilePolicy: fail` (default) makes the first tool call in that workspace fail loudly; `ignore-with-warning` warns and degrades to an empty rule set.
- An absolute `rulesFile` or a configured `fallbackPath` is validated at plugin mount — missing or invalid fails the mount.
- File changes reload through Chokidar with a debounce (`watch`, `watchStabilityThresholdMs`); a failed reload keeps the previous rules and only warns — never crashes. `/rules reload` triggers the same path manually.
