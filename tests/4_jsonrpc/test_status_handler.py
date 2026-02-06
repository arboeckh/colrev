#!/usr/bin/env python
"""Tests for the StatusHandler JSON-RPC endpoints.

Tests cover the following endpoints:
    - ping: Health check
    - get_status: Get comprehensive project status
    - status: Alias for get_status
    - validate: Validate project state
    - get_operation_info: Get operation preview information
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

import colrev.constants
import colrev.ops.init
from colrev.ui_jsonrpc.handler import JSONRPCHandler


class TestPingEndpoint:
    """Tests for the ping endpoint."""

    def test_ping_returns_pong(self):
        """Test that ping returns pong status."""
        handler = JSONRPCHandler()
        request = {
            "jsonrpc": "2.0",
            "method": "ping",
            "params": {},
            "id": 1,
        }

        response = handler.handle_request(request)

        assert response["jsonrpc"] == "2.0"
        assert response["id"] == 1
        assert "error" not in response
        assert response["result"]["status"] == "pong"

    def test_ping_without_params(self):
        """Test that ping works without params."""
        handler = JSONRPCHandler()
        request = {
            "jsonrpc": "2.0",
            "method": "ping",
            "id": 2,
        }

        response = handler.handle_request(request)

        assert response["result"]["status"] == "pong"


class TestGetStatusEndpoint:
    """Tests for the get_status endpoint."""

    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        """Set up a test project for each test."""
        self.base_path = tmp_path
        self.project_id = "test_project"
        self.test_dir = self.base_path / self.project_id
        self.test_dir.mkdir()

        # Mock environment manager
        mocker.patch(
            "colrev.env.environment_manager.EnvironmentManager.get_name_mail_from_git",
            return_value=("Test User", "test@example.com"),
        )

        # Mock registry file
        mocker.patch.object(
            colrev.constants.Filepaths,
            "REGISTRY_FILE",
            self.test_dir / "reg.json",
        )

        # Initialize project
        original_cwd = os.getcwd()
        os.chdir(self.test_dir)
        try:
            colrev.ops.init.Initializer(
                review_type="literature_review",
                target_path=self.test_dir,
                light=True,
            )
        finally:
            os.chdir(original_cwd)

        self.handler = JSONRPCHandler()

    def test_get_status_returns_comprehensive_data(self):
        """Test that get_status returns comprehensive status information."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_status",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert response["jsonrpc"] == "2.0"
        assert "error" not in response, f"Unexpected error: {response.get('error')}"
        result = response["result"]

        # Check top-level fields
        assert result["success"] is True
        assert result["project_id"] == self.project_id
        assert "path" in result
        assert "status" in result

        # Check status structure
        status = result["status"]
        assert "overall" in status
        assert "currently" in status
        assert "total_records" in status
        assert "next_operation" in status
        assert "completeness_condition" in status
        assert "atomic_steps" in status
        assert "completed_atomic_steps" in status
        assert "has_changes" in status
        assert "duplicates_removed" in status

    def test_get_status_overall_contains_all_states(self):
        """Test that overall status contains all record states."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_status",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)
        assert "error" not in response, f"Unexpected error: {response.get('error')}"
        overall = response["result"]["status"]["overall"]

        expected_states = [
            "md_retrieved",
            "md_imported",
            "md_prepared",
            "md_processed",
            "rev_prescreen_excluded",
            "rev_prescreen_included",
            "pdf_not_available",
            "pdf_imported",
            "pdf_prepared",
            "rev_excluded",
            "rev_included",
            "rev_synthesized",
        ]

        for state in expected_states:
            assert state in overall, f"Missing state: {state}"
            assert isinstance(overall[state], int)

    def test_get_status_currently_contains_all_states(self):
        """Test that currently status contains all record states."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_status",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)
        assert "error" not in response, f"Unexpected error: {response.get('error')}"
        currently = response["result"]["status"]["currently"]

        expected_states = [
            "md_retrieved",
            "md_imported",
            "md_needs_manual_preparation",
            "md_prepared",
            "md_processed",
            "rev_prescreen_excluded",
            "rev_prescreen_included",
            "pdf_needs_manual_retrieval",
            "pdf_not_available",
            "pdf_imported",
            "pdf_needs_manual_preparation",
            "pdf_prepared",
            "rev_excluded",
            "rev_included",
            "rev_synthesized",
        ]

        for state in expected_states:
            assert state in currently, f"Missing state: {state}"
            assert isinstance(currently[state], int)

    def test_status_is_alias_for_get_status(self):
        """Test that status method returns same result as get_status."""
        get_status_request = {
            "jsonrpc": "2.0",
            "method": "get_status",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 1,
        }
        status_request = {
            "jsonrpc": "2.0",
            "method": "status",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 2,
        }

        get_status_response = self.handler.handle_request(get_status_request)
        status_response = self.handler.handle_request(status_request)

        # Compare results (ignoring request ID differences)
        assert get_status_response["result"] == status_response["result"]

    def test_get_status_with_invalid_project_returns_error(self):
        """Test that get_status returns error for non-existent project."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_status",
            "params": {
                "project_id": "nonexistent_project",
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
        assert response["error"]["code"] < 0


class TestValidateEndpoint:
    """Tests for the validate endpoint."""

    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        """Set up a test project for each test."""
        self.base_path = tmp_path
        self.project_id = "validate_test_project"
        self.test_dir = self.base_path / self.project_id
        self.test_dir.mkdir()

        mocker.patch(
            "colrev.env.environment_manager.EnvironmentManager.get_name_mail_from_git",
            return_value=("Test User", "test@example.com"),
        )

        mocker.patch.object(
            colrev.constants.Filepaths,
            "REGISTRY_FILE",
            self.test_dir / "reg.json",
        )

        original_cwd = os.getcwd()
        os.chdir(self.test_dir)
        try:
            colrev.ops.init.Initializer(
                review_type="literature_review",
                target_path=self.test_dir,
                light=True,
            )
        finally:
            os.chdir(original_cwd)

        self.handler = JSONRPCHandler()

    def test_validate_returns_success(self):
        """Test that validate returns success for valid project."""
        request = {
            "jsonrpc": "2.0",
            "method": "validate",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert response["jsonrpc"] == "2.0"
        assert "error" not in response, f"Unexpected error: {response.get('error')}"
        result = response["result"]

        assert result["success"] is True
        assert result["operation"] == "validate"
        assert "details" in result

    def test_validate_with_scope_parameter(self):
        """Test that validate accepts scope parameter."""
        request = {
            "jsonrpc": "2.0",
            "method": "validate",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "scope": "HEAD",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" not in response, f"Unexpected error: {response.get('error')}"
        assert response["result"]["success"] is True

    def test_validate_with_filter_setting_parameter(self):
        """Test that validate accepts filter_setting parameter."""
        request = {
            "jsonrpc": "2.0",
            "method": "validate",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "filter_setting": "general",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" not in response, f"Unexpected error: {response.get('error')}"
        assert response["result"]["success"] is True


class TestGetOperationInfoEndpoint:
    """Tests for the get_operation_info endpoint."""

    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        """Set up a test project for each test."""
        self.base_path = tmp_path
        self.project_id = "operation_info_test_project"
        self.test_dir = self.base_path / self.project_id
        self.test_dir.mkdir()

        mocker.patch(
            "colrev.env.environment_manager.EnvironmentManager.get_name_mail_from_git",
            return_value=("Test User", "test@example.com"),
        )

        mocker.patch.object(
            colrev.constants.Filepaths,
            "REGISTRY_FILE",
            self.test_dir / "reg.json",
        )

        original_cwd = os.getcwd()
        os.chdir(self.test_dir)
        try:
            colrev.ops.init.Initializer(
                review_type="literature_review",
                target_path=self.test_dir,
                light=True,
            )
        finally:
            os.chdir(original_cwd)

        self.handler = JSONRPCHandler()

    def test_get_operation_info_returns_expected_structure(self):
        """Test that get_operation_info returns expected response structure."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_operation_info",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "operation": "search",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert response["jsonrpc"] == "2.0"
        assert "error" not in response, f"Unexpected error: {response.get('error')}"
        result = response["result"]

        assert result["success"] is True
        assert result["operation"] == "search"
        assert "can_run" in result
        assert "reason" in result
        assert "affected_records" in result
        assert "description" in result

    @pytest.mark.parametrize(
        "operation",
        [
            "search",
            "load",
            "prep",
            "dedupe",
            "prescreen",
            "pdf_get",
            "pdf_prep",
            "screen",
            "data",
        ],
    )
    def test_get_operation_info_for_all_operations(self, operation):
        """Test that get_operation_info works for all valid operations."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_operation_info",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "operation": operation,
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" not in response, f"Unexpected error: {response.get('error')}"
        result = response["result"]
        assert result["operation"] == operation
        assert isinstance(result["can_run"], bool)
        assert isinstance(result["affected_records"], int)
        assert isinstance(result["description"], str)
        assert len(result["description"]) > 0

    def test_get_operation_info_invalid_operation_returns_error(self):
        """Test that invalid operation name returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_operation_info",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "operation": "invalid_operation",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
        assert "invalid" in response["error"]["message"].lower()

    def test_get_operation_info_missing_operation_returns_error(self):
        """Test that missing operation parameter returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_operation_info",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response

    def test_get_operation_info_load_cannot_run_on_empty_project(self):
        """Test that load operation cannot run when no records are retrieved."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_operation_info",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "operation": "load",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)
        assert "error" not in response, f"Unexpected error: {response.get('error')}"
        result = response["result"]

        # Fresh project has no records to load
        assert result["can_run"] is False
        assert result["affected_records"] == 0
        assert result["reason"] is not None


