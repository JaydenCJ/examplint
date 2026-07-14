/**
 * Walks an OpenAPI document and finds every place an example can live:
 * media types (example / examples), parameters, headers, request bodies,
 * responses, reusable components, and — the ones review tools usually
 * miss — schema-level `example` / `examples` / `default` values nested
 * anywhere inside a schema tree.
 *
 * Discovery is purely structural: sites are emitted in document order,
 * deduplicated by pointer (a component referenced from an operation is
 * checked once, under its operation label), and never require network.
 */
import type { CheckOptions, ExampleSite, JsonObject, JsonValue, SiteKind } from "./types.js";
import type { SpecDocument } from "./document.js";
import { derefObject, isObject } from "./document.js";
import { joinPointer } from "./pointer.js";

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

/** Media types whose examples are JSON-shaped and therefore checkable. */
export function isJsonMediaType(mediaType: string): boolean {
  const bare = mediaType.split(";")[0]!.trim().toLowerCase();
  return bare === "application/json" || bare.endsWith("+json") || bare === "application/x-www-form-urlencoded" || bare === "multipart/form-data";
}

export function discoverSites(doc: SpecDocument, options: CheckOptions = {}): ExampleSite[] {
  return new Discoverer(doc, options).run();
}

class Discoverer {
  private readonly root: JsonObject;
  private readonly checkDefaults: boolean;
  private readonly sites = new Map<string, ExampleSite>();
  /** Schema trees already walked, keyed by pointer (dedups ref'd components). */
  private readonly walkedSchemas = new Set<string>();

  constructor(doc: SpecDocument, options: CheckOptions) {
    this.root = doc.root;
    this.checkDefaults = options.checkDefaults === true;
  }

  run(): ExampleSite[] {
    const paths = this.root["paths"];
    if (isObject(paths)) {
      for (const [path, item] of Object.entries(paths)) {
        this.walkPathItem(joinPointer("/paths", path), item!, path);
      }
    }
    const webhooks = this.root["webhooks"];
    if (isObject(webhooks)) {
      for (const [name, item] of Object.entries(webhooks)) {
        this.walkPathItem(joinPointer("/webhooks", name), item!, `webhook ${name}`);
      }
    }
    this.walkComponents();
    return [...this.sites.values()];
  }

  private add(site: ExampleSite): void {
    if (!this.sites.has(site.pointer)) this.sites.set(site.pointer, site);
  }

  // ---- path items and operations -------------------------------------

