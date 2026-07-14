# Contributing to examplint

Issues, discussions and pull requests are all welcome — this project aims
to stay small, zero-dependency at runtime, and honest about what it checks.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner used by the suite).

```bash
git clone https://github.com/JaydenCJ/examplint.git
cd examplint
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 90 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check against examples/
```

`scripts/smoke.sh` exercises the real CLI (check, list, exit codes,
--strict, --check-defaults, JSON input/output, determinism) against the
bundled example specs and must print `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean (strict mode is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable
   modules (parsing, discovery, validation and suggestion all take values,
   not file handles — only the CLI touches the filesystem).
5. New diagnostics need a row in `docs/rules.md`, a stable code that is
   never reused, and at least one test.

## Ground rules

- **No runtime dependencies.** The zero-dependency install is a core
  feature; adding one needs justification in the PR and will usually be
  declined.
- No network calls, ever — the tool reads local files and prints. That is
  the whole I/O surface.
- Rule codes (`E1xx`/`W2xx`) are stable API: never renumber or repurpose
  an existing code; add new ones instead.
- Never skip silently: anything examplint cannot validate must surface as
  a W-diagnostic explaining why.
- Suggestions must be safe: when a fix cannot be derived confidently,
  suggest nothing rather than something wrong.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `examplint --version` output, the exact command line, and
the smallest spec (or spec fragment) that reproduces the problem — a
single path with one example is usually enough. If validation itself is
wrong, the schema, the example value and the diagnostic you expected make
the report actionable immediately.

## Security

Do not open public issues for security problems; use GitHub private
vulnerability reporting on this repository instead.
