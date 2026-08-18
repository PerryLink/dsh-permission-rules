# Shared rule-syntax test vectors

Machine-readable conformance vectors for every DSH gate that consumes the
`dsh-permission-rules` rule syntax. The corpus is **implementation-neutral**:
it declares rule text plus expected decisions, never gate internals, so any
second gate (or a future core seam) can prove "same syntax, same verdicts".

- **Schema** — `corpus.json`, `schema: dsh-rule-test-vectors/v1`. Each vector
  is `{ id, purpose, rules (YAML text), cases[] }`; each case is
  `{ tool, arguments, context?, expect }` where `expect` is `allow` | `ask` |
  `deny` | `null` (null = passthrough). `context` carries `{ platform, env,
  agents }` host facts — the same vocabulary as the `when`/`agents` match
  dimensions.
- **The reference implementation** is this package: `test/test-vectors.spec.ts`
  compiles every vector through `compileRulesChain` and asserts each case's
  first-match decision, so the corpus is proven self-consistent against the
  gate that defines the syntax. A second gate imports the same file and runs
  the same table — a mismatch is a conformance failure in one of the two.
- **Extending the corpus** — add vectors for any syntax corner you rely on
  (negation patterns, nested params, path candidates, network rules, chains).
  Keep `rules` self-contained YAML and `cases` free of gate-specific fields.
  Bump nothing: the corpus is additive, and both gates consume HEAD.

This corpus exists because two independent DSH permission gates
(`dsh-permission-rules` and sjh9714's gate, see
[PerryLink/dsh-permission-rules#4](https://github.com/PerryLink/dsh-permission-rules/issues/4))
agreed to share rule-syntax test vectors rather than re-derive them
separately — one corpus, two consumers, no drift.
