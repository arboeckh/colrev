#!/usr/bin/env python
"""Tests for the PrescreenHandler queue management JSON-RPC endpoints.

Tests cover the following endpoints:
    - get_prescreen_queue: Get records awaiting prescreening
    - prescreen_record: Submit prescreening decision for a single record
    - enrich_record_metadata: Enrich a single record with API data
    - batch_enrich_records: Enrich multiple records in one call
"""
from __future__ import annotations

import os

import pytest

import colrev.constants
import colrev.ops.init
from colrev.ui_jsonrpc.handler import JSONRPCHandler


class TestGetPrescreenQueueEndpoint:
    """Tests for the get_prescreen_queue endpoint."""

    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        """Set up a test project for each test."""
        self.base_path = tmp_path
        self.project_id = "prescreen_queue_test_project"
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

    def test_get_prescreen_queue_returns_expected_structure(self):
        """Test that get_prescreen_queue returns expected response structure."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_prescreen_queue",
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
        assert isinstance(result["records"], list)
        assert isinstance(result["total_count"], int)

    def test_get_prescreen_queue_with_limit(self):
        """Test get_prescreen_queue with limit parameter."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_prescreen_queue",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "limit": 5,
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" not in response, f"Unexpected error: {response.get('error')}"
        result = response["result"]

        assert len(result["records"]) <= 5

    def test_get_prescreen_queue_record_fields(self):
        """Test that records in queue have expected fields."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_prescreen_queue",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)
        assert "error" not in response, f"Unexpected error: {response.get('error')}"

        records = response["result"]["records"]
        if len(records) > 0:
            record = records[0]
            # Required fields
            assert "id" in record
            assert "title" in record
            assert "author" in record
            assert "year" in record

    def test_get_prescreen_queue_with_invalid_project_returns_error(self):
        """Test that get_prescreen_queue returns error for non-existent project."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_prescreen_queue",
            "params": {
                "project_id": "nonexistent_project",
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response


class TestPrescreenRecordEndpoint:
    """Tests for the prescreen_record endpoint."""

    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        """Set up a test project for each test."""
        self.base_path = tmp_path
        self.project_id = "prescreen_record_test_project"
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

    def test_prescreen_record_missing_record_id_returns_error(self):
        """Test that missing record_id parameter returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "prescreen_record",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "decision": "include",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
        assert "record_id" in response["error"]["message"].lower()

    def test_prescreen_record_missing_decision_returns_error(self):
        """Test that missing decision parameter returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "prescreen_record",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "record_id": "some_record",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
        assert "decision" in response["error"]["message"].lower()

    def test_prescreen_record_invalid_decision_returns_error(self):
        """Test that invalid decision parameter returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "prescreen_record",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "record_id": "some_record",
                "decision": "maybe",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
        assert "include" in response["error"]["message"].lower() or "exclude" in response["error"]["message"].lower()

    def test_prescreen_record_nonexistent_record_returns_error(self):
        """Test that non-existent record returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "prescreen_record",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "record_id": "nonexistent_record_id",
                "decision": "include",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response

    def test_prescreen_record_with_invalid_project_returns_error(self):
        """Test that prescreen_record returns error for non-existent project."""
        request = {
            "jsonrpc": "2.0",
            "method": "prescreen_record",
            "params": {
                "project_id": "nonexistent_project",
                "base_path": str(self.base_path),
                "record_id": "some_record",
                "decision": "include",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response


class TestEnrichRecordMetadataEndpoint:
    """Tests for the enrich_record_metadata endpoint."""

    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        """Set up a test project for each test."""
        self.base_path = tmp_path
        self.project_id = "enrich_metadata_test_project"
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

    def test_enrich_record_metadata_missing_record_id_returns_error(self):
        """Test that missing record_id parameter returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "enrich_record_metadata",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
        assert "record_id" in response["error"]["message"].lower()

    def test_enrich_record_metadata_nonexistent_record_returns_error(self):
        """Test that non-existent record returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "enrich_record_metadata",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "record_id": "nonexistent_record_id",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response

    def test_enrich_record_metadata_with_invalid_project_returns_error(self):
        """Test that enrich_record_metadata returns error for non-existent project."""
        request = {
            "jsonrpc": "2.0",
            "method": "enrich_record_metadata",
            "params": {
                "project_id": "nonexistent_project",
                "base_path": str(self.base_path),
                "record_id": "some_record",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response


class TestBatchEnrichRecordsEndpoint:
    """Tests for the batch_enrich_records endpoint."""

    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        """Set up a test project for each test."""
        self.base_path = tmp_path
        self.project_id = "batch_enrich_test_project"
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

    def test_batch_enrich_records_missing_record_ids_returns_error(self):
        """Test that missing record_ids parameter returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "batch_enrich_records",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
        assert "record_ids" in response["error"]["message"].lower()

    def test_batch_enrich_records_empty_record_ids_returns_error(self):
        """Test that empty record_ids list returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "batch_enrich_records",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "record_ids": [],
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
        assert "record_ids" in response["error"]["message"].lower()

    def test_batch_enrich_records_with_invalid_project_returns_error(self):
        """Test that batch_enrich_records returns error for non-existent project."""
        request = {
            "jsonrpc": "2.0",
            "method": "batch_enrich_records",
            "params": {
                "project_id": "nonexistent_project",
                "base_path": str(self.base_path),
                "record_ids": ["record1", "record2"],
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response

    def test_batch_enrich_records_nonexistent_records_returns_failed_count(self):
        """Test that non-existent records are counted in failed_count."""
        request = {
            "jsonrpc": "2.0",
            "method": "batch_enrich_records",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "record_ids": ["nonexistent1", "nonexistent2"],
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" not in response, f"Unexpected error: {response.get('error')}"
        result = response["result"]

        assert result["success"] is True
        assert result["failed_count"] == 2
        assert result["enriched_count"] == 0
        assert len(result["records"]) == 2
