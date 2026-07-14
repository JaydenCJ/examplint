// checkDocument: the glue that turns failures into coded, counted,
// suggestion-bearing diagnostics. Codes and counts are the CLI contract.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { checkDocument, RULES, codeForKeyword, severityOf } from "../dist/index.js";
import { doc30, docWithMediaExample } from "./helpers.mjs";

test("a conforming document reports ok with zero diagnostics", () => {
  const report = checkDocument(docWithMediaExample({ type: "integer" }, 42));
  assert.equal(report.ok, true);
  assert.equal(report.checked, 1);
  assert.equal(report.skipped, 0);
  assert.deepEqual(report.diagnostics, []);
});

test("failures carry stable codes, site pointers and suggestions", () => {
  const report = checkDocument(docWithMediaExample({ type: "integer" }, "42"));
  assert.equal(report.ok, false);
  assert.equal(report.errorCount, 1);
  const d = report.diagnostics[0];
  assert.equal(d.code, "E101");
  assert.equal(d.severity, "error");
  assert.equal(d.sitePointer, "/paths/~1things/get/responses/200/content/application~1json/example");
  assert.equal(d.suggestion, "unquote it: 42");
});

test("format mismatches are warnings and keep ok = true without --strict", () => {
  const report = checkDocument(docWithMediaExample({ type: "string", format: "uuid" }, "not-a-uuid"));
  assert.equal(report.ok, true);
  assert.equal(report.warningCount, 1);
  assert.equal(report.diagnostics[0].code, "W203");
});

test("unknown formats are reported once per schema location per site", () => {
  const schema = { type: "array", items: { type: "string", format: "stock-ticker" } };
  const report = checkDocument(docWithMediaExample(schema, ["a", "b", "c"]));
  const w204 = report.diagnostics.filter((d) => d.code === "W204");
  assert.equal(w204.length, 1);
});

test("skipped sites are counted and produce their W-diagnostic", () => {
  const doc = doc30({
    paths: {
      "/a": {
        get: {
          responses: {
            200: {
              description: "ok",
              content: {
                "application/xml": { schema: { type: "string" }, example: "<x/>" },
                "application/json": { schema: { type: "integer" }, example: 5 },
              },
            },
          },
        },
      },
    },
  });
  const report = checkDocument(doc);
  assert.equal(report.sites, 2);
  assert.equal(report.checked, 1);
  assert.equal(report.skipped, 1);
  assert.deepEqual(report.diagnostics.map((d) => d.code), ["W205"]);
  assert.equal(report.ok, true);
});

test("check-defaults validates default values like examples", () => {
  const doc = doc30({
    components: { schemas: { Limit: { type: "integer", minimum: 1, default: 0 } } },
  });
  assert.equal(checkDocument(doc).checked, 0);
  const report = checkDocument(doc, { checkDefaults: true });
  assert.equal(report.checked, 1);
  assert.deepEqual(report.diagnostics.map((d) => [d.code, d.sitePointer]), [["E103", "/components/schemas/Limit/default"]]);
});

test("an unresolvable schema $ref downgrades to W201, never a crash", () => {
  const report = checkDocument(docWithMediaExample({ $ref: "#/components/schemas/Ghost" }, 1));
  assert.deepEqual(report.diagnostics.map((d) => d.code), ["W201"]);
  assert.equal(report.ok, true);
});

test("every rule code has a prefix-matching severity; every keyword maps to a cataloged code", () => {
  for (const [code, [severity]] of Object.entries(RULES)) {
    assert.equal(severity, code.startsWith("E") ? "error" : "warning", code);
    assert.equal(severityOf(code), severity);
  }
  const keywords = [
    "type", "false-schema", "enum", "const", "multipleOf", "maximum", "minimum",
    "maxLength", "minLength", "pattern", "maxItems", "minItems", "uniqueItems",
    "contains", "required", "maxProperties", "minProperties", "propertyNames",
    "additionalProperties", "anyOf", "oneOf", "not", "format", "format-unknown",
    "ref", "pattern-invalid",
  ];
  for (const keyword of keywords) {
    assert.ok(RULES[codeForKeyword(keyword)] !== undefined, keyword);
  }
});
