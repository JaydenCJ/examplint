/**
 * The fix-suggestion engine. Given a keyword-level failure, derive a
 * concrete edit a human can apply: unquote the number, pick the enum value
 * they probably meant, add the missing property with a schema-derived
 * placeholder, rename the typo'd key. Suggestions are advisory prose on
 * the diagnostic — examplint never rewrites the spec itself.
 */
import type { Failure, JsonObject, JsonValue } from "./types.js";
import { isObject } from "./document.js";
import { FORMAT_SAMPLES } from "./formats.js";
import { previewValue } from "./validate.js";

/** Damerau-lite edit distance (insert / delete / substitute), capped small. */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i, ...new Array<number>(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = curr;
  }
  return prev[n]!;
}

/** The candidate closest to `target`, if convincingly close. */
export function nearest(target: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const d = editDistance(target.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  if (best === undefined) return undefined;
  const threshold = Math.max(1, Math.floor(Math.max(target.length, best.length) / 3));
  return bestDistance <= threshold ? best : undefined;
}

/** A schema-derived placeholder value, for "add the missing property" fixes. */
export function placeholderFor(schema: JsonValue | undefined): JsonValue {
  if (!isObject(schema)) return null;
  if ("default" in schema) return schema["default"]!;
  if ("example" in schema) return schema["example"]!;
  if (Array.isArray(schema["examples"]) && schema["examples"].length > 0) return schema["examples"][0]!;
  if ("const" in schema) return schema["const"]!;
  if (Array.isArray(schema["enum"]) && schema["enum"].length > 0) return schema["enum"][0]!;
  const declared = schema["type"];
  const type = Array.isArray(declared) ? declared.find((t) => t !== "null") : declared;
  switch (type) {
    case "string": {
      const format = schema["format"];
      if (typeof format === "string" && FORMAT_SAMPLES[format] !== undefined) return FORMAT_SAMPLES[format]!;
      return "";
    }
    case "integer":
    case "number": {
      const minimum = schema["minimum"];
      return typeof minimum === "number" ? minimum : 0;
    }
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return null;
  }
}

/** "1 character", "2 characters" — count plus correctly pluralized noun. */
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function listPreview(values: JsonValue[], max = 4): string {
  const shown = values.slice(0, max).map((v) => previewValue(v));
  const suffix = values.length > max ? `, … (${values.length} total)` : "";
  return shown.join(", ") + suffix;
}

/** Derive a fix suggestion for one failure; undefined when none is safe. */
export function suggestFor(failure: Failure): string | undefined {
  const params = failure.params ?? {};
  switch (failure.keyword) {
    case "type":
      return suggestType(params);
    case "enum": {
      const allowed = params["allowed"];
      const value = params["value"];
      if (!Array.isArray(allowed)) return undefined;
      if (typeof value === "string") {
        const near = nearest(value, allowed.filter((v): v is string => typeof v === "string"));
        if (near !== undefined) return `did you mean ${JSON.stringify(near)}?`;
      }
      if (typeof value === "number") {
        const asString = allowed.find((v) => typeof v === "string" && v === String(value));
        if (asString !== undefined) return `quote it: ${JSON.stringify(asString)} (the enum holds strings)`;
      }
      return `use one of: ${listPreview(allowed as JsonValue[])}`;
    }
    case "const": {
      const expected = params["expected"];
      return expected === undefined ? undefined : `use the constant ${previewValue(expected as JsonValue)}`;
    }
    case "multipleOf": {
      const value = params["value"];
      const multipleOf = params["multipleOf"];
      if (typeof value !== "number" || typeof multipleOf !== "number") return undefined;
      const snapped = Math.round(value / multipleOf) * multipleOf;
      const rounded = Number(snapped.toPrecision(12));
      return `nearest multiple is ${rounded}`;
    }
    case "maximum":
    case "minimum": {
      const limit = params["limit"];
      const exclusive = params["exclusive"] === true;
      if (typeof limit !== "number") return undefined;
      const op = failure.keyword === "maximum" ? (exclusive ? "<" : "<=") : exclusive ? ">" : ">=";
      return `use a value ${op} ${limit}`;
    }
    case "maxLength": {
      const limit = params["limit"];
      const length = params["length"];
      if (typeof limit !== "number" || typeof length !== "number") return undefined;
      return `shorten the string by ${plural(length - limit, "character")}`;
    }
    case "minLength": {
      const limit = params["limit"];
      const length = params["length"];
      if (typeof limit !== "number" || typeof length !== "number") return undefined;
      return `lengthen the string by ${plural(limit - length, "character")}`;
    }
    case "pattern": {
      const pattern = params["pattern"];
      return typeof pattern === "string" ? `make the value match ${JSON.stringify(pattern)}` : undefined;
    }
    case "format": {
      const format = params["format"];
      if (typeof format !== "string") return undefined;
      const sample = FORMAT_SAMPLES[format];
      return sample === undefined ? undefined : `a valid ${format} looks like ${JSON.stringify(sample)}`;
    }
    case "required": {
      const property = params["property"];
      const schema = params["schema"];
      if (typeof property !== "string") return undefined;
      const schemaValue = schema as JsonValue | undefined;
      const propSchema =
        isObject(schemaValue) && isObject(schemaValue["properties"]) ? (schemaValue["properties"] as JsonObject)[property] : undefined;
      return `add ${JSON.stringify(property)}: ${JSON.stringify(placeholderFor(propSchema))}`;
    }
    case "additionalProperties": {
      const property = params["property"];
      const declared = params["declared"];
      if (typeof property !== "string") return undefined;
      if (Array.isArray(declared)) {
        const near = nearest(property, declared.filter((v): v is string => typeof v === "string"));
        if (near !== undefined) return `did you mean ${JSON.stringify(near)}?`;
      }
      return `remove ${JSON.stringify(property)} or declare it in the schema`;
    }
    case "uniqueItems": {
      const duplicate = params["duplicate"];
      return typeof duplicate === "number" ? `remove the duplicate item at index ${duplicate}` : undefined;
    }
    case "anyOf":
    case "oneOf": {
      const matched = params["matched"];
      if (Array.isArray(matched) && matched.length > 1) {
        return `make the value match exactly one branch (add or change a discriminating field)`;
      }
      const best = params["best"];
      const bestFailures = params["bestFailures"];
      if (typeof best === "number" && Array.isArray(bestFailures) && bestFailures.length > 0) {
        const first = bestFailures[0] as Failure;
        const where = first.instancePath === "" ? "" : ` at ${first.instancePath}`;
        return `closest is branch #${best} — ${plural(bestFailures.length, "issue")}, first: ${first.message}${where}`;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

function suggestType(params: Record<string, unknown>): string | undefined {
  const allowed = params["allowed"];
  const value = params["value"];
  if (!Array.isArray(allowed)) return undefined;
  const wants = (t: string): boolean => allowed.includes(t);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((wants("integer") || wants("number")) && trimmed !== "" && Number.isFinite(Number(trimmed))) {
      const numeric = Number(trimmed);
      if (wants("integer") && !Number.isInteger(numeric)) return undefined;
      return `unquote it: ${numeric}`;
    }
    if (wants("boolean") && (trimmed === "true" || trimmed === "false")) return `unquote it: ${trimmed}`;
    if (wants("null") && trimmed === "null") return `use null (unquoted)`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    if (wants("string")) return `quote it: ${JSON.stringify(String(value))}`;
    if (wants("integer") && typeof value === "number" && !Number.isInteger(value)) {
      return `round it: ${Math.round(value)}`;
    }
  }
  if (value === null && !wants("null")) {
    return `null is not allowed here; provide a ${allowed.filter((t) => t !== "null").join(" | ")} value`;
  }
  if (Array.isArray(value) && wants("object")) return undefined;
  return undefined;
}
