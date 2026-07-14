/**
 * Spec loading and $ref resolution. A document is parsed once (JSON or the
 * YAML subset, sniffed from content, not extension) and addressed by JSON
 * Pointer from then on. Only internal references ("#/...") are resolved —
 * examplint is offline by design, so external refs become W201 skips
 * instead of network calls.
 */
import type { JsonObject, JsonValue } from "./types.js";
import { getByPointer } from "./pointer.js";
import { parseYaml, YamlError } from "./yaml.js";

export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentError";
  }
}

export interface SpecDocument {
  /** The parsed document root. */
  root: JsonObject;
  /** "3.0" or "3.1" (minor family), derived from the `openapi` field. */
  version: "3.0" | "3.1";
  /** The raw `openapi` field, for reporting. */
  openapi: string;
}

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a spec from text. JSON documents must start with "{" (a spec is
 * always an object); everything else goes through the YAML subset parser.
 */
export function parseDocument(text: string, label = "<input>"): SpecDocument {
  let root: JsonValue;
  if (/^﻿?\s*\{/.test(text)) {
    try {
      root = JSON.parse(text) as JsonValue;
    } catch (error) {
      throw new DocumentError(`${label}: invalid JSON: ${(error as Error).message}`);
    }
  } else {
    try {
      root = parseYaml(text.replace(/^﻿/, ""));
    } catch (error) {
      if (error instanceof YamlError) throw new DocumentError(`${label}: ${error.message}`);
      throw error;
    }
  }
  if (!isObject(root)) {
    throw new DocumentError(`${label}: expected the document root to be an object`);
  }
  const openapi = root["openapi"];
  if (typeof openapi !== "string") {
    throw new DocumentError(
      `${label}: missing "openapi" field — examplint validates OpenAPI 3.0/3.1 documents` +
        (root["swagger"] !== undefined ? " (Swagger 2.0 is not supported)" : "")
    );
  }
  let version: "3.0" | "3.1";
  if (openapi.startsWith("3.0")) version = "3.0";
  else if (openapi.startsWith("3.1")) version = "3.1";
  else throw new DocumentError(`${label}: unsupported OpenAPI version ${JSON.stringify(openapi)}`);
  return { root, version, openapi };
}

export interface RefResolution {
  /** The resolved node, or undefined when the ref cannot be followed. */
  value: JsonValue | undefined;
  /** Pointer of the resolved node inside the document ("" for external). */
  pointer: string;
  /** Why resolution failed, when value is undefined. */
  reason?: string;
}

/** Resolve one `$ref` string against the document. Internal refs only. */
export function resolveRef(root: JsonObject, ref: string): RefResolution {
  if (!ref.startsWith("#")) {
    return { value: undefined, pointer: "", reason: `external reference ${JSON.stringify(ref)} (examplint is offline; bundle the document first)` };
  }
  const pointer = decodeURIComponent(ref.slice(1));
  let value: JsonValue | undefined;
  try {
    value = getByPointer(root, pointer);
  } catch {
    return { value: undefined, pointer, reason: `malformed reference ${JSON.stringify(ref)}` };
  }
  if (value === undefined) {
    return { value: undefined, pointer, reason: `reference ${JSON.stringify(ref)} does not resolve` };
  }
  return { value, pointer };
}

/**
 * Follow a chain of `$ref`s from a node until a concrete object is reached.
 * Guards against reference cycles. Used for OpenAPI *object* refs
 * (parameters, responses, examples, …); schema refs are resolved lazily by
 * the validator instead, so recursive schemas keep working.
 */
export function derefObject(
  root: JsonObject,
  node: JsonValue | undefined,
  pointer: string
): { node: JsonObject | undefined; pointer: string; reason?: string } {
  const seen = new Set<string>();
  let current = node;
  let currentPointer = pointer;
  while (isObject(current) && typeof current["$ref"] === "string") {
    const ref = current["$ref"];
    if (seen.has(ref)) {
      return { node: undefined, pointer: currentPointer, reason: `reference cycle through ${JSON.stringify(ref)}` };
    }
    seen.add(ref);
    const resolved = resolveRef(root, ref);
    if (resolved.value === undefined) {
      return { node: undefined, pointer: currentPointer, reason: resolved.reason };
    }
    current = resolved.value;
    currentPointer = resolved.pointer;
  }
  if (!isObject(current)) return { node: undefined, pointer: currentPointer, reason: "expected an object" };
  return { node: current, pointer: currentPointer };
}
