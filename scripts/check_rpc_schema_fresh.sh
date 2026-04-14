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

# Regenerate schemas into a scratch file and diff.
python - <<'PY' > "$TMP_SCHEMAS"
import json, colrev.ui_jsonrpc.framework_handlers  # noqa: F401
from colrev.ui_jsonrpc.framework import registry
doc = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "CoLRev JSON-RPC Method Schemas",
    "version": 1,
    "methods": {
        s.name: {
            "request": s.request_model.model_json_schema(),
            "response": s.response_model.model_json_schema(),
            "requires_project": s.requires_project,
            "writes": s.writes,
        }
        for s in sorted(registry.all(), key=lambda m: m.name)
    },
}
print(json.dumps(doc, indent=2, sort_keys=True))
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