  private walkPathItem(pointer: string, node: JsonValue, route: string): void {
    const resolved = derefObject(this.root, node, pointer);
    if (resolved.node === undefined) return; // an unresolvable path item has no example sites
    const item = resolved.node;
    const base = resolved.pointer;
    const shared = item["parameters"];
    if (Array.isArray(shared)) {
      this.walkParameters(joinPointer(base, "parameters"), shared, route);
    }
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!isObject(op)) continue;
      const opPointer = joinPointer(base, method);
      const label = `${method.toUpperCase()} ${route}`;
      const params = op["parameters"];
      if (Array.isArray(params)) {
        this.walkParameters(joinPointer(opPointer, "parameters"), params, label);
      }
      const body = op["requestBody"];
      if (body !== undefined) {
        const bodyResolved = derefObject(this.root, body, joinPointer(opPointer, "requestBody"));
        if (bodyResolved.node !== undefined) {
          this.walkContentMap(bodyResolved.node["content"], joinPointer(bodyResolved.pointer, "content"), `${label} → requestBody`);
        }
      }
      const responses = op["responses"];
      if (isObject(responses)) {
        for (const [status, response] of Object.entries(responses)) {
          this.walkResponse(joinPointer(opPointer, "responses", status), response!, `${label} → ${status}`);
        }
      }
    }
  }

  private walkResponse(pointer: string, node: JsonValue, label: string): void {
    const resolved = derefObject(this.root, node, pointer);
    if (resolved.node === undefined) return;
    const response = resolved.node;
    this.walkContentMap(response["content"], joinPointer(resolved.pointer, "content"), label);
    const headers = response["headers"];
    if (isObject(headers)) {
      for (const [name, header] of Object.entries(headers)) {
        const headerResolved = derefObject(this.root, header!, joinPointer(resolved.pointer, "headers", name));
        if (headerResolved.node !== undefined) {
          this.walkParameterLike(headerResolved.node, headerResolved.pointer, `${label} → header ${name}`, "header-example");
        }
      }
    }
  }

  private walkParameters(basePointer: string, params: JsonValue[], label: string): void {
    for (let i = 0; i < params.length; i++) {
      const resolved = derefObject(this.root, params[i]!, joinPointer(basePointer, i));
      if (resolved.node === undefined) continue;
      const name = typeof resolved.node["name"] === "string" ? resolved.node["name"] : `#${i}`;
      this.walkParameterLike(resolved.node, resolved.pointer, `${label} → param ${name}`, "parameter-example");
    }
  }

  /** Parameters and headers share their example surface. */
  private walkParameterLike(node: JsonObject, pointer: string, label: string, kind: SiteKind): void {
    const schema = schemaNodeOf(node["schema"]);
    const schemaPointer = joinPointer(pointer, "schema");
    if ("example" in node) {
      this.add({
        pointer: joinPointer(pointer, "example"),
        kind,
        label: `${label} → example`,
        value: node["example"]!,
        schema,
        schemaPointer,
        ...(schema === undefined ? { skip: noSchemaSkip() } : {}),
      });
    }
    if (isObject(node["examples"])) {
      this.walkExamplesMap(node["examples"], joinPointer(pointer, "examples"), label, schema, schemaPointer);
    }
    this.walkContentMap(node["content"], joinPointer(pointer, "content"), label);
    if (schema !== undefined && isObject(node["schema"])) {
      this.walkSchemaTree(node["schema"], schemaPointer, `${label} → schema`);
    }
  }

  // ---- media types ----------------------------------------------------

  private walkContentMap(content: JsonValue | undefined, pointer: string, label: string): void {
    if (!isObject(content)) return;
    for (const [mediaType, media] of Object.entries(content)) {
      if (!isObject(media)) continue;
      this.walkMediaType(media, joinPointer(pointer, mediaType), `${label} → ${mediaType}`, mediaType);
    }
  }

  private walkMediaType(media: JsonObject, pointer: string, label: string, mediaType: string): void {
    const schema = schemaNodeOf(media["schema"]);
    const schemaPointer = joinPointer(pointer, "schema");
    const jsonLike = isJsonMediaType(mediaType);
    const skip = !jsonLike
      ? { code: "W205", reason: `media type ${JSON.stringify(mediaType)} is not JSON-shaped; example not validated` }
      : schema === undefined
        ? noSchemaSkip()
        : undefined;
    if ("example" in media) {
      this.add({
        pointer: joinPointer(pointer, "example"),
        kind: "media-example",
        label: `${label} → example`,
        value: media["example"]!,
        schema,
        schemaPointer,
        mediaType,
        ...(skip !== undefined ? { skip } : {}),
      });
    }
    if (isObject(media["examples"])) {
      this.walkExamplesMap(media["examples"], joinPointer(pointer, "examples"), label, schema, schemaPointer, mediaType, skip);
    }
    if (jsonLike && isObject(media["schema"])) {
      this.walkSchemaTree(media["schema"], schemaPointer, `${label} → schema`);
    }
  }

  /** An `examples` map of named Example Objects (possibly $ref'd). */
  private walkExamplesMap(
    map: JsonObject,
    pointer: string,
    label: string,
    schema: JsonObject | boolean | undefined,
    schemaPointer: string,
    mediaType?: string,
    mediaSkip?: { code: string; reason: string }
  ): void {
    for (const [name, entry] of Object.entries(map)) {
      const entryPointer = joinPointer(pointer, name);
      const siteLabel = `${label} → examples.${name}`;
      const resolved = derefObject(this.root, entry!, entryPointer);
      if (resolved.node === undefined) {
        this.add({
          pointer: entryPointer,
          kind: "named-example",
          label: siteLabel,
          value: undefined,
          schema,
          schemaPointer,
          ...(mediaType !== undefined ? { mediaType } : {}),
          skip: { code: "W201", reason: resolved.reason ?? "unresolvable example reference" },
        });
        continue;
      }
      const example = resolved.node;
      const hasValue = "value" in example;
      const hasExternal = typeof example["externalValue"] === "string";
      const warnings: { code: string; reason: string }[] = [];
      let skip = mediaSkip ?? (schema === undefined ? noSchemaSkip() : undefined);
      if (!hasValue && hasExternal) {
        skip = { code: "W202", reason: `externalValue ${JSON.stringify(example["externalValue"])} cannot be fetched offline; not validated` };
      } else if (!hasValue) {
        skip = { code: "W209", reason: "example object has neither `value` nor `externalValue`; nothing to validate" };
      } else if (hasExternal) {
        warnings.push({ code: "W206", reason: "`value` and `externalValue` are mutually exclusive; validating `value`" });
      }
      this.add({
        pointer: hasValue ? joinPointer(resolved.pointer, "value") : resolved.pointer,
        kind: "named-example",
        label: siteLabel,
        value: hasValue ? example["value"]! : undefined,
        schema,
        schemaPointer,
        ...(mediaType !== undefined ? { mediaType } : {}),
        ...(skip !== undefined ? { skip } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    }
  }

  // ---- components -----------------------------------------------------

  private walkComponents(): void {
    const components = this.root["components"];
    if (!isObject(components)) return;
    const schemas = components["schemas"];
    if (isObject(schemas)) {
      for (const [name, schema] of Object.entries(schemas)) {
        if (isObject(schema)) {
          this.walkSchemaTree(schema, joinPointer("/components/schemas", name), `components.schemas.${name}`);
        }
      }
    }
    const parameters = components["parameters"];
    if (isObject(parameters)) {
      for (const [name, parameter] of Object.entries(parameters)) {
        if (isObject(parameter)) {
          this.walkParameterLike(parameter, joinPointer("/components/parameters", name), `components.parameters.${name}`, "parameter-example");
        }
      }
    }
    const headers = components["headers"];
    if (isObject(headers)) {
      for (const [name, header] of Object.entries(headers)) {
        if (isObject(header)) {
          this.walkParameterLike(header, joinPointer("/components/headers", name), `components.headers.${name}`, "header-example");
        }
      }
    }
    const requestBodies = components["requestBodies"];
    if (isObject(requestBodies)) {
      for (const [name, body] of Object.entries(requestBodies)) {
        if (isObject(body)) {
          this.walkContentMap(body["content"], joinPointer("/components/requestBodies", name, "content"), `components.requestBodies.${name}`);
        }
      }
    }
    const responses = components["responses"];
    if (isObject(responses)) {
      for (const [name, response] of Object.entries(responses)) {
        this.walkResponse(joinPointer("/components/responses", name), response!, `components.responses.${name}`);
      }
    }
    // Unreferenced shared examples have no schema association; surface them
    // as skips rather than pretending they were checked.
    const examples = components["examples"];
    if (isObject(examples)) {
      this.walkExamplesMap(examples, "/components/examples", "components", undefined, "");
    }
  }

  // ---- schema-level example / examples / default ----------------------

  private walkSchemaTree(schema: JsonObject, pointer: string, label: string): void {
    if (this.walkedSchemas.has(pointer)) return;
    this.walkedSchemas.add(pointer);

    if ("example" in schema) {
      this.add({
        pointer: joinPointer(pointer, "example"),
        kind: "schema-example",
        label: `${label} → example`,
        value: schema["example"]!,
        schema,
        schemaPointer: pointer,
      });
    }
    // In a Schema Object, `examples` is the 3.1 array form. A map here would
    // be a misplaced Media-Type-style examples block; it is not a schema
    // keyword, so it is ignored (structural linting is out of scope).
    const examples = schema["examples"];
    if (Array.isArray(examples)) {
      for (let i = 0; i < examples.length; i++) {
        this.add({
          pointer: joinPointer(pointer, "examples", i),
          kind: "schema-example",
          label: `${label} → examples[${i}]`,
          value: examples[i]!,
          schema,
          schemaPointer: pointer,
        });
      }
    }
    if (this.checkDefaults && "default" in schema) {
      this.add({
        pointer: joinPointer(pointer, "default"),
        kind: "schema-default",
        label: `${label} → default`,
        value: schema["default"]!,
        schema,
        schemaPointer: pointer,
      });
    }

    // Recurse into every subschema position (literal tree only: $refs are
    // not followed here, so shared components are walked exactly once).
    const objectMaps = ["properties", "patternProperties", "dependentSchemas"] as const;
    for (const key of objectMaps) {
      const map = schema[key];
      if (isObject(map)) {
        for (const [name, sub] of Object.entries(map)) {
          if (isObject(sub)) this.walkSchemaTree(sub, joinPointer(pointer, key, name), `${label}.${name}`);
        }
      }
    }
    const listKeys = ["allOf", "anyOf", "oneOf", "prefixItems"] as const;
    for (const key of listKeys) {
      const list = schema[key];
      if (Array.isArray(list)) {
        for (let i = 0; i < list.length; i++) {
          const sub = list[i];
          if (isObject(sub)) this.walkSchemaTree(sub, joinPointer(pointer, key, i), `${label}.${key}[${i}]`);
        }
      }
    }
    const singleKeys = ["items", "additionalItems", "additionalProperties", "not", "contains", "propertyNames"] as const;
    for (const key of singleKeys) {
      const sub = schema[key];
      if (isObject(sub)) this.walkSchemaTree(sub, joinPointer(pointer, key), `${label}.${key}`);
      else if (key === "items" && Array.isArray(sub)) {
        for (let i = 0; i < sub.length; i++) {
          const tuple = sub[i];
          if (isObject(tuple)) this.walkSchemaTree(tuple, joinPointer(pointer, key, i), `${label}.items[${i}]`);
        }
      }
    }
  }
}

function schemaNodeOf(node: JsonValue | undefined): JsonObject | boolean | undefined {
  if (isObject(node) || typeof node === "boolean") return node;
  return undefined;
}

function noSchemaSkip(): { code: string; reason: string } {
  return { code: "W207", reason: "no schema is declared for this example; nothing to validate against" };
}
