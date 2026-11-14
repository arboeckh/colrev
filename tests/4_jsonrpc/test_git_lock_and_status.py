#!/usr/bin/env python
"""get_status is read-only, and a leftover .git/index.lock cannot hang the backend."""
from __future__ import annotations

import os
import time
from pathlib import Path

import git
import pytest

import colrev.constants
import colrev.ops.init
from colrev.constants import FileSets
from colrev.ui_jsonrpc.error_handler import COLREV_RESOURCE_LOCKED
from colrev.ui_jsonrpc.framework import lazy_git
from colrev.ui_jsonrpc.handler import JSONRPCHandler

RECORDS_BIB = """@article{R1,
   colrev_origin                 = {import.bib/R1},
   colrev_status                 = {md_processed},
   title                         = {Alpha},
   author                        = {Doe, Jane},
   year                          = {2021},
   journal                       = {Journal A},
}
"""


class TestGetStatusAndIndexLock:
    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        self.base_path = tmp_path
        self.project_id = "lock_project"
        self.test_dir = self.base_path / self.project_id
        self.test_dir.mkdir()
        mocker.patch(
            "colrev.env.environment_manager.EnvironmentManager.get_name_mail_from_git",
            return_value=("Test User", "test@example.com"),
        )
        mocker.patch.object(
            colrev.constants.Filepaths, "REGISTRY_FILE", self.test_dir / "reg.json"
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
        self.repo = git.Repo(self.test_dir)
        records = self.test_dir / "data" / "records.bib"
        records.parent.mkdir(parents=True, exist_ok=True)
        records.write_text(RECORDS_BIB, encoding="utf-8")
        self.repo.git.add("data/records.bib")
        self.repo.git.commit("-m", "Add records")
        self.lock = self.test_dir / ".git" / "index.lock"

    def _call(self, method: str, **params) -> dict:
        return JSONRPCHandler().handle_request(
            {
                "jsonrpc": "2.0",
                "method": method,
                "params": {
                    "project_id": self.project_id,
                    "base_path": str(self.base_path),
                    **params,
                },
                "id": 1,
            }
        )

    def _make_lock(self, age_sec: float) -> None:
        self.lock.write_text("")
        old = time.time() - age_sec
        os.utime(self.lock, (old, old))

    def test_get_status_does_not_write(self):
        gitignore = self.test_dir / ".gitignore"
        index = self.test_dir / ".git" / "index"
        before = (gitignore.stat().st_mtime_ns, index.stat().st_mtime_ns)
        time.sleep(0.05)
        response = self._call("get_status")
        assert "error" not in response, response
        after = (gitignore.stat().st_mtime_ns, index.stat().st_mtime_ns)
        assert before == after

    def test_get_status_has_changes_reflects_working_tree(self):
        assert self._call("get_status")["result"]["status"]["has_changes"] is False
        (self.test_dir / "notes.txt").write_text("x", encoding="utf-8")
        assert self._call("get_status")["result"]["status"]["has_changes"] is True

    def test_get_status_with_fresh_lock_returns_quickly(self):
        self._make_lock(age_sec=0)
        started = time.monotonic()
        response = self._call("get_status")
        assert time.monotonic() - started < 8
        assert "error" not in response or (
            response["error"]["code"] == COLREV_RESOURCE_LOCKED
        )
        assert self.lock.exists()  # a fresh lock is never removed

    def test_get_status_with_stale_lock_returns_quickly(self):
        self._make_lock(age_sec=3600)
        started = time.monotonic()
        response = self._call("get_status")
        assert time.monotonic() - started < 8
        assert "error" not in response or (
            response["error"]["code"] == COLREV_RESOURCE_LOCKED
        )

    def test_write_with_fresh_lock_is_locked_error_in_bounded_time(self, monkeypatch):
        monkeypatch.setattr(lazy_git, "INDEX_LOCK_WAIT_SEC", 0.5)
        self._make_lock(age_sec=0)
        started = time.monotonic()
        response = self._call("prescreen_record", record_id="R1", decision="include")
        assert time.monotonic() - started < 8
        assert response["error"]["code"] == COLREV_RESOURCE_LOCKED
        assert self.lock.exists()

    def test_write_with_stale_lock_removes_it(self):
        self._make_lock(age_sec=3600)
        response = self._call("prescreen_record", record_id="R1", decision="include")
        assert "error" not in response, response
        assert not self.lock.exists()

    def test_crlf_gitignore_stays_clean(self):
        gitignore = self.test_dir / ".gitignore"
        text = gitignore.read_bytes().decode("utf-8").replace("\r\n", "\n")
        gitignore.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
        self.repo.git.add(".gitignore")
        # The project's commit hooks normalise line endings; bypass them.
        self.repo.git(c="core.hooksPath=/dev/null").commit("-m", "CRLF gitignore")
        assert b"\r\n" in gitignore.read_bytes()

        assert "error" not in self._call("get_status")
        assert b"\r\n" in gitignore.read_bytes(), "get_status rewrote .gitignore"
        response = self._call("prescreen_record", record_id="R1", decision="include")
        assert "error" not in response, response
        assert ".gitignore" not in self.repo.git.status("--porcelain")
        assert b"\r\n" in gitignore.read_bytes()


class TestSyncGitignore:
    def test_creates_lf_file_when_missing(self, tmp_path):
        assert lazy_git.sync_gitignore(tmp_path, add=["a", "b"], remove=[])
        assert (tmp_path / ".gitignore").read_bytes() == b"a\nb\n"

    def test_no_write_when_nothing_to_change(self, tmp_path):
        (tmp_path / ".gitignore").write_bytes(b"a\r\nb\r\n")
        assert not lazy_git.sync_gitignore(tmp_path, add=["a"], remove=["zzz"])
        assert (tmp_path / ".gitignore").read_bytes() == b"a\r\nb\r\n"

    def test_keeps_crlf_when_adding_and_removing(self, tmp_path):
        (tmp_path / ".gitignore").write_bytes(b"a\r\nold\r\n")
        assert lazy_git.sync_gitignore(tmp_path, add=["new"], remove=["old"])
        assert (tmp_path / ".gitignore").read_bytes() == b"a\r\nnew\r\n"

    def test_default_items_are_a_list_of_str(self):
        assert all(isinstance(x, str) for x in FileSets.DEFAULT_GIT_IGNORE_ITEMS)


def test_ensure_index_unlocked_is_bounded(tmp_path):
    (tmp_path / ".git").mkdir()
    lock = tmp_path / ".git" / "index.lock"
    lock.write_text("")
    started = time.monotonic()
    with pytest.raises(lazy_git.IndexLockedError):
        lazy_git.ensure_index_unlocked(tmp_path, wait_sec=0.3)
    assert time.monotonic() - started < 2
    assert Path(lock).exists()
