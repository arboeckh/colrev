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


def test_rebuild_from_stored_parameters_uses_the_new_search_string(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression: a query edit must reach the URL the search actually runs.

    The stored parameters always carry a derived ``url``. Treating that URL as
    a pasted raw URL made every edit rebuild the original search, so the query
    changed in the UI while the results never moved.
    """
    monkeypatch.setenv("OPENALEX_API_KEY", "test-key")
    stored = _build_openalex_search_parameters(
        search_string="original query",
        extra={"query": {"search": "original query", "year_from": 2020}},
    )

    rebuilt = _build_openalex_search_parameters(
        search_string="revised query",
        extra={"query": {**stored["query"], "search": "revised query"}},
    )

    assert "revised" in rebuilt["url"]
    assert "original" not in rebuilt["url"]
    assert rebuilt["url"] != stored["url"]
    # Filters the edit did not mention survive.
    assert "publication_year%3A2020-" in rebuilt["url"]
    assert rebuilt["query"]["year_from"] == 2020


def test_filter_only_change_produces_a_different_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENALEX_API_KEY", "test-key")
    base = _build_openalex_search_parameters(
        search_string="machine learning",
        extra={"query": {"search": "machine learning"}},
    )
    filtered = _build_openalex_search_parameters(
        search_string="machine learning",
        extra={"query": {**base["query"], "open_access_only": True}},
    )
    assert filtered["url"] != base["url"]
    assert "is_oa" in filtered["url"]


def test_raw_url_round_trips_through_the_stored_query(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENALEX_API_KEY", "test-key")
    pasted = "https://api.openalex.org/works?filter=type%3Aarticle"

    added = _build_openalex_search_parameters(
        search_string="", extra={"url": pasted}
    )
    assert added["query"]["raw_url"] == pasted

    rebuilt = _build_openalex_search_parameters(
        search_string="", extra={"query": added["query"]}
    )
    assert rebuilt["url"] == added["url"]
    assert "type%3Aarticle" in rebuilt["url"]


def test_legacy_url_stored_as_search_text_stays_a_raw_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sources added before ``raw_url`` existed kept the pasted URL in ``search``."""
    monkeypatch.setenv("OPENALEX_API_KEY", "test-key")
    pasted = "https://api.openalex.org/works?filter=is_oa%3Atrue"

    rebuilt = _build_openalex_search_parameters(
        search_string="", extra={"query": {"search": pasted}}
    )
    assert rebuilt["query"]["raw_url"] == pasted
    assert "title_and_abstract" not in rebuilt["url"]
    assert "is_oa%3Atrue" in rebuilt["url"]
