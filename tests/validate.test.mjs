// The schema validator: one focused test per keyword family, both OpenAPI
// 3.0 quirks (nullable, boolean exclusiveMaximum) and 3.1 forms (type
// arrays, prefixItems, const), plus $ref cycles — the case that crashes
// naive validators.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { deepEqual, isAnnotationFailure, jsonTypeOf, previewValue, validateValue } from "../dist/validate.js";

/** Validate with an empty root document (schemas without $refs). */
function failuresOf(value, schema, version = "3.0") {
  return validateValue({}, version, value, schema, "/s");
}

function keywords(value, schema, version = "3.0") {
  return failuresOf(value, schema, version).map((f) => f.keyword);
}

test("a conforming object yields zero failures", () => {
  const schema = {
    type: "object",
    required: ["id"],
    properties: { id: { type: "integer", minimum: 1 }, name: { type: "string" } },
    additionalProperties: false,
  };
  assert.deepEqual(failuresOf({ id: 3, name: "ok" }, schema), []);
});

test("type: integer rejects floats and strings but accepts whole numbers", () => {
  assert.deepEqual(keywords(3, { type: "integer" }), []);
  assert.deepEqual(keywords(3.0, { type: "integer" }), []);
  assert.deepEqual(keywords(3.5, { type: "integer" }), ["type"]);
  assert.deepEqual(keywords("3", { type: "integer" }), ["type"]);
});

test("null handling: 3.1 type arrays vs 3.0 nullable (which short-circuits)", () => {
  assert.deepEqual(keywords(null, { type: ["string", "null"] }, "3.1"), []);
  assert.deepEqual(keywords("x", { type: ["string", "null"] }, "3.1"), []);
  assert.deepEqual(keywords(5, { type: ["string", "null"] }, "3.1"), ["type"]);
  assert.deepEqual(keywords(null, { type: "string", nullable: true, minLength: 3 }), []);
  assert.deepEqual(keywords(null, { type: "string" }), ["type"]);
});

test("enum uses deep equality; const is checked independently", () => {
  const schema = { enum: [[1, 2], { a: 1 }] };
  assert.deepEqual(keywords([1, 2], schema), []);
  assert.deepEqual(keywords({ a: 1 }, schema), []);
  assert.deepEqual(keywords([2, 1], schema), ["enum"]);
  assert.deepEqual(keywords("v2", { const: "v1" }, "3.1"), ["const"]);
});

test("numeric bounds: 3.0 boolean exclusives, 3.1 numeric exclusives, float-safe multipleOf", () => {
  const draft4 = { type: "number", maximum: 10, exclusiveMaximum: true };
  assert.deepEqual(keywords(9.9, draft4), []);
  assert.deepEqual(keywords(10, draft4), ["maximum"]);
  const modern = { type: "number", exclusiveMinimum: 0 };
  assert.deepEqual(keywords(0.1, modern, "3.1"), []);
  assert.deepEqual(keywords(0, modern, "3.1"), ["minimum"]);
  assert.deepEqual(keywords(0.3, { multipleOf: 0.1 }), []); // no 0.30000000000000004 false positive
  assert.deepEqual(keywords(0.35, { multipleOf: 0.1 }), ["multipleOf"]);
});

test("string constraints: code-point lengths, pattern misses, invalid patterns as annotations", () => {
  assert.deepEqual(keywords("ab🦜", { type: "string", maxLength: 3 }), []); // emoji count once
  assert.deepEqual(keywords("abcd", { type: "string", maxLength: 3 }), ["maxLength"]);
  assert.deepEqual(keywords("a", { type: "string", minLength: 2 }), ["minLength"]);
  assert.deepEqual(keywords("zz9", { type: "string", pattern: "^[a-z]+$" }), ["pattern"]);
  const invalid = failuresOf("x", { type: "string", pattern: "([" });
  assert.deepEqual(invalid.map((f) => f.keyword), ["pattern-invalid"]);
  assert.ok(invalid.every(isAnnotationFailure));
});

test("array constraints: items, min/maxItems, uniqueItems and 3.1 prefixItems", () => {
  const schema = { type: "array", items: { type: "integer" }, minItems: 1, maxItems: 3, uniqueItems: true };
  assert.deepEqual(keywords([1, 2], schema), []);
  assert.deepEqual(keywords([], schema), ["minItems"]);
  assert.deepEqual(keywords([1, 2, 3, 4], schema), ["maxItems"]);
  assert.deepEqual(keywords([1, "x"], schema), ["type"]);
  const dup = failuresOf([1, 2, 1], schema);
  assert.deepEqual(dup.map((f) => [f.keyword, f.instancePath]), [["uniqueItems", "/2"]]);
  const tuple = { type: "array", prefixItems: [{ type: "string" }, { type: "integer" }], items: { type: "boolean" } };
  assert.deepEqual(keywords(["a", 1, true, false], tuple, "3.1"), []);
  assert.deepEqual(failuresOf(["a", "x", 3], tuple, "3.1").map((f) => f.instancePath), ["/1", "/2"]);
});

test("required failures name the property; nested paths compose", () => {
  const schema = {
    type: "object",
    properties: { pet: { type: "object", required: ["id"], properties: { id: { type: "integer" } } } },
  };
  const bad = failuresOf({ pet: {} }, schema);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].keyword, "required");
  assert.equal(bad[0].instancePath, "/pet");
  assert.match(bad[0].message, /"id"/);
});

