/**
 * Public programmatic API. The CLI is a thin wrapper over these exports;
 * everything here is pure (string/value in, report out) and offline.
 *
 * ```ts
 * import { parseDocument, checkDocument } from "examplint";
 * const doc = parseDocument(readFileSync("openapi.yaml", "utf8"));
 * const report = checkDocument(doc);
 * if (!report.ok) console.error(report.diagnostics);
 * ```
 */
export { checkDocument } from "./check.js";
export { discoverSites, isJsonMediaType } from "./discover.js";
export { DocumentError, parseDocument, resolveRef, derefObject, isObject } from "./document.js";
export type { SpecDocument, RefResolution } from "./document.js";
export { FORMAT_CHECKERS, FORMAT_SAMPLES, OPAQUE_FORMATS } from "./formats.js";
export { escapeToken, unescapeToken, joinPointer, parsePointer, getByPointer } from "./pointer.js";
export { renderJson, renderSiteList, renderText } from "./report.js";
export { RULES, codeForKeyword, severityOf } from "./rules.js";
export { editDistance, nearest, placeholderFor, suggestFor } from "./suggest.js";
export { ANNOTATION_KEYWORDS, deepEqual, isAnnotationFailure, jsonTypeOf, previewValue, validateValue } from "./validate.js";
export { parseYaml, plainScalar, YamlError } from "./yaml.js";
export { VERSION } from "./version.js";
export type {
  CheckOptions,
  Diagnostic,
  ExampleSite,
  Failure,
  JsonObject,
  JsonValue,
  Report,
  Severity,
  SiteKind,
} from "./types.js";
