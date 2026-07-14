/**
 * Renderers for check results: a grouped, grep-friendly text report and a
 * stable JSON shape for CI. No ANSI colors — output is meant to be read in
 * logs and diffed in golden tests as-is.
 */
import type { Diagnostic, ExampleSite, Report } from "./types.js";

/** "1 example", "2 examples" — count plus correctly pluralized noun. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** Render the report for one file as plain text. */
export function renderText(report: Report, file: string, options: { quiet?: boolean; strict?: boolean } = {}): string {
  const lines: string[] = [];
  lines.push(`${file}: ${count(report.checked, "example")} checked, ${report.skipped} skipped`);
  if (!options.quiet) {
    const bySite = new Map<string, Diagnostic[]>();
    for (const diagnostic of report.diagnostics) {
      const list = bySite.get(diagnostic.sitePointer);
      if (list === undefined) bySite.set(diagnostic.sitePointer, [diagnostic]);
      else list.push(diagnostic);
    }
    for (const [pointer, diagnostics] of bySite) {
      lines.push("");
      lines.push(`${diagnostics[0]!.siteLabel}`);
      lines.push(`  at ${pointer}`);
      for (const diagnostic of diagnostics) {
        const where = diagnostic.instancePath === "" ? "" : ` at ${diagnostic.instancePath}`;
        lines.push(`  ${diagnostic.severity} ${diagnostic.code}${where}: ${diagnostic.message}`);
        if (diagnostic.suggestion !== undefined) {
          lines.push(`      fix: ${diagnostic.suggestion}`);
        }
      }
    }
  }
  lines.push("");
  // Under --strict warnings fail the run, so the verdict says FAIL too —
  // the summary line always agrees with the exit code.
  const failed = !report.ok || (options.strict === true && report.warningCount > 0);
  const verdict = failed ? "FAIL" : "OK";
  lines.push(`${file}: ${verdict} (${count(report.errorCount, "error")}, ${count(report.warningCount, "warning")})`);
  return lines.join("\n");
}

/** Render the report for one file as stable JSON (one object per file). */
export function renderJson(report: Report, file: string): string {
  return JSON.stringify(
    {
      file,
      sites: report.sites,
      checked: report.checked,
      skipped: report.skipped,
      ok: report.ok,
      errorCount: report.errorCount,
      warningCount: report.warningCount,
      diagnostics: report.diagnostics,
    },
    null,
    2
  );
}

/** Render the `list` subcommand: every discovered site, one per line. */
export function renderSiteList(sites: ExampleSite[], file: string): string {
  const lines: string[] = [];
  lines.push(`${file}: ${count(sites.length, "example site")}`);
  for (const site of sites) {
    const status = site.skip !== undefined ? `skipped (${site.skip.code})` : site.kind;
    lines.push(`  ${site.label}`);
    lines.push(`    at ${site.pointer} [${status}]`);
  }
  return lines.join("\n");
}
