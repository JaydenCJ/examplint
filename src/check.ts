/**
 * Orchestrates one document check: discover the sites, validate each
 * example against its schema, translate keyword failures into stable rule
 * codes, attach fix suggestions, and count the outcome. Pure: takes a
 * parsed document, returns a Report — the CLI and the tests share it.
 */
import type { CheckOptions, Diagnostic, ExampleSite, Report } from "./types.js";
import type { SpecDocument } from "./document.js";
import { discoverSites } from "./discover.js";
import { codeForKeyword, severityOf } from "./rules.js";
import { suggestFor } from "./suggest.js";
import { validateValue } from "./validate.js";

export function checkDocument(doc: SpecDocument, options: CheckOptions = {}): Report {
  const sites = discoverSites(doc, options);
  const diagnostics: Diagnostic[] = [];
  let checked = 0;
  let skipped = 0;

  for (const site of sites) {
    for (const warning of site.warnings ?? []) {
      diagnostics.push(siteDiagnostic(site, warning.code, warning.reason));
    }
    if (site.skip !== undefined) {
      skipped++;
      diagnostics.push(siteDiagnostic(site, site.skip.code, site.skip.reason));
      continue;
    }
    checked++;
    if (site.schema === undefined) continue; // unreachable: no-schema sites are skips
    const failures = validateValue(doc.root, doc.version, site.value ?? null, site.schema, site.schemaPointer);
    const seenAnnotations = new Set<string>();
    for (const failure of failures) {
      const code = codeForKeyword(failure.keyword);
      // Unknown-format and invalid-pattern notes repeat per array element;
      // one per schema location per site is enough signal.
      if (code === "W204" || code === "W208") {
        const key = `${code} ${failure.schemaPath}`;
        if (seenAnnotations.has(key)) continue;
        seenAnnotations.add(key);
      }
      const diagnostic: Diagnostic = {
        code,
        severity: severityOf(code),
        sitePointer: site.pointer,
        siteLabel: site.label,
        instancePath: failure.instancePath,
        schemaPath: failure.schemaPath,
        message: failure.message,
      };
      const suggestion = suggestFor(failure);
      if (suggestion !== undefined) diagnostic.suggestion = suggestion;
      diagnostics.push(diagnostic);
    }
  }

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.length - errorCount;
  return {
    sites: sites.length,
    checked,
    skipped,
    diagnostics,
    errorCount,
    warningCount,
    ok: errorCount === 0,
  };
}

function siteDiagnostic(site: ExampleSite, code: string, reason: string): Diagnostic {
  return {
    code,
    severity: severityOf(code),
    sitePointer: site.pointer,
    siteLabel: site.label,
    instancePath: "",
    schemaPath: "",
    message: reason,
  };
}
