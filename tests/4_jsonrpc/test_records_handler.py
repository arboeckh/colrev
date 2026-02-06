#!/usr/bin/env python
"""Tests for the RecordsHandler JSON-RPC endpoints.

Tests cover the following endpoints:
    - get_records: Get records with filtering and pagination
    - get_record: Get a single record by ID
    - update_record: Update a record's fields
"""
from __future__ import annotations

import os

import pytest

import colrev.constants
import colrev.ops.init
from colrev.constants import Fields, RecordState
from colrev.ui_jsonrpc.handler import JSONRPCHandler


class TestGetRecordsEndpoint:
    """Tests for the get_records endpoint."""

    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        """Set up a test project for each test."""
        self.base_path = tmp_path
        self.project_id = "records_test_project"
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
            # Initialize with example records
            colrev.ops.init.Initializer(
                review_type="literature_review",
                target_path=self.test_dir,
                light=True,
                example=True,  # Include example records
            )
        finally:
            os.chdir(original_cwd)

        self.handler = JSONRPCHandler()

    def test_get_records_returns_expected_structure(self):
        """Test that get_records returns expected response structure."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_records",
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
        assert "total_count" in result
        assert "records" in result
        assert "pagination" in result
        assert isinstance(result["records"], list)
        assert "offset" in result["pagination"]
        assert "limit" in result["pagination"]
        assert "has_more" in result["pagination"]

    def test_get_records_with_pagination(self):
        """Test get_records with pagination parameters."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_records",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "pagination": {
                    "offset": 0,
                    "limit": 10,
                },
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" not in response, f"Unexpected error: {response.get('error')}"
        result = response["result"]

        assert result["pagination"]["offset"] == 0
        assert result["pagination"]["limit"] == 10
        assert len(result["records"]) <= 10

    def test_get_records_with_status_filter(self):
        """Test get_records with status filter."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_records",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "filters": {
                    "status": ["md_imported"],
                },
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" not in response, f"Unexpected error: {response.get('error')}"
        result = response["result"]

        # All returned records should have md_imported status
        for record in result["records"]:
            assert record.get(Fields.STATUS) == "md_imported"

    def test_get_records_with_text_search(self):
        """Test get_records with text search filter."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_records",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "filters": {
                    "search_text": "test",
                },
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" not in response, f"Unexpected error: {response.get('error')}"
        # Response should be valid even if no matches
        assert response["result"]["success"] is True

    def test_get_records_with_invalid_project_returns_error(self):
        """Test that get_records returns error for non-existent project."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_records",
            "params": {
                "project_id": "nonexistent_project",
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response


class TestGetRecordEndpoint:
    """Tests for the get_record endpoint."""

    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        """Set up a test project with example records."""
        self.base_path = tmp_path
        self.project_id = "get_record_test_project"
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
                example=True,
            )
        finally:
            os.chdir(original_cwd)

        self.handler = JSONRPCHandler()

    def test_get_record_missing_record_id_returns_error(self):
        """Test that missing record_id parameter returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_record",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
        assert "record_id" in response["error"]["message"].lower()

    def test_get_record_nonexistent_returns_error(self):
        """Test that non-existent record_id returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_record",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "record_id": "nonexistent_record_id",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response


class TestUpdateRecordEndpoint:
    """Tests for the update_record endpoint."""

    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        """Set up a test project with example records."""
        self.base_path = tmp_path
        self.project_id = "update_record_test_project"
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
                example=True,
            )
        finally:
            os.chdir(original_cwd)

        self.handler = JSONRPCHandler()

    def test_update_record_missing_record_id_returns_error(self):
        """Test that missing record_id parameter returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "update_record",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "fields": {"title": "New Title"},
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
        assert "record_id" in response["error"]["message"].lower()

    def test_update_record_missing_fields_returns_error(self):
        """Test that missing fields parameter returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "update_record",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "record_id": "some_record",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
        assert "fields" in response["error"]["message"].lower()

    def test_update_record_nonexistent_returns_error(self):
        """Test that updating non-existent record returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "update_record",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "record_id": "nonexistent_record_id",
                "fields": {"title": "New Title"},
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response

    def test_update_record_protected_field_returns_error(self):
        """Test that updating protected field (ID) returns error."""
        # First get a valid record ID
        get_request = {
            "jsonrpc": "2.0",
            "method": "get_records",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "pagination": {"limit": 1},
            },
            "id": 1,
        }
        get_response = self.handler.handle_request(get_request)

        if get_response["result"]["total_count"] == 0:
            pytest.skip("No records in test project")

        record_id = get_response["result"]["records"][0]["ID"]

        # Try to update protected field
        request = {
            "jsonrpc": "2.0",
            "method": "update_record",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "record_id": record_id,
                "fields": {"ID": "new_id"},
                "skip_commit": True,
            },
            "id": 2,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
        assert "protected" in response["error"]["message"].lower()
