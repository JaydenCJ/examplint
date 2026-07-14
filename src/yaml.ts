/**
 * A small, dependency-free parser for the YAML subset that real-world
 * OpenAPI documents actually use: block mappings and sequences, flow
 * collections, quoted/plain scalars, block scalars (| and >), and comments.
 *
 * Deliberately unsupported (each fails with a clear, line-numbered error
 * instead of silently mis-parsing): anchors/aliases, tags, merge keys,
 * multi-document streams, and tab indentation. docs/yaml-support.md lists
 * the full contract; JSON input bypasses this module entirely.
 */
import type { JsonValue } from "./types.js";

export class YamlError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`YAML parse error at line ${line}: ${message}`);
    this.name = "YamlError";
    this.line = line;
  }
}

interface Line {
  indent: number;
  /** Content with indentation stripped; never empty. */
  text: string;
  /** 1-based line number in the source. */
  no: number;
}

export function parseYaml(source: string): JsonValue {
  return new Parser(source).parseDocument();
}

class Parser {
  private readonly raw: string[];
  private readonly lines: Line[] = [];
  private pos = 0;

  constructor(source: string) {
    this.raw = source.split(/\r\n|\n|\r/);
    this.scan();
  }

  /** Pre-scan raw lines into meaningful lines, keeping block-scalar bodies raw. */
  private scan(): void {
    for (let i = 0; i < this.raw.length; i++) {
      const raw = this.raw[i]!;
      const no = i + 1;
      if (/^\s*$/.test(raw)) continue;
      const indentMatch = /^ */.exec(raw)!;
      const indent = indentMatch[0].length;
      const text = raw.slice(indent);
      if (text.startsWith("\t") || indentMatch[0].includes("\t")) {
        throw new YamlError("tab characters are not allowed in indentation", no);
      }
      if (text.startsWith("#")) continue;
      if (text.startsWith("%")) {
        if (indent === 0) continue; // ignore %YAML / %TAG directives
        throw new YamlError("unexpected '%' in content", no);
      }
      this.lines.push({ indent, text, no });
    }
  }

  parseDocument(): JsonValue {
    // Optional leading "---"; a second one means a multi-document stream.
    if (this.peek()?.text === "---") this.pos++;
    const value = this.parseNode(0);
    const rest = this.peek();
    if (rest !== undefined) {
      if (rest.text === "...") {
        this.pos++;
        if (this.peek() === undefined) return value;
      }
      if (rest.text === "---" || this.peek()?.text === "---") {
        throw new YamlError("multi-document YAML streams are not supported", this.peek()!.no);
      }
      throw new YamlError(`unexpected content: ${JSON.stringify(this.peek()!.text)}`, this.peek()!.no);
    }
    return value;
  }

  private peek(): Line | undefined {
    return this.lines[this.pos];
  }

  /** Parse the node starting at the next line, which must be at >= minIndent. */
  private parseNode(minIndent: number): JsonValue {
    const line = this.peek();
    if (line === undefined || line.indent < minIndent) return null;
    if (line.text === "-" || line.text.startsWith("- ")) {
      return this.parseSequence(line.indent);
    }
    if (this.findKey(line.text, line.no) !== undefined) {
      return this.parseMapping(line.indent);
    }
    // A bare scalar document/value on its own line.
    this.pos++;
    return this.parseFlowOrScalar(stripComment(line.text, line.no), line.no);
  }

