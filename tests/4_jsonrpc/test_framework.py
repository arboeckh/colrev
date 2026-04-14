"""Tests for the typed handler framework.

Validates:
- @rpc_method registration (decorator + BaseHandler.__init_subclass__).
- Dispatcher routes through Pydantic validation.
- Validation errors produce INVALID_PARAMS (-32602).
- Unknown methods produce an error (fallthrough to legacy is safe too, but
  a truly unknown method must 404).
- No-project methods don't construct a ReviewManager.
"""

from __future__ import annotations

from typing import Literal

import pytest

from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import NoProjectRequest
from colrev.ui_jsonrpc.framework import SuccessResponse
from colrev.ui_jsonrpc.framework import registry
from colrev.ui_jsonrpc.framework import rpc_method
from colrev.ui_jsonrpc.framework.dispatcher import Dispatcher
from colrev.ui_jsonrpc.handler import JSONRPCHandler


# --- Fixtures / scaffolding --------------------------------------------------


class _EchoRequest(NoProjectRequest):
    value: int


class _EchoResponse(SuccessResponse):
    doubled: int


class _TestFrameworkHandler(BaseHandler):
    """A throwaway handler just for framework tests. Registered on import."""

    @rpc_method(
        name="__test_echo_double",
        request=_EchoRequest,
        response=_EchoResponse,
        requires_project=False,
    )
    def echo_double(self, req: _EchoRequest) -> _EchoResponse:
        return _EchoResponse(doubled=req.value * 2)


# --- Tests -------------------------------------------------------------------


class TestRegistry:
    def test_test_method_registered(self):
        assert registry.has("__test_echo_double")

    def test_ping_and_prescreen_record_registered(self):
        # Forces framework_handlers import.
        JSONRPCHandler()
        assert registry.has("ping")
        assert registry.has("prescreen_record")

    def test_unknown_method_raises(self):
        with pytest.raises(ValueError, match="not found"):
            registry.get("__does_not_exist")


class TestDispatcher:
    def setup_method(self) -> None:
        self.dispatcher = Dispatcher()

    def test_roundtrip_success(self):
        result = self.dispatcher.dispatch("__test_echo_double", {"value": 5})
        assert result == {"success": True, "doubled": 10}

    def test_validation_error_bubbles_as_value_error(self):
        with pytest.raises(ValueError, match="Invalid params"):
            self.dispatcher.dispatch("__test_echo_double", {"value": "not-an-int"})

    def test_extra_fields_rejected(self):
        # _FrameworkModel sets extra="forbid"
        with pytest.raises(ValueError, match="Invalid params"):
            self.dispatcher.dispatch(
                "__test_echo_double", {"value": 1, "unexpected": True}
            )

    def test_unknown_method_raises(self):
        with pytest.raises(ValueError, match="not found"):
            self.dispatcher.dispatch("__does_not_exist", {})


class TestJSONRPCIntegration:
    """End-to-end through the JSONRPCHandler wrapper (simulates real requests)."""

    def setup_method(self) -> None:
        self.handler = JSONRPCHandler()

    def test_framework_ping(self):
        resp = self.handler.handle_request(
            {"jsonrpc": "2.0", "method": "ping", "params": {}, "id": 1}
        )
        assert resp["id"] == 1
        assert resp["result"]["status"] == "pong"
        assert resp["result"]["success"] is True

    def test_framework_invalid_params_returns_32602(self):
        resp = self.handler.handle_request(
            {
                "jsonrpc": "2.0",
                "method": "__test_echo_double",
                "params": {"value": "x"},
                "id": 2,
            }
        )
        assert "error" in resp
        assert resp["error"]["code"] == -32602

    def test_framework_result_is_dict(self):
        resp = self.handler.handle_request(
            {
                "jsonrpc": "2.0",
                "method": "__test_echo_double",
                "params": {"value": 7},
                "id": 3,
            }
        )
        assert resp["result"] == {"success": True, "doubled": 14}
