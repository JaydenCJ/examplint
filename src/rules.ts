/**
 * The stable rule catalog. Codes are API: scripts match on them, so a code
 * is never renumbered or repurposed — new findings get new codes. Errors
 * (E1xx) mean an example does not conform to its schema; warnings (W2xx)
 * mean examplint could not fully check something (or found an
 * annotation-level mismatch) and is telling you instead of staying quiet.
 */
import type { Severity } from "./types.js";

export const RULES: Record<string, [Severity, string]> = {
  E101: ["error", "value type does not match the schema type"],
  E102: ["error", "value is not among the allowed enum/const values"],
  E103: ["error", "numeric constraint violated (minimum/maximum/multipleOf)"],
  E104: ["error", "string constraint violated (minLength/maxLength/pattern)"],
  E105: ["error", "array constraint violated (min/maxItems, uniqueItems, contains)"],
  E106: ["error", "object constraint violated (required, property count, names)"],
  E107: ["error", "property not declared and additionalProperties is false"],
  E108: ["error", "value fails schema composition (oneOf/anyOf/not)"],
  W201: ["warning", "unresolvable $ref; example skipped or partially checked"],
  W202: ["warning", "externalValue example cannot be fetched offline; skipped"],
  W203: ["warning", "value does not match its declared format (annotation)"],
  W204: ["warning", "unknown format; value not verified"],
  W205: ["warning", "non-JSON media type; example not validated"],
  W206: ["warning", "example has both value and externalValue"],
  W207: ["warning", "example has no schema to validate against"],
  W208: ["warning", "schema pattern is not a valid regular expression"],
  W209: ["warning", "example object has neither value nor externalValue"],
};

/** Map a validator keyword to its stable rule code. */
export function codeForKeyword(keyword: string): string {
  switch (keyword) {
    case "type":
    case "false-schema":
      return "E101";
    case "enum":
    case "const":
      return "E102";
    case "multipleOf":
    case "maximum":
    case "minimum":
      return "E103";
    case "maxLength":
    case "minLength":
    case "pattern":
      return "E104";
    case "maxItems":
    case "minItems":
    case "uniqueItems":
    case "contains":
      return "E105";
    case "required":
    case "maxProperties":
    case "minProperties":
    case "propertyNames":
      return "E106";
    case "additionalProperties":
      return "E107";
    case "anyOf":
    case "oneOf":
    case "not":
      return "E108";
    case "format":
      return "W203";
    case "format-unknown":
      return "W204";
    case "ref":
      return "W201";
    case "pattern-invalid":
      return "W208";
    default:
      return "E101"; // conservative: unknown keywords read as conformance errors
  }
}

export function severityOf(code: string): Severity {
  return RULES[code]?.[0] ?? "error";
}