  private parseMapping(indent: number): JsonValue {
    const out: { [key: string]: JsonValue } = {};
    for (;;) {
      const line = this.peek();
      if (line === undefined || line.indent !== indent) break;
      if (line.text === "-" || line.text.startsWith("- ")) break;
      if (line.text === "---" || line.text === "...") break; // document marker
      const keySplit = this.findKey(line.text, line.no);
      if (keySplit === undefined) {
        throw new YamlError(`expected "key: value", got ${JSON.stringify(line.text)}`, line.no);
      }
      const { key, rest } = keySplit;
      if (key === "<<") {
        throw new YamlError("merge keys (<<) are not supported", line.no);
      }
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        throw new YamlError(`duplicate mapping key ${JSON.stringify(key)}`, line.no);
      }
      this.pos++;
      out[key] = this.parseValueAfterKey(rest, indent, line.no);
    }
    return out;
  }

  /** Parse whatever follows "key:" — inline scalar, block scalar or nested block. */
  private parseValueAfterKey(rest: string, indent: number, no: number): JsonValue {
    const trimmed = stripComment(rest, no).trim();
    if (trimmed === "") {
      const next = this.peek();
      if (next !== undefined && next.indent > indent) return this.parseNode(next.indent);
      // YAML allows a block sequence at the SAME indent as its mapping key.
      if (next !== undefined && next.indent === indent && (next.text === "-" || next.text.startsWith("- "))) {
        return this.parseSequence(indent);
      }
      return null;
    }
    if (trimmed.startsWith("|") || trimmed.startsWith(">")) {
      return this.parseBlockScalar(trimmed, indent, no);
    }
    const value = this.parseFlowOrScalar(trimmed, no);
    // Multi-line plain scalars: more-indented continuation lines that are
    // neither keys nor sequence items fold into the value with spaces.
    if (typeof value === "string" && !/^["'[{]/.test(trimmed)) {
      let folded = value;
      for (;;) {
        const next = this.peek();
        if (next === undefined || next.indent <= indent) break;
        if (next.text === "-" || next.text.startsWith("- ")) break;
        if (this.findKey(next.text, next.no) !== undefined) break;
        folded += " " + stripComment(next.text, next.no).trim();
        this.pos++;
      }
      return folded;
    }
    return value;
  }

  private parseSequence(indent: number): JsonValue {
    const out: JsonValue[] = [];
    for (;;) {
      const line = this.peek();
      if (line === undefined || line.indent !== indent) break;
      if (line.text !== "-" && !line.text.startsWith("- ")) break;
      if (line.text === "-") {
        this.pos++;
        const next = this.peek();
        out.push(next !== undefined && next.indent > indent ? this.parseNode(next.indent) : null);
        continue;
      }
      const restOffset = line.text.length - line.text.slice(1).trimStart().length;
      const rest = line.text.slice(restOffset);
      const itemIndent = indent + restOffset;
      if (this.findKey(rest, line.no) !== undefined) {
        // "- key: value": rewrite the item as a mapping line at its own column
        // so following keys at the same column join the same mapping.
        this.lines[this.pos] = { indent: itemIndent, text: rest, no: line.no };
        out.push(this.parseMapping(itemIndent));
        continue;
      }
      this.pos++;
      const trimmed = stripComment(rest, line.no).trim();
      if (trimmed.startsWith("|") || trimmed.startsWith(">")) {
        out.push(this.parseBlockScalar(trimmed, indent, line.no));
      } else if (trimmed === "- " || trimmed === "-" || trimmed.startsWith("- ")) {
        // Nested sequence on the same line ("- - a") — rewrite like mappings.
        this.lines.splice(this.pos, 0, { indent: itemIndent, text: rest, no: line.no });
        out.push(this.parseSequence(itemIndent));
      } else {
        out.push(this.parseFlowOrScalar(trimmed, line.no));
      }
    }
    return out;
  }

  /** Parse "|"/" >" block scalars, honoring strip (-) and keep (+) chomping. */
  private parseBlockScalar(header: string, parentIndent: number, no: number): string {
    const match = /^([|>])([+-]?)([0-9]?)([+-]?)\s*(#.*)?$/.exec(header);
    if (match === null) {
      throw new YamlError(`malformed block scalar header ${JSON.stringify(header)}`, no);
    }
    const style = match[1]!;
    const chomp = match[2] || match[4] || "";
    const explicit = match[3] === "" ? undefined : Number(match[3]);

    // Collect raw body lines strictly more indented than the parent node.
    const body: string[] = [];
    let baseIndent: number | undefined = explicit === undefined ? undefined : parentIndent + explicit;
    let i = no; // raw[] is 0-based; line `no` is raw[no - 1], body starts at raw[no].
    for (; i < this.raw.length; i++) {
      const rawLine = this.raw[i]!;
      if (/^\s*$/.test(rawLine)) {
        body.push("");
        continue;
      }
      const lineIndent = /^ */.exec(rawLine)![0].length;
      if (lineIndent <= parentIndent) break;
      if (baseIndent === undefined) baseIndent = lineIndent;
      if (lineIndent < baseIndent) break;
      body.push(rawLine.slice(baseIndent));
    }
    // Drop the consumed body from the meaningful-line stream.
    while (this.pos < this.lines.length && this.lines[this.pos]!.no <= i) this.pos++;
    let trailingBlanks = 0;
    while (body.length > 0 && body[body.length - 1] === "") {
      body.pop();
      trailingBlanks++;
    }

    let text: string;
    if (style === "|") {
      text = body.join("\n");
    } else {
      // Folded: single newlines become spaces, blank lines become newlines.
      text = "";
      let paragraphOpen = false;
      for (const bodyLine of body) {
        if (bodyLine === "") {
          text += "\n";
          paragraphOpen = false;
        } else {
          if (paragraphOpen) text += " ";
          text += bodyLine;
          paragraphOpen = true;
        }
      }
    }
    if (body.length === 0) return chomp === "+" ? "\n".repeat(trailingBlanks) : "";
    if (chomp === "-") return text;
    if (chomp === "+") return text + "\n".repeat(trailingBlanks + 1);
    return text + "\n"; // default: clip to exactly one trailing newline
  }

  /**
   * Find the "key:" split of a mapping line, respecting quotes. Returns
   * undefined when the line is not a mapping entry (i.e. a plain scalar).
   */
  private findKey(text: string, no: number): { key: string; rest: string } | undefined {
    if (text.startsWith("? ")) {
      throw new YamlError("explicit complex mapping keys (?) are not supported", no);
    }
    let i = 0;
    let key: string;
    if (text.startsWith('"') || text.startsWith("'")) {
      const quote = text[0]!;
      const end = this.scanQuoted(text, 0, no);
      key = quote === '"' ? parseDoubleQuoted(text.slice(1, end), no) : text.slice(1, end).replace(/''/g, "'");
      i = end + 1;
      const colon = /^\s*:/.exec(text.slice(i));
      if (colon === null) return undefined;
      i += colon[0].length;
    } else {
      // Plain key: ends at the first ": " or ":" at end of line, outside flow.
      let depth = 0;
      let colonAt = -1;
      for (let j = 0; j < text.length; j++) {
        const ch = text[j]!;
        if (ch === "[" || ch === "{") depth++;
        else if (ch === "]" || ch === "}") depth--;
        else if (ch === ":" && depth === 0) {
          const nextCh = text[j + 1];
          if (nextCh === undefined || nextCh === " ") {
            colonAt = j;
            break;
          }
        } else if (ch === "#" && j > 0 && text[j - 1] === " ") {
          break; // comment before any colon
        }
      }
      if (colonAt === -1) return undefined;
      key = text.slice(0, colonAt).trim();
      if (key === "") throw new YamlError("empty mapping key", no);
      i = colonAt + 1;
    }
    return { key, rest: text.slice(i) };
  }

  /** Index of the closing quote for a quoted scalar starting at `start`. */
  private scanQuoted(text: string, start: number, no: number): number {
    const quote = text[start]!;
    for (let j = start + 1; j < text.length; j++) {
      if (quote === "'" && text[j] === "'") {
        if (text[j + 1] === "'") {
          j++; // escaped '' inside single quotes
          continue;
        }
        return j;
      }
      if (quote === '"') {
        if (text[j] === "\\") {
          j++;
          continue;
        }
        if (text[j] === '"') return j;
      }
    }
    throw new YamlError("unterminated quoted string", no);
  }

  /** Parse an inline value: flow collection, quoted string or plain scalar. */
  private parseFlowOrScalar(text: string, no: number): JsonValue {
    const first = text[0];
    if (first === "[" || first === "{" || first === '"' || first === "'") {
      const flow = new FlowParser(text, no);
      const value = flow.parseValue();
      flow.expectEnd();
      return value;
    }
    if (first === "&" || first === "*") {
      throw new YamlError("anchors and aliases are not supported (inline the value instead)", no);
    }
    if (first === "!") {
      throw new YamlError("YAML tags are not supported", no);
    }
    // Block-context plain scalar: commas, brackets and colons are literal.
    return plainScalar(text.trim());
  }
}

/** Strip a trailing comment (a "#" preceded by whitespace, outside quotes). */
function stripComment(text: string, no: number): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inDouble) {
      if (ch === "\\") i++;
      else if (ch === '"') inDouble = false;
    } else if (inSingle) {
      if (ch === "'") {
        if (text[i + 1] === "'") i++;
        else inSingle = false;
      }
    } else if (ch === '"') inDouble = true;
    else if (ch === "'") inSingle = true;
    else if (ch === "#" && (i === 0 || text[i - 1] === " " || text[i - 1] === "\t")) {
      return text.slice(0, i);
    }
  }
  if (inSingle || inDouble) throw new YamlError("unterminated quoted string", no);
  return text;
}

