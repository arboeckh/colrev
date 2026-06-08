"""OpenAlex query builder URL construction tests."""

from __future__ import annotations

import pytest

from colrev.packages.open_alex.src.open_alex_query_builder import (
    OpenAlexQueryError,
    OpenAlexSearchParams,
    build_works_url,
)


def test_year_range_adds_filter() -> None:
    url = build_works_url(
        OpenAlexSearchParams(search="surgery", year_from=2020, year_to=2023),
        api_key="test-key",
    )
    assert "publication_year%3A2020-2023" in url
    # Keyword search is routed through the title_and_abstract.search filter,
    # NOT the bare ``search`` query parameter (which matches fulltext and
    # ignores Boolean operators).
    assert "title_and_abstract.search%3Asurgery" in url
    assert "search=surgery" not in url
    assert "api_key=test-key" in url


def test_keyword_uses_title_and_abstract_filter() -> None:
    url = build_works_url(
        OpenAlexSearchParams(search='"machine learning" AND dog AND play'),
        api_key="k",
    )
    assert "title_and_abstract.search%3A" in url
    assert "search=" not in url


def test_open_access_filter() -> None:
    url = build_works_url(
        OpenAlexSearchParams(search="diabetes", open_access_only=True),
        api_key="k",
    )
    assert "is_oa%3Atrue" in url


def test_exact_match_uses_exact_filter() -> None:
    url = build_works_url(
        OpenAlexSearchParams(search="surgery", search_exact=True),
        api_key="k",
    )
    assert "title_and_abstract.search.exact%3Asurgery" in url
    assert "search.exact=surgery" not in url
    assert "search=surgery" not in url


def test_pasted_url_passes_through_with_api_key() -> None:
    raw = "https://api.openalex.org/works?search=foo&filter=is_oa:true"
    url = build_works_url(
        OpenAlexSearchParams(raw_url=raw),
        api_key="my-key",
    )
    assert "search=foo" in url
    assert "api_key=my-key" in url
    assert "is_oa" in url


def test_url_length_raises_informative_error() -> None:
    long_query = "word " * 2000
    with pytest.raises(OpenAlexQueryError, match="URL length"):
        build_works_url(
            OpenAlexSearchParams(search=long_query),
            api_key="k",
        )


def test_unconstrained_query_is_rejected() -> None:
    with pytest.raises(OpenAlexQueryError, match="requires a keyword query"):
        build_works_url(OpenAlexSearchParams(), api_key="k")


def test_sort_omitted_without_keyword_search() -> None:
    url = build_works_url(
        OpenAlexSearchParams(year_from=2023, year_to=2023),
        api_key="k",
    )
    assert "sort=" not in url
    assert "publication_year" in url


def test_strip_sensitive_url_params_removes_api_key() -> None:
    from colrev.packages.open_alex.src.open_alex_query_builder import (
        inject_api_key,
        strip_sensitive_url_params,
    )

    stored = strip_sensitive_url_params(
        "https://api.openalex.org/works?search=foo&api_key=secret&mailto=a@b.co"
    )
    assert "api_key" not in stored
    assert "mailto" not in stored
    assert "search=foo" in stored
    runtime = inject_api_key(stored, api_key="secret", mailto="a@b.co")
    assert "api_key=secret" in runtime
