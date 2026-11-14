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
from colrev.ui_jsonrpc import validation
from colrev.ui_jsonrpc.errors import NotFoundError
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

    @pytest.mark.parametrize(
        "bad_id",
        ["../escaped", "..", ".", ".hidden", "a/b", "a\\b", "/abs", "", "has space"],
    )
    def test_rejects_a_project_id_that_could_leave_the_projects_root(
        self, handler, projects_root, bad_id
    ) -> None:
        response = _request(
            handler,
            "init_project",
            {"project_id": bad_id, "base_path": str(projects_root)},
        )

        assert "error" in response
        assert response["error"]["code"] == -32602
        assert list(projects_root.iterdir()) == []
        assert not (projects_root.parent / "escaped").exists()

    def test_keeps_a_project_id_with_dots_as_it_is(self, handler, projects_root) -> None:
        # GitHub allows dots in repository names, and a cloned repository's id
        # is its name: the id must not be rewritten.
        response = _request(
            handler,
            "init_project",
            {"project_id": "lit-review-v1.2", "base_path": str(projects_root)},
        )

        assert "error" not in response, response.get("error")
        assert response["result"]["project_id"] == "lit-review-v1.2"
        assert (projects_root / "lit-review-v1.2" / "settings.json").exists()

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


class TestProjectIdsWithDots:
    """A folder named ``review.v2`` (e.g. a cloned repo) is listed *and* opens."""

    @staticmethod
    def _make_project(root: Path, name: str) -> Path:
        project = root / name
        project.mkdir()
        (project / "settings.json").write_text(
            json.dumps({"project": {"title": name}})
        )
        return project

    def test_a_listed_project_with_a_dot_resolves_to_its_own_directory(
        self, handler, projects_root, initialized_project
    ) -> None:
        # `reviewv2` is what the old id rewriting turned `review.v2` into.
        dotted = self._make_project(projects_root, "review.v2")
        self._make_project(projects_root, "reviewv2")

        listed = _request(handler, "list_projects", {"base_path": str(projects_root)})
        listed_ids = {p["id"] for p in listed["result"]["projects"]}
        assert {"review.v2", "reviewv2"} <= listed_ids

        resolved = validation.validate_existing_project(
            {"project_id": "review.v2", "base_path": str(projects_root)}
        )
        assert resolved == dotted.resolve()

    def test_project_calls_reject_a_traversal_id(self, handler, projects_root) -> None:
        response = _request(
            handler,
            "get_status",
            {"project_id": "../projects", "base_path": str(projects_root)},
        )
        assert response["error"]["code"] == -32602

    def test_project_calls_do_not_fall_through_to_a_sibling(
        self, handler, projects_root
    ) -> None:
        # Only `reviewv2` exists: asking for `review.v2` is "not found", not a
        # silent operation on the other project.
        self._make_project(projects_root, "reviewv2")
        with pytest.raises(NotFoundError):
            validation.validate_existing_project(
                {"project_id": "review.v2", "base_path": str(projects_root)}
            )


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

    def test_one_undecodable_settings_file_does_not_fail_the_list(
        self, handler, projects_root, initialized_project
    ) -> None:
        broken = projects_root / "latin1"
        broken.mkdir()
        (broken / "settings.json").write_bytes(b'{"project": {"title": "caf\xe9"}}')

        response = _request(handler, "list_projects", {"base_path": str(projects_root)})
        titles = {p["id"]: p["title"] for p in response["result"]["projects"]}
        assert titles == {"review_one": "Review One", "latin1": "latin1"}

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

    @pytest.mark.parametrize("bad_id", ["../projects", "..", ".", "a/b", ".hidden", ""])
    def test_rejects_an_id_that_could_leave_the_projects_root(
        self, handler, projects_root, initialized_project, bad_id
    ) -> None:
        response = _request(
            handler,
            "delete_project",
            {"project_id": bad_id, "base_path": str(projects_root)},
        )

        assert response["error"]["code"] == -32602
        assert initialized_project.exists(), "delete_project followed a traversal id"
        assert projects_root.exists()

    def test_deletes_a_project_whose_name_has_a_dot(self, handler, projects_root) -> None:
        project = projects_root / "review.v2"
        project.mkdir()
        (project / "settings.json").write_text("{}")

        response = _request(
            handler,
            "delete_project",
            {"project_id": "review.v2", "base_path": str(projects_root)},
        )

        assert response["result"]["project_id"] == "review.v2"
        assert not project.exists()

    def test_reports_a_missing_project(self, handler, projects_root) -> None:
        response = _request(
            handler,
            "delete_project",
            {"project_id": "never_existed", "base_path": str(projects_root)},
        )
        assert "error" in response