/** Recursive-descent parser for flow collections ([...], {...}) and scalars. */
class FlowParser {
  private i = 0;
  constructor(
    private readonly text: string,
    private readonly no: number
  ) {}

  parseValue(): JsonValue {
    this.skipSpace();
    const ch = this.text[this.i];
    if (ch === undefined) return null;
    if (ch === "[") return this.parseFlowSequence();
    if (ch === "{") return this.parseFlowMapping();
    if (ch === '"' || ch === "'") return this.parseQuoted();
    if (ch === "&" || ch === "*") {
      throw new YamlError("anchors and aliases are not supported (inline the value instead)", this.no);
    }
    if (ch === "!") {
      throw new YamlError("YAML tags are not supported", this.no);
    }
    return this.parsePlain();
  }

  expectEnd(): void {
    this.skipSpace();
    if (this.i < this.text.length) {
      throw new YamlError(`unexpected trailing content ${JSON.stringify(this.text.slice(this.i))}`, this.no);
    }
  }

  private skipSpace(): void {
    while (this.text[this.i] === " " || this.text[this.i] === "\t") this.i++;
  }

  private parseFlowSequence(): JsonValue {
    this.i++; // consume "["
    const out: JsonValue[] = [];
    this.skipSpace();
    if (this.text[this.i] === "]") {
      this.i++;
      return out;
    }
    for (;;) {
      out.push(this.parseValue());
      this.skipSpace();
      const ch = this.text[this.i];
      if (ch === ",") {
        this.i++;
        this.skipSpace();
        if (this.text[this.i] === "]") {
          this.i++; // trailing comma
          return out;
        }
        continue;
      }
      if (ch === "]") {
        this.i++;
        return out;
      }
      throw new YamlError("expected ',' or ']' in flow sequence", this.no);
    }
  }

