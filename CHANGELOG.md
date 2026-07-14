# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-12

### Added

- `examplint check`: validates every example in an OpenAPI 3.0/3.1
  document against its declared schema — media-type `example` and named
  `examples`, parameter and header examples, request bodies, responses,
  reusable components, webhooks, and schema-level `example` /
  `examples[]` values nested anywhere in a schema tree.
- Fix suggestions on diagnostics: unquote/quote/round type coercions,
  nearest enum value for typos (`avialable` → `available`), nearest
  declared property for typo'd keys, schema-derived placeholders for
  missing required properties, boundary and nearest-multiple hints, valid
  sample values for failed formats, and closest-branch guidance for
  `oneOf`/`anyOf` misses.
- JSON Schema validator covering both OpenAPI dialects: 3.0 (`nullable`,
  boolean `exclusiveMaximum/Minimum`, single-schema `items`) and 3.1
  (type arrays, `const`, `prefixItems`, `contains`, `dependentRequired`,
  boolean schemas), with lazy cycle-guarded `$ref` resolution so recursive
  schemas validate recursive data.
- 16 format checkers (`date-time`, `uuid`, `ipv6`, `int32`, …) reported at
  warning level per JSON Schema's annotation semantics; unknown formats
  surface as W204 instead of being silently ignored.
- Stable rule catalog: 8 error codes (E101–E108) and 9 warning codes
  (W201–W209); nothing is ever skipped silently.
- `examplint list`: enumerates every discovered example site with its JSON
  Pointer and kind.
- `--strict` (warnings fail), `--check-defaults` (validate schema
  `default` values), `--quiet`, `--format json`, multi-file runs with
  worst-outcome exit codes (0 ok / 1 findings / 2 usage or I/O error).
- Built-in dependency-free YAML subset parser (block/flow styles, block
  scalars, quoting, comments) with loud, line-numbered rejection of
  anchors, tags, merge keys and multi-document streams; JSON input is
  sniffed from content.
- Public programmatic API (`parseDocument`, `discoverSites`,
  `validateValue`, `checkDocument`, `suggestFor`, renderers) with type
  declarations.
- Test suite: 90 node:test tests (unit + CLI integration in fresh temp
  dirs) and an end-to-end `scripts/smoke.sh` against the bundled petstore
  examples.

[0.1.0]: https://github.com/JaydenCJ/examplint/releases/tag/v0.1.0
