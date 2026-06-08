#! /usr/bin/env python
"""SearchSource: OpenAlex"""
from __future__ import annotations

import logging
import typing
from multiprocessing import Lock
from pathlib import Path

from pydantic import Field

import colrev.env.environment_manager
import colrev.exceptions as colrev_exceptions
import colrev.ops.search_api_feed
import colrev.package_manager.package_base_classes as base_classes
import colrev.record.record
import colrev.record.record_prep
import colrev.search_file
import colrev.utils
from colrev.constants import Fields
from colrev.constants import SearchSourceHeuristicStatus
from colrev.constants import SearchType
from colrev.ops.search_api_feed import create_api_source
from colrev.ops.search_db import create_db_source
from colrev.ops.search_db import run_db_search
from colrev.packages.open_alex.src import open_alex_api
from colrev.packages.open_alex.src.open_alex_query_builder import OpenAlexSearchParams
from colrev.packages.open_alex.src.open_alex_query_builder import build_works_url
from colrev.packages.open_alex.src.open_alex_query_builder import strip_sensitive_url_params

# pylint: disable=unused-argument
# pylint: disable=duplicate-code


class OpenAlexSearchSource(base_classes.SearchSourcePackageBaseClass):
    """OpenAlex API"""

    CURRENT_SYNTAX_VERSION = "0.1.0"

    endpoint = "colrev.open_alex"
    source_identifier = "openalex_id"
    search_types = [SearchType.DB, SearchType.API, SearchType.MD]
    api_search_supported = True

    ci_supported: bool = Field(default=True)
    heuristic_status = SearchSourceHeuristicStatus.oni
    _availability_exception_message = "OpenAlex"
    db_url = "https://openalex.org/"

    def __init__(
        self,
        *,
        search_file: colrev.search_file.ExtendedSearchFile,
        logger: typing.Optional[logging.Logger] = None,
        verbose_mode: bool = False,
    ) -> None:
        self.logger = logger or logging.getLogger(__name__)
        self.verbose_mode = verbose_mode

        self.search_source = search_file

        self.open_alex_lock = Lock()

        _, self.email = (
            colrev.env.environment_manager.EnvironmentManager.get_name_mail_from_git()
        )

    @classmethod
    def heuristic(cls, filename: Path, data: str) -> dict:
        """Source heuristic for OpenAlex"""

        result = {"confidence": 0.0}

        return result

    @classmethod
    def add_endpoint(
        cls,
        params: str,
        path: Path,
        logger: typing.Optional[logging.Logger] = None,
    ) -> colrev.search_file.ExtendedSearchFile:
        """Add SearchSource as an endpoint (based on query provided to colrev search --add )"""

        params_dict: dict[str, str] = {}
        if params:
            if params.startswith("http"):
                params_dict = {Fields.URL: params}
            else:
                for item in params.split(";"):
                    key, value = item.split("=")
                    params_dict[key] = value

        search_type = colrev.utils.select_search_type(
            search_types=cls.search_types, params=params_dict
        )

        if search_type == SearchType.DB:
            search_source = create_db_source(
                path=path,
                platform=cls.endpoint,
                params=params_dict,
                add_to_git=True,
                logger=logger,
            )
            search_source.version = cls.CURRENT_SYNTAX_VERSION

        elif search_type == SearchType.API:
            api_key = open_alex_api.OpenAlexAPI.require_api_key()
            if Fields.URL in params_dict:
                url = build_works_url(
                    OpenAlexSearchParams(raw_url=params_dict[Fields.URL]),
                    api_key=api_key,
                    mailto=cls._resolve_mailto(),
                )
                filename = colrev.utils.get_unique_filename(
                    base_path=path,
                    file_path_string="openalex",
                )
                search_source = colrev.search_file.ExtendedSearchFile(
                    platform=cls.endpoint,
                    search_results_path=filename,
                    search_type=SearchType.API,
                    search_string=params_dict[Fields.URL],
                    comment="",
                    version=cls.CURRENT_SYNTAX_VERSION,
                )
            else:
                search_source = create_api_source(platform=cls.endpoint, path=path)
                url = build_works_url(
                    OpenAlexSearchParams(search=search_source.search_string),
                    api_key=api_key,
                    mailto=cls._resolve_mailto(),
                )
                search_source.search_string = search_source.search_string
            search_source.search_parameters = {
                "url": strip_sensitive_url_params(url),
            }
            search_source.version = cls.CURRENT_SYNTAX_VERSION
        else:
            raise NotImplementedError

        return search_source

    @classmethod
    def _resolve_mailto(cls) -> str:
        _, email = (
            colrev.env.environment_manager.EnvironmentManager.get_name_mail_from_git()
        )
        return email or ""

    def check_availability(self) -> None:
        """Check status (availability) of the OpenAlex API"""

        try:
            api_key = open_alex_api.OpenAlexAPI.require_api_key()
            api = open_alex_api.OpenAlexAPI(email=self.email, api_key=api_key)
            retrieved_record = api.get_record(open_alex_id="W2741809807")
            if not retrieved_record.data:
                raise colrev_exceptions.ServiceNotAvailableException(
                    self._availability_exception_message
                )
        except (open_alex_api.OpenAlexAPIError, KeyError) as exc:
            raise colrev_exceptions.ServiceNotAvailableException(
                self._availability_exception_message
            ) from exc

    def _get_masterdata_record(
        self,
        *,
        record: colrev.record.record.Record,
        prep_operation: colrev.ops.prep.Prep,
    ) -> colrev.record.record.Record:
        try:
            api_key = open_alex_api.OpenAlexAPI.resolve_api_key()
            api = open_alex_api.OpenAlexAPI(email=self.email, api_key=api_key)
            retrieved_record = api.get_record(
                open_alex_id=record.data["colrev.open_alex.id"]
            )

            self.open_alex_lock.acquire(timeout=120)

            # Note : need to reload file because the object is not shared between processes
            open_alex_feed = colrev.ops.search_api_feed.SearchAPIFeed(
                source_identifier=self.source_identifier,
                search_source=self.search_source,
                update_only=False,
                prep_mode=True,
                records=prep_operation.review_manager.dataset.load_records_dict(),
                logger=self.logger,
                verbose_mode=self.verbose_mode,
            )

            open_alex_feed.add_update_record(retrieved_record)
            record.change_entrytype(
                new_entrytype=retrieved_record.data[Fields.ENTRYTYPE],
            )

            record.merge(
                retrieved_record,
                default_source=retrieved_record.data[Fields.ORIGIN][0],
            )
            prep_operation.review_manager.dataset.save_records_dict(
                open_alex_feed.get_records(),
            )
            open_alex_feed.save()
        except (
            colrev_exceptions.RecordNotParsableException,
            open_alex_api.OpenAlexAPIError,
        ):
            pass
        except Exception as exc:
            raise exc
        finally:
            try:
                self.open_alex_lock.release()
            except ValueError:
                pass

        return record

    def prep_link_md(
        self,
        prep_operation: colrev.ops.prep.Prep,
        record: colrev.record.record.Record,
        save_feed: bool = True,
        timeout: int = 30,
    ) -> colrev.record.record.Record:
        """Retrieve masterdata from OpenAlex based on similarity with the record provided"""

        if "colrev.open_alex.id" in record.data:
            record = self._get_masterdata_record(
                record=record, prep_operation=prep_operation
            )

        return record

    def _run_api_search(
        self,
        *,
        openalex_feed: colrev.ops.search_api_feed.SearchAPIFeed,
        rerun: bool,
    ) -> None:
        if rerun:
            self.logger.info("Performing a search of the full history (may take time)")

        api_key = open_alex_api.OpenAlexAPI.require_api_key()
        api = open_alex_api.OpenAlexAPI(
            email=self.email,
            api_key=api_key,
            logger=self.logger,
        )
        url = self.search_source.search_parameters["url"]
        self._validate_search_url(url)

        imported = 0
        for record in api.search_works(url):
            try:
                if "" == record.data.get(Fields.AUTHOR, "") and "" == record.data.get(
                    Fields.TITLE, ""
                ):
                    self.logger.warning("Skipped empty OpenAlex record: %s", record.data)
                    continue

                prep_record = colrev.record.record_prep.PrepRecord(record.data)
                if Fields.D_PROV in prep_record.data:
                    del prep_record.data[Fields.D_PROV]

                added = openalex_feed.add_update_record(prep_record)
                imported += 1
                if not added and not rerun:
                    break
            except colrev_exceptions.NotFeedIdentifiableException:
                self.logger.warning("Skipped record without openalex_id")
                continue

        openalex_feed.save()
        self.logger.info("Imported %s works from OpenAlex", imported)

    @staticmethod
    def _validate_search_url(url: str) -> None:
        from urllib.parse import parse_qs, urlparse

        from colrev.packages.open_alex.src.open_alex_query_builder import OpenAlexQueryError

        query = parse_qs(urlparse(url).query)
        has_search = bool(query.get("search") or query.get("search.exact"))
        has_filter = bool(query.get("filter"))
        if not has_search and not has_filter:
            raise OpenAlexQueryError(
                "Stored OpenAlex search URL has no keyword query or filters. "
                "Remove this source and add it again with your search query."
            )

    def search(self, rerun: bool) -> None:
        """Run a search of OpenAlex"""

        if self.search_source.search_type == SearchType.DB:
            if self.search_source.search_results_path.is_file():
                return
            run_db_search(
                db_url=self.db_url,
                source=self.search_source,
                add_to_git=True,
            )
            return

        openalex_feed = colrev.ops.search_api_feed.SearchAPIFeed(
            source_identifier=self.source_identifier,
            search_source=self.search_source,
            update_only=(not rerun),
            logger=self.logger,
            verbose_mode=self.verbose_mode,
        )

        if self.search_source.search_type == SearchType.API:
            self._run_api_search(openalex_feed=openalex_feed, rerun=rerun)
        else:
            raise NotImplementedError

    def load(self) -> dict:
        """Load the records from the SearchSource file"""

        if self.search_source.search_results_path.suffix == ".bib":
            records = colrev.loader.load_utils.load(
                filename=self.search_source.search_results_path,
                logger=self.logger,
            )
            return records

        raise NotImplementedError

    def prepare(
        self,
        record: colrev.record.record_prep.PrepRecord,
    ) -> colrev.record.record.Record:
        """Source-specific preparation for OpenAlex"""

        return record
