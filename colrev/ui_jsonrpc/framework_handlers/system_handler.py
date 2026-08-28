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


class SetConnectorApiKeyRequest(NoProjectRequest):
    connector: str
    api_key: str


class SetConnectorApiKeyResponse(SuccessResponse):
    connector: str
    configured: bool


class GetConnectorApiKeyStatusRequest(NoProjectRequest):
    pass


class GetConnectorApiKeyStatusResponse(SuccessResponse):
    openalex: bool


class SystemHandler(BaseHandler):
    """System endpoints that do not require a project."""

    @rpc_method(
        name="ping",
        request=PingRequest,
        response=PingResponse,
        requires_project=False,
        timeout_class="fast",
    )
    def ping(self, _req: PingRequest) -> PingResponse:
        return PingResponse()

    @rpc_method(
        name="get_csv_source_templates",
        request=GetCSVSourceTemplatesRequest,
        response=GetCSVSourceTemplatesResponse,
        requires_project=False,
        timeout_class="fast",
    )
    def get_csv_source_templates(
        self, _req: GetCSVSourceTemplatesRequest
    ) -> GetCSVSourceTemplatesResponse:
        from colrev.ui_jsonrpc.csv_transforms import get_available_templates

        return GetCSVSourceTemplatesResponse(templates=get_available_templates())

    @rpc_method(
        name="set_connector_api_key",
        request=SetConnectorApiKeyRequest,
        response=SetConnectorApiKeyResponse,
        requires_project=False,
        timeout_class="fast",
    )
    def set_connector_api_key(
        self, req: SetConnectorApiKeyRequest
    ) -> SetConnectorApiKeyResponse:
        import os

        connector = req.connector.strip().lower()
        api_key = req.api_key.strip()
        if connector == "openalex":
            if not api_key:
                raise ValueError("OpenAlex API key cannot be empty")
            os.environ["OPENALEX_API_KEY"] = api_key
            return SetConnectorApiKeyResponse(connector=connector, configured=True)
        raise ValueError(f"Unknown connector '{req.connector}'")

    @rpc_method(
        name="get_connector_api_key_status",
        request=GetConnectorApiKeyStatusRequest,
        response=GetConnectorApiKeyStatusResponse,
        requires_project=False,
        timeout_class="fast",
    )
    def get_connector_api_key_status(
        self, _req: GetConnectorApiKeyStatusRequest
    ) -> GetConnectorApiKeyStatusResponse:
        from colrev.packages.open_alex.src import open_alex_api

        return GetConnectorApiKeyStatusResponse(
            openalex=bool(open_alex_api.OpenAlexAPI.resolve_api_key())
        )
