"""Live OpenAlex API smoke tests (skipped unless OPENALEX_API_KEY is set)."""

from __future__ import annotations

import os

import pytest
import requests

from colrev.packages.open_alex.src.open_alex_query_builder import OpenAlexSearchParams
from colrev.packages.open_alex.src.open_alex_query_builder import build_works_url


pytestmark = pytest.mark.skipif(
    not os.getenv("OPENALEX_API_KEY"),
    reason="Set OPENALEX_API_KEY to run live OpenAlex smoke tests",
)


def test_live_constrained_query_returns_small_result_set() -> None:
    api_key = os.environ["OPENALEX_API_KEY"]
    url = build_works_url(
        OpenAlexSearchParams(
            search='"sotatercept" AND "pulmonary arterial hypertension"',
            year_from=2023,
            year_to=2024,
        ),
        api_key=api_key,
    )
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    meta = response.json()["meta"]
    # Keyword search must go through the title_and_abstract.search filter, not
    # the bare search= param (which matches fulltext and ignores Boolean AND).
    assert "title_and_abstract.search" in url
    assert "search=" not in url and "search.exact=" not in url
    assert meta["count"] < 500, (
        f"Expected a constrained systematic-review query to match <500 works, "
        f"got {meta['count']}. URL may be missing the search parameter."
    )


def test_live_unconstrained_build_is_rejected() -> None:
    from colrev.packages.open_alex.src.open_alex_query_builder import OpenAlexQueryError

    with pytest.raises(OpenAlexQueryError):
        build_works_url(OpenAlexSearchParams(), api_key=os.environ["OPENALEX_API_KEY"])
