#!/usr/bin/env python
"""Tests for the no-project system endpoints (WP-08 §3).

These are the methods the Electron main process calls before any project
exists: ``ping`` is the readiness probe the supervisor polls after a restart,
and the connector-key endpoints gate whether the search UI shows an API-key
field. Cheap to get wrong, cheap to test, previously untested.
"""
from __future__ import annotations

import os

import pytest

from colrev.ui_jsonrpc.error_handler import INVALID_PARAMS
from colrev.ui_jsonrpc.handler import JSONRPCHandler


def _request(handler: JSONRPCHandler, method: str, params: dict | None = None) -> dict:
    return handler.handle_request(
        {"jsonrpc": "2.0", "method": method, "params": params or {}, "id": 1}
    )


@pytest.fixture
def handler() -> JSONRPCHandler:
    return JSONRPCHandler()


class TestPing:
    def test_answers_pong_without_a_project(self, handler) -> None:
        # The supervised-restart path polls this before replaying queued
        # calls; it must never need a ReviewManager.
        response = _request(handler, "ping")
        assert response["result"]["status"] == "pong"

    def test_ignores_stray_params(self, handler) -> None:
        response = _request(handler, "ping", {"base_path": "/nonexistent"})
        assert response["result"]["status"] == "pong"


class TestCSVSourceTemplates:
    def test_returns_the_available_templates(self, handler) -> None:
        response = _request(handler, "get_csv_source_templates")
        templates = response["result"]["templates"]
        # The list may legitimately be empty; the contract is that the method
        # always answers with a list of objects, never null.
        assert isinstance(templates, list)
        assert all(isinstance(t, dict) for t in templates)


class TestConnectorApiKeys:
    def test_round_trips_the_openalex_key(self, handler, monkeypatch) -> None:
        monkeypatch.delenv("OPENALEX_API_KEY", raising=False)

        set_response = _request(
            handler,
            "set_connector_api_key",
            {"connector": "openalex", "api_key": "  test-key  "},
        )
        assert set_response["result"]["configured"] is True
        assert set_response["result"]["connector"] == "openalex"
        assert os.environ["OPENALEX_API_KEY"] == "test-key"

        status = _request(handler, "get_connector_api_key_status")
        assert status["result"]["openalex"] is True

    def test_rejects_an_unknown_connector(self, handler) -> None:
        response = _request(
            handler,
            "set_connector_api_key",
            {"connector": "not-a-connector", "api_key": "x"},
        )
        # A rejected connector is a caller mistake, not a server fault.
        assert response["error"]["code"] == INVALID_PARAMS

    def test_rejects_an_empty_key(self, handler, monkeypatch) -> None:
        monkeypatch.delenv("OPENALEX_API_KEY", raising=False)
        response = _request(
            handler,
            "set_connector_api_key",
            {"connector": "openalex", "api_key": "   "},
        )
        assert "error" in response
        assert "OPENALEX_API_KEY" not in os.environ
