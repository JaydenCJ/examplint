// End-to-end CLI runs against the compiled dist/cli.js in fresh temp dirs:
// exit codes, formats and multi-file behavior are the scripting contract.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CLI = join(ROOT, "dist", "cli.js");
const PETSTORE = join(ROOT, "examples", "petstore.yaml");
const DRIFTED = join(ROOT, "examples", "drifted.yaml");

function run(...args) {
  const result = spawnSync("node", [CLI, ...args], { encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function tempSpec(content, name = "api.json") {
  const dir = mkdtempSync(join(tmpdir(), "examplint-test-"));
  const file = join(dir, name);
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}

test("--version matches package.json; --help documents every subcommand and flag", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const version = run("--version");
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), pkg.version);
  const help = run("--help");
  assert.equal(help.code, 0);
  for (const needle of ["check", "list", "--format", "--strict", "--check-defaults", "--quiet"]) {
    assert.ok(help.stdout.includes(needle), `help missing ${needle}`);
  }
});

test("the bundled clean petstore exits 0 with zero findings", () => {
  const { code, stdout } = run("check", PETSTORE);
  assert.equal(code, 0);
  assert.match(stdout, /11 examples checked, 0 skipped/);
  assert.match(stdout, /OK \(0 errors, 0 warnings\)/);
});

test("the bundled drifted petstore exits 1 with the seeded findings", () => {
  const { code, stdout } = run(DRIFTED); // verb-free spelling
  assert.equal(code, 1);
  assert.match(stdout, /FAIL \(6 errors, 1 warning\)/);
  for (const needle of ["E101", "E102", "E103", "E106", "E107", "W203", 'did you mean "available"?', "unquote it: 25"]) {
    assert.ok(stdout.includes(needle), `report missing ${needle}`);
  }
});

test("JSON input works end to end (content sniffing, not extensions)", () => {
  const file = tempSpec({
    openapi: "3.1.0",
    info: { title: "t", version: "1" },
    paths: {
      "/a": {
        get: {
          responses: {
            200: { description: "ok", content: { "application/json": { schema: { const: 1 }, example: 2 } } },
          },
        },
      },
    },
  });
  const { code, stdout } = run("check", file, "--format", "json");
  assert.equal(code, 1);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.diagnostics[0].code, "E102");
});

test("--strict turns a warnings-only run into exit 1", () => {
  const file = tempSpec({
    openapi: "3.0.3",
    info: { title: "t", version: "1" },
    paths: {
      "/a": {
        get: {
          responses: {
            200: {
              description: "ok",
              content: { "application/json": { schema: { type: "string", format: "uuid" }, example: "nope" } },
            },
          },
        },
      },
    },
  });
  const relaxed = run("check", file);
  assert.equal(relaxed.code, 0);
  assert.match(relaxed.stdout, /OK \(0 errors, 1 warning\)/);
  const strict = run("check", file, "--strict");
  assert.equal(strict.code, 1);
  // The verdict line agrees with the exit code, so logs read consistently.
  assert.match(strict.stdout, /FAIL \(0 errors, 1 warning\)/);
});

test("--check-defaults flips a bad default from invisible to exit 1", () => {
  const file = tempSpec({
    openapi: "3.0.3",
    info: { title: "t", version: "1" },
    paths: {},
    components: { schemas: { Limit: { type: "integer", minimum: 1, default: 0 } } },
  });
  assert.equal(run("check", file).code, 0);
  const strict = run("check", file, "--check-defaults");
  assert.equal(strict.code, 1);
  assert.match(strict.stdout, /E103/);
});

test("list shows every site with pointers; skipped sites are labeled", () => {
  const { code, stdout } = run("list", PETSTORE);
  assert.equal(code, 0);
  assert.match(stdout, /11 example sites/);
  assert.match(stdout, /\[schema-example\]/);
  assert.match(stdout, /at \/components\/schemas\/Pet\/example/);
});

test("multiple files: the worst outcome wins; --quiet keeps only summary lines", () => {
  const { code, stdout } = run("check", PETSTORE, DRIFTED, "--quiet");
  assert.equal(code, 1);
  assert.match(stdout, /petstore\.yaml: OK/);
  assert.match(stdout, /drifted\.yaml: FAIL/);
  assert.deepEqual(
    stdout.trim().split("\n").filter((l) => l !== ""),
    [
      `${PETSTORE}: 11 examples checked, 0 skipped`,
      `${PETSTORE}: OK (0 errors, 0 warnings)`,
      `${DRIFTED}: 5 examples checked, 0 skipped`,
      `${DRIFTED}: FAIL (6 errors, 1 warning)`,
    ]
  );
});

test("missing files and unparseable specs exit 2 with stderr, not a crash", () => {
  const missing = run("check", "/nonexistent/spec.yaml");
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /cannot read file/);
  const invalid = run("check", tempSpec("a: &x 1", "bad.yaml"));
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /anchors and aliases/);
  const usage = run("--format", "xml");
  assert.equal(usage.code, 2);
  assert.match(usage.stderr, /--format expects/);
});
