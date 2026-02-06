#!/usr/bin/env python
"""Tests for the SearchHandler source management JSON-RPC endpoints.

Tests cover the following endpoints:
    - get_sources: List all configured search sources
    - add_source: Add a new search source
    - upload_search_file: Upload a search results file
"""
from __future__ import annotations

import os

import pytest

import colrev.constants
import colrev.ops.init
from colrev.ui_jsonrpc.handler import JSONRPCHandler


class TestGetSourcesEndpoint:
    """Tests for the get_sources endpoint."""

    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        """Set up a test project for each test."""
        self.base_path = tmp_path
        self.project_id = "sources_test_project"
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

    def test_get_sources_returns_expected_structure(self):
        """Test that get_sources returns expected response structure."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_sources",
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
        assert result["project_id"] == self.project_id
        assert "sources" in result
        assert isinstance(result["sources"], list)

    def test_get_sources_source_structure(self):
        """Test that each source has expected fields."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_sources",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)
        assert "error" not in response, f"Unexpected error: {response.get('error')}"

        sources = response["result"]["sources"]
        if len(sources) > 0:
            source = sources[0]
            # ExtendedSearchFile uses platform/search_results_path
            assert "platform" in source
            assert "search_results_path" in source
            assert "search_type" in source

    def test_get_sources_with_invalid_project_returns_error(self):
        """Test that get_sources returns error for non-existent project."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_sources",
            "params": {
                "project_id": "nonexistent_project",
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response


class TestAddSourceEndpoint:
    """Tests for the add_source endpoint."""

    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        """Set up a test project for each test."""
        self.base_path = tmp_path
        self.project_id = "add_source_test_project"
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

    def test_add_source_missing_endpoint_returns_error(self):
        """Test that missing endpoint parameter returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "add_source",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "search_type": "DB",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
        assert "endpoint" in response["error"]["message"].lower()

    def test_add_source_missing_search_type_returns_error(self):
        """Test that missing search_type parameter returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "add_source",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "endpoint": "colrev.crossref",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
        assert "search_type" in response["error"]["message"].lower()

    def test_add_source_invalid_search_type_returns_error(self):
        """Test that invalid search_type returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "add_source",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "endpoint": "colrev.crossref",
                "search_type": "INVALID_TYPE",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
        assert "invalid" in response["error"]["message"].lower()

    def test_add_source_with_invalid_project_returns_error(self):
        """Test that add_source returns error for non-existent project."""
        request = {
            "jsonrpc": "2.0",
            "method": "add_source",
            "params": {
                "project_id": "nonexistent_project",
                "base_path": str(self.base_path),
                "endpoint": "colrev.crossref",
                "search_type": "API",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response


class TestUploadSearchFileEndpoint:
    """Tests for the upload_search_file endpoint."""

    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        """Set up a test project for each test."""
        self.base_path = tmp_path
        self.project_id = "upload_file_test_project"
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

    def test_upload_search_file_returns_expected_structure(self):
        """Test that upload_search_file returns expected response structure."""
        bibtex_content = """@article{test2024,
  title = {Test Article},
  author = {Test Author},
  year = {2024},
  journal = {Test Journal}
}"""
        request = {
            "jsonrpc": "2.0",
            "method": "upload_search_file",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "filename": "test_search.bib",
                "content": bibtex_content,
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert response["jsonrpc"] == "2.0"
        assert "error" not in response, f"Unexpected error: {response.get('error')}"
        result = response["result"]

        assert result["success"] is True
        assert result["operation"] == "upload_search_file"
        assert "details" in result
        assert "path" in result["details"]
        assert "detected_format" in result["details"]

    def test_upload_search_file_detects_bibtex(self):
        """Test that BibTeX format is detected."""
        bibtex_content = """@article{test2024,
  title = {Test Article}
}"""
        request = {
            "jsonrpc": "2.0",
            "method": "upload_search_file",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "filename": "test.bib",
                "content": bibtex_content,
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)
        assert "error" not in response, f"Unexpected error: {response.get('error')}"

        assert response["result"]["details"]["detected_format"] == "bibtex"

    def test_upload_search_file_detects_ris(self):
        """Test that RIS format is detected."""
        ris_content = """TY  - JOUR
TI  - Test Article
AU  - Test Author
PY  - 2024
ER  -
"""
        request = {
            "jsonrpc": "2.0",
            "method": "upload_search_file",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "filename": "test.ris",
                "content": ris_content,
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)
        assert "error" not in response, f"Unexpected error: {response.get('error')}"

        assert response["result"]["details"]["detected_format"] == "ris"

    def test_upload_search_file_missing_filename_returns_error(self):
        """Test that missing filename parameter returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "upload_search_file",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "content": "some content",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
        assert "filename" in response["error"]["message"].lower()

    def test_upload_search_file_missing_content_returns_error(self):
        """Test that missing content parameter returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "upload_search_file",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "filename": "test.bib",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
        assert "content" in response["error"]["message"].lower()

    def test_upload_search_file_with_invalid_project_returns_error(self):
        """Test that upload_search_file returns error for non-existent project."""
        request = {
            "jsonrpc": "2.0",
            "method": "upload_search_file",
            "params": {
                "project_id": "nonexistent_project",
                "base_path": str(self.base_path),
                "filename": "test.bib",
                "content": "@article{test,}",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
