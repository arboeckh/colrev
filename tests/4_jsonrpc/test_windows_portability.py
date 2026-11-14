#!/usr/bin/env python
"""Project files are the same on Windows and macOS (BOE-991).

Nothing here runs on Windows. The Windows behaviours are simulated:

* ``windows_text_mode`` makes text-mode writes produce CRLF (``os.linesep`` and
  the default ``newline`` of ``open``), as on Windows.
* ``windows_paths`` makes core's ``SearchFile.to_dict`` emit ``\\`` separators,
  as ``str(WindowsPath)`` does.
"""
from __future__ import annotations

import base64
import builtins
import io
import json
import os
import subprocess
from pathlib import Path
from typing import Callable
from typing import Generator

import pytest

import colrev.constants
import colrev.ops.init
import colrev.search_file
from colrev.ui_jsonrpc.framework import portability
from colrev.ui_jsonrpc.framework_handlers import init_handler
from colrev.ui_jsonrpc.handler import JSONRPCHandler
from colrev.ui_jsonrpc.managed_review import ManagedReviewService

PROJECT_ID = "portability_project"
BIB = """@article{S1,
  title = {Alpha study},
  author = {Doe, Jane},
  year = {2021},
  journal = {Journal A},
}
"""
MINIMAL_PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


@pytest.fixture(scope="module")
def handler() -> JSONRPCHandler:
    return JSONRPCHandler()


@pytest.fixture
def root(tmp_path, mocker) -> Generator[Path, None, None]:
    mocker.patch(
        "colrev.env.environment_manager.EnvironmentManager.get_name_mail_from_git",
        return_value=("Test User", "test@example.com"),
    )
    mocker.patch.object(colrev.constants.Filepaths, "REGISTRY_FILE", tmp_path / "reg.json")
    project = tmp_path / PROJECT_ID
    project.mkdir()
    cwd = os.getcwd()
    os.chdir(project)
    try:
        colrev.ops.init.Initializer(
            review_type="literature_review", target_path=project, light=True
        )
    finally:
        os.chdir(cwd)
    yield tmp_path


@pytest.fixture
def project(root: Path) -> Path:
    return root / PROJECT_ID


@pytest.fixture
def call(handler: JSONRPCHandler, root: Path) -> Callable[..., dict]:
    def _call(method: str, **params) -> dict:
        return handler.handle_request(
            {
                "jsonrpc": "2.0",
                "method": method,
                "params": {"project_id": PROJECT_ID, "base_path": str(root), **params},
                "id": 1,
            }
        )

    return _call


def _ok(response: dict) -> dict:
    assert "error" not in response, response.get("error")
    return response["result"]


def _git(project: Path, *args: str) -> str:
    done = subprocess.run(["git", *args], cwd=project, capture_output=True, text=True)
    assert done.returncode == 0, done.stderr
    return done.stdout


def _add_db_source(call, name: str = "db1") -> str:
    filename = f"data/search/{name}.bib"
    _ok(call("upload_search_file", filename=f"{name}.bib", content=BIB))
    _ok(
        call(
            "add_source",
            endpoint="colrev.unknown_source",
            search_type="DB",
            filename=filename,
            search_string="initial query",
        )
    )
    return filename


def _history(project: Path, name: str = "db1") -> Path:
    return project / "data" / "search" / f"{name}_search_history.json"


def _sources(call) -> dict:
    return {s["search_results_path"]: s for s in _ok(call("get_sources"))["sources"]}


@pytest.fixture
def windows_text_mode(monkeypatch) -> None:
    """Text-mode writes produce CRLF, and the platform says so."""
    real_open = io.open

    def crlf_open(file, mode="r", *args, **kwargs):  # type: ignore[no-untyped-def]
        text_write = "b" not in mode and any(m in mode for m in "wax+")
        if text_write and kwargs.get("newline") is None and len(args) < 4:
            kwargs["newline"] = "\r\n"
        return real_open(file, mode, *args, **kwargs)

    monkeypatch.setattr(os, "linesep", "\r\n")
    monkeypatch.setattr(builtins, "open", crlf_open)
    monkeypatch.setattr(io, "open", crlf_open)
    monkeypatch.setattr(portability, "crlf_platform", lambda: True)


