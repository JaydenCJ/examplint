// Site discovery: every place an example can hide must be found exactly
// once, with a pointer that resolves and a label a human can navigate by.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { discoverSites, getByPointer, isJsonMediaType } from "../dist/index.js";
import { doc30, doc31 } from "./helpers.mjs";

test("media-type example and named examples are both discovered", () => {
  const doc = doc30({
    paths: {
      "/a": {
        get: {
          responses: {
            200: {
              description: "ok",
              content: {
                "application/json": {
                  schema: { type: "integer" },
                  example: 1,
                  examples: { one: { value: 1 }, two: { value: 2 } },
                },
              },
            },
          },
        },
      },
    },
  });
  const sites = discoverSites(doc);
  assert.deepEqual(
    sites.map((s) => [s.kind, s.pointer]),
    [
      ["media-example", "/paths/~1a/get/responses/200/content/application~1json/example"],
      ["named-example", "/paths/~1a/get/responses/200/content/application~1json/examples/one/value"],
      ["named-example", "/paths/~1a/get/responses/200/content/application~1json/examples/two/value"],
    ]
  );
  // Every pointer must actually resolve to the example value, and repeat
  // discovery must be byte-for-byte deterministic.
  for (const site of sites) {
    assert.deepEqual(getByPointer(doc.root, site.pointer), site.value);
  }
  assert.deepEqual(discoverSites(doc).map((s) => s.pointer), sites.map((s) => s.pointer));
});

test("parameter examples are found at path level, operation level and components", () => {
  const doc = doc30({
    paths: {
      "/a/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" }, example: 7 }],
        get: {
          parameters: [{ $ref: "#/components/parameters/Limit" }],
          responses: { 200: { description: "ok" } },
        },
      },
    },
    components: { parameters: { Limit: { name: "limit", in: "query", schema: { type: "integer" }, example: 20 } } },
  });
  const sites = discoverSites(doc);
  assert.deepEqual(
    sites.map((s) => [s.label, s.pointer]),
    [
      // Path-level parameters apply to every method, so no method prefix.
      ["/a/{id} → param id → example", "/paths/~1a~1{id}/parameters/0/example"],
      ["GET /a/{id} → param limit → example", "/components/parameters/Limit/example"],
    ]
  );
});

test("a component referenced twice is discovered once, under its first label", () => {
  const shared = {
    description: "shared",
    content: { "application/json": { schema: { type: "string" }, example: "x" } },
  };
  const doc = doc30({
    paths: {
      "/a": { get: { responses: { 200: { $ref: "#/components/responses/Shared" } } } },
      "/b": { get: { responses: { 200: { $ref: "#/components/responses/Shared" } } } },
    },
    components: { responses: { Shared: shared } },
  });
  const sites = discoverSites(doc);
  assert.equal(sites.length, 1);
  assert.equal(sites[0].label, "GET /a → 200 → application/json → example");
});

test("schema-level example, 3.1 examples arrays and nested subschemas are walked", () => {
  const doc = doc31({
    components: {
      schemas: {
        Pet: {
          type: "object",
          properties: { tag: { type: "string", examples: ["small", "large"] } },
          example: { tag: "small" },
        },
      },
    },
  });
  const sites = discoverSites(doc);
  assert.deepEqual(
    sites.map((s) => [s.kind, s.pointer]),
    [
      ["schema-example", "/components/schemas/Pet/example"],
      ["schema-example", "/components/schemas/Pet/properties/tag/examples/0"],
      ["schema-example", "/components/schemas/Pet/properties/tag/examples/1"],
    ]
  );
});

test("defaults become sites only under checkDefaults", () => {
  const doc = doc30({
    components: { schemas: { Limit: { type: "integer", default: 20 } } },
  });
  assert.equal(discoverSites(doc).length, 0);
  const withDefaults = discoverSites(doc, { checkDefaults: true });
  assert.deepEqual(withDefaults.map((s) => [s.kind, s.pointer]), [["schema-default", "/components/schemas/Limit/default"]]);
});

test("non-JSON media types skip with W205; +json suffixes and parameters count as JSON", () => {
  const doc = doc30({
    paths: {
      "/a": {
        get: {
          responses: {
            200: {
              description: "ok",
              content: { "application/xml": { schema: { type: "string" }, example: "<x/>" } },
            },
          },
        },
      },
    },
  });
  const sites = discoverSites(doc);
  assert.equal(sites.length, 1);
  assert.equal(sites[0].skip.code, "W205");
  assert.ok(isJsonMediaType("application/json"));
  assert.ok(isJsonMediaType("application/problem+json"));
  assert.ok(isJsonMediaType("application/json; charset=utf-8"));
  assert.ok(!isJsonMediaType("application/xml"));
  assert.ok(!isJsonMediaType("text/plain"));
});

test("externalValue-only examples skip with W202; both present warns W206", () => {
  const doc = doc30({
    paths: {
      "/a": {
        get: {
          responses: {
            200: {
              description: "ok",
              content: {
                "application/json": {
                  schema: { type: "integer" },
                  examples: {
                    ext: { externalValue: "https://example.test/big.json" },
                    both: { value: 1, externalValue: "https://example.test/big.json" },
                    empty: { summary: "nothing here" },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  const sites = discoverSites(doc);
  const byName = Object.fromEntries(sites.map((s) => [s.label.split("examples.")[1], s]));
  assert.equal(byName.ext.skip.code, "W202");
  assert.equal(byName.both.skip, undefined);
  assert.deepEqual(byName.both.warnings.map((w) => w.code), ["W206"]);
  assert.equal(byName.empty.skip.code, "W209");
});

test("schema-less examples and unreferenced components.examples skip as W207, not silence", () => {
  const noSchema = doc30({
    paths: {
      "/a": {
        get: {
          responses: {
            200: { description: "ok", content: { "application/json": { example: 1 } } },
          },
        },
      },
    },
  });
  assert.equal(discoverSites(noSchema)[0].skip.code, "W207");
  const orphan = doc30({ components: { examples: { Orphan: { value: { any: "thing" } } } } });
  const sites = discoverSites(orphan);
  assert.equal(sites.length, 1);
  assert.equal(sites[0].pointer, "/components/examples/Orphan/value");
  assert.equal(sites[0].skip.code, "W207");
});

test("request bodies, response headers and webhooks are all walked", () => {
  const doc = doc31({
    paths: {
      "/a": {
        post: {
          requestBody: { content: { "application/json": { schema: { type: "integer" }, example: 5 } } },
          responses: {
            200: {
              description: "ok",
              headers: { "X-Next": { schema: { type: "string" }, example: "cursor" } },
            },
          },
        },
      },
    },
    webhooks: {
      ping: {
        post: {
          requestBody: { content: { "application/json": { schema: { type: "string" }, example: "pong" } } },
          responses: { 200: { description: "ok" } },
        },
      },
    },
  });
  const kinds = discoverSites(doc).map((s) => [s.kind, s.label]);
  assert.deepEqual(kinds, [
    ["media-example", "POST /a → requestBody → application/json → example"],
    ["header-example", "POST /a → 200 → header X-Next → example"],
    ["media-example", "POST webhook ping → requestBody → application/json → example"],
  ]);
});
