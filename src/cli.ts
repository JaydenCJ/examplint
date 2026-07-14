#!/usr/bin/env node
/**
 * The examplint CLI. Thin by design: reads files, delegates to the pure
 * check/discover modules, prints, sets the exit code. Exit codes are
 * stable API: 0 conforms, 1 findings, 2 usage/parse/IO error.
 */
import { readFileSync } from "node:fs";
import { checkDocument } from "./check.js";
import { CliError, HELP_TEXT, parseCliArgs } from "./cliargs.js";
import { discoverSites } from "./discover.js";
import { DocumentError, parseDocument, type SpecDocument } from "./document.js";
import { renderJson, renderSiteList, renderText } from "./report.js";
import { VERSION } from "./version.js";

function loadDocument(file: string): SpecDocument {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new DocumentError(`${file}: cannot read file: ${(error as Error).message}`);
  }
  return parseDocument(text, file);
}

export function main(argv: string[]): number {
  let options;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`examplint: ${error.message}\n`);
      process.stderr.write(`Run "examplint --help" for usage.\n`);
      return 2;
    }
    throw error;
  }

  if (options.command === "help") {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if (options.command === "version") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  let worst = 0;
  const outputs: string[] = [];
  for (const file of options.files) {
    let doc: SpecDocument;
    try {
      doc = loadDocument(file);
    } catch (error) {
      if (error instanceof DocumentError) {
        process.stderr.write(`examplint: ${error.message}\n`);
        worst = 2;
        continue;
      }
      throw error;
    }

    if (options.command === "list") {
      const sites = discoverSites(doc, { checkDefaults: options.checkDefaults });
      outputs.push(renderSiteList(sites, file));
      continue;
    }

    const report = checkDocument(doc, { checkDefaults: options.checkDefaults });
    outputs.push(options.format === "json" ? renderJson(report, file) : renderText(report, file, { quiet: options.quiet, strict: options.strict }));
    const failed = !report.ok || (options.strict && report.warningCount > 0);
    if (failed && worst < 1) worst = 1;
  }
  if (outputs.length > 0) {
    process.stdout.write(outputs.join("\n") + "\n");
  }
  return worst;
}

process.exitCode = main(process.argv.slice(2));
