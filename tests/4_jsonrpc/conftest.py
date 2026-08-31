#!/usr/bin/env python
"""Conftest file containing fixtures for JSON-RPC handler tests."""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Generator

import pytest

import colrev.ops.init
import colrev.review_manager
from colrev.ui_jsonrpc.handler import JSONRPCHandler


@pytest.fixture(scope="session", autouse=True)
def _venv_bin_on_path() -> Generator[None, None, None]:
    """Make the running interpreter's bin directory resolvable via PATH.

    ``colrev init`` shells out to ``pre-commit`` by bare name. When pytest is
    invoked by absolute path (``.venv-test/bin/pytest ...``) without activating
    the venv, that binary is not on PATH and every project-initializing test
    errors with FileNotFoundError. Prepending the interpreter's own bin dir
    resolves it from whichever venv is actually running the tests.
    """
    bin_dir = str(Path(sys.executable).parent)
    original = os.environ.get("PATH", "")
    if bin_dir not in original.split(os.pathsep):
        os.environ["PATH"] = bin_dir + os.pathsep + original
    try:
        yield
    finally:
        os.environ["PATH"] = original


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


# ---------------------------------------------------------------------------
# RPC method coverage recording (WP-08 §3)
#
# Every test in this package drives the backend through
# ``JSONRPCHandler.handle_request``. Wrapping it here records, per method,
# whether a test ever produced a successful result and whether one ever
# produced an error — which ``test_zz_method_coverage.py`` then checks against
# the live registry. That keeps the coverage claim honest without a
# hand-maintained list of "methods we have tests for".
# ---------------------------------------------------------------------------

OUTCOME_HAPPY = "happy"
OUTCOME_FAILURE = "failure"

#: method name -> set of observed outcomes ({"happy", "failure"}).
RPC_OUTCOMES: dict[str, set[str]] = defaultdict(set)

#: Basenames of the test modules collected from this package this run. The
#: coverage assertion only means something when the whole package ran.
COLLECTED_MODULES: set[str] = set()


def pytest_collection_modifyitems(items) -> None:  # noqa: D103
    package_dir = Path(__file__).parent
    for item in items:
        path = Path(str(item.fspath))
        if path.parent == package_dir:
            COLLECTED_MODULES.add(path.name)


@pytest.fixture(scope="session", autouse=True)
def _record_rpc_outcomes() -> Generator[None, None, None]:
    """Record every dispatched method and whether it succeeded or errored."""
    original = JSONRPCHandler.handle_request

    def recording(self, request: dict) -> dict:
        response = original(self, request)
        method = request.get("method")
        if isinstance(method, str):
            outcome = OUTCOME_FAILURE if "error" in response else OUTCOME_HAPPY
            RPC_OUTCOMES[method].add(outcome)
        return response

    JSONRPCHandler.handle_request = recording  # type: ignore[method-assign]
    try:
        yield
    finally:
        JSONRPCHandler.handle_request = original  # type: ignore[method-assign]


@pytest.fixture(scope="session")
def rpc_outcomes() -> dict[str, set[str]]:
    """Observed outcomes per RPC method (see ``test_zz_method_coverage.py``)."""
    return RPC_OUTCOMES


@pytest.fixture(scope="session")
def collected_test_modules() -> set[str]:
    """Test module basenames collected from this package this run."""
    return COLLECTED_MODULES