@pytest.fixture
def windows_paths(monkeypatch) -> None:
    """Core's ``SearchFile.to_dict`` puts ``\\`` separators in the path fields."""
    original = colrev.search_file.ExtendedSearchFile.to_dict

    def to_dict(self) -> dict:
        data = original(self)
        for key in portability.HISTORY_PATH_KEYS:
            if key in data:
                data[key] = str(data[key]).replace("/", "\\")
        return data

    monkeypatch.setattr(colrev.search_file.ExtendedSearchFile, "to_dict", to_dict)


def _to_backslash_form(path: Path, *, crlf: bool = False) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    for key in portability.HISTORY_PATH_KEYS:
        if key in data:
            data[key] = data[key].replace("/", "\\")
    text = json.dumps(data, indent=4)
    if crlf:
        text = text.replace("\n", "\r\n")
    path.write_bytes(text.encode("utf-8"))


# -- 1. search-source paths ----------------------------------------------------


class TestSearchHistoryPaths:
    def test_a_history_file_with_backslash_paths_opens(self, call, project) -> None:
        filename = _add_db_source(call)
        _git(project, "add", "-A")
        _git(project, "commit", "-m", "source")
        _to_backslash_form(_history(project))
        assert "\\\\" in _history(project).read_text(encoding="utf-8")

        source = _sources(call)[filename]

        assert source["record_count"] == 1
        assert source["is_stale"] is False or source["is_stale"] is True
        assert "has not been run" not in (source.get("stale_reason") or "")
        data = json.loads(_history(project).read_text(encoding="utf-8"))
        assert data["search_results_path"] == filename

    def test_a_settings_save_after_it_creates_no_second_source(
        self, call, project
    ) -> None:
        filename = _add_db_source(call)
        _to_backslash_form(_history(project))

        _ok(call("update_source", filename=filename, search_string="revised"))

        names = sorted(p.name for p in (project / "data" / "search").glob("*history*"))
        assert names == ["db1_search_history.json", "files_search_history.json"]
        assert [k for k in _sources(call) if "db1" in k] == [filename]
        # The project still answers (it used to fail with "Non-unique source filename(s)").
        _ok(call("get_status"))

    def test_a_stray_backslash_named_history_file_is_healed(
        self, call, project
    ) -> None:
        filename = _add_db_source(call)
        stray = project / "data" / "search" / "data\\search\\db1_search_history.json"
        stray.write_bytes(_history(project).read_bytes())
        _git(project, "add", "-A")
        # The hooks cannot open the project with the stray file.
        _git(project, "-c", "core.hooksPath=/dev/null", "commit", "-m", "with stray")

        _ok(call("get_status"))

        assert not stray.exists()
        assert [k for k in _sources(call) if "db1" in k] == [filename]
        assert "data/search/data\\search\\db1_search_history.json" not in _git(
            project, "ls-files"
        )

    def test_saving_on_windows_writes_posix_paths(
        self, call, project, windows_paths
    ) -> None:
        filename = _add_db_source(call)
        _ok(call("update_source", filename=filename, search_string="revised"))

        data = json.loads(_history(project).read_text(encoding="utf-8"))
        assert data["search_results_path"] == "data/search/db1.bib"
        assert "\\" not in _history(project).read_text(encoding="utf-8")

    def test_the_run_history_writer_uses_posix_paths_too(
        self, call, project, windows_paths
    ) -> None:
        # ``_save_source_history`` writes ``source.to_dict()`` on its own.
        from colrev.ui_jsonrpc.framework_handlers.search_handler import SearchHandler

        filename = _add_db_source(call)
        review_manager = _review_manager(project)
        source = next(
            s
            for s in review_manager.settings.sources
            if portability.to_posix(s.search_results_path) == filename
        )
        ctx = type("Ctx", (), {"review_manager": review_manager})()
        SearchHandler(ctx)._save_source_history(source)  # type: ignore[arg-type]

        assert "\\" not in _history(project).read_text(encoding="utf-8")


def _review_manager(project: Path):
    import colrev.review_manager

    cwd = os.getcwd()
    os.chdir(project)
    try:
        return colrev.review_manager.ReviewManager(
            path_str=str(project), verbose_mode=False, high_level_operation=True
        )
    finally:
        os.chdir(cwd)


class TestHealingUnit:
    def test_heal_rewrites_paths_and_line_endings(self, call, project) -> None:
        _add_db_source(call)
        _to_backslash_form(_history(project), crlf=True)

        portability.heal_search_history(project)

        raw = _history(project).read_bytes()
        assert b"\r\n" not in raw
        assert json.loads(raw)["search_results_path"] == "data/search/db1.bib"

    def test_heal_leaves_a_healthy_file_untouched(self, call, project) -> None:
        _add_db_source(call)
        before = _history(project).read_bytes()
        mtime = _history(project).stat().st_mtime_ns

        portability.heal_search_history(project)

        assert _history(project).read_bytes() == before
        assert _history(project).stat().st_mtime_ns == mtime


