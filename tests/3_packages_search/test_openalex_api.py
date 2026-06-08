"""OpenAlex API client behaviour tests (mocked HTTP)."""

from __future__ import annotations

import typing
from typing import Any, Optional

import pytest
import requests

from colrev.packages.open_alex.src import open_alex_api


def _work(
    *,
    work_id: str = "W123",
    title: str = "Example Title",
    abstract: Optional[dict[str, list[int]]] = None,
) -> dict[str, Any]:
    return {
        "id": f"https://openalex.org/{work_id}",
        "title": title,
        "type": "article",
        "publication_year": 2023,
        "cited_by_count": 5,
        "doi": "https://doi.org/10.1000/example",
        "authorships": [
            {"author": {"display_name": "Jane Doe"}},
            {"author": {"display_name": "John Smith"}},
        ],
        "primary_location": {
            "source": {"display_name": "Example Journal"},
        },
        "biblio": {},
        "abstract_inverted_index": abstract
        or {"Example": [0], "abstract": [1], "text": [2]},
    }


class FakeResponse:
    def __init__(
        self,
        *,
        status_code: int,
        json_data: Optional[dict[str, Any]] = None,
    ) -> None:
        self.status_code = status_code
        self._json_data = json_data or {}

    def json(self) -> dict[str, Any]:
        return self._json_data

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(response=typing.cast(requests.Response, self))


def test_decode_abstract_reconstructs_plain_text() -> None:
    inverted = {"Hello": [0], "world": [1]}
    assert open_alex_api.decode_abstract(inverted) == "Hello world"


def test_parse_item_sets_openalex_id_and_metadata() -> None:
    api = open_alex_api.OpenAlexAPI(email="test@example.com", api_key="key")
    record = api._parse_item_to_record(item=_work())
    assert record.data["openalex_id"] == "W123"
    assert record.data["colrev.open_alex.id"] == "W123"
    assert record.data["title"] == "Example Title"
    assert record.data["abstract"] == "Example abstract text"
    assert record.data["doi"] == "10.1000/EXAMPLE"


def test_search_works_paginates_and_includes_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    def fake_get(url: str, *, timeout: int, headers: dict[str, str]) -> FakeResponse:
        calls.append(url)
        from urllib.parse import parse_qs, urlparse

        page = int(parse_qs(urlparse(url).query).get("page", ["1"])[0])
        if page <= 1:
            return FakeResponse(
                status_code=200,
                json_data={
                    "results": [_work(work_id="W1"), _work(work_id="W2")],
                    "meta": {"count": 3, "page": 1, "per_page": 2},
                },
            )
        return FakeResponse(
            status_code=200,
            json_data={
                "results": [_work(work_id="W3")],
                "meta": {"count": 3, "page": 2, "per_page": 2},
            },
        )

    monkeypatch.setattr(open_alex_api.requests, "get", fake_get)
    api = open_alex_api.OpenAlexAPI(email="test@example.com", api_key="secret-key")
    records = list(
        api.search_works(
            "https://api.openalex.org/works?search=test&per_page=2&api_key=secret-key"
        )
    )
    assert len(records) == 3
    assert all("api_key=secret-key" in call for call in calls)


def test_search_works_stops_at_reported_total(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Do not keep paging once OpenAlex meta.count is exhausted."""

    def fake_get(url: str, *, timeout: int, headers: dict[str, str]) -> FakeResponse:
        from urllib.parse import parse_qs, urlparse

        page = int(parse_qs(urlparse(url).query).get("page", ["1"])[0])
        return FakeResponse(
            status_code=200,
            json_data={
                "results": [_work(work_id=f"W{page}{i}") for i in range(100)],
                "meta": {"count": 150, "page": page, "per_page": 100},
            },
        )

    monkeypatch.setattr(open_alex_api.requests, "get", fake_get)
    api = open_alex_api.OpenAlexAPI(email="test@example.com", api_key="k")
    records = list(
        api.search_works("https://api.openalex.org/works?search=constrained&api_key=k")
    )
    assert len(records) == 150


def test_with_page_preserves_search_on_high_page_numbers() -> None:
    api = open_alex_api.OpenAlexAPI(email="test@example.com", api_key="k")
    base = (
        "https://api.openalex.org/works?"
        "search=sotatercept+AND+PAH&filter=publication_year%3A2023-2024"
    )
    page10 = api._with_page(base, page=10)
    from urllib.parse import parse_qs, urlparse

    query = parse_qs(urlparse(page10).query)
    assert query["page"] == ["10"]
    assert "sotatercept AND PAH" in query["search"][0]


def test_search_works_retries_on_rate_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts = {"count": 0}

    def fake_get(url: str, *, timeout: int, headers: dict[str, str]) -> FakeResponse:
        attempts["count"] += 1
        if attempts["count"] == 1:
            return FakeResponse(status_code=429, json_data={})
        return FakeResponse(
            status_code=200,
            json_data={
                "results": [_work()],
                "meta": {"count": 1, "page": 1, "per_page": 100},
            },
        )

    monkeypatch.setattr(open_alex_api.requests, "get", fake_get)
    monkeypatch.setattr(open_alex_api.time, "sleep", lambda _: None)
    api = open_alex_api.OpenAlexAPI(email="test@example.com", api_key="k")
    records = list(api.search_works("https://api.openalex.org/works?search=x"))
    assert len(records) == 1
    assert attempts["count"] == 2