  private parseFlowMapping(): JsonValue {
    this.i++; // consume "{"
    const out: { [key: string]: JsonValue } = {};
    this.skipSpace();
    if (this.text[this.i] === "}") {
      this.i++;
      return out;
    }
    for (;;) {
      this.skipSpace();
      const keyValue = this.parseValue();
      const key = typeof keyValue === "string" ? keyValue : jsonScalarToKey(keyValue, this.no);
      this.skipSpace();
      let value: JsonValue = null;
      if (this.text[this.i] === ":") {
        this.i++;
        value = this.parseValue();
      }
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        throw new YamlError(`duplicate mapping key ${JSON.stringify(key)}`, this.no);
      }
      out[key] = value;
      this.skipSpace();
      const ch = this.text[this.i];
      if (ch === ",") {
        this.i++;
        this.skipSpace();
        if (this.text[this.i] === "}") {
          this.i++;
          return out;
        }
        continue;
      }
      if (ch === "}") {
        this.i++;
        return out;
      }
      throw new YamlError("expected ',' or '}' in flow mapping", this.no);
    }
  }

  private parseQuoted(): string {
    const quote = this.text[this.i]!;
    let j = this.i + 1;
    let raw = "";
    for (; j < this.text.length; j++) {
      const ch = this.text[j]!;
      if (quote === "'") {
        if (ch === "'") {
          if (this.text[j + 1] === "'") {
            raw += "'";
            j++;
            continue;
          }
          this.i = j + 1;
          return raw;
        }
        raw += ch;
      } else {
        if (ch === "\\") {
          raw += ch + (this.text[j + 1] ?? "");
          j++;
          continue;
        }
        if (ch === '"') {
          this.i = j + 1;
          return parseDoubleQuoted(raw, this.no);
        }
        raw += ch;
      }
    }
    throw new YamlError("unterminated quoted string", this.no);
  }

  private parsePlain(): JsonValue {
    let j = this.i;
    let value = "";
    for (; j < this.text.length; j++) {
      const ch = this.text[j]!;
      if (ch === "," || ch === "]" || ch === "}" || (ch === ":" && (this.text[j + 1] === " " || this.text[j + 1] === undefined))) {
        break;
      }
      value += ch;
    }
    this.i = j;
    return plainScalar(value.trim());
  }
}

