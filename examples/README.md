# Examples

Two versions of the same petstore API. `petstore.yaml` is the spec as it
was written: every example matches its schema. `drifted.yaml` is the same
spec six months later, after the kind of "harmless" edits nobody reviews —
a quoted integer, a typo'd enum value, a misspelled property, a dropped
required field, a date that is not a date, an id below its minimum.

The test suite and `scripts/smoke.sh` both run against these files, so
they are guaranteed to stay accurate.

## Try it

```bash
# from the repository root, after `npm install && npm run build`
node dist/cli.js check examples/petstore.yaml   # exit 0, everything conforms
node dist/cli.js check examples/drifted.yaml    # exit 1, 6 errors + 1 warning
node dist/cli.js list  examples/petstore.yaml   # where the 11 examples live
```

## What the seeded drift demonstrates

| Drift in `drifted.yaml` | Rule | Suggested fix |
|---|---|---|
| `example: "25"` — integer got quoted | E101 | `unquote it: 25` |
| `status: avialable` — typo'd enum value | E102 | `did you mean "available"?` |
| `id: "2"` — quoted integer inside an array item | E101 | `unquote it: 2` |
| `taggs: []` — typo'd property, `additionalProperties: false` | E107 | `did you mean "tags"?` |
| POST example lost required `status` | E106 | `add "status": "available"` |
| `adoptedAt: yesterday` — not a `date-time` | W203 | `a valid date-time looks like "2026-07-12T09:30:00Z"` |
| Pet schema example `id: 0` under `minimum: 1` | E103 | `use a value >= 1` |

`petstore.yaml` also shows the discovery surface: media-type examples,
named `examples` maps, `$ref`'d shared examples in `components.examples`,
parameter and header examples, and schema-level examples nested inside
`components.schemas` — all 11 are found and validated.
