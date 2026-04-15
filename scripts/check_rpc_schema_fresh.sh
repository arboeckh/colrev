#!/usr/bin/env bash
# Fail if the generated RPC schemas or TypeScript types are stale relative to
# the Python framework handlers. Run in CI and as a pre-commit hook.
#
# Usage:
#     ./scripts/check_rpc_schema_fresh.sh
#
# Regenerate locally:
#     python scripts/export_rpc_schemas.py
#     (cd electron-app && npm run gen-types)

set -euo pipefail

cd "$(dirname "$0")/.."

TMP_SCHEMAS="$(mktemp -t rpc-schemas.XXXXXX.json)"
TMP_TYPES="$(mktemp -d -t rpc-types.XXXXXX)"
trap 'rm -f "$TMP_SCHEMAS"; rm -rf "$TMP_TYPES"' EXIT

SCHEMAS_COMMITTED="electron-app/src/renderer/types/generated/rpc-schemas.json"
TYPES_COMMITTED="electron-app/src/renderer/types/generated/rpc.d.ts"

# Regenerate schemas into a scratch file and diff. Reuse the single source of
# truth (``scripts/export_rpc_schemas.py``) so this check can't drift from
# what regeneration actually writes.
python - <<PY > "$TMP_SCHEMAS"
import json, runpy, sys
module = runpy.run_path("scripts/export_rpc_schemas.py")
doc = module["build_schema_document"]()
json.dump(doc, sys.stdout, indent=2, sort_keys=True)
sys.stdout.write("\n")
PY

if ! diff -q "$TMP_SCHEMAS" "$SCHEMAS_COMMITTED" > /dev/null; then
    echo "FAIL: $SCHEMAS_COMMITTED is stale."
    echo "Run: python scripts/export_rpc_schemas.py && (cd electron-app && npm run gen-types)"
    diff -u "$SCHEMAS_COMMITTED" "$TMP_SCHEMAS" | head -80 || true
    exit 1
fi

# Regenerate TypeScript into a temp dir and diff.
(
    cd electron-app
    RPC_TYPES_OUT="$TMP_TYPES/rpc.d.ts" npx tsx scripts/gen-rpc-types.ts >/dev/null
) || {
    echo "FAIL: npm gen-types script failed."
    exit 1
}

# gen-rpc-types.ts writes to its hard-coded OUTPUT_PATH; re-read the committed
# file after the run and compare to the freshly-generated committed file. To
# keep this simple we compare the committed file to itself after regeneration
# (the script is idempotent given identical input).
if ! git diff --quiet --exit-code -- "$TYPES_COMMITTED"; then
    echo "FAIL: $TYPES_COMMITTED is stale."
    echo "Run: (cd electron-app && npm run gen-types)"
    git --no-pager diff -- "$TYPES_COMMITTED" | head -80
    exit 1
fi

echo "OK: RPC schemas and TypeScript types are fresh."