function jsonScalarToKey(value: JsonValue, no: number): string {
  if (value === null || typeof value === "object") {
    throw new YamlError("complex mapping keys are not supported", no);
  }
  return String(value);
}

const ESCAPES: Record<string, string> = {
  "0": "\0",
  a: "\x07",
  b: "\b",
  t: "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  e: "\x1b",
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
};

/** Decode the escapes of a double-quoted YAML scalar body. */
function parseDoubleQuoted(body: string, no: number): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) throw new YamlError("dangling backslash in double-quoted string", no);
    if (next === "u" || next === "U" || next === "x") {
      const width = next === "x" ? 2 : next === "u" ? 4 : 8;
      const hex = body.slice(i + 2, i + 2 + width);
      if (hex.length !== width || !/^[0-9a-fA-F]+$/.test(hex)) {
        throw new YamlError(`invalid \\${next} escape`, no);
      }
      out += String.fromCodePoint(parseInt(hex, 16));
      i += 1 + width;
      continue;
    }
    const mapped = ESCAPES[next];
    if (mapped === undefined) throw new YamlError(`unknown escape \\${next}`, no);
    out += mapped;
    i++;
  }
  return out;
}

const NUMBER_RE = /^[+-]?(0x[0-9a-fA-F]+|0o[0-7]+|(0|[1-9][0-9]*)(\.[0-9]*)?([eE][+-]?[0-9]+)?|\.[0-9]+([eE][+-]?[0-9]+)?)$/;

/** Interpret an unquoted scalar per YAML 1.2 core schema (JSON-compatible). */
export function plainScalar(text: string): JsonValue {
  if (text === "" || text === "~" || text === "null" || text === "Null" || text === "NULL") return null;
  if (text === "true" || text === "True" || text === "TRUE") return true;
  if (text === "false" || text === "False" || text === "FALSE") return false;
  if (NUMBER_RE.test(text)) {
    if (/^[+-]?0x/.test(text)) return parseInt(text, 16);
    if (/^[+-]?0o/.test(text)) {
      const negative = text.startsWith("-");
      const digits = text.replace(/^[+-]?0o/, "");
      return (negative ? -1 : 1) * parseInt(digits, 8);
    }
    return Number(text);
  }
  return text;
}