# -- 2. PDF file paths ---------------------------------------------------------


def _seed_pdf_record(project: Path, status: str, file_value: str = "") -> None:
    lines = [
        "@article{R1,",
        "   colrev_origin                 = {import.bib/R1},",
        f"   colrev_status                 = {{{status}}},",
        "   title                         = {Machine learning in healthcare},",
        "   author                        = {Smith, John},",
        "   year                          = {2023},",
        "   journal                       = {Journal A},",
    ]
    if file_value:
        lines.append(f"   file                          = {{{file_value}}},")
    lines.append("}")
    records = project / "data" / "records.bib"
    records.parent.mkdir(parents=True, exist_ok=True)
    records.write_text("\n".join(lines) + "\n", encoding="utf-8")
    _git(project, "add", "-A")
    _git(project, "commit", "-m", "seed")


class TestPdfPaths:
    def test_upload_pdf_records_a_posix_path(
        self, call, project, monkeypatch
    ) -> None:
        import colrev.ops.pdf_get_man

        _seed_pdf_record(project, "pdf_needs_manual_retrieval")
        original = colrev.ops.pdf_get_man.PDFGetMan.pdf_get_man_record

        def windows_link(self, *, record, filepath=None, PAD=40):  # type: ignore[no-untyped-def]
            original(self, record=record, filepath=filepath, PAD=PAD)
            # What ``str(WindowsPath)`` stores.
            records = self.review_manager.dataset.load_records_dict()
            records[record.data["ID"]]["file"] = "data\\pdfs\\R1.pdf"
            self.review_manager.dataset.save_records_dict(records)

        monkeypatch.setattr(
            colrev.ops.pdf_get_man.PDFGetMan, "pdf_get_man_record", windows_link
        )

        _ok(
            call(
                "upload_pdf",
                record_id="R1",
                filename="r1.pdf",
                content=base64.b64encode(MINIMAL_PDF).decode(),
            )
        )

        bib = (project / "data" / "records.bib").read_text(encoding="utf-8")
        assert "data/pdfs/R1.pdf" in bib
        assert "data\\pdfs" not in bib

    def test_a_backslash_file_field_is_found_on_disk(self, call, project) -> None:
        _seed_pdf_record(project, "pdf_needs_manual_preparation", "data\\pdfs\\R1.pdf")
        (project / "data" / "pdfs").mkdir(parents=True, exist_ok=True)
        (project / "data" / "pdfs" / "R1.pdf").write_bytes(MINIMAL_PDF)

        records = _ok(call("get_records"))["records"]
        assert next(r for r in records if r["ID"] == "R1")["file_on_disk"] is True

    def test_accept_pdf_as_is_reads_a_backslash_file_field(self, call, project) -> None:
        _seed_pdf_record(project, "pdf_needs_manual_preparation", "data\\pdfs\\R1.pdf")
        (project / "data" / "pdfs").mkdir(parents=True, exist_ok=True)
        (project / "data" / "pdfs" / "R1.pdf").write_bytes(MINIMAL_PDF)

        response = call("accept_pdf_as_is", record_id="R1")

        assert "not on this machine" not in json.dumps(response)

    def test_restore_pdf_file_accepts_a_backslash_file_field(self, call, project) -> None:
        _seed_pdf_record(project, "pdf_needs_manual_preparation", "data\\pdfs\\R1.pdf")

        response = call(
            "restore_pdf_file",
            record_id="R1",
            content=base64.b64encode(MINIMAL_PDF).decode(),
        )

        assert "outside the PDF directory" not in json.dumps(response)
        assert (project / "data" / "pdfs" / "R1.pdf").read_bytes() == MINIMAL_PDF

    def test_project_file_reads_both_forms(self, tmp_path) -> None:
        assert portability.project_file(tmp_path, "data\\pdfs\\a.pdf") == (
            tmp_path / "data" / "pdfs" / "a.pdf"
        )
        assert portability.project_file(tmp_path, "data/pdfs/a.pdf") == (
            tmp_path / "data" / "pdfs" / "a.pdf"
        )


# -- 3. line endings -----------------------------------------------------------


