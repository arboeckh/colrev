#! /usr/bin/env python
"""Pubmed API"""
import datetime
import logging
import time
import typing
from sqlite3 import OperationalError
from xml.etree.ElementTree import Element  # nosec
from xml.etree.ElementTree import ParseError

import requests
from defusedxml import ElementTree as DefusedET

import colrev.exceptions as colrev_exceptions
import colrev.record.record
from colrev.constants import Fields


# pylint: disable=too-few-public-methods


class PubmedAPIError(Exception):
    """Exception raised for PubMed API errors."""


class PubmedAPI:
    """Connector for the Pubmed API"""

    # Batch size for efetch requests (PubMed recommends max 200 for XML)
    EFETCH_BATCH_SIZE = 200
    # Batch size for esearch ID retrieval
    ESEARCH_BATCH_SIZE = 10000

    # pylint: disable=too-many-arguments
    # pylint: disable=too-many-instance-attributes
    def __init__(
        self,
        *,
        url: str,
        email: str,
        session: requests.Session,
        timeout: int = 60,
        logger: typing.Optional[logging.Logger] = None,
    ):
        self.email = email
        self.session = session
        self._timeout = timeout
        self.url = url

        self.headers = {"user-agent": f"{__name__} (mailto:{self.email})"}

        if logger is not None:
            self.logger = logger
        else:
            self.logger = logging.getLogger(__name__)

        self._retstart = 0
        self._retmax = self.ESEARCH_BATCH_SIZE

    @classmethod
    def _get_author_string_from_node(cls, *, author_node: Element) -> str:
        authors_string = ""
        author_last_name_node = author_node.find("LastName")
        if author_last_name_node is not None:
            if author_last_name_node.text is not None:
                authors_string += author_last_name_node.text
        author_fore_name_node = author_node.find("ForeName")
        if author_fore_name_node is not None:
            if author_fore_name_node.text is not None:
                authors_string += ", "
                authors_string += author_fore_name_node.text
        return authors_string

    @classmethod
    def _get_author_string(cls, *, root: Element) -> str:
        authors_list = []
        for author_node in root.findall(
            "./PubmedArticle/MedlineCitation/Article/AuthorList/Author"
        ):
            authors_list.append(
                cls._get_author_string_from_node(author_node=author_node)
            )
        return " and ".join(authors_list)

    @classmethod
    def _get_title_string(cls, *, root: Element) -> str:
        title_text = root.findtext(
            "./PubmedArticle/MedlineCitation/Article/ArticleTitle", ""
        )
        if title_text:
            title_text = title_text.strip().rstrip(".")
            if title_text.startswith("[") and title_text.endswith("]"):
                title_text = title_text[1:-1]
            return title_text
        return ""

    @classmethod
    def _get_abstract_string(cls, *, root: Element) -> str:
        abstract = root.find("./PubmedArticle/MedlineCitation/Article/Abstract")
        if abstract is not None:
            return DefusedET.tostring(abstract, encoding="unicode")
        return ""

    # pylint: disable=colrev-missed-constant-usage
    # pylint: disable=too-many-branches
    @classmethod
    def _parse_single_article(cls, *, article_element: Element) -> dict:
        """Parse a single PubmedArticle element into a record dict."""
        retrieved_record_dict: dict = {Fields.ENTRYTYPE: "misc"}

        if article_element.find("MedlineCitation") is None:
            return {}

        # Get title
        title_text = article_element.findtext(
            "./MedlineCitation/Article/ArticleTitle", ""
        )
        if title_text:
            title_text = title_text.strip().rstrip(".")
            if title_text.startswith("[") and title_text.endswith("]"):
                title_text = title_text[1:-1]
            retrieved_record_dict[Fields.TITLE] = title_text

        # Get authors
        authors_list = []
        for author_node in article_element.findall(
            "./MedlineCitation/Article/AuthorList/Author"
        ):
            authors_list.append(
                cls._get_author_string_from_node(author_node=author_node)
            )
        if authors_list:
            retrieved_record_dict[Fields.AUTHOR] = " and ".join(authors_list)

        # Get journal info
        journal = article_element.find("./MedlineCitation/Article/Journal")
        if journal is not None:
            journal_name = journal.findtext("ISOAbbreviation")
            if journal_name:
                retrieved_record_dict[Fields.ENTRYTYPE] = "article"
                retrieved_record_dict[Fields.JOURNAL] = journal_name

            volume = journal.findtext("JournalIssue/Volume")
            if volume:
                retrieved_record_dict[Fields.VOLUME] = volume

            number = journal.findtext("JournalIssue/Issue")
            if number:
                retrieved_record_dict[Fields.NUMBER] = number

            year = journal.findtext("JournalIssue/PubDate/Year")
            if year:
                retrieved_record_dict[Fields.YEAR] = year

        # Get abstract
        abstract = article_element.find("./MedlineCitation/Article/Abstract")
        if abstract is not None:
            retrieved_record_dict[Fields.ABSTRACT] = DefusedET.tostring(
                abstract, encoding="unicode"
            )

        # Get article IDs (pubmed, doi, etc.)
        article_id_list = article_element.find("./PubmedData/ArticleIdList")
        if article_id_list is not None:
            for article_id in article_id_list:
                id_type = article_id.attrib.get("IdType")
                if id_type == "pubmed" and article_id.text:
                    retrieved_record_dict["pubmedid"] = article_id.text.upper()
                elif id_type == "doi" and article_id.text:
                    retrieved_record_dict[Fields.DOI] = article_id.text.upper()
                elif id_type and article_id.text:
                    retrieved_record_dict[id_type] = article_id.text

        # Clean up empty values
        retrieved_record_dict = {
            k: v for k, v in retrieved_record_dict.items() if v != ""
        }
        if (
            retrieved_record_dict.get("pii", "pii").lower()
            == retrieved_record_dict.get("doi", "doi").lower()
        ):
            del retrieved_record_dict["pii"]

        return retrieved_record_dict

    @classmethod
    def _pubmed_xml_to_record(cls, *, root: Element) -> dict:
        """Parse XML with single PubmedArticle (backward compatibility)."""
        pubmed_article = root.find("PubmedArticle")
        if pubmed_article is None:
            return {}
        return cls._parse_single_article(article_element=pubmed_article)

    @classmethod
    def _pubmed_xml_to_records(cls, *, root: Element) -> typing.List[dict]:
        """Parse XML with multiple PubmedArticle elements (batch response)."""
        records = []
        for article in root.findall("PubmedArticle"):
            record_dict = cls._parse_single_article(article_element=article)
            if record_dict:
                records.append(record_dict)
        return records

    def query_id(self, *, pubmed_id: str) -> colrev.record.record.Record:
        """Retrieve a single record from Pubmed by ID."""
        records = self._fetch_records_batch(pubmed_ids=[pubmed_id])
        if not records:
            raise colrev_exceptions.RecordNotParsableException(
                f"Pubmed record {pubmed_id} not parsable"
            )
        return records[0]

    def _fetch_records_batch(
        self, *, pubmed_ids: typing.List[str]
    ) -> typing.List[colrev.record.record.Record]:
        """Fetch multiple records from PubMed in a single request.

        Args:
            pubmed_ids: List of PubMed IDs to fetch (max ~200 recommended)

        Returns:
            List of Record objects
        """
        if not pubmed_ids:
            return []

        try:
            # Join IDs with commas for batch request
            ids_str = ",".join(pubmed_ids)
            url = (
                "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?"
                f"db=pubmed&id={ids_str}&rettype=xml&retmode=text"
            )

            while True:
                ret = self.session.request(
                    "GET", url, headers=self.headers, timeout=self._timeout
                )
                if ret.status_code == 429:
                    self.logger.warning("Rate limited, waiting 10s...")
                    time.sleep(10)
                    continue
                ret.raise_for_status()

                response_content = getattr(ret, "content", None)
                if response_content is None:
                    response_text = getattr(ret, "text", "")
                    response_content = response_text.encode("utf-8")

                root = DefusedET.fromstring(response_content)
                record_dicts = self._pubmed_xml_to_records(root=root)

                records = []
                for record_dict in record_dicts:
                    if record_dict:
                        records.append(colrev.record.record.Record(record_dict))

                return records

        except requests.exceptions.RequestException as exc:
            raise PubmedAPIError from exc
        except ParseError as exc:
            raise colrev_exceptions.RecordNotParsableException(
                "Error parsing XML response"
            ) from exc
        except OperationalError as exc:
            raise colrev_exceptions.ServiceNotAvailableException(
                "sqlite, required for requests CachedSession "
                "(possibly caused by concurrent operations)"
            ) from exc

    def _get_pubmed_ids(self, retstart: int = 0, retmax: int = 10000) -> dict:
        """Call eSearch with JSON output to get matching PubMed IDs.

        Args:
            retstart: Starting index for pagination
            retmax: Maximum number of IDs to return (max 10000 per NCBI)

        Returns:
            Dict with 'uids' (list of IDs) and 'totalResults' (total count)
        """
        params = {
            "retmode": "json",
            "retstart": retstart,
            "retmax": retmax,
        }
        while True:
            try:
                ret = self.session.request(
                    "GET", self.url, params=params, headers=self.headers, timeout=60
                )
                if ret.status_code == 429:
                    self.logger.warning("Rate limited on esearch, waiting 5s...")
                    time.sleep(5.0)
                    continue
                ret.raise_for_status()
                data = ret.json()
                es = data.get("esearchresult", {})
                return {
                    "uids": es.get("idlist", []),
                    "totalResults": int(es.get("count", 0)),
                }
            except requests.exceptions.RequestException as exc:  # pragma: no cover
                raise PubmedAPIError from exc

    def get_query_return(self) -> typing.Iterator[colrev.record.record.Record]:
        """Retrieve records from PubMed using efficient batch fetching.

        This method uses a two-phase approach for optimal performance:
        1. esearch: Get all matching PubMed IDs (up to 10k per request)
        2. efetch: Fetch full records in batches of 200

        For 10,000 records, this takes ~5-10 minutes instead of ~3 hours.
        """
        total_results = None
        all_ids: typing.List[str] = []
        seen: typing.Set[str] = set()

        # Phase 1: Collect all PubMed IDs using esearch pagination
        esearch_start = 0
        while True:
            page = self._get_pubmed_ids(
                retstart=esearch_start, retmax=self.ESEARCH_BATCH_SIZE
            )

            if total_results is None:
                total_results = page["totalResults"]
                self.logger.info("Total results found: %s", total_results)

                if total_results == 0:
                    return

                # Estimate time based on batch fetching
                # ~1 request per 200 records, ~0.5s per request
                num_batches = (total_results + self.EFETCH_BATCH_SIZE - 1) // self.EFETCH_BATCH_SIZE
                expected_seconds = num_batches * 0.5
                expected_time = datetime.timedelta(seconds=round(expected_seconds))
                self.logger.info(
                    "Using batch fetching (%d records per request)",
                    self.EFETCH_BATCH_SIZE,
                )
                self.logger.info("Estimated time: %s", expected_time)

            ids = page["uids"]
            if not ids:
                break

            # Filter duplicates
            for uid in ids:
                if uid not in seen:
                    seen.add(uid)
                    all_ids.append(uid)

            esearch_start += len(ids)
            self.logger.info(
                "Collected %d / %d IDs...", len(all_ids), total_results
            )

            if esearch_start >= total_results:
                break

            # Small delay between esearch requests
            time.sleep(0.34)  # ~3 requests per second

        self.logger.info("Fetching %d records in batches...", len(all_ids))

        # Phase 2: Fetch full records in batches using efetch
        fetched_count = 0
        for i in range(0, len(all_ids), self.EFETCH_BATCH_SIZE):
            batch_ids = all_ids[i : i + self.EFETCH_BATCH_SIZE]
            batch_num = (i // self.EFETCH_BATCH_SIZE) + 1
            total_batches = (len(all_ids) + self.EFETCH_BATCH_SIZE - 1) // self.EFETCH_BATCH_SIZE

            self.logger.info(
                "Fetching batch %d/%d (%d records)...",
                batch_num,
                total_batches,
                len(batch_ids),
            )

            try:
                records = self._fetch_records_batch(pubmed_ids=batch_ids)
                for record in records:
                    fetched_count += 1
                    yield record
            except (PubmedAPIError, colrev_exceptions.RecordNotParsableException) as exc:
                self.logger.warning("Error fetching batch %d: %s", batch_num, exc)
                # Continue with next batch instead of failing completely
                continue

            # Rate limiting: ~3 requests per second
            # With 200 records per batch, this is very efficient
            time.sleep(0.34)

        self.logger.info("Fetched %d records total", fetched_count)
