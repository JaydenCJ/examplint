/**
 * RFC 6901 JSON Pointer helpers. Pointers are the project's addressing
 * scheme: every diagnostic carries one pointing into the spec document and
 * one pointing into the example value, so editors and scripts can jump
 * straight to the offending node.
 */
import type { JsonValue } from "./types.js";

/** Escape one reference token (`~` -> `~0`, `/` -> `~1`). */
export function escapeToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Unescape one reference token. Order matters: `~1` first, then `~0`. */
export function unescapeToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** Append tokens to a pointer, escaping each. join("", "a/b") = "/a~1b". */
export function joinPointer(base: string, ...tokens: (string | number)[]): string {
  let out = base;
  for (const token of tokens) {
    out += "/" + escapeToken(String(token));
  }
  return out;
}

/**
 * Split a pointer into unescaped tokens. "" -> []; "/a/b" -> ["a", "b"].
 * Throws on pointers that do not start with "/" (except the empty pointer).
 */
export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new Error(`invalid JSON Pointer: ${JSON.stringify(pointer)}`);
  }
  return pointer.slice(1).split("/").map(unescapeToken);
}

/**
 * Resolve a pointer against a document. Returns undefined when any step is
 * missing — callers decide whether that is an error or a skip.
 */
export function getByPointer(doc: JsonValue, pointer: string): JsonValue | undefined {
  let node: JsonValue | undefined = doc;
  for (const token of parsePointer(pointer)) {
    if (node === null || typeof node !== "object") return undefined;
    if (Array.isArray(node)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) return undefined;
      node = node[Number(token)];
    } else {
      if (!Object.prototype.hasOwnProperty.call(node, token)) return undefined;
      node = node[token];
    }
  }
  return node;
}
