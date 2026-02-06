#!/usr/bin/env python
"""Conftest file containing fixtures for JSON-RPC handler tests."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Generator

import pytest

import colrev.ops.init
import colrev.review_manager
from colrev.ui_jsonrpc.handler import JSONRPCHandler


@pytest.fixture(scope="module")
def jsonrpc_handler() -> JSONRPCHandler:
    """Return a JSONRPCHandler instance."""
    return JSONRPCHandler()


@pytest.fixture(scope="module")
def test_project_path(tmp_path_factory, session_mocker) -> Generator[Path, None, None]:
    """Create a test CoLRev project and return its path."""
    # Create temporary directory
    test_dir = tmp_path_factory.mktemp("jsonrpc_test_project")

    # Mock environment manager to avoid git config issues
    session_mocker.patch(
        "colrev.env.environment_manager.EnvironmentManager.get_name_mail_from_git",
        return_value=("Test User", "test@example.com"),
    )

    # Mock registry file
    session_mocker.patch.object(
        colrev.constants.Filepaths,
        "REGISTRY_FILE",
        test_dir / "reg.json",
    )

    # Initialize project
    os.chdir(test_dir)
    colrev.ops.init.Initializer(
        review_type="literature_review",
        target_path=test_dir,
        light=True,
    )

    yield test_dir


@pytest.fixture(scope="module")
def test_project_id() -> str:
    """Return the test project ID."""
    return "test_project"


def make_request(
    handler: JSONRPCHandler,
    method: str,
    params: dict = None,
    request_id: int = 1,
) -> dict:
    """Helper function to create and send a JSON-RPC request.

    Args:
        handler: JSONRPCHandler instance
        method: JSON-RPC method name
        params: Method parameters
        request_id: Request ID

    Returns:
        JSON-RPC response dictionary
    """
    request = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params or {},
        "id": request_id,
    }
    return handler.handle_request(request)