class TestJSONRPCProtocol:
    """Tests for JSON-RPC 2.0 protocol compliance."""

    def test_invalid_jsonrpc_version_returns_error(self):
        """Test that invalid JSON-RPC version returns error."""
        handler = JSONRPCHandler()
        request = {
            "jsonrpc": "1.0",
            "method": "ping",
            "id": 1,
        }

        response = handler.handle_request(request)

        assert "error" in response
        assert response["error"]["code"] == -32600  # Invalid Request

    def test_missing_method_returns_error(self):
        """Test that missing method returns error."""
        handler = JSONRPCHandler()
        request = {
            "jsonrpc": "2.0",
            "params": {},
            "id": 1,
        }

        response = handler.handle_request(request)

        assert "error" in response
        assert response["error"]["code"] == -32600  # Invalid Request

    def test_unknown_method_returns_error(self):
        """Test that unknown method returns error."""
        handler = JSONRPCHandler()
        request = {
            "jsonrpc": "2.0",
            "method": "unknown_method",
            "params": {},
            "id": 1,
        }

        response = handler.handle_request(request)

        assert "error" in response
        # Should be either Method not found or Internal error
        assert response["error"]["code"] < 0

    def test_response_contains_request_id(self):
        """Test that response contains the same ID as request."""
        handler = JSONRPCHandler()
        request_id = 12345

        request = {
            "jsonrpc": "2.0",
            "method": "ping",
            "params": {},
            "id": request_id,
        }

        response = handler.handle_request(request)

        assert response["id"] == request_id
