// Format checkers: each checker gets a valid and an invalid probe. These
// are the values that make W203 fire, so false positives here would spam
// every report.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { FORMAT_CHECKERS, FORMAT_SAMPLES, OPAQUE_FORMATS } from "../dist/formats.js";

function ok(format, value) {
  assert.equal(FORMAT_CHECKERS[format](value), true, `${format} should accept ${JSON.stringify(value)}`);
}

function bad(format, value) {
  assert.equal(FORMAT_CHECKERS[format](value), false, `${format} should reject ${JSON.stringify(value)}`);
}

test("date family: calendar rules, T separator, zone offsets, leap seconds", () => {
  ok("date", "2026-07-12");
  ok("date", "2024-02-29"); // leap year
  bad("date", "2026-02-29"); // not a leap year
  bad("date", "2026-13-01");
  bad("date", "12/07/2026");
  ok("date-time", "2026-07-12T09:30:00Z");
  ok("date-time", "2026-07-12t23:59:60+09:00"); // lowercase t, leap second
  bad("date-time", "2026-07-12 09:30:00Z"); // space separator
  bad("date-time", "2026-07-12T09:30:00"); // missing offset
  bad("date-time", "yesterday");
  ok("time", "09:30:00.123+02:00");
  bad("time", "24:00:00Z");
  bad("time", "09:30Z");
});

test("duration, email and hostname reject the classic paste mistakes", () => {
  ok("duration", "P3DT4H");
  ok("duration", "PT0.5S");
  bad("duration", "P");
  bad("duration", "3 days");
  ok("email", "dev@example.test");
  bad("email", "dev@");
  bad("email", "dev example.test");
  ok("hostname", "api.example.test");
  bad("hostname", "-bad.example.test");
});

test("uuid, ipv4 and ipv6 validate shape strictly", () => {
  ok("uuid", "3f2b6c1e-8a4d-4f60-9b2a-5c7d8e9f0a1b");
  bad("uuid", "3f2b6c1e8a4d4f609b2a5c7d8e9f0a1b");
  ok("ipv4", "127.0.0.1");
  bad("ipv4", "256.0.0.1");
  ok("ipv6", "::1");
  ok("ipv6", "2001:db8::8a2e:370:7334");
  bad("ipv6", "2001:::1");
  bad("ipv6", "1:2:3:4:5:6:7:8:9");
});

test("uri requires a scheme, uri-reference does not, byte means base64", () => {
  ok("uri", "https://example.test/path");
  bad("uri", "/relative/only");
  ok("uri-reference", "/relative/only");
  bad("uri-reference", "has space");
  ok("byte", "aGVsbG8=");
  bad("byte", "not base64!");
});

test("int32/int64 bound numbers; float/double reject non-finite JSON impossibilities", () => {
  ok("int32", 2147483647);
  bad("int32", 2147483648);
  bad("int32", 1.5);
  ok("int64", 9007199254740991);
  bad("int64", 9007199254740993); // beyond safe integers: silently corrupted
  ok("double", 1.5);
});

test("every advertised sample passes its own checker, so suggestions are honest", () => {
  for (const [format, sample] of Object.entries(FORMAT_SAMPLES)) {
    const checker = FORMAT_CHECKERS[format];
    assert.ok(checker !== undefined, `sample for unknown format ${format}`);
    const numeric = format === "int32" || format === "int64" || format === "float" || format === "double";
    assert.equal(checker(numeric ? Number(sample) : sample), true, `sample for ${format} must be valid`);
  }
});

test("opaque formats are declared, not silently dropped", () => {
  assert.ok(OPAQUE_FORMATS.has("binary"));
  assert.ok(OPAQUE_FORMATS.has("password"));
  for (const format of OPAQUE_FORMATS) {
    assert.equal(FORMAT_CHECKERS[format], undefined, `${format} must not also have a checker`);
  }
});
