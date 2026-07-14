# Rule catalog

Codes are stable API: a code is never renumbered or repurposed, so scripts
can match on them forever. New findings get new codes.

Two severities:

- **Errors (E1xx)** — an example does not conform to its declared schema.
  Any error makes `examplint check` exit 1.
- **Warnings (W2xx)** — examplint could not fully check something, or found
  an annotation-level mismatch. Warnings never change the exit code unless
  `--strict` is passed. The design rule: *never skip silently* — if an
  example was not validated, a warning says so and says why.

Every diagnostic carries two locations: the **site pointer** (where the
example lives in the spec document, as a JSON Pointer) and the **instance
path** (where inside the example value the mismatch is). Most diagnostics
also carry a concrete fix suggestion.

## Errors

| Rule | Fired by | Typical suggestion |
|---|---|---|
| E101 | `type` mismatch (incl. `false` schemas) | `unquote it: 25` / `quote it: "404"` / `round it: 4` |
| E102 | value not in `enum`, or `const` mismatch | `did you mean "available"?` |
| E103 | `minimum` / `maximum` / `exclusive*` / `multipleOf` | `use a value <= 100`, `nearest multiple is 0.3` |
| E104 | `minLength` / `maxLength` / `pattern` | `shorten the string by 2 characters` |
| E105 | `minItems` / `maxItems` / `uniqueItems` / `contains` | `remove the duplicate item at index 2` |
| E106 | `required` / `dependentRequired` / property counts / `propertyNames` | `add "status": "available"` (placeholder derived from the schema) |
| E107 | undeclared property under `additionalProperties: false` | `did you mean "tags"?` or `remove "x" or declare it` |
| E108 | `oneOf` / `anyOf` / `not` composition failures | `closest is branch #0 — 2 issues, first: …` |

Notes on E-rules:

- E101 type checks understand both dialects: `nullable: true` (3.0) and
  `type: ["string", "null"]` (3.1). `integer` accepts `3.0` the number but
  rejects `3.5`.
- E106's placeholder for a missing property is derived from the property's
  schema in priority order: `default` → `example` → `examples[0]` →
  `const` → `enum[0]` → a type-appropriate zero value.
- E108 for a zero-match `oneOf`/`anyOf` names the *closest* branch (fewest
  failures) and its first problem, so you know which branch to repair.
  A multi-match `oneOf` lists the matching branch indexes.

## Warnings

| Rule | Meaning |
|---|---|
| W201 | a `$ref` (schema or example) does not resolve, or points outside the document — the affected check is skipped |
| W202 | the example only has `externalValue`; examplint is offline and will not fetch it |
| W203 | a value fails its declared, well-known `format` (formats are annotations in JSON Schema, hence not errors) |
| W204 | a `format` examplint has no checker for — the value was *not* verified (reported once per schema location per example) |
| W205 | the example sits under a non-JSON media type (e.g. `application/xml`) and is not validated |
| W206 | an Example Object has both `value` and `externalValue` (mutually exclusive per spec); `value` was validated anyway |
| W207 | there is no schema to validate against (media type without `schema`, or an unreferenced `components.examples` entry) |
| W208 | a schema `pattern` is not a valid regular expression, so it was not checked |
| W209 | an Example Object has neither `value` nor `externalValue` — nothing to validate |

Formats with checkers: `date`, `time`, `date-time`, `duration`, `email`,
`uuid`, `uri`, `uri-reference`, `hostname`, `ipv4`, `ipv6`, `byte`,
`int32`, `int64`, `float`, `double`. `binary` and `password` are treated
as opaque (valid by definition). Everything else fires W204.
