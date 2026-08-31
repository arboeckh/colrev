#!/usr/bin/env python
"""Registry-driven failure-mode coverage for every RPC method (WP-08 §3).

Per-handler tests cover the interesting failures. This file covers the two
that every method must get right no matter what it does, and covers them by
walking the registry — so a newly registered method is tested the moment it
exists, rather than whenever someone remembers to add a test:

1. A project-scoped method asked for a project that does not exist answers
   ``COLREV_NOT_FOUND``. It must not fall through to a ``ReviewManager``
   construction on a bogus path, and must not raise past the dispatcher.
2. A method whose request model has required fields answers
   ``INVALID_PARAMS`` when they are missing — never a 500-shaped
   ``INTERNAL_ERROR`` and never a partial success.

Both are cheap: neither reaches a handler, so this file adds seconds, not
minutes.
"""
from __future__ import annotations

import typing
from typing import Any

import pytest
from pydantic import BaseModel

import colrev.ui_jsonrpc.framework_handlers  # noqa: F401  (registers methods)
from colrev.ui_jsonrpc.error_handler import COLREV_NOT_FOUND
from colrev.ui_jsonrpc.error_handler import INVALID_PARAMS
from colrev.ui_jsonrpc.framework import registry


def make_request(handler, method: str, params: dict | None = None) -> dict:
    """Send a JSON-RPC request and return the response envelope."""
    return handler.handle_request(
        {"jsonrpc": "2.0", "method": method, "params": params or {}, "id": 1}
    )

ALL_SPECS = sorted(registry.all(), key=lambda spec: spec.name)
PROJECT_SCOPED = [spec for spec in ALL_SPECS if spec.requires_project]


def _dummy_value(annotation: Any) -> Any:
    """A value that satisfies ``annotation`` well enough to pass validation.

    Only used to get *past* param validation so the dispatcher reaches its
    project lookup — the values are never meant to be meaningful.
    """
    origin = typing.get_origin(annotation)
    args = typing.get_args(annotation)

    if origin is typing.Literal:
        return args[0]
    if origin in (list, set, tuple):
        return []
    if origin is dict:
        return {}
    if origin is typing.Union or str(origin) == "types.UnionType":
        non_none = [a for a in args if a is not type(None)]
        return _dummy_value(non_none[0]) if non_none else None
    if annotation is bool:
        return False
    if annotation in (int, float):
        return 0
    if annotation is str:
        return "x"
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return _required_params(annotation)
    return None


def _required_params(model: type[BaseModel]) -> dict[str, Any]:
    return {
        name: _dummy_value(field.annotation)
        for name, field in model.model_fields.items()
        if field.is_required()
    }


@pytest.mark.parametrize(
    "spec", PROJECT_SCOPED, ids=lambda spec: spec.name
)
def test_unknown_project_is_rejected(spec, jsonrpc_handler, tmp_path) -> None:
    """Every project-scoped method rejects a project that does not exist."""
    params = _required_params(spec.request_model)
    params["project_id"] = "no_such_project"
    params["base_path"] = str(tmp_path)

    response = make_request(jsonrpc_handler, spec.name, params)

    assert "error" in response, f"{spec.name} accepted a nonexistent project"
    assert response["error"]["code"] == COLREV_NOT_FOUND, (
        f"{spec.name} reported {response['error']['code']} for a missing "
        f"project; the renderer branches on COLREV_NOT_FOUND"
    )


REQUIRE_PARAMS = [
    spec
    for spec in ALL_SPECS
    if any(field.is_required() for field in spec.request_model.model_fields.values())
]


@pytest.mark.parametrize("spec", REQUIRE_PARAMS, ids=lambda spec: spec.name)
def test_missing_required_params_are_rejected(spec, jsonrpc_handler) -> None:
    """Missing required params surface as INVALID_PARAMS, not an internal error."""
    response = make_request(jsonrpc_handler, spec.name, {})

    assert "error" in response, f"{spec.name} accepted an empty param object"
    assert response["error"]["code"] == INVALID_PARAMS, (
        f"{spec.name} reported {response['error']['code']} for missing params"
    )


def test_registry_is_not_empty() -> None:
    """Guard: a registry that failed to populate would make this file vacuous."""
    assert len(ALL_SPECS) > 50
    assert len(PROJECT_SCOPED) > 50
