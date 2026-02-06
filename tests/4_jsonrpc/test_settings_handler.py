#!/usr/bin/env python
"""Tests for the SettingsHandler JSON-RPC endpoints.

Tests cover the following endpoints:
    - get_settings: Get current project settings
    - update_settings: Update project settings (partial update)
"""
from __future__ import annotations

import os

import pytest

import colrev.constants
import colrev.ops.init
from colrev.ui_jsonrpc.handler import JSONRPCHandler


class TestGetSettingsEndpoint:
    """Tests for the get_settings endpoint."""

    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        """Set up a test project for each test."""
        self.base_path = tmp_path
        self.project_id = "settings_test_project"
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

    def test_get_settings_returns_complete_settings(self):
        """Test that get_settings returns complete project settings."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_settings",
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
        assert "settings" in result

        settings = result["settings"]
        # Check top-level settings sections exist
        assert "project" in settings
        assert "search" in settings
        assert "prep" in settings
        assert "dedupe" in settings
        assert "prescreen" in settings
        assert "pdf_get" in settings
        assert "pdf_prep" in settings
        assert "screen" in settings
        assert "data" in settings
        assert "sources" in settings

    def test_get_settings_project_section(self):
        """Test that project settings section contains expected fields."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_settings",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)
        assert "error" not in response, f"Unexpected error: {response.get('error')}"

        project = response["result"]["settings"]["project"]
        assert "title" in project
        assert "authors" in project
        assert "review_type" in project
        assert "colrev_version" in project

    def test_get_settings_sources_list(self):
        """Test that sources is a list."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_settings",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)
        assert "error" not in response, f"Unexpected error: {response.get('error')}"

        sources = response["result"]["settings"]["sources"]
        assert isinstance(sources, list)

    def test_get_settings_with_invalid_project_returns_error(self):
        """Test that get_settings returns error for non-existent project."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_settings",
            "params": {
                "project_id": "nonexistent_project",
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
        assert response["error"]["code"] < 0


class TestUpdateSettingsEndpoint:
    """Tests for the update_settings endpoint."""

    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        """Set up a test project for each test."""
        self.base_path = tmp_path
        self.project_id = "update_settings_test_project"
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

    def test_update_settings_project_title(self):
        """Test updating project title."""
        request = {
            "jsonrpc": "2.0",
            "method": "update_settings",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "settings": {
                    "project": {
                        "title": "Updated Project Title",
                    }
                },
                "skip_commit": True,
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert response["jsonrpc"] == "2.0"
        assert "error" not in response, f"Unexpected error: {response.get('error')}"
        result = response["result"]

        assert result["success"] is True
        assert result["operation"] == "update_settings"
        assert "details" in result
        assert "updated_fields" in result["details"]
        assert "project.title" in result["details"]["updated_fields"]

        # Verify the update persisted
        get_request = {
            "jsonrpc": "2.0",
            "method": "get_settings",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 2,
        }
        get_response = self.handler.handle_request(get_request)
        assert get_response["result"]["settings"]["project"]["title"] == "Updated Project Title"

    def test_update_settings_missing_settings_returns_error(self):
        """Test that missing settings parameter returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "update_settings",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
        assert "settings" in response["error"]["message"].lower()

    def test_update_settings_invalid_settings_type_returns_error(self):
        """Test that non-dict settings parameter returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "update_settings",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "settings": "not a dict",
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response

    def test_update_settings_with_invalid_project_returns_error(self):
        """Test that update_settings returns error for non-existent project."""
        request = {
            "jsonrpc": "2.0",
            "method": "update_settings",
            "params": {
                "project_id": "nonexistent_project",
                "base_path": str(self.base_path),
                "settings": {"project": {"title": "Test"}},
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
