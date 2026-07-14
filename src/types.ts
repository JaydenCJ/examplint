/**
 * Shared types for examplint. Everything the public API exposes is defined
 * here so consumers can type their own tooling against a single import.
 */

/** Any value representable in JSON — the shape of parsed specs and examples. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** A JSON object (the usual shape of an OpenAPI node). */
export type JsonObject = { [key: string]: JsonValue };

export type Severity = "error" | "warning";

/**
 * Where an example was found. The kind decides how it is reported and which
 * skip rules apply (e.g. media-type examples on XML bodies are skipped).
 */
export type SiteKind =
  | "media-example" // content.<mt>.example
  | "named-example" // content.<mt>.examples.<name>.value (also parameters/headers)
  | "parameter-example" // parameter.example
  | "header-example" // header.example
  | "schema-example" // schema.example (3.0) or schema.examples[i] (3.1)
  | "schema-default"; // schema.default (only with --check-defaults)

/** One discovered example: a value paired with the schema it must satisfy. */
export interface ExampleSite {
  /** JSON Pointer to the example value inside the spec document. */
  pointer: string;
  kind: SiteKind;
  /** Human-readable route, e.g. "GET /pets → 200 → application/json → examples.ok". */
  label: string;
  /** The example value itself; undefined when only externalValue is given. */
  value: JsonValue | undefined;
  /** The (unresolved) schema node governing this example; undefined if none. */
  schema: JsonObject | boolean | undefined;
  /** JSON Pointer to that schema node inside the spec document. */
  schemaPointer: string;
  /** Media type, when the example sits under a content map. */
  mediaType?: string;
  /** Set when the site cannot be validated; becomes a W-diagnostic. */
  skip?: { code: string; reason: string };
  /** Non-fatal findings (e.g. value + externalValue both present). */
  warnings?: { code: string; reason: string }[];
}

/** One keyword-level validation failure, produced by the schema validator. */
export interface Failure {
  /** The schema keyword that failed, e.g. "type", "required", "format". */
  keyword: string;
  /** JSON Pointer inside the example value ("" = the example root). */
  instancePath: string;
  /** JSON Pointer to the violated keyword inside the spec document. */
  schemaPath: string;
  message: string;
  /** Keyword-specific details used by the suggestion engine. */
  params?: Record<string, unknown>;
}

/** A reported finding: a failure bound to its site, coded and suggested. */
export interface Diagnostic {
  /** Stable rule code, e.g. "E101" (see docs/rules.md). Never renumbered. */
  code: string;
  severity: Severity;
  /** JSON Pointer to the example value inside the spec document. */
  sitePointer: string;
  /** Human-readable route of the site. */
  siteLabel: string;
  /** JSON Pointer inside the example value ("" = the example root). */
  instancePath: string;
  /** JSON Pointer to the violated schema keyword ("" for site-level issues). */
  schemaPath: string;
  message: string;
  /** A concrete, human-applicable fix, when one can be derived. */
  suggestion?: string;
}

/** The result of checking one spec document. */
export interface Report {
  /** All example sites discovered, including skipped ones. */
  sites: number;
  /** Sites actually validated against a schema. */
  checked: number;
  /** Sites skipped (no schema, external value, non-JSON media type, …). */
  skipped: number;
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
  /** True when there are no errors (warnings alone keep ok = true). */
  ok: boolean;
}

/** Options accepted by the checker (mirrors the CLI flags). */
export interface CheckOptions {
  /** Also validate schema `default` values as if they were examples. */
  checkDefaults?: boolean;
}
