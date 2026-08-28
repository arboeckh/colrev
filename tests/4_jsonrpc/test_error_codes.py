"""Tests for structured JSON-RPC error code mapping (WP-02 §5)."""
from __future__ import annotations

import colrev.exceptions as colrev_exceptions
from colrev.ui_jsonrpc import error_handler
from colrev.ui_jsonrpc import validation
from colrev.ui_jsonrpc.errors import MethodNotFoundError
from colrev.ui_jsonrpc.errors import NotFoundError
from colrev.ui_jsonrpc.framework.registry import MethodRegistry


class TestErrorCodeMapping:
    def test_unknown_method_maps_to_method_not_found(self):
        registry = MethodRegistry()
        try:
            registry.get("no_such_method")
        except MethodNotFoundError as exc:
            code = error_handler.map_exception_to_error_code(exc)
        assert code == error_handler.METHOD_NOT_FOUND

    def test_missing_project_maps_to_not_found(self, tmp_path):
        try:
            validation.validate_existing_project(
                {"project_id": "ghost", "base_path": str(tmp_path)}
            )
        except NotFoundError as exc:
            code = error_handler.map_exception_to_error_code(exc)
        assert code == error_handler.COLREV_NOT_FOUND

    def test_git_lock_maps_to_resource_locked(self):
        exc = colrev_exceptions.GitNotAvailableError()
        assert (
            error_handler.map_exception_to_error_code(exc)
            == error_handler.COLREV_RESOURCE_LOCKED
        )

    def test_dirty_repo_maps_to_precondition_failed(self):
        for exc in (
            colrev_exceptions.UnstagedGitChangesError(["records.bib"]),
            colrev_exceptions.CleanRepoRequiredError([], ""),
        ):
            assert (
                error_handler.map_exception_to_error_code(exc)
                == error_handler.COLREV_PRECONDITION_FAILED
            )

    def test_plain_value_error_still_maps_to_invalid_params(self):
        assert (
            error_handler.map_exception_to_error_code(ValueError("bad"))
            == error_handler.INVALID_PARAMS
        )

    def test_generic_colrev_exception_still_maps_to_operation_error(self):
        exc = colrev_exceptions.CoLRevException("boom")
        assert (
            error_handler.map_exception_to_error_code(exc)
            == error_handler.COLREV_OPERATION_ERROR
        )

    def test_error_response_preserves_code_message_data(self):
        response = error_handler.handle_exception(
            NotFoundError("Project x does not exist"), request_id=42
        )
        assert response["error"]["code"] == error_handler.COLREV_NOT_FOUND
        assert "does not exist" in response["error"]["message"]
        assert response["error"]["data"] == "NotFoundError"
        assert response["id"] == 42
