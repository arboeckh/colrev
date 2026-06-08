"""JSON-RPC OpenAlex search parameter construction tests."""

from __future__ import annotations

import pytest

from colrev.ui_jsonrpc.framework_handlers.search_handler import (
    _build_openalex_search_parameters,
)


def test_build_openalex_search_parameters_includes_url_and_query(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENALEX_API_KEY", "test-key")
    params = _build_openalex_search_parameters(
        search_string="machine learning",
        extra={
            "query": {
                "search": "machine learning",
                "year_from": 2020,
                "year_to": 2023,
                "open_access_only": True,
            }
        },
    )
    assert "url" in params
    assert "api.openalex.org/works" in params["url"]
    assert "api_key" not in params["url"]
    assert "is_oa" in params["url"]
    assert params["query"]["search"] == "machine learning"


def test_build_openalex_search_parameters_falls_back_to_search_string(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENALEX_API_KEY", "test-key")
    params = _build_openalex_search_parameters(
        search_string="fallback query",
        extra={"query": {"search": "", "year_from": 2023, "year_to": 2023}},
    )
    assert "title_and_abstract.search%3Afallback" in params["url"]
    assert "publication_year" in params["url"]
    assert "api_key" not in params
