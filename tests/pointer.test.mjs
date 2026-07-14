// JSON Pointer helpers: escaping is where real specs bite (paths contain
// "/", media types contain nothing special but templates contain "{}").
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { escapeToken, getByPointer, joinPointer, parsePointer, unescapeToken } from "../dist/pointer.js";

test("escape/unescape are inverses; joinPointer escapes each appended token", () => {
  for (const token of ["/pets/{petId}", "~tilde", "a~1b", "plain", ""]) {
    assert.equal(unescapeToken(escapeToken(token)), token);
  }
  assert.equal(joinPointer("", "paths", "/pets/{petId}", "get"), "/paths/~1pets~1{petId}/get");
  assert.equal(joinPointer("/a", 0, "x~y"), "/a/0/x~0y");
});

test("parsePointer splits and unescapes; missing leading slash is rejected", () => {
  assert.deepEqual(parsePointer(""), []);
  assert.deepEqual(parsePointer("/paths/~1pets/get"), ["paths", "/pets", "get"]);
  assert.throws(() => parsePointer("paths/x"), /invalid JSON Pointer/);
});

test("getByPointer walks objects and arrays", () => {
  const doc = { paths: { "/pets": { get: { tags: ["a", "b"] } } } };
  assert.equal(getByPointer(doc, "/paths/~1pets/get/tags/1"), "b");
  assert.deepEqual(getByPointer(doc, ""), doc);
});

test("getByPointer: missing steps and bad indices yield undefined, stored null stays null", () => {
  const doc = { list: [1, 2], value: null };
  assert.equal(getByPointer(doc, "/nope"), undefined);
  assert.equal(getByPointer(doc, "/list/5"), undefined);
  assert.equal(getByPointer(doc, "/list/01"), undefined); // leading zero is not an index
  assert.equal(getByPointer(doc, "/list/x"), undefined);
  assert.equal(getByPointer(doc, "/value"), null);
});
