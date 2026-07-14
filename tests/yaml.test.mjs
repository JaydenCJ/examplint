// The YAML subset parser: the shapes real OpenAPI documents use, plus the
// unsupported constructs that must fail loudly (never mis-parse silently).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseYaml, plainScalar, YamlError } from "../dist/yaml.js";

test("block mappings and sequences nest by indentation", () => {
  const value = parseYaml(
    ["info:", "  title: Petstore", "  tags:", "    - pets", "    - store", "count: 2"].join("\n")
  );
  assert.deepEqual(value, { info: { title: "Petstore", tags: ["pets", "store"] }, count: 2 });
  // YAML also allows a sequence at the SAME indent as its mapping key —
  // the most common OpenAPI layout for `tags:` and `servers:`.
  const flush = parseYaml(["tags:", "- pets", "- store", "count: 2"].join("\n"));
  assert.deepEqual(flush, { tags: ["pets", "store"], count: 2 });
});

test("sequence items that open a mapping keep following keys in the same item", () => {
  const value = parseYaml(["parameters:", "  - name: limit", "    in: query", "  - name: petId", "    in: path"].join("\n"));
  assert.deepEqual(value, {
    parameters: [
      { name: "limit", in: "query" },
      { name: "petId", in: "path" },
    ],
  });
});

test("plain scalars resolve null/bool/number per the YAML core schema", () => {
  assert.equal(plainScalar("null"), null);
  assert.equal(plainScalar("~"), null);
  assert.equal(plainScalar(""), null);
  assert.equal(plainScalar("true"), true);
  assert.equal(plainScalar("False"), false);
  assert.equal(plainScalar("42"), 42);
  assert.equal(plainScalar("-3.5"), -3.5);
  assert.equal(plainScalar("1e3"), 1000);
  assert.equal(plainScalar("0x1F"), 31);
  assert.equal(plainScalar("0o17"), 15);
});

test("version-like strings stay strings (3.0.3 is not a number)", () => {
  assert.deepEqual(parseYaml("openapi: 3.0.3"), { openapi: "3.0.3" });
  assert.deepEqual(parseYaml("v: 1.2.3-beta"), { v: "1.2.3-beta" });
});

test("block-context plain scalars keep commas, colons-without-space and brackets", () => {
  const value = parseYaml("description: A classic petstore, with examples [sic] and 10:30 times");
  assert.equal(value.description, "A classic petstore, with examples [sic] and 10:30 times");
  // Multi-line plain scalars fold continuation lines with spaces.
  const folded = parseYaml(["description: spans two", "  indented lines", "next: 1"].join("\n"));
  assert.deepEqual(folded, { description: "spans two indented lines", next: 1 });
});

test("quoting: single-quote doubling, double-quote escapes, quoted keys, comments", () => {
  assert.deepEqual(parseYaml("a: 'it''s'"), { a: "it's" });
  assert.deepEqual(parseYaml('b: "line\\nbreak \\u00e9"'), { b: "line\nbreak é" });
  assert.deepEqual(parseYaml('"200": ok'), { "200": "ok" });
  const commented = parseYaml(["a: 1 # trailing", "# full line", "b: '# not a comment'"].join("\n"));
  assert.deepEqual(commented, { a: 1, b: "# not a comment" });
});

test("flow sequences and mappings parse, including nesting and trailing commas", () => {
  assert.deepEqual(parseYaml("tags: [a, b, ]"), { tags: ["a", "b"] });
  assert.deepEqual(parseYaml("obj: {x: 1, y: [true, null]}"), { obj: { x: 1, y: [true, null] } });
  assert.deepEqual(parseYaml("empty: {}\nnone: []"), { empty: {}, none: [] });
});

test("literal block scalars preserve newlines; folded scalars join lines", () => {
  const literal = parseYaml(["a: |", "  line one", "  line two"].join("\n"));
  assert.equal(literal.a, "line one\nline two\n");
  const folded = parseYaml(["b: >", "  joined", "  words", "", "  new paragraph"].join("\n"));
  assert.equal(folded.b, "joined words\nnew paragraph\n");
});

test("block scalar chomping: strip (-) drops and keep (+) keeps trailing newlines", () => {
  assert.equal(parseYaml("a: |-\n  x\n\n").a, "x");
  assert.equal(parseYaml("b: |+\n  x\n\nc: 1").b, "x\n\n");
});

test("a leading --- marker is accepted; multi-document streams are rejected", () => {
  assert.deepEqual(parseYaml("---\na: 1"), { a: 1 });
  assert.throws(() => parseYaml("---\na: 1\n---\nb: 2"), (e) => e instanceof YamlError && /multi-document/.test(e.message));
});

test("anchors, aliases, tags and merge keys fail with clear errors", () => {
  assert.throws(() => parseYaml("a: &anchor 1"), /anchors and aliases/);
  assert.throws(() => parseYaml("a: *anchor"), /anchors and aliases/);
  assert.throws(() => parseYaml("a: !!str 1"), /tags are not supported/);
  assert.throws(() => parseYaml("base: {a: 1}\nb:\n  <<: base"), /merge keys/);
});

test("tabs, duplicate keys and unterminated quotes are line-numbered hard errors", () => {
  assert.throws(() => parseYaml("a:\n\tb: 1"), /tab characters/);
  assert.throws(() => parseYaml("a: 1\na: 2"), /duplicate mapping key "a"/);
  assert.throws(() => parseYaml('a: "open'), (e) => e instanceof YamlError && e.line === 1);
  assert.throws(() => parseYaml("ok: 1\nbad: 'open"), (e) => e instanceof YamlError && e.line === 2);
});

test("empty values round-trip to null; windows line endings parse like unix", () => {
  const value = parseYaml(["a:", "b:", "  c:", "list:", "  -", "  - x"].join("\n"));
  assert.deepEqual(value, { a: null, b: { c: null }, list: [null, "x"] });
  assert.deepEqual(parseYaml("a: 1\r\nb:\r\n  - x\r\n"), { a: 1, b: ["x"] });
});
