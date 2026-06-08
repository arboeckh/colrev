"""Build OpenAlex /works API URLs from structured search parameters."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional
from urllib.parse import parse_qs, quote, urlencode, urlparse, urlunparse

OPENALEX_WORKS_BASE = "https://api.openalex.org/works"
MAX_URL_LENGTH = 8000

SORT_MAP = {
    "relevance": "relevance_score:desc",
    "citations": "cited_by_count:desc",
    "date": "publication_date:desc",
}


class OpenAlexQueryError(ValueError):
    """Invalid or oversized OpenAlex query."""


@dataclass
class OpenAlexSearchParams:
    """Structured parameters for an OpenAlex works search."""

    search: str = ""
    search_exact: bool = False
    year_from: Optional[int] = None
    year_to: Optional[int] = None
    open_access_only: bool = False
    work_types: Optional[List[str]] = None
    sort: str = "relevance"
    min_citations: Optional[int] = None
    language: Optional[str] = None
    has_abstract: bool = False
    raw_url: Optional[str] = None


def _build_filters(params: OpenAlexSearchParams) -> List[str]:
    filters: List[str] = []

    search_text = params.search.strip()
    if search_text:
        # Route the keyword query through the title_and_abstract.search FILTER,
        # NOT the bare ``search`` query parameter. The ``search`` param (a.k.a.
        # default.search) matches title + abstract + *full text* and ignores
        # the AND/OR/NOT semantics a constrained Boolean query needs, so a tight
        # query like '"machine learning" AND dog AND play' returns ~48k works
        # instead of ~60. The title_and_abstract.search filter honors Boolean
        # operators (uppercase AND/OR/NOT) and phrase quoting and restricts to
        # title + abstract, matching the openalex.org website's count.
        field = (
            "title_and_abstract.search.exact"
            if params.search_exact
            else "title_and_abstract.search"
        )
        filters.append(f"{field}:{search_text}")

    if params.year_from is not None or params.year_to is not None:
        start = params.year_from if params.year_from is not None else ""
        end = params.year_to if params.year_to is not None else ""
        filters.append(f"publication_year:{start}-{end}")

    if params.open_access_only:
        filters.append("is_oa:true")

    if params.work_types:
        type_filter = "|".join(params.work_types)
        filters.append(f"type:{type_filter}")

    if params.min_citations is not None:
        filters.append(f"cited_by_count:>{params.min_citations}")

    if params.language:
        filters.append(f"language:{params.language}")

    if params.has_abstract:
        filters.append("has_abstract:true")

    return filters


def build_works_url(
    params: OpenAlexSearchParams,
    *,
    api_key: str,
    mailto: str = "",
) -> str:
    """Return a fully qualified OpenAlex /works URL."""

    if params.raw_url:
        return _merge_api_key(params.raw_url, api_key=api_key, mailto=mailto)

    query_parts: dict[str, str] = {"per_page": "100"}

    search_text = params.search.strip()

    filters = _build_filters(params)
    if filters:
        query_parts["filter"] = ",".join(filters)

    if not search_text and not filters:
        raise OpenAlexQueryError(
            "OpenAlex search requires a keyword query or at least one filter "
            "(year range, open access, work type, etc.)."
        )

    # Relevance sort only applies when there is a keyword search.
    if search_text:
        sort_value = SORT_MAP.get(params.sort)
        if sort_value:
            query_parts["sort"] = sort_value

    if api_key:
        query_parts["api_key"] = api_key
    if mailto:
        query_parts["mailto"] = mailto

    url = f"{OPENALEX_WORKS_BASE}?{urlencode(query_parts, quote_via=quote)}"
    _check_url_length(url)
    return url


def strip_sensitive_url_params(url: str) -> str:
    """Remove api_key from a URL before persisting to search history."""

    parsed = urlparse(url)
    query = parse_qs(parsed.query, keep_blank_values=True)
    flat_query = {
        key: values[-1]
        for key, values in query.items()
        if key not in {"api_key", "mailto"}
    }
    return urlunparse(parsed._replace(query=urlencode(flat_query, quote_via=quote)))


def inject_api_key(url: str, *, api_key: str, mailto: str = "") -> str:
    """Add api_key (and optional mailto) to a stored search URL at request time."""

    parsed = urlparse(url)
    query = parse_qs(parsed.query, keep_blank_values=True)
    flat_query = {key: values[-1] for key, values in query.items()}
    if api_key:
        flat_query["api_key"] = api_key
    if mailto:
        flat_query["mailto"] = mailto
    return urlunparse(parsed._replace(query=urlencode(flat_query, quote_via=quote)))


def _merge_api_key(raw_url: str, *, api_key: str, mailto: str) -> str:
    parsed = urlparse(raw_url)
    if "openalex.org" not in parsed.netloc:
        raise OpenAlexQueryError("Pasted URL must be an openalex.org API URL")

    query = parse_qs(parsed.query, keep_blank_values=True)
    flat_query = {key: values[-1] for key, values in query.items()}
    if api_key:
        flat_query["api_key"] = api_key
    if mailto:
        flat_query["mailto"] = mailto

    merged = urlunparse(
        parsed._replace(query=urlencode(flat_query, quote_via=quote))
    )
    _check_url_length(merged)
    return merged


def _check_url_length(url: str) -> None:
    if len(url) > MAX_URL_LENGTH:
        raise OpenAlexQueryError(
            f"URL length ({len(url)}) exceeds limit ({MAX_URL_LENGTH}). "
            "Simplify the Boolean query or use fewer filters."
        )