class TestLineEndings:
    def test_the_simulation_really_writes_crlf(self, tmp_path, windows_text_mode) -> None:
        target = tmp_path / "probe.txt"
        with open(target, "w", encoding="utf-8") as handle:
            handle.write("a\nb\n")
        assert target.read_bytes() == b"a\r\nb\r\n"

    def test_the_rpc_layers_own_writers_write_lf(
        self, call, project, windows_text_mode
    ) -> None:
        filename = _add_db_source(call)
        _ok(call("update_source", filename=filename, search_string="revised"))
        service = ManagedReviewService(review_manager=_review_manager(project))
        service.save_manifest(manifest=service.load_manifest(), add_to_git=False)

        for path in (
            project / filename,
            _history(project),
            project / "colrev_app.json",
        ):
            assert b"\r\n" not in path.read_bytes(), path

    def test_the_data_extraction_table_is_written_with_lf(
        self, tmp_path, windows_text_mode
    ) -> None:
        import csv

        import pandas as pd

        frame = pd.DataFrame({"ID": ["a"], "x": ["1"]})
        target = tmp_path / "data.csv"
        # The call the handler makes (``DataHandler._write_frame``).
        frame.to_csv(target, index=False, quoting=csv.QUOTE_ALL, lineterminator="\n")
        assert b"\r\n" not in target.read_bytes()
        # And without the explicit terminator pandas follows ``os.linesep``.
        frame.to_csv(target, index=False, quoting=csv.QUOTE_ALL)
        assert b"\r\n" in target.read_bytes()

    def test_commits_made_on_windows_hold_lf(
        self, call, project, windows_text_mode, windows_paths
    ) -> None:
        filename = _add_db_source(call)
        _ok(call("update_source", filename=filename, search_string="revised"))
        _ok(call("load"))
        _ok(call("commit_changes", message="save"))

        for tracked in (
            "data/records.bib",
            "settings.json",
            ".gitignore",
            "data/search/db1_search_history.json",
            filename,
        ):
            blob = subprocess.run(
                ["git", "show", f"HEAD:{tracked}"],
                cwd=project,
                capture_output=True,
                check=True,
            ).stdout
            assert blob, tracked
            assert b"\r\n" not in blob, tracked
        # The working tree agrees with what was committed.
        assert _git(project, "status", "--porcelain") == ""

    def test_normalize_text_file_only_touches_crlf(self, tmp_path) -> None:
        crlf = tmp_path / "a.bib"
        crlf.write_bytes(b"x\r\ny\r\n")
        lf = tmp_path / "b.bib"
        lf.write_bytes(b"x\ny\n")
        assert portability.normalize_text_file(crlf) is True
        assert portability.normalize_text_file(lf) is False
        assert crlf.read_bytes() == b"x\ny\n"

    def test_nothing_is_rewritten_off_windows(self, tmp_path, monkeypatch) -> None:
        monkeypatch.setattr(os, "linesep", "\n")
        (tmp_path / "settings.json").write_bytes(b'{"a":\r\n1}')
        assert portability.lf_sweep(tmp_path) == []
        assert (tmp_path / "settings.json").read_bytes() == b'{"a":\r\n1}'

    def test_a_new_project_pins_lf_and_keeps_pdfs_binary(
        self, handler, tmp_path, mocker
    ) -> None:
        mocker.patch(
            "colrev.env.environment_manager.EnvironmentManager.get_name_mail_from_git",
            return_value=("Test User", "test@example.com"),
        )
        mocker.patch.object(
            colrev.constants.Filepaths, "REGISTRY_FILE", tmp_path / "reg.json"
        )
        response = handler.handle_request(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "init_project",
                "params": {"project_id": "fresh", "base_path": str(tmp_path)},
            }
        )
        assert "error" not in response, response.get("error")
        fresh = tmp_path / "fresh"

        lines = (fresh / ".gitattributes").read_text(encoding="utf-8").splitlines()
        assert lines[0] == "* text=auto eol=lf"
        assert "*.pdf binary" in lines
        assert _git(fresh, "status", "--porcelain") == ""
        assert ".gitattributes" in _git(fresh, "ls-files")


# -- 4. delete_project ---------------------------------------------------------


def _open_files_under(path: Path) -> list[str]:
    fd_dir = Path("/proc/self/fd")
    held = []
    for fd in fd_dir.iterdir():
        try:
            target = os.readlink(fd)
        except OSError:
            continue
        if target.startswith(str(path)):
            held.append(target)
    return held


