## Checklist

Before opening this pull request, confirm each item (uncheck and fix what applies):

- [ ] All local gates pass: `pnpm run typecheck && pnpm run lint && pnpm test && pnpm run test:coverage && pnpm run build && pnpm pack && node scripts/check-readme-sync.mjs`
- [ ] Tests added or updated to cover the change
- [ ] `CHANGELOG.md` updated (new "Unreleased" section or a version section)
- [ ] Multi-language documentation synced: all five READMEs (`README.md` + `zh`/`es`/`pt`/`hi`), and `docs/rules-format.md` + `docs/rules-format.en.md` whenever the rule vocabulary changes
- [ ] Related issue linked (e.g. `fixes #2`)
- [ ] No credentials, tokens, personal paths, or private data included — placeholders only
