#!/usr/bin/env python3
"""Merge branches of CoLRev projects."""
from __future__ import annotations

import copy
import typing

import git
from dictdiffer import diff
from git.exc import GitCommandError

import colrev.process.operation
import colrev.utils
from colrev.constants import Colors
from colrev.constants import Fields
from colrev.constants import OperationsType
from colrev.constants import RecordState
from colrev.writer.write_utils import to_string

# pylint: disable=too-few-public-methods


class Merge(colrev.process.operation.Operation):
    """Merge branches of CoLRev project"""

    type = OperationsType.check

    def __init__(
        self,
        *,
        review_manager: colrev.review_manager.ReviewManager,
    ) -> None:
        super().__init__(
            review_manager=review_manager,
            operations_type=self.type,
            notify_state_transition_operation=False,
        )

    def _get_non_status_changes(
        self,
        *,
        current_branch_records: dict,
        other_branch_records: dict,
        current_branch_name: str,
        other_branch_name: str,
    ) -> list:
        non_status_changes = []

        records_missing_in_current_branch = [
            rid for rid in other_branch_records if rid not in current_branch_records
        ]
        if records_missing_in_current_branch:
            non_status_changes.append(
                {
                    f"records missing in {current_branch_name}": records_missing_in_current_branch
                }
            )

        records_missing_in_other_branch = [
            rid for rid in current_branch_records if rid not in other_branch_records
        ]
        if records_missing_in_other_branch:
            non_status_changes.append(
                {
                    f"records missing in {other_branch_name}:": records_missing_in_other_branch
                }
            )

        changed_records = []
        for current_record_id, current_record in current_branch_records.items():
            if current_record_id not in other_branch_records:
                continue
            other_record = other_branch_records[current_record_id]

            comparison_current_record = current_record.copy()
            del comparison_current_record[Fields.STATUS]
            comparison_other_record = other_record.copy()
            del comparison_other_record[Fields.STATUS]

            if comparison_current_record != comparison_other_record:
                comparison_diff = colrev.utils.pformat(
                    list(diff(comparison_current_record, comparison_other_record))
                )
                changed_records.append(f"{current_record_id}: " f"{comparison_diff}")
        if changed_records:
            non_status_changes.append({"changed record fields:": changed_records})

        return non_status_changes

    # ------------------------------------------------------------------
    # Shared merge primitives (used by the interactive CLI path and the
    # non-interactive analyze/apply API)
    # ------------------------------------------------------------------

    def _git_repo(self) -> git.Repo:
        return self.review_manager.dataset.git_repo.repo

    def _merge_in_progress(self) -> bool:
        git_repo = self._git_repo()
        try:
            git_repo.git.rev_parse("--verify", "-q", "MERGE_HEAD")
            return True
        except GitCommandError:
            return False

    def _start_merge(self, ref: str) -> bool:
        """Start ``git merge --no-commit --no-ff <ref>``.

        Returns True when the merge stopped with conflicts, False when git
        auto-merged cleanly (merge is staged, MERGE_HEAD present, no commit).
        Raises for any non-conflict failure (dirty tree, unknown ref, ...).
        """
        git_repo = self._git_repo()
        try:
            git_repo.git.merge("--no-commit", "--no-ff", ref)
            return False
        except GitCommandError:
            if self._merge_in_progress():
                return True
            raise

    def abort_merge(self) -> None:
        """Abort an in-progress merge, restoring the pre-merge state."""
        git_repo = self._git_repo()
        if self._merge_in_progress():
            git_repo.git.merge("--abort")

    def get_unmerged_file_stages(self, path: str) -> typing.Dict[int, str]:
        """Return {stage: content} for an unmerged path.

        Stage 1 is the common ancestor, 2 the current branch, 3 the merged
        ref. Missing stages (add/add or delete/modify conflicts) are absent.
        """
        git_repo = self._git_repo()
        unmerged_blobs = git_repo.index.unmerged_blobs()
        stages: typing.Dict[int, str] = {}
        for stage, blob in unmerged_blobs.get(path, []):
            stages[stage] = blob.data_stream.read().decode("utf-8")
        return stages

    def _load_unmerged_records(
        self,
    ) -> typing.Tuple[typing.Optional[dict], typing.Optional[dict]]:
        """Load (ours, theirs) records dicts from the unmerged index stages.

        Returns (None, None) when RECORDS_FILE is not in conflict. A side
        missing its stage (deleted on one branch) is returned as None.
        """
        records_path = self.review_manager.paths.RECORDS_FILE_GIT
        stages = self.get_unmerged_file_stages(records_path)
        if not stages:
            return None, None

        def _loads(content: typing.Optional[str]) -> typing.Optional[dict]:
            if content is None:
                return None
            return colrev.loader.load_utils.loads(
                load_string=content,
                implementation="bib",
                logger=self.review_manager.logger,
            )

        return _loads(stages.get(2)), _loads(stages.get(3))

    def _reconcile_status_conflicts(
        self,
        *,
        current_branch_records: dict,
        other_branch_records: dict,
        resolver: typing.Callable[[str, dict, dict], RecordState],
    ) -> None:
        """Resolve per-record status disagreements in-place.

        ``resolver(record_id, current_record, other_record)`` returns the
        resolved colrev_status value for the record.
        """
        for (
            current_branch_record_id,
            current_branch_record_dict,
        ) in current_branch_records.items():
            other_branch_record = other_branch_records[current_branch_record_id]

            if (
                current_branch_record_dict[Fields.STATUS]
                == other_branch_record[Fields.STATUS]
            ):
                continue

            resolution = resolver(
                current_branch_record_id,
                current_branch_record_dict,
                other_branch_record,
            )
            self.review_manager.report_logger.info(
                f"Reconciliation for {current_branch_record_id}: {resolution}"
            )
            current_branch_record = colrev.record.record.Record(
                current_branch_record_dict
            )
            current_branch_record.set_status(resolution)

    def _finalize_reconciled_records(
        self,
        *,
        current_branch_records_prior: dict,
        other_branch_records: dict,
        records_reconciled: dict,
    ) -> dict:
        """Save reconciled records, refresh status.yaml, compute agreement.

        Files are written directly and staged via the git CLI: GitPython's
        ``index.add`` corrupts the index during a merge (writes a stage-0
        entry while keeping the conflict stages — gitpython#1185), leaving
        the repository uncommittable. ``dataset.save_records_dict`` must
        therefore not be used here.
        """
        bibtex_str = to_string(records_dict=records_reconciled, implementation="bib")
        with open(self.review_manager.paths.records, "w", encoding="utf-8") as out:
            out.write(bibtex_str + "\n")
        self.review_manager.update_status_yaml(
            add_to_git=False, records=records_reconciled
        )
        git_repo = self._git_repo()
        git_repo.git.add(self.review_manager.paths.RECORDS_FILE_GIT)
        git_repo.git.add(str(self.review_manager.paths.STATUS_FILE))

        validate_operation = self.review_manager.get_validate_operation()
        return validate_operation.validate_merge_prescreen_screen(
            current_branch_records=current_branch_records_prior,
            other_branch_records=other_branch_records,
            records_reconciled=records_reconciled,
        )

    @staticmethod
    def _flatten_non_status_changes(non_status_changes: list) -> typing.List[str]:
        reasons: typing.List[str] = []
        for entry in non_status_changes:
            for label, items in entry.items():
                if isinstance(items, list):
                    for item in items:
                        reasons.append(f"{label.rstrip(':')}: {item}")
                else:
                    reasons.append(f"{label.rstrip(':')}: {items}")
        return reasons

    # ------------------------------------------------------------------
    # Non-interactive API (used by the JSON-RPC layer)
    # ------------------------------------------------------------------

    def _collect_conflict_report(self, *, theirs: str) -> dict:
        """Inspect an in-progress conflicted merge and build a report dict."""
        # pylint: disable=too-many-locals
        git_repo = self._git_repo()
        records_path = self.review_manager.paths.RECORDS_FILE_GIT
        settings_path = str(self.review_manager.paths.SETTINGS_FILE)
        status_path = str(self.review_manager.paths.STATUS_FILE)
        current_branch = git_repo.active_branch.name

        blockers: typing.List[dict] = []
        status_conflicts: typing.List[dict] = []
        settings_stages: typing.Optional[typing.Dict[int, str]] = None

        unmerged_paths = list(git_repo.index.unmerged_blobs().keys())
        for path in unmerged_paths:
            if path == records_path:
                continue  # handled below
            if path == settings_path:
                settings_stages = self.get_unmerged_file_stages(path)
                continue
            if path == status_path:
                continue  # regenerated from records on apply
            blockers.append(
                {
                    "id": path,
                    "reason": f"File '{path}' was changed in both versions "
                    "and cannot be reconciled automatically",
                }
            )

        if records_path in unmerged_paths:
            ours_records, theirs_records = self._load_unmerged_records()
            if ours_records is None or theirs_records is None:
                blockers.append(
                    {
                        "id": records_path,
                        "reason": f"'{records_path}' was deleted on one side "
                        "of the merge",
                    }
                )
            else:
                non_status_changes = self._get_non_status_changes(
                    current_branch_records=ours_records,
                    other_branch_records=theirs_records,
                    current_branch_name=current_branch,
                    other_branch_name=theirs,
                )
                if non_status_changes:
                    for reason in self._flatten_non_status_changes(non_status_changes):
                        blockers.append({"id": records_path, "reason": reason})
                else:
                    for record_id, ours_record in ours_records.items():
                        theirs_record = theirs_records[record_id]
                        if ours_record[Fields.STATUS] == theirs_record[Fields.STATUS]:
                            continue
                        status_conflicts.append(
                            {
                                "id": record_id,
                                "ours": str(ours_record[Fields.STATUS]),
                                "theirs": str(theirs_record[Fields.STATUS]),
                                "title": ours_record.get(Fields.TITLE),
                                "author": ours_record.get(Fields.AUTHOR),
                                "year": ours_record.get(Fields.YEAR),
                            }
                        )

        return {
            "auto_mergeable": not blockers
            and not status_conflicts
            and settings_stages is None,
            "status_conflicts": status_conflicts,
            "blockers": blockers,
            "settings_stages": settings_stages,
        }

    def analyze(self, *, theirs: str) -> dict:
        """Analyze a merge with ``theirs`` without leaving a merge in progress.

        Returns a dict:
            auto_mergeable: bool
            status_conflicts: [{id, ours, theirs, title, author, year}]
            blockers: [{id, reason}]
            settings_stages: {1: base, 2: ours, 3: theirs} content strings
                when settings.json conflicts, else None.
        """
        if self._merge_in_progress():
            raise ValueError(
                "A merge is already in progress; abort it before analyzing."
            )
        conflicted = self._start_merge(theirs)
        try:
            if not conflicted:
                return {
                    "auto_mergeable": True,
                    "status_conflicts": [],
                    "blockers": [],
                    "settings_stages": None,
                }
            return self._collect_conflict_report(theirs=theirs)
        finally:
            self.abort_merge()

    def apply(
        self,
        *,
        theirs: str,
        decisions: typing.Optional[typing.Dict[str, str]] = None,
    ) -> dict:
        """Merge ``theirs`` non-interactively, resolving status conflicts.

        ``decisions`` maps record IDs to "ours" or "theirs". Blockers and
        missing decisions abort the merge and raise ValueError.

        On success the merge is left IN PROGRESS (MERGE_HEAD present) with
        records.bib and status.yaml resolved and staged. Committing (and
        resolving any settings.json conflict beforehand) is the caller's
        responsibility, so the resulting commit has both merge parents.

        Returns a dict:
            reconciled: bool — whether record statuses needed reconciliation
            statistics: inter-rater agreement stats (None if not reconciled)
            settings_stages: {stage: content} when settings.json conflicts,
                else None. The caller must resolve it before committing.
        """
        decisions = decisions or {}
        if self._merge_in_progress():
            raise ValueError("A merge is already in progress; abort it before merging.")

        conflicted = self._start_merge(theirs)
        try:
            if not conflicted:
                self.review_manager.update_status_yaml(add_to_git=False)
                self._git_repo().git.add(str(self.review_manager.paths.STATUS_FILE))
                return {
                    "reconciled": False,
                    "statistics": None,
                    "settings_stages": None,
                }

            report = self._collect_conflict_report(theirs=theirs)
            if report["blockers"]:
                reasons = "; ".join(b["reason"] for b in report["blockers"])
                raise ValueError(f"Merge blocked: {reasons}")

            statistics = None
            reconciled = False
            records_path = self.review_manager.paths.RECORDS_FILE_GIT
            if records_path in self._git_repo().index.unmerged_blobs():
                ours_records, theirs_records = self._load_unmerged_records()
                assert ours_records is not None and theirs_records is not None

                missing = [
                    c["id"]
                    for c in report["status_conflicts"]
                    if decisions.get(c["id"]) not in ("ours", "theirs")
                ]
                if missing:
                    raise ValueError(
                        "Missing merge resolution for record(s): " + ", ".join(missing)
                    )

                current_branch_records_prior = copy.deepcopy(ours_records)

                def _decision_resolver(
                    record_id: str, ours_record: dict, theirs_record: dict
                ) -> RecordState:
                    if decisions[record_id] == "ours":
                        return ours_record[Fields.STATUS]
                    return theirs_record[Fields.STATUS]

                self._reconcile_status_conflicts(
                    current_branch_records=ours_records,
                    other_branch_records=theirs_records,
                    resolver=_decision_resolver,
                )
                validation_details = self._finalize_reconciled_records(
                    current_branch_records_prior=current_branch_records_prior,
                    other_branch_records=theirs_records,
                    records_reconciled=ours_records,
                )
                statistics = validation_details["statistics"]
                reconciled = True
            else:
                self.review_manager.update_status_yaml(add_to_git=False)
                self._git_repo().git.add(str(self.review_manager.paths.STATUS_FILE))

            return {
                "reconciled": reconciled,
                "statistics": statistics,
                "settings_stages": report["settings_stages"],
            }
        except Exception:
            self.abort_merge()
            raise

    # ------------------------------------------------------------------
    # Interactive CLI entrypoint
    # ------------------------------------------------------------------

    @colrev.process.operation.Operation.decorate()
    def main(self, *, branch: str) -> None:
        """Merge branches of a CoLRev project (main entrypoint)"""

        # pylint: disable=too-many-locals
        # pylint: disable=too-many-statements

        git_repo = self.review_manager.dataset.git_repo.repo
        # our_index  = git_repo.index

        for remote in git_repo.remotes:
            remote.fetch()

        branches = git_repo.heads
        assert branch in [b.name for b in branches]

        git_branch = [b for b in branches if b.name == branch][0]
        merging_branch_author = git_branch.commit.author
        current_branch = git_repo.active_branch.name

        try:
            git_repo.git.merge(branch)
            self.review_manager.logger.info("Merged without conflicts.")
            return
        except GitCommandError:
            self.review_manager.logger.info("Detected changes in both branches.")

        current_branch_records, other_branch_records = self._load_unmerged_records()

        if current_branch_records is None or other_branch_records is None:
            self.review_manager.logger.info(
                f"No conflicts to reconcile in {self.review_manager.paths.records}."
            )
            return

        # There may be removed records / renamed IDs, changed fields...
        # if so: print, ask to resolve and exit
        non_status_changes = self._get_non_status_changes(
            current_branch_records=current_branch_records,
            other_branch_records=other_branch_records,
            current_branch_name=current_branch,
            other_branch_name=branch,
        )
        if non_status_changes:
            print(
                "Resolve non-status changes before merging "
                "(abort merge using git merge --abort):"
            )
            print(non_status_changes)
            return

        self.review_manager.logger.info("Reconciling changes in colrev_status.")
        # Note : reconciliation of other changes not supported yet

        (
            current_branch_author,
            _,
        ) = self.review_manager.environment_manager.get_name_mail_from_git()

        self.review_manager.logger.info(
            "Start merge reconciliation: "
            f"branch {current_branch} ({current_branch_author}) <-> "
            f"branch {branch} ({merging_branch_author})"
        )

        # Copy: for statistics
        current_branch_records_prior = copy.deepcopy(current_branch_records)

        print()
        nr_to_reconcile = len(
            [
                r
                for r in current_branch_records.values()
                if other_branch_records[r[Fields.ID]][Fields.STATUS] != r[Fields.STATUS]
            ]
        )
        counter = {"i": 0}

        def _interactive_resolver(
            record_id: str,  # pylint: disable=unused-argument
            current_branch_record_dict: dict,
            other_branch_record: dict,
        ) -> RecordState:
            counter["i"] += 1
            print(f"{counter['i']}/{nr_to_reconcile}")
            copied_rec = current_branch_record_dict.copy()
            copied_rec.pop(Fields.STATUS)
            print(colrev.record.record.Record(copied_rec).format_bib_style())
            print(
                f"1 - {current_branch_author} coded on {current_branch}".ljust(40, " ")
                + f": {current_branch_record_dict['colrev_status']}"
            )
            print(
                f"2 - {merging_branch_author} coded on {branch}".ljust(40, " ")
                + f": {other_branch_record['colrev_status']}"
            )
            resolution_nr = input("Enter resolution: (1 or 2)")
            if resolution_nr == "1":
                resolution = current_branch_record_dict[Fields.STATUS]
            else:
                resolution = other_branch_record[Fields.STATUS]
            print("\n\n\n")
            return resolution

        self._reconcile_status_conflicts(
            current_branch_records=current_branch_records,
            other_branch_records=other_branch_records,
            resolver=_interactive_resolver,
        )

        validation_details = self._finalize_reconciled_records(
            current_branch_records_prior=current_branch_records_prior,
            other_branch_records=other_branch_records,
            records_reconciled=current_branch_records,
        )
        print("Statistics:")
        colrev.utils.p_print(validation_details["statistics"])

        print(
            f"\n{Colors.ORANGE}Please add (git add .) and commit (git commit){Colors.END}"
        )

        # Note : cannot add/create commit yet - not yet supported by gitpython:
        # https://github.com/gitpython-developers/GitPython/issues/1185
        # our_index.write(ignore_extension_data=True)
