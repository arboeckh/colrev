#! /usr/bin/env python
"""Open Alex API"""
from __future__ import annotations

import logging
import time
import typing
from typing import Iterator, Optional

import pyalex
import requests
from pyalex import Works

import colrev.env.language_service
import colrev.exceptions as colrev_exceptions
import colrev.record.record_prep
from colrev.constants import ENTRYTYPES
from colrev.constants import Fields
from colrev.constants import FieldValues

# pylint: disable=too-few-public-methods

MAX_IMPORTED_RESULTS = 10_000
PER_PAGE = 100
MAX_RETRIES = 5


class OpenAlexAPIError(Exception):
    """Exception raised for OpenAlex API errors."""


def decode_abstract(inverted_index: Optional[dict]) -> str:
    """Reconstruct plain-text abstract from OpenAlex inverted index."""

    if not inverted_index:
        return ""

    max_pos = max(pos for positions in inverted_index.values() for pos in positions)
    words = [""] * (max_pos + 1)
    for word, positions in inverted_index.items():
        for pos in positions:
            words[pos] = word
    return " ".join(word for word in words if word)


class OpenAlexAPI:
    """Connector for the Open Alex API"""

    # pylint: disable=too-many-arguments
    def __init__(
        self,
        email: str,
        api_key: str = "",
        logger: typing.Optional[logging.Logger] = None,
    ):
        pyalex.config.email = email
        if api_key:
            pyalex.config.api_key = api_key
        self.api_key = api_key
        self.email = email
        self.language_service = colrev.env.language_service.LanguageService()
        self.logger = logger or logging.getLogger(__name__)

    @classmethod
    def resolve_api_key(cls) -> str:
        """Resolve OpenAlex API key from environment."""

        import os

        return os.getenv("OPENALEX_API_KEY", "").strip()

    @classmethod
    def require_api_key(cls) -> str:
        """Return API key or raise if missing."""

        api_key = cls.resolve_api_key()
        if not api_key:
            raise OpenAlexAPIError(
                "OpenAlex API key not configured. Set OPENALEX_API_KEY or add your "
                "key in app settings (https://openalex.org/settings/api)."
            )
        return api_key

    def _fix_errors(self, *, record: colrev.record.record.Record) -> None:
        if "PubMed" == record.data.get(Fields.JOURNAL, ""):
            record.remove_field(key=Fields.JOURNAL)
        try:
            self.language_service.unify_to_iso_639_3_language_codes(record=record)
        except colrev_exceptions.InvalidLanguageCodeException:
            record.remove_field(key=Fields.LANGUAGE)

    def _set_author_from_item(self, *, record_dict: dict, item: dict) -> None:
        author_list = []
        # pylint: disable=colrev-missed-constant-usage
        for author in item["authorships"]:
            if "author" not in author:
                continue
            if author["author"].get("display_name", None) is None:
                continue
            author_string = colrev.record.record_prep.PrepRecord.format_author_field(
                author["author"]["display_name"]
            )
            author_list.append(author_string)

        record_dict[Fields.AUTHOR] = " and ".join(author_list)

    def _parse_item_to_record(self, *, item: dict) -> colrev.record.record.Record:
        def set_entrytype(*, record_dict: dict, item: dict) -> None:
            # pylint: disable=colrev-missed-constant-usage
            if "title" in record_dict and record_dict["title"] is None:
                del record_dict["title"]
            if item.get("type_crossref", "") == "proceedings-article":
                record_dict[Fields.ENTRYTYPE] = ENTRYTYPES.INPROCEEDINGS
                if (
                    item.get("primary_location", None) is not None
                    and item["primary_location"].get("source", None) is not None
                ):
                    display_name = item["primary_location"]["source"]["display_name"]
                    if display_name != "Proceedings":
                        record_dict[Fields.BOOKTITLE] = display_name
            elif item["type"] in ["journal-article", "article"]:
                record_dict[Fields.ENTRYTYPE] = ENTRYTYPES.ARTICLE
                if (
                    item.get("primary_location", None) is not None
                    and item["primary_location"].get("source", None) is not None
                ):
                    record_dict[Fields.JOURNAL] = item["primary_location"]["source"][
                        "display_name"
                    ]
            else:
                record_dict[Fields.ENTRYTYPE] = ENTRYTYPES.MISC

        openalex_id = item["id"].replace("https://openalex.org/", "")
        record_dict = {
            "openalex_id": openalex_id,
            "colrev.open_alex.id": openalex_id,
        }
        # pylint: disable=colrev-missed-constant-usage
        if "title" in item and item["title"] is not None:
            record_dict[Fields.TITLE] = item["title"].lstrip("[").rstrip("].")
        set_entrytype(record_dict=record_dict, item=item)

        if "publication_year" in item and item["publication_year"] is not None:
            record_dict[Fields.YEAR] = str(item["publication_year"])
        # pylint: disable=colrev-missed-constant-usage
        if "language" in item and item["language"] is not None:
            record_dict[Fields.LANGUAGE] = item["language"]

        if "is_retracted" in item and item["is_retracted"]:
            record_dict[FieldValues.RETRACTED] = item["is_retracted"]

        abstract = decode_abstract(item.get("abstract_inverted_index"))
        if abstract:
            record_dict[Fields.ABSTRACT] = abstract

        # pylint: disable=colrev-missed-constant-usage
        if "doi" in item and item["doi"] is not None:
            record_dict[Fields.DOI] = (
                item["doi"].upper().replace("HTTPS://DOI.ORG/", "")
            )

        record_dict[Fields.CITED_BY] = item["cited_by_count"]

        # pylint: disable=colrev-missed-constant-usage
        if "volume" in item["biblio"] and item["biblio"]["volume"] is not None:
            record_dict[Fields.VOLUME] = item["biblio"]["volume"]
        if "issue" in item["biblio"] and item["biblio"]["issue"] is not None:
            record_dict[Fields.NUMBER] = item["biblio"]["issue"]
        if "first_page" in item["biblio"] and item["biblio"]["first_page"] is not None:
            record_dict[Fields.PAGES] = item["biblio"]["first_page"]
        if "last_page" in item["biblio"] and item["biblio"]["last_page"] is not None:
            record_dict[Fields.PAGES] += "--" + item["biblio"]["last_page"]

        self._set_author_from_item(record_dict=record_dict, item=item)
        record = colrev.record.record.Record(record_dict)

        self._fix_errors(record=record)
        return record

    def get_record(self, *, open_alex_id: str) -> colrev.record.record.Record:
        """Get a record from OpenAlex"""

        try:
            item = Works()[open_alex_id]
        except requests.exceptions.RequestException as exc:  # pragma: no cover
            raise OpenAlexAPIError from exc
        except Exception as exc:  # pragma: no cover
            raise OpenAlexAPIError from exc

        retrieved_record = self._parse_item_to_record(item=item)
        return retrieved_record

    def search_works(self, url: str) -> Iterator[colrev.record.record.Record]:
        """Paginate an OpenAlex /works query and yield parsed records."""

        from colrev.packages.open_alex.src.open_alex_query_builder import inject_api_key

        request_url = inject_api_key(url, api_key=self.api_key, mailto=self.email)
        headers = {"user-agent": f"colrev-openalex (mailto:{self.email})"}
        imported = 0
        page = 1
        total_available: Optional[int] = None

        while imported < MAX_IMPORTED_RESULTS:
            page_url = self._with_page(request_url, page=page)
            payload = self._request_json(page_url, headers=headers)
            results = payload.get("results", [])
            if not results:
                break

            meta = payload.get("meta", {})
            if total_available is None:
                total_available = meta.get("count", 0)
                self.logger.info(
                    "OpenAlex reported %s matching works for this query",
                    total_available,
                )

            for item in results:
                if imported >= MAX_IMPORTED_RESULTS:
                    self.logger.info(
                        "Reached OpenAlex import cap of %s works", MAX_IMPORTED_RESULTS
                    )
                    return
                if total_available and imported >= total_available:
                    return
                yield self._parse_item_to_record(item=item)
                imported += 1

            per_page = meta.get("per_page", PER_PAGE)
            current_page = meta.get("page", page)
            total = total_available or meta.get("count", 0)
            if current_page * per_page >= total or len(results) < per_page:
                break
            page += 1

        self.logger.info("Imported %s works from OpenAlex (of %s reported)", imported, total_available)

    def _with_page(self, url: str, *, page: int) -> str:
        from urllib.parse import parse_qs, quote, urlencode, urlparse, urlunparse

        parsed = urlparse(url)
        query = parse_qs(parsed.query, keep_blank_values=True)
        flat_query = {key: values[-1] for key, values in query.items()}
        flat_query["page"] = str(page)
        flat_query["per_page"] = str(PER_PAGE)
        if self.api_key:
            flat_query["api_key"] = self.api_key
        return urlunparse(
            parsed._replace(query=urlencode(flat_query, quote_via=quote))
        )

    def _request_json(self, url: str, *, headers: dict[str, str]) -> dict:
        for attempt in range(MAX_RETRIES):
            try:
                response = requests.get(url, timeout=60, headers=headers)
                if response.status_code == 429:
                    if attempt + 1 >= MAX_RETRIES:
                        raise OpenAlexAPIError("OpenAlex rate limit exceeded")
                    time.sleep(2**attempt)
                    continue
                response.raise_for_status()
                return response.json()
            except requests.exceptions.RequestException as exc:
                if attempt + 1 >= MAX_RETRIES:
                    raise OpenAlexAPIError from exc
                time.sleep(2**attempt)
        raise OpenAlexAPIError("OpenAlex request failed")
