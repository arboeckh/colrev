#!/usr/bin/env python
"""Tests for the GitHandler JSON-RPC endpoints.

Tests cover the following endpoints:
    - get_git_status: Get Git repository status
"""
from __future__ import annotations

import os

import pytest

import colrev.constants
import colrev.ops.init
from colrev.ui_jsonrpc.handler import JSONRPCHandler


class TestGetGitStatusEndpoint:
    """Tests for the get_git_status endpoint."""

    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        """Set up a test project for each test."""
        self.base_path = tmp_path
        self.project_id = "git_status_test_project"
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

    def test_get_git_status_returns_expected_structure(self):
        """Test that get_git_status returns expected response structure."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_git_status",
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
        assert "git" in result

        git_status = result["git"]
        assert "branch" in git_status
        assert "is_clean" in git_status
        assert "uncommitted_changes" in git_status
        assert "untracked_files" in git_status
        assert "modified_files" in git_status
        assert "staged_files" in git_status
        assert "ahead" in git_status
        assert "behind" in git_status
        assert "last_commit" in git_status

    def test_get_git_status_branch_is_string(self):
        """Test that branch is returned as string."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_git_status",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)
        assert "error" not in response, f"Unexpected error: {response.get('error')}"

        branch = response["result"]["git"]["branch"]
        assert isinstance(branch, str)
        assert len(branch) > 0

    def test_get_git_status_is_clean_boolean(self):
        """Test that is_clean is returned as boolean."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_git_status",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)
        assert "error" not in response, f"Unexpected error: {response.get('error')}"

        is_clean = response["result"]["git"]["is_clean"]
        assert isinstance(is_clean, bool)

    def test_get_git_status_files_are_lists(self):
        """Test that file lists are returned as lists."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_git_status",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)
        assert "error" not in response, f"Unexpected error: {response.get('error')}"

        git_status = response["result"]["git"]
        assert isinstance(git_status["untracked_files"], list)
        assert isinstance(git_status["modified_files"], list)
        assert isinstance(git_status["staged_files"], list)

    def test_get_git_status_last_commit_structure(self):
        """Test that last_commit has expected structure when present."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_git_status",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)
        assert "error" not in response, f"Unexpected error: {response.get('error')}"

        last_commit = response["result"]["git"]["last_commit"]
        # A newly initialized project should have at least one commit
        if last_commit is not None:
            assert "hash" in last_commit
            assert "short_hash" in last_commit
            assert "message" in last_commit
            assert "author" in last_commit
            assert "timestamp" in last_commit

    def test_get_git_status_ahead_behind_are_integers(self):
        """Test that ahead/behind counts are integers."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_git_status",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)
        assert "error" not in response, f"Unexpected error: {response.get('error')}"

        git_status = response["result"]["git"]
        assert isinstance(git_status["ahead"], int)
        assert isinstance(git_status["behind"], int)
        assert git_status["ahead"] >= 0
        assert git_status["behind"] >= 0

    def test_get_git_status_with_invalid_project_returns_error(self):
        """Test that get_git_status returns error for non-existent project."""
        request = {
            "jsonrpc": "2.0",
            "method": "get_git_status",
            "params": {
                "project_id": "nonexistent_project",
                "base_path": str(self.base_path),
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" in response
