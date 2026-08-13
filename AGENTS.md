# AGENTS.md

Standalone DeepSeek Harness plugin repository (`dsh-permission-rules`). Development follows the dsh-plugin-guide skill and the official plugin contract; this file records repo-local decisions.

## Layout

- `src/index.ts` — function-plugin contract (`name`/`inject`/`Config`/`apply`; NO default export — the Loader unwraps `exports.default ?? exports`).
- `src/config.ts` — Schemastery schema + explicit `resolveConfig` (no hidden `?? default` in `run()` paths).
- `src/glob.ts` — strict glob→RegExp compiler; bad globs throw at compile time (load), never silently match nothing.
- `src/rules.ts` — the pure core: YAML document validation, pattern compilation, first-match evaluation, path-candidate extraction/normalization. No fs/clock/process state.
- `src/events.ts` — `permissionRules/decision` SessionEventMap member (declaration merging).
- `src/runtime.ts` — `tools/pre-execute` listener, per-cwd rule loading (project file → fallback → empty), `permissionRules/decision` audit, `/rules` command, Chokidar watch.
- `test/` — vitest; real `Context` + real `Session`/`Commands`/`ApprovalService` from the `0.1.0-rc.6` peers; chokidar mocked with a fake EventEmitter; the dsh-auto-review integration uses its tarball with a scripted reviewer mock.
- `docs/rules-format.md` — the rule file schema and the 5-rule security baseline.

## Hard rules applied here

- Waterfall listener (`tools/pre-execute`) always calls `next()` unless it claims the call with `deny`/`ask`. An `allow` hit is NEVER short-circuited.
- Model-visible ⟺ logged: the only model-visible plugin content is the deny/ask reason materialized by the tools registry into the tool result; the `permissionRules/decision` audit event carries the same `callId` and reason for reconstruction.
- Log-only audit: `permissionRules/decision` is never injected into the model context.
- Loud misconfiguration: invalid YAML, unknown fields, unknown actions, bad globs/regexes, and rule counts over `maxRules` fail the load (`badFilePolicy` chooses fail vs ignore-with-warning). Deployment-level files (absolute `rulesFile`, `fallbackPath`) fail the mount.
- Watch failures warn only: a bad HMR reload keeps the previous rules and never crashes the process.
- No reviewer subagents, no model calls, no OS-sandbox changes — `ask` ends at the official approval seam; the answerer role belongs to `dsh-auto-review`.

## Docs

- Five-language READMEs (`README.md`, `README.zh.md`, `README.es.md`, `README.pt.md`, `README.hi.md`) — keep all five in sync; the English file is the source of truth. GitHub-style front matter (badges, TOC, architecture diagram, quick start).
- When the repo is published on GitHub, set topics `dsh`, `dsh-plugin`, `deepseek-harness`, `deepseek`, `cordis`, `permission`, `approval`, `ai-safety` (the ecosystem's visibility channel is the `dsh-plugin` topic; see dsh-plugin-guide §9).
- License is Apache-2.0 (`LICENSE` + the package.json `license` field).

## Build

`typescript` + `tsdown` are regular `dependencies` on purpose: pnpm does not install devDependencies of git-hosted packages, and the git channel's `prepare` must build with production dependencies alone. `scripts/prepare.mjs` is the single build entry; it runs tsdown FIRST, then tsc declarations into `lib/types` — tsdown's `clean: true` wipes `lib/`, so the reverse order would delete the fresh declarations.

## Checks

`pnpm run typecheck && pnpm test && pnpm run build && pnpm pack`.

## Integration dependency

`test/integration.spec.ts` imports `dsh-auto-review` from `vendor/dsh-auto-review-0.1.0.tgz` (gitignored build artifact of the sibling repo; regenerate with `pnpm --dir ../dsh-auto-review pack --pack-destination <this repo>/vendor`). The shipped tarball carries runtime JS without `.d.ts`, so `tsconfig.test.json` maps the package name onto `test/auto-review.d.ts` for types while runtime resolution loads the real bundle.
