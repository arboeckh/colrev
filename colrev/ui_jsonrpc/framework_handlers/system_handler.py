"""System-level endpoints: ping and other no-project methods.

These prove the framework dispatcher works end-to-end without a ReviewManager.
"""

from __future__ import annotations

from typing import Any
from typing import Dict
from typing import List

from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import NoProjectRequest
from colrev.ui_jsonrpc.framework import PingResponse
from colrev.ui_jsonrpc.framework import SuccessResponse
from colrev.ui_jsonrpc.framework import rpc_method


class PingRequest(NoProjectRequest):
    pass


class GetCSVSourceTemplatesRequest(NoProjectRequest):
    pass


class GetCSVSourceTemplatesResponse(SuccessResponse):
    templates: List[Dict[str, Any]]


class SystemHandler(BaseHandler):
    """System endpoints that do not require a project."""

    @rpc_method(
        name="ping",
        request=PingRequest,
        response=PingResponse,
        requires_project=False,
    )
    def ping(self, _req: PingRequest) -> PingResponse:
        return PingResponse()

    @rpc_method(
        name="get_csv_source_templates",
        request=GetCSVSourceTemplatesRequest,
        response=GetCSVSourceTemplatesResponse,
        requires_project=False,
    )
    def get_csv_source_templates(
        self, _req: GetCSVSourceTemplatesRequest
    ) -> GetCSVSourceTemplatesResponse:
        from colrev.ui_jsonrpc.csv_transforms import get_available_templates

        return GetCSVSourceTemplatesResponse(templates=get_available_templates())
