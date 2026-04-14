#!/usr/bin/env python3
"""Export the JSON-RPC framework's typed request/response schemas.

Walks every ``MethodSpec`` in the global registry and emits a single JSON
document containing the JSON Schema of each method's request and response
models. This file is the single source of truth for frontend type
generation (see ``electron-app/scripts/gen-rpc-types.ts``).

Run this whenever handlers change. CI should fail if the output file is
stale — that enforces the frontend type surface tracking the backend.
"""

from __future__ import annotations

import json
from pathlib import Path

# Importing framework_handlers triggers all @rpc_method registrations.
import colrev.ui_jsonrpc.framework_handlers  # noqa: F401
from colrev.ui_jsonrpc.framework import ProgressEvent
from colrev.ui_jsonrpc.framework import RecordPayload
from colrev.ui_jsonrpc.framework import RecordStateName
from colrev.ui_jsonrpc.framework import RecordSummary
from colrev.ui_jsonrpc.framework import registry


REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = (
    REPO_ROOT
    / "electron-app"
    / "src"
    / "renderer"
    / "types"
    / "generated"
    / "rpc-schemas.json"
)

# Shared types exported alongside per-method schemas. Frontend needs these
# to type subscriptions (e.g. onProgress) and record payloads that appear
# inside many responses.
SHARED_MODELS = {
    "ProgressEvent": ProgressEvent,
    "RecordPayload": RecordPayload,
    "RecordSummary": RecordSummary,
}


def _record_state_schema() -> dict:
    """RecordStateName exported as a plain string-enum JSON Schema."""
    return {
        "title": "RecordStateName",
        "type": "string",
        "enum": [s.value for s in RecordStateName],
        "description": "CoLRev record workflow state (mirrors RecordState).",
    }


def build_schema_document() -> dict:
    """Produce the full JSON Schema document: methods + shared types."""
    methods: dict[str, dict] = {}
    for spec in registry.all():
        methods[spec.name] = {
            "request": spec.request_model.model_json_schema(),
            "response": spec.response_model.model_json_schema(),
            "requires_project": spec.requires_project,
            "writes": spec.writes,
        }

    shared: dict[str, dict] = {
        name: model.model_json_schema() for name, model in SHARED_MODELS.items()
    }
    shared["RecordStateName"] = _record_state_schema()

    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "CoLRev JSON-RPC Method Schemas",
        "version": 1,
        "methods": dict(sorted(methods.items())),
        "shared": dict(sorted(shared.items())),
    }


def main() -> None:
    doc = build_schema_document()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n")
    print(
        f"Wrote {len(doc['methods'])} method schemas and "
        f"{len(doc['shared'])} shared types to {OUTPUT_PATH}"
    )


if __name__ == "__main__":
    main()