test("additionalProperties: false flags undeclared keys; a schema validates extras", () => {
  const closed = { type: "object", properties: { name: {} }, additionalProperties: false };
  const bad = failuresOf({ name: "x", nmae: "y" }, closed);
  assert.deepEqual(bad.map((f) => [f.keyword, f.instancePath]), [["additionalProperties", "/nmae"]]);
  const open = { type: "object", additionalProperties: { type: "integer" } };
  assert.deepEqual(keywords({ a: 1 }, open), []);
  assert.deepEqual(keywords({ a: "x" }, open), ["type"]);
});

test("patternProperties claims matching keys away from additionalProperties", () => {
  const schema = { type: "object", patternProperties: { "^x-": { type: "string" } }, additionalProperties: false };
  assert.deepEqual(keywords({ "x-trace": "on" }, schema), []);
  assert.deepEqual(keywords({ "x-trace": 5 }, schema), ["type"]);
  assert.deepEqual(keywords({ other: "v" }, schema), ["additionalProperties"]);
});

test("allOf aggregates failures from every branch; not fails when its schema matches", () => {
  const schema = { allOf: [{ type: "object", required: ["a"] }, { type: "object", required: ["b"] }] };
  assert.deepEqual(failuresOf({}, schema).map((f) => f.keyword), ["required", "required"]);
  assert.deepEqual(keywords("x", { not: { type: "string" } }), ["not"]);
  assert.deepEqual(keywords(1, { not: { type: "string" } }), []);
});

test("oneOf: zero matches reports the closest branch, two matches reports ambiguity", () => {
  const schema = {
    oneOf: [
      { type: "object", required: ["kind", "wingspan"] },
      { type: "object", required: ["kind", "legs"] },
    ],
  };
  const none = failuresOf({ other: 1 }, schema);
  assert.equal(none.length, 1);
  assert.equal(none[0].keyword, "oneOf");
  assert.deepEqual(none[0].params.matched, []);
  const both = failuresOf({ kind: "bat", wingspan: 1, legs: 2 }, schema);
  assert.equal(both[0].keyword, "oneOf");
  assert.deepEqual(both[0].params.matched, [0, 1]);
});

test("anyOf passes when one branch matches and keeps only its annotations", () => {
  const schema = { anyOf: [{ type: "integer" }, { type: "string", format: "date" }] };
  assert.deepEqual(keywords(5, schema), []);
  const dateWarn = failuresOf("not-a-date", schema);
  assert.deepEqual(dateWarn.map((f) => f.keyword), ["format"]);
  assert.ok(dateWarn.every(isAnnotationFailure));
});

test("$ref resolves through the document and reports the resolved schemaPath", () => {
  const root = { components: { schemas: { Id: { type: "integer", minimum: 1 } } } };
  const bad = validateValue(root, "3.0", 0, { $ref: "#/components/schemas/Id" }, "/s");
  assert.equal(bad.length, 1);
  assert.equal(bad[0].schemaPath, "/components/schemas/Id/minimum");
  // Unresolvable refs downgrade to an annotation-class failure, never a crash.
  const ghost = validateValue({}, "3.0", 1, { $ref: "#/components/schemas/Ghost" }, "/s");
  assert.deepEqual(ghost.map((f) => f.keyword), ["ref"]);
  assert.ok(isAnnotationFailure(ghost[0]));
});

test("recursive schemas validate recursive data without infinite loops", () => {
  const root = {
    components: {
      schemas: {
        Node: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" }, children: { type: "array", items: { $ref: "#/components/schemas/Node" } } },
        },
      },
    },
  };
  const schema = { $ref: "#/components/schemas/Node" };
  const good = { name: "root", children: [{ name: "leaf", children: [] }] };
  assert.deepEqual(validateValue(root, "3.0", good, schema, "/s"), []);
  const bad = { name: "root", children: [{ children: [] }] };
  const failures = validateValue(root, "3.0", bad, schema, "/s");
  assert.deepEqual(failures.map((f) => [f.keyword, f.instancePath]), [["required", "/children/0"]]);
});

test("3.1 keywords: boolean schemas, contains/minContains, dependentRequired", () => {
  assert.deepEqual(failuresOf({ any: 1 }, true, "3.1"), []);
  assert.deepEqual(keywords(1, false, "3.1"), ["false-schema"]);
  const containing = { type: "array", contains: { type: "integer" }, minContains: 2 };
  assert.deepEqual(keywords([1, "a", 2], containing, "3.1"), []);
  assert.deepEqual(keywords([1, "a"], containing, "3.1"), ["contains"]);
  const dependent = { type: "object", dependentRequired: { card: ["cvv"] } };
  assert.deepEqual(keywords({ cash: true }, dependent, "3.1"), []);
  assert.deepEqual(keywords({ card: "visa" }, dependent, "3.1"), ["required"]);
});

test("helpers: jsonTypeOf, deepEqual and previewValue behave as documented", () => {
  assert.equal(jsonTypeOf(null), "null");
  assert.equal(jsonTypeOf([1]), "array");
  assert.equal(jsonTypeOf({}), "object");
  assert.ok(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
  assert.ok(!deepEqual({ a: 1 }, { a: 1, b: 2 }));
  assert.equal(previewValue("short"), '"short"');
  assert.ok(previewValue("x".repeat(100)).length <= 48);
});
