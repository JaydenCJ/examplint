# YAML support

examplint ships its own YAML parser so the tool stays zero-dependency and
offline. It is a deliberate *subset* parser: it covers the YAML that
real-world OpenAPI documents are written in, and refuses — loudly, with a
line number — anything it cannot represent faithfully. It never guesses.

JSON input bypasses this parser entirely (`JSON.parse`), and input format
is sniffed from content, not the file extension.

## Supported

- Block mappings and block sequences, nested by indentation — including
  sequences at the *same* indent as their mapping key (`tags:` then `- a`)
- Sequence items that open an inline mapping (`- name: limit`)
- Multi-line plain scalars: more-indented continuation lines fold into the
  value with spaces (the usual layout for long `description` fields)
- Flow collections: `[a, b]`, `{x: 1, y: 2}`, nested, with trailing commas
- Plain scalars per the YAML 1.2 core schema: `null`/`~`, booleans,
  integers (decimal, `0x`, `0o`), floats, everything else a string —
  version-like strings such as `3.0.3` stay strings
- Single-quoted strings (with `''` doubling) and double-quoted strings
  (with `\n`, `\t`, `\uXXXX`, `\xXX`, `\UXXXXXXXX` escapes)
- Quoted mapping keys (`"200":`) — keys are always treated as strings,
  matching JSON semantics for status codes
- Block scalars `|` and `>` with strip (`-`) and keep (`+`) chomping and
  explicit indentation indicators
- Comments (`#`), including trailing comments outside quotes
- A single leading `---` document marker and a trailing `...`
- Windows (CRLF) and old-Mac (CR) line endings

## Rejected with a clear error

| Construct | Error message hint |
|---|---|
| Anchors `&a` / aliases `*a` | "anchors and aliases are not supported (inline the value instead)" |
| Tags `!!str`, `!custom` | "YAML tags are not supported" |
| Merge keys `<<:` | "merge keys (<<) are not supported" |
| Multi-document streams (`---` mid-file) | "multi-document YAML streams are not supported" |
| Explicit complex keys `? ` | "explicit complex mapping keys (?) are not supported" |
| Tab indentation | "tab characters are not allowed in indentation" |
| Duplicate mapping keys | "duplicate mapping key" (YAML allows overriding; specs should not) |

If your spec uses anchors or tags, run it through any YAML-to-JSON
converter once (`yq -o=json`, your editor, a two-line script) and lint the
JSON — examplint treats both formats identically from there.

## Why not a full YAML library?

Two reasons. First, the zero-dependency install is a feature: nothing to
audit, nothing to break, no supply chain. Second, most of YAML's dark
corners (implicit type coercion, the Norway problem, anchor bombs) are
exactly the things you do not want silently interpreted inside an API
contract. The subset parser turns them into hard errors instead —
`no` stays the string `"no"`, and `billion laughs` never expands.
