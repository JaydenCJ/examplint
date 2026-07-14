// Flag parsing: the CLI surface is small, so every flag and every rejection
// path is pinned here without touching the filesystem.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CliError, parseCliArgs } from "../dist/cliargs.js";

test("a bare spec path defaults to the check command", () => {
  const options = parseCliArgs(["api.yaml"]);
  assert.equal(options.command, "check");
  assert.deepEqual(options.files, ["api.yaml"]);
});

test("explicit subcommands and multiple files parse", () => {
  assert.deepEqual(parseCliArgs(["check", "a.yaml", "b.json"]).files, ["a.yaml", "b.json"]);
  assert.equal(parseCliArgs(["list", "a.yaml"]).command, "list");
});

test("flags: --strict, --check-defaults, --quiet, --format (both spellings)", () => {
  const options = parseCliArgs(["check", "a.yaml", "--strict", "--check-defaults", "-q", "--format", "json"]);
  assert.equal(options.strict, true);
  assert.equal(options.checkDefaults, true);
  assert.equal(options.quiet, true);
  assert.equal(options.format, "json");
  assert.equal(parseCliArgs(["a.yaml", "--format=json"]).format, "json");
  // help/version win regardless of other arguments.
  assert.equal(parseCliArgs(["--help"]).command, "help");
  assert.equal(parseCliArgs(["check", "a.yaml", "-V"]).command, "version");
});

test("bad --format values, unknown flags and missing files raise CliError", () => {
  assert.throws(() => parseCliArgs(["a.yaml", "--format", "xml"]), CliError);
  assert.throws(() => parseCliArgs(["a.yaml", "--frobnicate"]), CliError);
  assert.throws(() => parseCliArgs([]), /no spec file given/);
  assert.throws(() => parseCliArgs(["list"]), /no spec file given/);
});
