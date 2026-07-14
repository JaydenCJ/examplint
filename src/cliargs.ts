/**
 * Tiny, dependency-free argv parser for the CLI. Kept separate from the
 * command implementations so flag handling is unit-testable without
 * touching the filesystem.
 */

export interface CliOptions {
  command: "check" | "list" | "help" | "version";
  files: string[];
  format: "text" | "json";
  strict: boolean;
  checkDefaults: boolean;
  quiet: boolean;
}

export class CliError extends Error {}

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    command: "check",
    files: [],
    format: "text",
    strict: false,
    checkDefaults: false,
    quiet: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--help":
      case "-h":
        return { ...options, command: "help" };
      case "--version":
      case "-V":
        return { ...options, command: "version" };
      case "--strict":
        options.strict = true;
        break;
      case "--check-defaults":
        options.checkDefaults = true;
        break;
      case "--quiet":
      case "-q":
        options.quiet = true;
        break;
      case "--format": {
        const value = argv[++i];
        if (value !== "text" && value !== "json") {
          throw new CliError(`--format expects "text" or "json", got ${JSON.stringify(value ?? "")}`);
        }
        options.format = value;
        break;
      }
      default:
        if (arg.startsWith("--format=")) {
          const value = arg.slice("--format=".length);
          if (value !== "text" && value !== "json") {
            throw new CliError(`--format expects "text" or "json", got ${JSON.stringify(value)}`);
          }
          options.format = value;
          break;
        }
        if (arg.startsWith("-") && arg !== "-") {
          throw new CliError(`unknown option ${JSON.stringify(arg)}`);
        }
        positional.push(arg);
    }
  }
  // First positional may be a subcommand; a spec path works verb-free too.
  if (positional[0] === "check" || positional[0] === "list") {
    options.command = positional[0];
    options.files = positional.slice(1);
  } else {
    options.files = positional;
  }
  if (options.files.length === 0) {
    throw new CliError(`no spec file given (usage: examplint ${options.command === "list" ? "list" : "[check]"} <spec.yaml|spec.json> ...)`);
  }
  return options;
}

export const HELP_TEXT = `examplint — validate every example in an OpenAPI spec against its schema

Usage:
  examplint [check] <spec.yaml|spec.json> [...]   validate all examples
  examplint list <spec.yaml|spec.json> [...]      list discovered example sites

Options:
  --format text|json   output format (default: text)
  --strict             warnings also fail the run (exit 1)
  --check-defaults     also validate schema "default" values
  -q, --quiet          per-file summary lines only
  -h, --help           show this help
  -V, --version        print the version

Exit codes:
  0  all examples conform (warnings allowed unless --strict)
  1  at least one example fails its schema (or any finding with --strict)
  2  usage, parse or I/O error
`;
