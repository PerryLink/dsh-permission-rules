## v0.7.0 - 2026-09-10

### Added

- `network.upstreamProxy` — chain the connections this plugin **allows** through an upstream proxy: `off` (default — allowed connections dial directly), `inherit` (reuse the proxy names from the launch environment), or an explicit `http(s)://` proxy URL. CONNECT requests are chained by asking the upstream for a tunnel (`CONNECT host:port`); plain-HTTP requests are forwarded to the upstream in absolute form. A SOCKS (`socks:`/`socks5:`), non-http(s), blank or unparseable value fails the mount with a `TypeError` naming `network.upstreamProxy` (Node has no SOCKS client, so SOCKS is refused rather than attempted).
- `/rules network` renders one `Upstream: …` line and the settings page one `Upstream` row, both fed by the new `upstream` block of `networkSnapshot()`: `mode` (`off` | `inherit` | `url`), the redacted `http`/`https` candidates, `active`, and the `chained` counter.
- Settings-page **"allow this host"** action (issue #19 item 3): every recent interception now offers an **Allow** button that writes ONE minimal `match: { network: { domains: [<host>] } }` / `action: allow` rule at index 0 of the nearest rule file that actually judges that connection — the project file of the workspace the block was attributed to, or, for a session-less host-level block, the file the host chain resolves — preserving the file's comments and untouched rules. The rule goes at the head because rules are first-match-wins; the write re-reads the workspace chains AND invalidates the session-less host chain, so it takes effect immediately with no restart. The decision is recomputed after the write, so the page reports the REAL outcome (an already-allowed target writes nothing; a write that leaves the target blocked reads as a failure, never a success). It refuses, leaving the file untouched, an unknown workspace, a target outside `knownRuleSources()`, the read-only built-in baseline, and a file it cannot read or parse. The new `permissionRules/allowHost` RPC accepts a workspace `cwd`, never a path, so it has exactly the same write boundary as `rulesSave` and grants no new capability.
- `network.allowHostAction` (default `true`) — switches the settings-page allow action off: the Allow button is hidden and the `permissionRules/allowHost` RPC refuses. The page's rule editor is unaffected (it is deliberately wider: it writes arbitrary rule text).

### Security

- Two cases never chain even when an upstream is configured: a **loopback** target (a proxy outside this host cannot route its loopback) and any decision produced by an **`ips`-scoped rule** (chaining hands the hostname to the upstream, so the issue #21 invariant — the connection lands on an address the rules saw — would stop holding exactly where the rules cared about the address; those decisions keep dialing the adjudicated address directly). A target whose scheme has no usable upstream is not chained either. A blocked target never reaches the upstream: it still gets this plugin's structured 403.
- An upstream URL carrying credentials is never emitted raw: warnings, `/rules network` and the settings snapshot print it through `redactProxyUrl` with the password masked (`http://user:***@host:port`).
- A configured upstream that points at this proxy's own bind address and port is treated as a self-loop: chaining is disabled for it and warned about once, instead of recursing into this proxy.
- An unreachable upstream, a timeout (10 s), or a non-2xx answer from the upstream yields **502** — deliberately no silent fallback to a direct dial, so a misconfiguration stays visible.

### Fixed

- An ambient proxy used to be discarded silently when `network.upstreamProxy` was `off` (the default): the plugin now logs one warning saying the ambient proxy is discarded for traffic through this proxy (it is still exported to subprocesses). `inherit` warns too when `injectEnv` is false or when the launch environment named nothing usable.

## v0.6.21 - 2026-09-10

### Fixed

- The session-less host chain no longer survives an explicit reload, so a corrected rule takes effect without restarting the process. `hostLoaded` was cached for the lifetime of the mount, and that chain is deliberately neither a `byCwd` member nor watched, so neither `reloadAll()` nor `saveRuleFile()` ever reached it — and the settings page (which drives `reloadAll()`) is the one surface usable while no session has run a tool call, i.e. exactly the window in which this chain is what judges traffic. `invalidateHostChain()` now drops the cache and re-arms the one-shot warning, and is called from `reloadAll()`, `saveRuleFile()` and `onNetworkConfigChanged()` (the last because `rulesFile` and `fallbackPath` are inputs to the chain, so a config change must not reuse a chain built from the previous one). The new test asserts both the stale read and the refreshed one, and removing the invalidation makes it fail.

## v0.6.20 - 2026-09-10

### Fixed

- **Corrected the mechanism by which this plugin participates in host networking (issue #22).** The five READMEs, `AGENTS.md` and the v0.6.19 note claimed that the process-wide injected proxy environment also placed the harness's own LLM transport under this policy. Measurement on 2026-09-10 (Node 22; `scripts/host-egress-probe.mjs`) shows it does not: the launcher installs undici's global dispatcher from the **launch environment** before the first plugin mounts, that dispatcher routes by its policy rather than by the environment, and Node samples the proxy environment at start — so a mid-process `process.env` write reaches neither `fetch` nor `node:http`. The injection covers spawned shell children, which is what it was always for. The READMEs' known-limitations bullet now says so, and the `llm/stream` annotation shipped in v0.6.19 is recorded as inert: it can only fire when a blocked child-process connection coincides within its window with an unrelated model failure, so it misattributes rather than diagnoses — it has been **removed in this release**, along with its registration, its block-window helper, the type import it needed, and its four tests.

## v0.6.19 - 2026-09-10

### Security

- A CONNECT tunnel refuses to dial a hostname when the adjudication resolved no address: `connectUpstream` now fails closed (logged, 502 to the client) instead of falling back to `connect(port, target.host)` — a second DNS resolution whose answer the rules never saw, and the one remaining path governed by Node's 250 ms `autoSelectFamilyAttemptTimeout`. The reported path itself was already fixed in 0.6.17 (`connect` dials the addresses `decideWithResolution` returned, and an IP literal skips the family race entirely); this closes the residual (issue #21).

### Fixed

- Session-less host-level traffic is judged against the CONFIGURED chain instead of an empty map. `proxyChains()` consulted only `byCwd`, which `rulesFor(cwd)` populates from a session or tool call, so at boot the harness's own host-level fetches met the whitelist default and were blocked as `[network: blocked pending approval]` even with a matching allow rule already configured. `hostChain()` loads the chain for the host process's own working directory (project file → absolute `rulesFile` → configured fallback → shipped baseline) while no per-cwd chain is loaded; it never becomes a `byCwd` member, so a session workspace chain always outranks it, and an unusable configured chain warns once and degrades to the mode default (issue #18).
- Rule files are normalized before parsing: CRLF maps onto LF, a stray CR inside a line is dropped, and every CR is a line separator in a CR-only file. A lone CR is not a line break to the YAML parser in every position — it survived into the scalar it terminated (`domains: [registry.npmjs.org\r]`, or a final line ending in a bare CR), compiling a pattern that silently never matched its target (issue #19 item 4).
- Rule-file watches poll on WSL drvfs mounts: `watchPollingFor` switches a watch to `usePolling` (300 ms interval) when the watched rule file is under `/mnt/<drive>` or `/proc/version` reports a Microsoft kernel, because chokidar's native change events are unreliable on drvfs/9p and a rule edit otherwise stopped hot-reloading silently with no error. Detection is per watch, so every other host keeps the native watcher, and `/rules reload` stays the manual fallback (issue #19 item 1).

### Added

- A failing model call now names the policy. The injected proxy environment is process-wide, so the harness's own LLM transport is adjudicated by this policy too, and a blocked provider endpoint surfaced as a bare `Connection error. / TRANSPORT`. A transparent `llm/stream` listener appends the `[network: …]` marker — blocked target, mode/rule, remediation — to the ORIGINAL error object (its class, code and retry facts stay intact) and logs it, so a turn can be attributed to the policy rather than reading as a provider outage. It registers only when `network.enabled`. It does NOT auto-allow provider endpoints: the two other resolutions the issue offers are not reachable from a plugin (`ctx.llm.listProviders()` exposes provider ids/names only, configured base URLs are adapter-owned, and there is no per-spawn environment seam for shell children), which the five READMEs record as a known limitation (issue #22).

### Tests

- Gate chain green: 23 files / 302 tests, coverage 92.27% statements / 87.29% branches / 93.62% functions.

## v0.6.18 - 2026-09-10

### Docs

- Five-language READMEs: the network-policy "Matching" bullet now states that IPv4-mapped IPv6 literals are normalized to their IPv4 form before matching, and that the proxy connects on the addresses the decision was made on (never a second DNS resolution). Republished so the npm page carries the updated READMEs.

### Tests

- No behavior change in this version: it republishes the 0.6.17 code (which already contains the network hardening below) with the refreshed documentation. Gate chain re-run green (285 tests, 23 files).

## v0.6.17 - 2026-09-10

### Security

- **Hardening: the proxy now connects on the adjudicated address, never a second DNS resolution.** The proxy adjudicated a hostname on one `lookup()` and then connected by hostname, re-resolving — a hostname whose answers change between adjudication and connect (DNS rebinding, CWE-367) could reach an address the rules never approved. `decideWithResolution` now returns the target carrying the resolved addresses, CONNECT tunnels try those addresses in order (a 502 when none accepts), and the plain-HTTP forward pins `http(s).request` with a `lookup` answering from the same list, so a multi-address host keeps its fallbacks through happy-eyeballs ordering. End-to-end guards live in `test/proxy.spec.ts` (plain HTTP and CONNECT, literal and CIDR `ips` rules, plus named-target forwarding); `AGENTS.md` and both `rules-format` docs record the behavior.

### Changed

- Pin the `@deepseek-ai/dsh-*` dev/test dependencies to the published `0.1.5-rc.1` line and record `0.1.5-rc.1` in `dshWorkshop.compatibility.dshVersions`; the monthly Compat workflow now runs against `0.1.5-rc.1`. The peer range `>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0` is unchanged, so no supported host line is dropped.
- Vendor integration tarball updated to `dsh-auto-review` 0.12.2 (`vendor/dsh-auto-review-0.12.2.tgz`, packed from the sibling repo at tag `v0.12.2`; the packed `files` are byte-identical to that tag's checkout), with the devDependency `file:` specifier and `pnpm-lock.yaml` refreshed. The sibling's runtime `@deepseek-ai/dsh-*` pins now follow the `0.1.5-rc.1` host line, matching this repo's dev peers. The six historical vendor tarballs (`0.9.0`–`0.12.1`) stay in the tree.

### Docs

- Refresh the five-language README compatibility baseline to `dsh-v0.1.5-rc.1` (verified 2026-09-10).

## v0.6.16 - 2026-09-09

### Security

- **Fixed: an IPv4-mapped IPv6 literal bypassed `ips` rules.** `isIpLiteral()` classifies any host containing `:` as an IPv6 literal, while `ipMatches()` compared literal patterns by exact string equality and CIDR patterns with an IPv4 dotted-quad regex. A target spelled `::ffff:169.254.169.254` (or the hex form `::ffff:a9fe:a9fe`, or the full form `0:0:0:0:0:ffff:a9fe:a9fe`) therefore matched neither an IPv4 literal nor an IPv4 CIDR rule, even though Node routes the connection to that IPv4 destination — a sandboxed caller could reach an address the rules intended to block (for example a cloud metadata endpoint). Both sides now normalize through `unmapIpv4`: candidates and patterns are mapped back to their dotted IPv4 form before matching, a mapped pattern also covers the plain IPv4 spelling, and mapped globs keep their IPv4 remainder (`::ffff:10.0.*.*` → `10.0.*.*`). Reported by the maintainer during a network-rule audit; the shipped `docs/rules-format.md` / `.en.md` `ips` row documents the normalization.

### Tests

- `test/network.spec.ts` gains a regression case: mapped dotted / mapped hex / full-form mapped literals against both literal and CIDR `ips` rules, the normalized `parseUrlTarget` candidate, the mapped-pattern direction, and an unrelated-IPv6 negative.

## v0.6.15 - 2026-09-09

### Changed

- Vendor integration tarball updated to `dsh-auto-review` 0.12.1 (`vendor/dsh-auto-review-0.12.1.tgz`, packed from the sibling repo's `0.12.1` release source; the packed `files` are identical to tag `v0.12.1`), with the devDependency `file:` specifier and `pnpm-lock.yaml` refreshed. The sibling's runtime `@deepseek-ai/dsh-*` pins now follow the `0.1.5-alpha.1` host line, matching this repo's dev peers. The five historical vendor tarballs (`0.9.0`–`0.11.0`) stay in the tree.

### Tests

- `test/integration.spec.ts` (3 tests) re-run unchanged against the 0.12.1 tarball: the `ask` rule → official approval seam → scripted `autoReview/verdict` → `approval/decided` audit chain stays green, so no source adaptation was needed. The full gate chain (`typecheck`, `test` 23 files / 280 tests, `build`, `verify:self-contained`) passes with the new vendor artifact installed.

## v0.6.14 - 2026-09-09

### Fixed

- `isUnmarkedHostVersion` now classifies the `0.1.5-alpha` line as non-stamping. On the published `0.1.5-alpha.1` package the envelope keeps its `ignorable` field for stored-log reads only: `Session.append` accepts the third argument and silently drops it, so the first `permissionRules/decision` row landed UNMARKED and the session was then refused by `validateStoredEvents` on the same host. The gate now covers every alpha build in minor 2 and later (`0.1.2-alpha` through `0.1.5-alpha`, `^0\.1\.(?:[2-9]|[1-9]\d)-alpha[.-]\d+$`); over-refusal stays harmless because `allowUnmarkedAudit: true` opts back in and `strip` remains available.
- `scripts/repair-session-logs.mjs` discovers every generation-addressed log by the canonical `session[.vN].jsonl[.zstd]` form, so the `0.1.5-alpha` line's `session.v3.jsonl` is no longer invisible to the tool; its embedded `KNOWN_SESSION_EVENT_TYPES` copy gains the `0.1.5-alpha.1` catalog additions (`system/message`, `feedback/message-put`, `feedback/message-delete`, `tool/ptc-dispatch`, `tool/ptc-dispatch-start`) while keeping the v1/v2-only spellings, so native v3 logs stop reporting `system/message` as foreign.

### Added

- Regression coverage: `test/audit-support.spec.ts` runs the gate against the real installed `0.1.5-alpha.1` peer (no `peerVersion` mock) and asserts that no audit row is written and the one-time warning fires; `test/repair-session-logs.spec.ts` drives the shipped script on `%TEMP%` fixtures across every log generation (discovery, vocabulary, frame-preserving repair with backups, `strip`).

### Docs

- Five-language READMEs and AGENTS.md: the `0.1.5-alpha` line is documented as non-stamping and pre-checked before the first append, and the session-log repair section documents `strip` plus the per-generation matrix — native v3 logs only need `repair`, v2 logs must be `strip`ped before a `0.1.5-alpha` host migrates them (its v2→v3 gate refuses every unclassified event even when marked), and v1 logs before a 0.1.3-or-later host opens them.

## v0.6.12 - 2026-09-07

### Docs

- Fix the DSH plugin badge URL: shields.io rejects the four-segment static badge form with "404 badge not found"; the label now uses the documented double-dash form (`dsh--plugin`), rendering identically; no behavior change.


## v0.6.11 - 2026-09-07

### Fixed

- Align the `@deepseek-ai/dsh-*` peer ranges to `>=0.1.2-rc.1 <0.2.0`: the older `>=0.1.0-rc.8 <0.2.0` band resolved to only the `0.1.0-rc.8` prerelease under registry-driven resolution and broke fresh tarball installs; no behavior change.

### Changed

- Repack the vendored `dsh-auto-review` integration tarball at 0.10.4.

### Docs

- Refresh the five-language README support-version wording: the verified GitHub tag `dsh-v0.1.3-alpha.1` now leads the compatibility claim, while npm `0.1.2-rc.1` stays the published dependency-pin line (peers `>=0.1.2-rc.1 <0.2.0`); no behavior change.


## v0.6.10 - 2026-09-04

### Fixed

- `isUnmarkedHostVersion` now classifies the `0.1.2-rc` line as non-stamping: `0.1.2-rc.1` ships the alpha.5 surface (the third `Session.append` parameter is `SurfaceIntent` for surface event types only, so no rc build in the `0.1.2` minor stamps the marker). Previously `0.1.2-rc.1` fell through both regexes and was probed as marker-aware, so the first decision appended an unmarked event that pollutes the session log before the probe degrades audit.
- `isUnmarkedHostVersion` now also classifies the `0.1.3-alpha` line as non-stamping (it keeps the same surface-only append signature, verified against the `dsh-v0.1.3-alpha.1` tag) and every rc build in minor 2 and later (defensive; over-refusal is harmless because `allowUnmarkedAudit` opts back in).
- `scripts/repair-session-logs.mjs` syncs its `KNOWN_SESSION_EVENT_TYPES` copy with the harness catalog (adds `model/selection`, `session-log-deepseek/delivery-accepted`, `subagent/model-selection-policy`, `team/member`, `team/message/delivered`, `team/message/queued`, `team/task`) so `scan` stops misreporting those rows as foreign.

### Changed

- Dev pins move from the published dsh `0.1.2-alpha.5` line to `0.1.2-rc.1` (17 `@deepseek-ai/dsh-*` packages); `dshWorkshop.compatibility.dshVersions` and the compat workflow's CLI/base/headless installs now target `0.1.2-rc.1`.
- Repack the vendored `dsh-auto-review` sibling tarball at `0.10.3` and repoint the `file:` devDependency.
- `scripts/repair-session-logs.mjs` discovers v2 log generations (`session.v2.jsonl[.zstd]`, written by the `0.1.3-alpha` line) and carries the `assistant/attempt` type alongside `assistant/chunk` (the harness v2 catalog swapped the two). Its docs now state that v1 logs must be `strip`ped before a v2 host opens them: the v1→v2 migration refuses unknown v1 events even when marked `ignorable: true`, while v2 logs accept `repair`-stamped rows.

### Docs

- Five-language READMEs: the harness compatibility row states `0.1.2-rc.1` and the audit-marker limitation covers the `0.1.2-rc` and `0.1.3-alpha` lines (plus the v1-strip-before-v2-migration guidance); AGENTS.md facts updated (pinned rc.1 dev peers, 0.10.3 tarball, 0.1.3-alpha pre-check, v2 repair semantics).

## v0.6.9 - 2026-09-03

### Changed

- Vendor the `dsh-auto-review 0.10.2` integration tarball (its runtime dependencies now pin the published dsh `0.1.2-alpha.5` line; `dsh-agent-spine-demo` moved to devDependencies) and update the `file:` devDependency.
- Dev pins `@deepseek-ai/cordis-plugin-loader ^1.0.3` / `@deepseek-ai/cordis-plugin-include ^1.0.7` aligned with the `cordis 4.0.2` peer ranges.

## v0.6.8 - 2026-09-03

### Fixed

- Never recursively watch a workspace root for an expected-but-absent rule
  file (issue #13): candidate watchers are depth-limited to the immediate
  children of the deepest existing ancestor, ignore `node_modules`/`.git`,
  upgrade the watch when the missing path component (e.g. `.dsh/`)
  appears, and close when their watched directory disappears. A missing
  `.dsh/rules.yaml` used to watch the entire workspace tree — 245k inotify
  watches, multi-GiB RSS, and stalled tool calls on large workspaces.

## v0.6.7 - 2026-09-02

### Docs

- Sync the five-language READMEs to the 0.1.2-alpha.5 facts; no behavior change.

# Changelog

All notable changes to dsh-permission-rules are recorded here, newest first.

## v0.6.6 - 2026-09-02

### Changed

- Re-verify the adaptation claims against the published dsh `0.1.2-alpha.5` line and refresh the devDependency pins and lockfile for it.
- Repack the vendored `dsh-auto-review` sibling tarball at `0.10.0` (alpha.5-adapted tree) and repoint the `file:` devDependency; the integration suite stays green (271/271).

## v0.6.5 - 2026-09-01

### Changed

- Align the devDependency pins to the published dsh `0.1.2-alpha.3` line (17 `@deepseek-ai/dsh-*` packages), align `cordis`/`schemastery` to `^4.0.2`/`^3.18.2`, and raise the `dsh-sandbox` override and `dshWorkshop.compatibility.dshVersions` to `0.1.2-alpha.3`. The audit gate classification keeps failing safe on `0.1.2-alpha.3`; the five-language READMEs record the alpha.3 fact. The vendored `dsh-auto-review` 0.6.0 tarball stays frozen.

## v0.6.4 — 2026-09-01

### Fixed

- Guard every CONNECT socket error window so a client reset can no longer
  crash the host process: the raw tunnel socket now gets an explicit `error`
  handler (log + destroy both peers) before any await or write, covering the
  decision await, the 400 early return, and the 403 early return paths
  ([#12](https://github.com/PerryLink/dsh-permission-rules/issues/12)).

## v0.6.3 — 2026-08-30

### Fixed

- Replace the removed `@deepseek-ai/dsh-client-runtime` client metadata with the
  current `@deepseek-ai/dsh-client-web` package (`dsh.client.inject` + optional
  peerDependencies) and align the client-bundle externals with the shell's
  frozen module table at the 0.1.2-alpha host line
  (`@deepseek-ai/dsh-client-store` replaces the removed
  `@deepseek-ai/dsh-client-runtime/client` exemption; the removed
  `@deepseek-ai/dsh-client-web-react` entry is dropped).
- Derive the call-id brand from the dsh-tools execution contract
  (`ToolExecution['callId']`) in `src` and `test`, so both the published
  0.1.1-rc.2 line (dsh-llm `CallId`) and the 0.1.2-alpha host line (dsh-llm
  `ToolCallId`) typecheck without naming either brand name.

## v0.6.2 — 2026-08-30

### Fixed

- `isUnmarkedHostVersion` now treats the whole `0.1.2-alpha` line as unable to
  safely persist audit events: that line refuses to interpret logs containing
  out-of-vocabulary event types even when the envelope carries
  `ignorable: true` (verified on `0.1.2-alpha-1`), so audit events written
  there made sessions unresumable on the host itself. Session-log audit is now
  disabled on that line before the first append with the same one-time warning
  and `allowUnmarkedAudit: true` opt-back-in as the known-unmarked rc lines.
  Reported by [@rgw87](https://github.com/PerryLink/dsh-permission-rules/issues/15).
- `scripts/repair-session-logs.mjs` gains a `strip` mode that removes targeted
  audit rows entirely, for harness lines where the `ignorable` marker cannot
  help; the five-language READMEs document it.

## v0.6.1 — 2026-08-27

### Fixed

- Declare the web-client inject packages (`@deepseek-ai/dsh-client-connection`,
  `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-runtime`,
  `@deepseek-ai/dsh-client-ui-settings`) as optional peerDependencies so the
  bundle composition is explicit and standalone installs stay clean.

## v0.6.0 — 2026-08-26

### Added

- **Built-in high-risk baseline**: a shipped `rules/builtin-high-risk.yaml` (deny/ask rules for destructive commands — `rm -rf /`, `mkfs`, `dd of=/dev/*`, `chmod -R 777`, `chown -R` — privilege escalation — setuid/setgid, `shutdown`/`reboot` — download-and-execute — `curl|sh`/`wget|sh` — history rewrites — `git push --force`, `git reset --hard` — the fork bomb, and sensitive paths — `~/.ssh`, `.env`, credentials, `/etc/shadow`, `~/.aws`). Enabled by default and appended AFTER user rules (first-match lets a nearer user rule override it); toggle with `builtin.enabled`, swap with `builtin.path`.
- **`argv` match dimension**: lexically decompose shell `command`/`cmd`/`script` arguments (quotes/escapes/pipes/control-operators/redirects aware) into command words, argument tokens, redirect targets, and a pipeline signature, then match them token-precisely (`command`, `args` AND, `anyArg` OR, `pipeline`) without changing existing rule syntax.
- **Rule compile cache**: compiled rules are cached per source path + content hash, so the shared built-in baseline and any shared fallback/absolute `rulesFile` are parsed and compiled once across workspaces instead of once per cwd.

### Docs

- Document the `argv` dimension and the built-in baseline in `docs/rules-format.md`/`.en.md` and `docs/rules-format.schema.json`; add the `builtin.*` config keys to the five-language READMEs.

## v0.5.6 — 2026-08-25

### Fixed

- `isUnmarkedHostVersion` only matched the `0.1.0-rc` line, so hosts on the `0.1.1-rc` line passed the pre-check and wrote the first `permissionRules/decision` event unmarked — that polluted event makes the session unresumable on stricter harness builds. The gate now covers `0.1.1-rc.1`–`rc.7` as known-unmarked (verified on `0.1.1-rc.2`, where the harness still drops the `ignorable` marker); over-refusal is opt-out via `allowUnmarkedAudit: true`. Reported by [@cuohua](https://github.com/PerryLink/dsh-permission-rules/issues/11).

## v0.5.5 — 2026-08-23

### Docs

- Document the `network` match dimension in the rule-format references: `docs/rules-format.en.md` and `docs/rules-format.md` now list `network` among the allowed `match` fields, add a `network` dimension row plus a dedicated section (domains / ips / ports / schemes semantics, tool scoping, the mode/boundary cross-reference), and `docs/rules-format.schema.json` gains the `network` property so editor completion covers it. This closes the v0.5.0 gap where the implementation shipped but the vocabulary docs still listed only six `match` fields.
- The injected network-policy system-prompt paragraph now opens with a short role sentence (Minimal persona style), as the engineering standard requires.
- Refresh the five-language README Development section test count to the current `236 tests, 20 files` (was `139 tests, 9 suites`).

## v0.5.4 — 2026-08-22

### DeepSeek Harness rc.2 compatibility

- The dsh peer family moves to `0.1.1-rc.2`: devDependencies pin the exact rc.2 line, peerDependencies keep the `>=0.1.0-rc.8 <0.2.0` range (which already covers `0.1.1-rc.2`), and the workshop compatibility manifest lists `0.1.1-rc.2`. The five-language Harness compatibility row declares the rc.2 line.
- The sibling `dsh-auto-review` integration tarball is repacked to `vendor/dsh-auto-review-0.5.4.tgz` and the `file:` devDependency updated to match.
- `pnpm-workspace.yaml` now excludes the whole `@deepseek-ai/*` scope from `minimumReleaseAge`; the compat workflow pins the rc.2 CLI and `dsh-base`/`dsh-headless` bundles.
- The rc.2 `@deepseek-ai/dsh-*` prereleases resolve from `next` (their `latest` tags are stale), so the fresh transitive peers cannot be hoisted. The workspace drops `nodeLinker: hoisted` (the default isolated linker skips unresolvable peers, as the sibling repo does), and the load-bearing peers are pinned explicitly as devDependencies: `dsh-brand`, `dsh-invariants`, `dsh-session-projection` (sibling tarball peers) and `cordis-plugin-include` (the Loader composition runner).

## v0.5.3 — 2026-08-21

### DeepSeek Harness rc.8 compatibility

- The dsh peer family moves to `0.1.0-rc.8`: devDependencies pin the exact rc.8 line, peerDependencies widen to `>=0.1.0-rc.8 <0.2.0`, the workshop compatibility manifest adds rc.8, and the five-language Harness compatibility row declares it. The rc.8 `commands.execute` signature gained the `images` parameter, so the `/rules` specs and the Loader composition runner pass an empty attachment array; the composition suite proves the built entry loads and serves `/rules` on the rc.8 peers.
- The rc.8 `dsh-session` stamps the envelope's `ignorable` marker, so the audit-capability degradation tests now simulate the pre-marker line through the runtime's `peerVersion` seam instead of claiming the released peers are unmarked; `isUnmarkedHostVersion`'s contract and the test-harness notes document the marker-aware rc.8 line.

## v0.5.2 — 2026-08-19

### Fixed

- **Client dictionaries survive hot-reload**: the browser half now holds the `locale.register` disposer through the plugin fiber's `ctx.effect` (the locale registry throws on a duplicate namespace). Disposing the client fiber unregisters the `settings.permissionRules` dictionaries; remounting re-registers cleanly instead of failing the mount until the next page refresh. Regression covered by a dispose-and-remount client test against a duplicate-strict locale registry.

## v0.5.1 — 2026-08-17

### Added

- **Shared rule-syntax test vectors** (`docs/rule-test-vectors/`): an implementation-neutral conformance corpus (schema `dsh-rule-test-vectors/v1`) covering exact/glob tool matches, params globs and negation, path patterns, `when.platform`/`when.env`, the `agents` identity dimension, `absent`, first-match ordering, and disabled rules. `test/test-vectors.spec.ts` proves every case through the real parser/matcher — the reference implementation for the cross-gate corpus agreed with sjh9714 (issues #4/#5).

### Changed

- `scripts/repair-session-logs.mjs` default target set now covers all five `autoReview/*` event types (`state`, `verdict`, `circuit`, `override`, `rejection`) in addition to `permissionRules/decision`, so sessions polluted by `dsh-auto-review` ≤ 0.5.0 on rc.6 hosts repair in one pass.
- The dsh-auto-review integration dependency moves to `vendor/dsh-auto-review-0.5.1.tgz` (its rc.6 audit-gating fix); the integration specs mount it with `allowUnmarkedAudit: true` so the asserted audit chain stays testable against the rc.6 peers.

## v0.5.0 — 2026-08-16

### Added

- **Process-level network policy (Codex-style).** Shell subprocess traffic flows through a built-in local HTTP/CONNECT proxy, and every connection is decided by ordered network rules (`match.network` with `domains` / `ips` / `ports` / `schemes` — globs, wildcards, CIDRs, port ranges; numeric YAML ports are accepted) or by the three network modes mapped onto the official sandbox presets (`deny-all` / `whitelist` / `allow-all` with an `auto` mode).
- URL-candidate extraction on the tools/pre-execute hot path: network rules fire on web-tool arguments and on URLs embedded in bash/pwsh command text; loopback targets can short-circuit rules per policy.
- Proxy-layer audit: denied connections append `permissionRules/network` to the owning session (same adaptive `ignorable` gate as `permissionRules/decision`), with block counters and recent interceptions in `/rules network` and the settings page.
- Settings page with a network-mode editor, a known-source rule editor and validated saves; the Typert remote surface (`src/typert.host.ts` / `src/remote-service.ts` / `src/wire.ts`) serves the snapshot and editor.

### Fixed

- Proxy environment injection snapshots every variable before writing any, so `restore()` puts back the exact original values on case-insensitive (Windows) environments.
- Blocked CONNECT tunnels are denied before any TCP connection to the target.
- `auditNetworkBlock` invoked `Session.append` with a lost `this` binding; blocked-connection audit events now land.
- Bare IPv6 loopback candidates (`::1`, full-form `0:0:0:0:0:0:0:1`) parse and are recognized as loopback; literal-IP hosts still match wildcard domain rules.
- `.dsh/rules.yaml` writes create missing parent directories.

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

## [Unreleased]

### Changed

- Rename the four translated READMEs to `README-<lang>.md`. npm selects the package-page readme as the first markdown file matching its `{README,README.*}` glob (`@npmcli/package-json`, publish path), and that glob order puts `README.<lang>.md` ahead of `README.md` — so npm was serving the Simplified-Chinese file for this package too (measured on 15/15 sampled packages of the family). The new names sit outside the glob, so the English source is served again. No content changed apart from the language-switcher link each translation holds to its siblings, and the repo readme gate still passes. Takes effect with the next release; an already-published version cannot gain a corrected readme retroactively.

## [0.6.13] - 2026-09-09

### Changed

- Align the `@deepseek-ai/dsh-*` peer ranges to `>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0` and pin the dev/test dependencies to the published `0.1.5-alpha.1` line: adaptation to DeepSeek Harness `dsh-v0.1.5-alpha.1` (session format V3, `ctx.agent` removal, `Inbox` type-only interface); runtime behavior is unchanged for every supported host line.
- Record `0.1.5-alpha.1` in `dshWorkshop.compatibility.dshVersions`.

### Docs

- Refresh the five-language README compatibility baseline to `dsh-v0.1.5-alpha.1` (verified 2026-09-09).

