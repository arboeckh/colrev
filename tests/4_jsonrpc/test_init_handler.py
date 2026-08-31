#!/usr/bin/env python
"""Tests for the project lifecycle endpoints (WP-08 §3).

``init_project`` / ``list_projects`` / ``delete_project`` are the only RPCs
that run with no project open, and the only ones that create or destroy a
repository on disk. Three properties matter and were untested:

* a fresh project lands on ``main`` (packaged builds use dugite's git, which
  has no ``init.defaultBranch`` and would otherwise produce ``master`` —
  every later push assumes ``main``);
* ``list_projects`` reports only real CoLRev projects, so a stray directory
  under the projects root cannot make the landing page offer a broken entry;
* ``delete_project`` refuses to ``rmtree`` anything that is not one.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

import colrev.constants
from colrev.ui_jsonrpc.handler import JSONRPCHandler


def _request(handler: JSONRPCHandler, method: str, params: dict | None = None) -> dict:
    return handler.handle_request(
        {"jsonrpc": "2.0", "method": method, "params": params or {}, "id": 1}
    )


@pytest.fixture
def handler() -> JSONRPCHandler:
    return JSONRPCHandler()


@pytest.fixture
def projects_root(tmp_path: Path, mocker) -> Path:
    mocker.patch(
        "colrev.env.environment_manager.EnvironmentManager.get_name_mail_from_git",
        return_value=("Test User", "test@example.com"),
    )
    mocker.patch.object(
        colrev.constants.Filepaths, "REGISTRY_FILE", tmp_path / "reg.json"
    )
    root = tmp_path / "projects"
    root.mkdir()
    return root


@pytest.fixture
def initialized_project(handler, projects_root: Path) -> Path:
    response = _request(
        handler,
        "init_project",
        {"project_id": "review_one", "title": "Review One", "base_path": str(projects_root)},
    )
    assert "error" not in response, response.get("error")
    return projects_root / "review_one"


class TestInitProject:
    def test_creates_a_colrev_project_on_main(self, handler, initialized_project) -> None:
        assert (initialized_project / "settings.json").exists()

        branch = subprocess.run(
            ["git", "symbolic-ref", "--short", "HEAD"],
            cwd=str(initialized_project),
            capture_output=True,
            text=True,
        )
        # Not `master`: the publish flow pushes whatever HEAD names, and the
        # rest of the app assumes `main`.
        assert branch.stdout.strip() == "main"

    def test_writes_the_requested_title_into_settings(
        self, handler, initialized_project
    ) -> None:
        settings = json.loads((initialized_project / "settings.json").read_text())
        assert settings["project"]["title"] == "Review One"

    def test_sanitizes_the_project_id_out_of_a_traversal_attempt(
        self, handler, projects_root
    ) -> None:
        response = _request(
            handler,
            "init_project",
            {"project_id": "../escaped", "base_path": str(projects_root)},
        )

        assert "error" not in response, response.get("error")
        # The id is stripped to safe characters, and the project stays under
        # the projects root.
        assert response["result"]["project_id"] == "escaped"
        assert Path(response["result"]["path"]).parent == projects_root.resolve()
        assert not (projects_root.parent / "escaped").exists()

    def test_reports_failure_for_an_unknown_review_type(
        self, handler, projects_root
    ) -> None:
        response = _request(
            handler,
            "init_project",
            {
                "project_id": "bad_type",
                "review_type": "colrev.not_a_review_type",
                "base_path": str(projects_root),
            },
        )
        assert "error" in response


class TestListProjects:
    def test_lists_an_initialized_project_with_its_title(
        self, handler, projects_root, initialized_project
    ) -> None:
        response = _request(handler, "list_projects", {"base_path": str(projects_root)})

        projects = response["result"]["projects"]
        assert [p["id"] for p in projects] == ["review_one"]
        assert projects[0]["title"] == "Review One"

    def test_ignores_directories_that_are_not_colrev_projects(
        self, handler, projects_root, initialized_project
    ) -> None:
        (projects_root / "just-a-folder").mkdir()
        (projects_root / "loose-file.txt").write_text("x")

        response = _request(handler, "list_projects", {"base_path": str(projects_root)})
        assert [p["id"] for p in response["result"]["projects"]] == ["review_one"]

    def test_falls_back_to_the_id_when_settings_are_unreadable(
        self, handler, projects_root
    ) -> None:
        broken = projects_root / "broken"
        broken.mkdir()
        (broken / "settings.json").write_text("{not json")

        response = _request(handler, "list_projects", {"base_path": str(projects_root)})
        assert response["result"]["projects"][0]["title"] == "broken"

    def test_returns_an_empty_list_for_a_missing_root(self, handler, tmp_path) -> None:
        response = _request(
            handler, "list_projects", {"base_path": str(tmp_path / "nope")}
        )
        assert response["result"]["projects"] == []


class TestDeleteProject:
    def test_removes_the_project_directory(
        self, handler, projects_root, initialized_project
    ) -> None:
        response = _request(
            handler,
            "delete_project",
            {"project_id": "review_one", "base_path": str(projects_root)},
        )

        assert response["result"]["project_id"] == "review_one"
        assert not initialized_project.exists()

    def test_refuses_a_directory_that_is_not_a_colrev_project(
        self, handler, projects_root
    ) -> None:
        stray = projects_root / "not-a-project"
        stray.mkdir()
        (stray / "important.txt").write_text("do not delete me")

        response = _request(
            handler,
            "delete_project",
            {"project_id": "not-a-project", "base_path": str(projects_root)},
        )

        assert "error" in response
        assert stray.exists(), "delete_project rmtree'd a non-project directory"

    def test_reports_a_missing_project(self, handler, projects_root) -> None:
        response = _request(
            handler,
            "delete_project",
            {"project_id": "never_existed", "base_path": str(projects_root)},
        )
        assert "error" in response
