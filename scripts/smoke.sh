#!/usr/bin/env bash
# Smoke test for examplint: exercises the real CLI end to end against the
# bundled example specs and freshly written temp specs. No network,
# idempotent, runs from a clean checkout (after `npm install`).
# Prints "SMOKE OK" on success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents both subcommands.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in check list --strict --check-defaults --format; do
  grep -q -- "$word" <<<"$HELP" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. Error handling: usage and unreadable files exit 2 (distinct from lint's 1).
set +e
$CLI --frobnicate >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown flag should exit 2"; }
$CLI check "$WORKDIR/nope.yaml" >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "missing file should exit 2"; }
printf 'a: &anchor 1\n' > "$WORKDIR/anchored.yaml"
$CLI check "$WORKDIR/anchored.yaml" >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unsupported YAML should exit 2"; }
set -e
echo "[smoke] error handling ok (exit 2)"

# 4. The clean petstore passes with every example checked.
OUT="$($CLI check examples/petstore.yaml)" || fail "clean petstore should exit 0"
grep -q '11 examples checked, 0 skipped' <<<"$OUT" || fail "petstore should check 11 examples"
grep -q 'OK (0 errors, 0 warnings)' <<<"$OUT" || fail "petstore should be clean"
echo "[smoke] clean spec ok (11 examples)"

# 5. The drifted petstore fails with the seeded findings and fix suggestions.
set +e
DRIFT_OUT="$($CLI check examples/drifted.yaml)"; DRIFT_CODE=$?
set -e
[ "$DRIFT_CODE" -eq 1 ] || fail "drifted petstore should exit 1, got $DRIFT_CODE"
grep -q 'FAIL (6 errors, 1 warning)' <<<"$DRIFT_OUT" || fail "drifted counts wrong: $DRIFT_OUT"
for needle in E101 E102 E103 E106 E107 W203; do
  grep -q "$needle" <<<"$DRIFT_OUT" || fail "drifted report missing $needle"
done
grep -q 'fix: unquote it: 25' <<<"$DRIFT_OUT" || fail "missing unquote suggestion"
grep -q 'fix: did you mean "available"?' <<<"$DRIFT_OUT" || fail "missing enum typo suggestion"
grep -q 'fix: add "status": "available"' <<<"$DRIFT_OUT" || fail "missing required-property suggestion"
echo "[smoke] drift detection ok (6 errors, 1 warning, fixes suggested)"

# 6. JSON input and --format json work end to end.
cat > "$WORKDIR/api.json" <<'EOF'
{
  "openapi": "3.1.0",
  "info": { "title": "t", "version": "1" },
  "paths": {
    "/a": {
      "get": {
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": { "schema": { "const": 1 }, "example": 2 }
            }
          }
        }
      }
    }
  }
}
EOF
set +e
JSON_OUT="$($CLI check "$WORKDIR/api.json" --format json)"; JSON_CODE=$?
set -e
[ "$JSON_CODE" -eq 1 ] || fail "JSON spec with drift should exit 1"
grep -q '"code": "E102"' <<<"$JSON_OUT" || fail "JSON output missing E102"
echo "$JSON_OUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>JSON.parse(s))" \
  || fail "--format json is not valid JSON"
echo "[smoke] JSON input + JSON output ok"

# 7. --strict turns a warnings-only run into a failure.
cat > "$WORKDIR/warn.json" <<'EOF'
{
  "openapi": "3.0.3",
  "info": { "title": "t", "version": "1" },
  "paths": {
    "/a": {
      "get": {
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": { "type": "string", "format": "uuid" },
                "example": "not-a-uuid"
              }
            }
          }
        }
      }
    }
  }
}
EOF
$CLI check "$WORKDIR/warn.json" >/dev/null || fail "warnings alone should pass by default"
set +e
$CLI check "$WORKDIR/warn.json" --strict >/dev/null; STRICT_CODE=$?
set -e
[ "$STRICT_CODE" -eq 1 ] || fail "--strict should exit 1 on warnings, got $STRICT_CODE"
echo "[smoke] --strict ok"

# 8. --check-defaults flips a bad schema default from invisible to exit 1.
cat > "$WORKDIR/defaults.json" <<'EOF'
{
  "openapi": "3.0.3",
  "info": { "title": "t", "version": "1" },
  "paths": {},
  "components": {
    "schemas": { "Limit": { "type": "integer", "minimum": 1, "default": 0 } }
  }
}
EOF
$CLI check "$WORKDIR/defaults.json" >/dev/null || fail "bad default should pass without the flag"
set +e
$CLI check "$WORKDIR/defaults.json" --check-defaults >/dev/null; DEFAULTS_CODE=$?
set -e
[ "$DEFAULTS_CODE" -eq 1 ] || fail "--check-defaults should exit 1, got $DEFAULTS_CODE"
echo "[smoke] --check-defaults ok"

# 9. list enumerates every site with resolvable pointers.
LIST_OUT="$($CLI list examples/petstore.yaml)" || fail "list failed"
grep -q '11 example sites' <<<"$LIST_OUT" || fail "list should show 11 sites"
grep -q '\[schema-example\]' <<<"$LIST_OUT" || fail "list missing schema-example kind"
grep -q 'at /components/schemas/Pet/example' <<<"$LIST_OUT" || fail "list missing Pet example pointer"
echo "[smoke] list ok (11 sites)"

# 10. Determinism: two runs over the same spec are byte-identical.
$CLI check examples/drifted.yaml > "$WORKDIR/run1.txt" 2>/dev/null || true
$CLI check examples/drifted.yaml > "$WORKDIR/run2.txt" 2>/dev/null || true
cmp -s "$WORKDIR/run1.txt" "$WORKDIR/run2.txt" || fail "repeat runs differ"
echo "[smoke] determinism ok"

echo "SMOKE OK"
