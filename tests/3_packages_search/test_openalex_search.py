"""OpenAlex search source integration tests."""

from __future__ import annotations

import typing
from pathlib import Path
from typing import Any, Optional

import pytest
from pytest_mock import MockerFixture

import colrev.env.environment_manager
import colrev.search_file
from colrev.constants import Fields
from colrev.constants import SearchType
from colrev.packages.open_alex.src import open_alex_api
from colrev.packages.open_alex.src.open_alex import OpenAlexSearchSource
from colrev.packages.open_alex.src.open_alex_query_builder import OpenAlexQueryError


def test_openalex_api_search_persists_results(
    tmp_path: Path,
    mocker: MockerFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("OPENALEX_API_KEY", "test-key")
    Path("data/search").mkdir(parents=True)

    search_file = colrev.search_file.ExtendedSearchFile(
        platform="colrev.open_alex",
        search_results_path=Path("data/search/openalex.bib"),
        search_type=SearchType.API,
        search_string="sotatercept",
        comment="",
        version="0.1.0",
    )
    search_file.search_parameters = {
        "url": "https://api.openalex.org/works?search=sotatercept",
        "query": {"search": "sotatercept"},
    }

    mocker.patch.object(
        colrev.env.environment_manager.EnvironmentManager,
        "get_name_mail_from_git",
        return_value=("Test User", "test@example.com"),
    )

    fake_work = {
        "id": "https://openalex.org/W123",
        "title": "Example trial",
        "type": "article",
        "publication_year": 2023,
        "cited_by_count": 1,
        "doi": "https://doi.org/10.1000/example",
        "authorships": [{"author": {"display_name": "Jane Doe"}}],
        "primary_location": {"source": {"display_name": "Example Journal"}},
        "biblio": {},
    }

    class FakeResponse:
        def __init__(self, *, status_code: int, json_data: dict[str, Any]) -> None:
            self.status_code = status_code
            self._json_data = json_data

        def json(self) -> dict[str, Any]:
            return self._json_data

        def raise_for_status(self) -> None:
            if self.status_code >= 400:
                raise RuntimeError("HTTP error")

    def fake_get(url: str, *, timeout: int, headers: dict[str, str]) -> FakeResponse:
        return FakeResponse(
            status_code=200,
            json_data={
                "results": [fake_work],
                "meta": {"count": 1, "page": 1, "per_page": 100},
            },
        )

    mocker.patch(
        "colrev.packages.open_alex.src.open_alex_api.requests.get",
        side_effect=fake_get,
    )

    source = OpenAlexSearchSource(search_file=search_file)
    source.search(rerun=True)

    bib = Path("data/search/openalex.bib").read_text(encoding="utf-8")
    assert "Example trial" in bib
    assert "openalex_id = {W123}" in bib or "W123" in bib


def test_openalex_db_search_noops_when_bib_exists(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    Path("data/search").mkdir(parents=True)
    bib_path = Path("data/search/openalex.bib")
    bib_path.write_text("@article{W1, title = {Cached}}\n", encoding="utf-8")

    search_file = colrev.search_file.ExtendedSearchFile(
        platform="colrev.open_alex",
        search_results_path=bib_path,
        search_type=SearchType.DB,
        search_string="uploaded query",
        comment="",
        version="0.1.0",
    )

    source = OpenAlexSearchSource(search_file=search_file)
    source.search(rerun=False)


def test_openalex_api_search_rejects_unconstrained_stored_url(
    tmp_path: Path,
    mocker: MockerFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("OPENALEX_API_KEY", "test-key")
    Path("data/search").mkdir(parents=True)

    search_file = colrev.search_file.ExtendedSearchFile(
        platform="colrev.open_alex",
        search_results_path=Path("data/search/openalex.bib"),
        search_type=SearchType.API,
        search_string="",
        comment="",
        version="0.1.0",
    )
    search_file.search_parameters = {
        "url": "https://api.openalex.org/works?per_page=100&sort=relevance_score:desc",
    }

    mocker.patch.object(
        colrev.env.environment_manager.EnvironmentManager,
        "get_name_mail_from_git",
        return_value=("Test User", "test@example.com"),
    )

    source = OpenAlexSearchSource(search_file=search_file)
    with pytest.raises(OpenAlexQueryError, match="no keyword query"):
        source.search(rerun=True)