def _cat_file_children(project: Path) -> dict[int, str]:
    """``git cat-file`` children of this process that sit in ``project``, by pid."""
    me = os.getpid()
    found: dict[int, str] = {}
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            stat = (entry / "stat").read_text()
            if int(stat.rsplit(")", 1)[1].split()[1]) != me:
                continue
            cmdline = (entry / "cmdline").read_bytes().replace(b"\0", b" ").decode()
            cwd = os.readlink(entry / "cwd")
        except (OSError, ValueError):
            continue
        if "cat-file" in cmdline and cwd.startswith(str(project)):
            found[int(entry.name)] = cmdline
    return found


needs_proc = pytest.mark.skipif(
    not Path("/proc/self/fd").is_dir(), reason="needs /proc to inspect open files"
)


def _delete(handler: JSONRPCHandler, root: Path) -> dict:
    return handler.handle_request(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "delete_project",
            "params": {"project_id": PROJECT_ID, "base_path": str(root)},
        }
    )


def _listed(handler: JSONRPCHandler, root: Path) -> list[str]:
    response = handler.handle_request(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "list_projects",
            "params": {"base_path": str(root)},
        }
    )
    return [p["id"] for p in _ok(response)["projects"]]


class TestDeleteProject:
    @needs_proc
    def test_no_project_file_is_left_open_after_requests(self, call, project) -> None:
        _add_db_source(call)
        _ok(call("get_status"))
        _ok(call("get_git_status"))
        assert [f for f in _open_files_under(project)] == []

    @needs_proc
    def test_no_git_child_process_outlives_the_requests(self, call, project) -> None:
        # Children left by creating the project (core's Initializer) are not ours.
        before = set(_cat_file_children(project))
        _add_db_source(call)
        for method in ("get_status", "get_git_status", "get_records", "get_sources"):
            _ok(call(method))
        _ok(call("commit_changes", message="save"))
        assert set(_cat_file_children(project)) - before == set()

    def test_deletes_a_project_with_read_only_git_objects(
        self, handler, call, project, root
    ) -> None:
        _add_db_source(call)
        _ok(call("commit_changes", message="save"))
        objects = list((project / ".git" / "objects").rglob("*"))
        read_only = [p for p in objects if p.is_file()]
        assert read_only and all(not os.access(p, os.W_OK) for p in read_only[:5])

        response = _delete(handler, root)

        assert "error" not in response, response.get("error")
        assert not project.exists()
        assert _listed(handler, root) == []
        assert [p.name for p in root.iterdir() if p.name.startswith(".")] == []

    def test_a_removal_that_fails_leaves_no_listed_half_project(
        self, handler, call, project, root, monkeypatch
    ) -> None:
        _ok(call("get_status"))

        def fail(_path) -> None:
            raise PermissionError("locked")

        monkeypatch.setattr(init_handler, "remove_tree", fail)

        response = _delete(handler, root)

        assert "error" not in response, response.get("error")
        assert not project.exists()
        assert _listed(handler, root) == []
        leftovers = [p for p in root.iterdir() if p.name.startswith(init_handler.TRASH_PREFIX)]
        assert len(leftovers) == 1

        monkeypatch.undo()
        # The next listing removes what could not be removed.
        assert _listed(handler, root) == []
        assert [p for p in root.iterdir() if p.name.startswith(init_handler.TRASH_PREFIX)] == []

    def test_a_delete_that_cannot_start_leaves_the_project_untouched(
        self, handler, call, project, root, monkeypatch
    ) -> None:
        def locked(*_args, **_kwargs) -> None:
            raise PermissionError("in use")

        monkeypatch.setattr(os, "rename", locked)

        response = _delete(handler, root)

        assert "error" in response
        assert (project / "settings.json").is_file()
        assert (project / ".git" / "HEAD").is_file()
        assert _listed(handler, root) == [PROJECT_ID]
        _ok(call("get_status"))

    def test_remove_tree_clears_the_read_only_bit(self, tmp_path) -> None:
        tree = tmp_path / "t"
        (tree / "sub").mkdir(parents=True)
        locked = tree / "sub" / "obj"
        locked.write_text("x")
        locked.chmod(0o444)
        tree.joinpath("sub").chmod(0o555)
        try:
            init_handler.remove_tree(tree)
        finally:
            if tree.exists():
                tree.joinpath("sub").chmod(0o755)
        assert not tree.exists()

