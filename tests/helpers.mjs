// Shared factories for the test suite. Everything is deterministic and
// in-memory; CLI tests build their own temp dirs.
import { parseDocument } from "../dist/index.js";

/** A minimal valid 3.0 document with the given extra top-level fields. */
export function doc30(extra = {}) {
  return parseDocument(
    JSON.stringify({
      openapi: "3.0.3",
      info: { title: "t", version: "1" },
      paths: {},
      ...extra,
    })
  );
}

/** A minimal valid 3.1 document with the given extra top-level fields. */
export function doc31(extra = {}) {
  return parseDocument(
    JSON.stringify({
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      paths: {},
      ...extra,
    })
  );
}

/** Wrap one media-type example + schema into a full document. */
export function docWithMediaExample(schema, example, { version = "3.0.3" } = {}) {
  return parseDocument(
    JSON.stringify({
      openapi: version,
      info: { title: "t", version: "1" },
      paths: {
        "/things": {
          get: {
            responses: {
              200: {
                description: "ok",
                content: { "application/json": { schema, example } },
              },
            },
          },
        },
      },
    })
  );
}
