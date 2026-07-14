// Report rendering: the text layout is grep-able API (scripts match on
// "error E1xx" lines) and the JSON shape is the CI contract.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { checkDocument, discoverSites, renderJson, renderSiteList, renderText } from "../dist/index.js";
import { docWithMediaExample } from "./helpers.mjs";

test("text output groups diagnostics under their site with pointers", () => {
  const report = checkDocument(docWithMediaExample({ type: "integer" }, "42"));
  const text = renderText(report, "api.yaml");
  const lines = text.split("\n");
  assert.equal(lines[0], "api.yaml: 1 example checked, 0 skipped");
  assert.ok(lines.includes("GET /things → 200 → application/json → example"));
  assert.ok(lines.includes("  at /paths/~1things/get/responses/200/content/application~1json/example"));
  assert.ok(lines.some((l) => l.startsWith('  error E101: expected integer, got string "42"')));
  assert.ok(lines.includes("      fix: unquote it: 42"));
  assert.equal(lines[lines.length - 1], "api.yaml: FAIL (1 error, 0 warnings)");
  // And a clean report renders OK with zero counts.
  const clean = checkDocument(docWithMediaExample({ type: "integer" }, 42));
  assert.match(renderText(clean, "api.yaml"), /api\.yaml: OK \(0 errors, 0 warnings\)$/);
});

test("quiet mode keeps only the summary lines", () => {
  const report = checkDocument(docWithMediaExample({ type: "integer" }, "42"));
  const text = renderText(report, "api.yaml", { quiet: true });
  assert.deepEqual(text.split("\n"), [
    "api.yaml: 1 example checked, 0 skipped",
    "",
    "api.yaml: FAIL (1 error, 0 warnings)",
  ]);
});

test("JSON output parses and mirrors the report fields exactly", () => {
  const report = checkDocument(docWithMediaExample({ type: "integer" }, "42"));
  const parsed = JSON.parse(renderJson(report, "api.yaml"));
  assert.equal(parsed.file, "api.yaml");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.errorCount, 1);
  assert.equal(parsed.diagnostics.length, 1);
  assert.equal(parsed.diagnostics[0].code, "E101");
  assert.equal(parsed.diagnostics[0].suggestion, "unquote it: 42");
});

test("site listing shows kind for checked sites and code for skipped ones", () => {
  const doc = docWithMediaExample({ type: "integer" }, 1);
  const text = renderSiteList(discoverSites(doc), "api.yaml");
  assert.match(text, /api\.yaml: 1 example site$/m);
  assert.match(text, /\[media-example\]/);
});
