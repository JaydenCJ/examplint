// Document loading: content sniffing (JSON vs YAML), OpenAPI version
// detection, and internal-only $ref resolution with cycle protection.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DocumentError, derefObject, parseDocument, resolveRef } from "../dist/index.js";

const MINIMAL = { openapi: "3.0.3", info: { title: "t", version: "1" }, paths: {} };

test("JSON is detected by content (not extension); YAML goes through the subset parser", () => {
  const json = parseDocument(JSON.stringify(MINIMAL), "spec.yaml");
  assert.equal(json.version, "3.0");
  assert.equal(json.openapi, "3.0.3");
  const yaml = parseDocument("openapi: 3.1.0\ninfo:\n  title: t\n  version: '1'\npaths: {}\n");
  assert.equal(yaml.version, "3.1");
});

test("bad input is rejected explicitly: parse errors carry the file label, wrong versions say why", () => {
  assert.throws(() => parseDocument("{broken", "api.json"), (e) => e instanceof DocumentError && e.message.startsWith("api.json:"));
  assert.throws(() => parseDocument("a: &x 1", "api.yaml"), (e) => e instanceof DocumentError && e.message.startsWith("api.yaml:"));
  assert.throws(() => parseDocument("{}"), /missing "openapi"/);
  assert.throws(() => parseDocument(JSON.stringify({ swagger: "2.0" })), /Swagger 2.0 is not supported/);
  assert.throws(() => parseDocument(JSON.stringify({ ...MINIMAL, openapi: "4.0.0" })), /unsupported OpenAPI version "4.0.0"/);
});

test("resolveRef follows internal pointers and percent-encoded refs", () => {
  const root = { components: { schemas: { Pet: { type: "object" } } } };
  assert.deepEqual(resolveRef(root, "#/components/schemas/Pet").value, { type: "object" });
  assert.deepEqual(resolveRef(root, "#/components/schemas/Pet").pointer, "/components/schemas/Pet");
  assert.deepEqual(resolveRef(root, "#%2Fcomponents%2Fschemas%2FPet").value, { type: "object" });
});

test("external and dangling refs return a reason instead of throwing", () => {
  const root = {};
  assert.match(resolveRef(root, "https://example.test/openapi.yaml#/X").reason, /external reference/);
  assert.match(resolveRef(root, "./other.yaml#/X").reason, /external reference/);
  assert.match(resolveRef(root, "#/components/schemas/Missing").reason, /does not resolve/);
});

test("derefObject follows chains and stops on cycles with a reason", () => {
  const root = {
    a: { $ref: "#/b" },
    b: { $ref: "#/c" },
    c: { done: true },
    loop1: { $ref: "#/loop2" },
    loop2: { $ref: "#/loop1" },
  };
  const ok = derefObject(root, root.a, "/a");
  assert.deepEqual(ok.node, { done: true });
  assert.equal(ok.pointer, "/c");
  const cycle = derefObject(root, root.loop1, "/loop1");
  assert.equal(cycle.node, undefined);
  assert.match(cycle.reason, /reference cycle/);
});
