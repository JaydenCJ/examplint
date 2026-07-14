// The fix-suggestion engine. Suggestions are advisory prose, but they are
// the reason drift actually gets fixed, so each family is pinned down:
// wrong suggestions are worse than none.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { editDistance, nearest, placeholderFor, suggestFor } from "../dist/suggest.js";
import { validateValue } from "../dist/validate.js";

/** Run a real validation and return [failure, suggestion] for the first hit. */
function firstSuggestion(value, schema, version = "3.0") {
  const failures = validateValue({}, version, value, schema, "/s");
  assert.ok(failures.length > 0, "expected at least one failure");
  return suggestFor(failures[0]);
}

test("type coercions: quoted scalars suggest unquoting, bare numbers suggest quoting", () => {
  assert.equal(firstSuggestion("25", { type: "integer" }), "unquote it: 25");
  assert.equal(firstSuggestion("2.5", { type: "number" }), "unquote it: 2.5");
  assert.equal(firstSuggestion("true", { type: "boolean" }), "unquote it: true");
  assert.equal(firstSuggestion(404, { type: "string" }), 'quote it: "404"');
});

test("floats against integer suggest rounding; unparseable strings get no guess", () => {
  assert.equal(firstSuggestion(3.7, { type: "integer" }), "round it: 4");
  assert.equal(firstSuggestion("soon", { type: "integer" }), undefined);
  assert.match(firstSuggestion(null, { type: "string" }), /provide a string value/);
});

test("enum typos resolve to the nearest value; distant misses list the choices", () => {
  const schema = { type: "string", enum: ["available", "pending", "sold"] };
  assert.equal(firstSuggestion("avialable", schema), 'did you mean "available"?');
  assert.equal(firstSuggestion("pnding", schema), 'did you mean "pending"?');
  assert.match(firstSuggestion("qwzzk", { type: "string", enum: ["north", "south"] }), /use one of: "north", "south"/);
  assert.equal(firstSuggestion(1, { enum: ["1", "2"] }), 'quote it: "1" (the enum holds strings)');
});

test("missing required properties get a schema-derived placeholder", () => {
  const schema = {
    type: "object",
    required: ["status", "count", "when"],
    properties: {
      status: { type: "string", enum: ["ok", "down"] },
      count: { type: "integer", minimum: 5 },
      when: { type: "string", format: "date-time" },
    },
  };
  const failures = validateValue({}, "3.0", {}, schema, "/s");
  const suggestions = failures.map(suggestFor);
  assert.deepEqual(suggestions, [
    'add "status": "ok"',
    'add "count": 5',
    'add "when": "2026-07-12T09:30:00Z"',
  ]);
});

test("typo'd property names against additionalProperties:false suggest the real key", () => {
  const schema = { type: "object", properties: { tags: {}, name: {} }, additionalProperties: false };
  assert.equal(firstSuggestion({ taggs: [] }, schema), 'did you mean "tags"?');
  assert.equal(firstSuggestion({ zzz: 1 }, schema), 'remove "zzz" or declare it in the schema');
});

test("numeric misses name the boundary and direction; multipleOf snaps without float noise", () => {
  assert.equal(firstSuggestion(101, { type: "integer", maximum: 100 }), "use a value <= 100");
  assert.equal(firstSuggestion(0, { type: "number", exclusiveMinimum: 0 }, "3.1"), "use a value > 0");
  assert.equal(firstSuggestion(0.35, { multipleOf: 0.1 }), "nearest multiple is 0.3");
  assert.equal(firstSuggestion(7, { multipleOf: 5 }), "nearest multiple is 5");
});

test("length and format failures produce concrete, valid examples", () => {
  assert.equal(firstSuggestion("abcdef", { type: "string", maxLength: 4 }), "shorten the string by 2 characters");
  assert.equal(firstSuggestion("abcde", { type: "string", maxLength: 4 }), "shorten the string by 1 character");
  assert.equal(firstSuggestion("yesterday", { type: "string", format: "date-time" }), 'a valid date-time looks like "2026-07-12T09:30:00Z"');
});

test("oneOf ambiguity and oneOf misses get directional advice", () => {
  const schema = {
    oneOf: [
      { type: "object", required: ["a"] },
      { type: "object", required: ["b"] },
    ],
  };
  assert.match(firstSuggestion({ a: 1, b: 2 }, schema), /exactly one branch/);
  assert.match(firstSuggestion({ c: 3 }, schema), /closest is branch #0/);
});

test("editDistance and nearest behave; nearest refuses distant matches", () => {
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.equal(editDistance("", "abc"), 3);
  assert.equal(nearest("avialable", ["available", "pending"]), "available");
  assert.equal(nearest("zzzzzz", ["available", "pending"]), undefined);
});

test("placeholderFor prefers default, then example, then enum, then type zero", () => {
  assert.equal(placeholderFor({ type: "integer", default: 9 }), 9);
  assert.equal(placeholderFor({ type: "string", example: "hi" }), "hi");
  assert.equal(placeholderFor({ type: "string", enum: ["a", "b"] }), "a");
  assert.equal(placeholderFor({ type: "boolean" }), false);
  assert.deepEqual(placeholderFor({ type: "array" }), []);
  assert.equal(placeholderFor({ type: ["null", "integer"] }), 0);
  assert.equal(placeholderFor(undefined), null);
});
