#!/usr/bin/env python3
"""Managed dual-review workflows for the Electron app."""
from __future__ import annotations

import csv
import io
import json
import re
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from typing import Dict
from typing import Optional

import colrev.loader.load_utils
import colrev.record.record
import colrev.review_manager
from colrev.constants import Fields
from colrev.constants import RecordState


APP_MANIFEST_FILENAME = Path("colrev_app.json")

SUPPORTED_KINDS = {"prescreen", "screen"}
ELIGIBLE_STATE_BY_KIND = {
    "prescreen": RecordState.md_processed,
    "screen": RecordState.pdf_prepared,
}
FINAL_STATES_BY_KIND = {
    "prescreen": {
        "rev_prescreen_included": RecordState.rev_prescreen_included,
        "rev_prescreen_excluded": RecordState.rev_prescreen_excluded,
    },
    "screen": {
        "rev_included": RecordState.rev_included,
        "rev_excluded": RecordState.rev_excluded,
    },
}
TASK_STATES_ACTIVE = {"active", "reconciling"}
REVIEWER_ROLES = ("reviewer_a", "reviewer_b")


@dataclass
class BranchDecision:
    """A reviewer decision for a record."""

    status: str
    criteria_string: str
    criteria: Dict[str, str]


class ManagedReviewService:
    """Managed dual-review workflow helper."""

    def __init__(self, *, review_manager: colrev.review_manager.ReviewManager) -> None:
        self.review_manager = review_manager

    def _manifest_path(self) -> Path:
        return self.review_manager.paths.app_manifest

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _default_manifest() -> Dict[str, Any]:
        return {
            "version": 1,
            "app_settings": {},
            "managed_tasks": [],
            "reconciliation_audit": [],
        }

    def load_manifest(self) -> Dict[str, Any]:
        """Load the managed-review manifest from disk."""

        manifest_path = self._manifest_path()
        if not manifest_path.is_file():
            return self._default_manifest()

        with open(manifest_path, encoding="utf-8") as file:
            manifest = json.load(file)

        for key, default in self._default_manifest().items():
            manifest.setdefault(key, deepcopy(default))
        return manifest

    def save_manifest(self, *, manifest: Dict[str, Any], add_to_git: bool = True) -> None:
        """Persist the managed-review manifest."""

        manifest_path = self._manifest_path()
        with open(manifest_path, "w", encoding="utf-8") as file:
            json.dump(manifest, file, indent=2, sort_keys=True)
            file.write("\n")

        if add_to_git:
            self.review_manager.dataset.git_repo.add_changes(APP_MANIFEST_FILENAME)

    @staticmethod
    def _normalize_status(status: Any) -> str:
        if hasattr(status, "name"):
            return status.name
        status_str = str(status)
        if status_str.startswith("RecordState."):
            return status_str.split(".", maxsplit=1)[1]
        return status_str

    @staticmethod
    def _sanitize_login(login: str) -> str:
        sanitized = re.sub(r"[^a-zA-Z0-9._-]+", "-", login.strip().lower())
        return sanitized.strip("-") or "reviewer"

    def _get_current_branch(self) -> str:
        git_repo = self.review_manager.dataset.git_repo.repo
        try:
            return git_repo.active_branch.name
        except TypeError:
            return str(git_repo.head.commit)[:8]

    def _require_dev_branch(self, *, action: str) -> None:
        if self._get_current_branch() != "dev":
            raise ValueError(f"{action} must be run from the dev branch.")

    def _get_branch_tracking(self) -> Dict[str, Any]:
        git_repo = self.review_manager.dataset.git_repo.repo
        branch = self._get_current_branch()
        tracking_branch = None
        ahead = 0
        behind = 0

        try:
            active_branch = git_repo.active_branch
            tracking_branch = active_branch.tracking_branch()
            if tracking_branch is not None:
                ahead = len(list(git_repo.iter_commits(f"{tracking_branch}..{branch}")))
                behind = len(list(git_repo.iter_commits(f"{branch}..{tracking_branch}")))
        except Exception:
            tracking_branch = None

        return {
            "has_remote": bool(git_repo.remotes),
            "tracking_branch": str(tracking_branch) if tracking_branch else None,
            "ahead": ahead,
            "behind": behind,
        }

    def _notify_for_kind(self, *, kind: str) -> None:
        if kind == "prescreen":
            self.review_manager.get_prescreen_operation(
                notify_state_transition_operation=False
            )
            return
        if kind == "screen":
            self.review_manager.get_screen_operation(
                notify_state_transition_operation=False
            )
            return
        raise ValueError(f"Unsupported managed review kind: {kind}")

    def _load_records_from_ref(
        self, *, ref: Optional[str], kind: str, header_only: bool = False
    ) -> Dict[str, Dict[str, Any]]:
        if ref is None:
            self._notify_for_kind(kind=kind)
            records = self.review_manager.dataset.load_records_dict(header_only=header_only)
            return records or {}

        git_repo = self.review_manager.dataset.git_repo.repo
        commit = git_repo.commit(ref)
        blob = commit.tree / self.review_manager.paths.RECORDS_FILE_GIT
        load_string = blob.data_stream.read().decode("utf-8")
        return colrev.loader.load_utils.loads(
            load_string=load_string,
            implementation="bib",
            logger=self.review_manager.logger,
        )

    def _branch_ref(self, *, branch_name: str) -> Optional[str]:
        git_repo = self.review_manager.dataset.git_repo.repo
        local_branch_names = {branch.name for branch in git_repo.heads}
        if branch_name in local_branch_names:
            return branch_name

        for remote in git_repo.remotes:
            for ref in remote.refs:
                if ref.remote_head == branch_name:
                    return ref.name
        return None

    def _find_task(self, *, manifest: Dict[str, Any], task_id: str) -> Dict[str, Any]:
        for task in manifest["managed_tasks"]:
            if task["id"] == task_id:
                return task
        raise ValueError(f"Managed review task '{task_id}' not found")

    def _eligible_ids(self, *, kind: str, records: Dict[str, Dict[str, Any]]) -> list[str]:
        eligible_state = ELIGIBLE_STATE_BY_KIND[kind]
        return sorted(
            record_id
            for record_id, record in records.items()
            if record.get(Fields.STATUS) == eligible_state
        )

    def _overlapping_task(
        self, *, manifest: Dict[str, Any], kind: str, record_ids: list[str]
    ) -> Optional[Dict[str, Any]]:
        record_id_set = set(record_ids)
        for task in manifest["managed_tasks"]:
            if task["kind"] != kind or task["state"] not in TASK_STATES_ACTIVE:
                continue
            if set(task["record_ids"]) & record_id_set:
                return task
        return None

    @staticmethod
    def _parse_criteria(criteria_string: str) -> Dict[str, str]:
        criteria: Dict[str, str] = {}
        if not criteria_string:
            return criteria
        for item in criteria_string.split(";"):
            if "=" not in item:
                continue
            key, value = item.split("=", maxsplit=1)
            criteria[key] = value
        return criteria

    @staticmethod
    def _format_criteria(criteria: Dict[str, str]) -> str:
        return ";".join(f"{key}={criteria[key]}" for key in sorted(criteria.keys()))

    def _extract_decision(self, *, kind: str, record: Dict[str, Any]) -> BranchDecision:
        status = self._normalize_status(record.get(Fields.STATUS, ""))
        if kind == "prescreen":
            return BranchDecision(status=status, criteria_string="", criteria={})

        criteria_string = self._format_criteria(
            self._parse_criteria(str(record.get(Fields.SCREENING_CRITERIA, "")))
        )
        return BranchDecision(
            status=status,
            criteria_string=criteria_string,
            criteria=self._parse_criteria(criteria_string),
        )

    def _strip_task_fields(self, *, kind: str, record: Dict[str, Any]) -> Dict[str, Any]:
        stripped = deepcopy(record)
        stripped.pop(Fields.STATUS, None)
        stripped.pop(Fields.MD_PROV, None)
        stripped.pop(Fields.D_PROV, None)
        if kind == "screen":
            stripped.pop(Fields.SCREENING_CRITERIA, None)
        return stripped

    def _task_record_summary(self, *, record: Dict[str, Any]) -> Dict[str, str]:
        return {
            "id": record.get(Fields.ID, ""),
            "title": record.get(Fields.TITLE, ""),
            "author": record.get(Fields.AUTHOR, ""),
            "year": record.get(Fields.YEAR, ""),
        }

    def get_task_readiness(self, *, kind: str) -> Dict[str, Any]:
        """Check whether a managed dual-review task can be launched."""

        if kind not in SUPPORTED_KINDS:
            raise ValueError(f"Unsupported managed review kind: {kind}")

        git_repo = self.review_manager.dataset.git_repo.repo
        manifest = self.load_manifest()
        current_records = self._load_records_from_ref(
            ref=None, kind=kind, header_only=True
        )
        eligible_ids = self._eligible_ids(kind=kind, records=current_records)
        current_branch = self._get_current_branch()
        tracking = self._get_branch_tracking()

        issues: list[str] = []
        if current_branch != "dev":
            issues.append("Managed review launch is only available from the dev branch.")
        if git_repo.is_dirty(untracked_files=True):
            issues.append("Repository must be clean before launching a managed review.")
        if git_repo.index.unmerged_blobs():
            issues.append("Resolve or abort the current merge before launching a managed review.")
        if not tracking["has_remote"]:
            issues.append("A remote repository is required before launching a managed review.")
        elif tracking["tracking_branch"] is None:
            issues.append("The current branch must track a remote branch before launch.")
        elif tracking["ahead"] or tracking["behind"]:
            issues.append("The dev branch must be fully synced with the remote before launch.")
        if not eligible_ids:
            issues.append(
                f"No records are ready for managed {kind} review."
            )
        if kind == "screen":
            blocking_states = {
                RecordState.rev_prescreen_included,
                RecordState.pdf_needs_manual_retrieval,
                RecordState.pdf_imported,
                RecordState.pdf_needs_manual_preparation,
            }
            incomplete_pdf_records = [
                record_id
                for record_id, record in current_records.items()
                if record.get(Fields.STATUS) in blocking_states
            ]
            if incomplete_pdf_records:
                issues.append(
                    "Finish PDF retrieval and preparation before launching managed screen review."
                )
        overlapping_task = self._overlapping_task(
            manifest=manifest, kind=kind, record_ids=eligible_ids
        )
        if overlapping_task is not None:
            issues.append(
                f"Task {overlapping_task['id']} already covers part of this record set."
            )

        return {
            "success": True,
            "kind": kind,
            "current_branch": current_branch,
            "eligible_state": ELIGIBLE_STATE_BY_KIND[kind].name,
            "eligible_record_ids": eligible_ids,
            "eligible_count": len(eligible_ids),
            "issues": issues,
            "ready": len(issues) == 0,
            "tracking": tracking,
        }

    def _serialize_task(self, *, task: Dict[str, Any]) -> Dict[str, Any]:
        eligible_state = task["eligible_state"]
        serialized = deepcopy(task)
        reviewer_progress = []

        for reviewer in task["reviewers"]:
            branch_ref = self._branch_ref(branch_name=reviewer["branch_name"])
            if branch_ref is None:
                reviewer_progress.append(
                    {
                        **reviewer,
                        "branch_ref": None,
                        "completed_count": 0,
                        "pending_count": len(task["record_ids"]),
                        "available": False,
                    }
                )
                continue

            records = self._load_records_from_ref(
                ref=branch_ref, kind=task["kind"], header_only=True
            )
            completed_count = 0
            for record_id in task["record_ids"]:
                if record_id not in records:
                    continue
                status = self._normalize_status(records[record_id].get(Fields.STATUS, ""))
                if status != eligible_state:
                    completed_count += 1

            reviewer_progress.append(
                {
                    **reviewer,
                    "branch_ref": branch_ref,
                    "completed_count": completed_count,
                    "pending_count": len(task["record_ids"]) - completed_count,
                    "available": True,
                }
            )

        serialized["reviewer_progress"] = reviewer_progress
        serialized["record_count"] = len(task["record_ids"])
        return serialized

    def list_tasks(self, *, kind: str) -> Dict[str, Any]:
        """List managed-review tasks for a review step."""

        manifest = self.load_manifest()
        tasks = [
            self._serialize_task(task=task)
            for task in manifest["managed_tasks"]
            if task["kind"] == kind
        ]
        tasks.sort(key=lambda task: task["created_at"], reverse=True)
        return {
            "success": True,
            "kind": kind,
            "tasks": tasks,
        }

    def get_current_branch_task(self, *, kind: str) -> Dict[str, Any]:
        """Return the current branch's active managed-review task, if any."""

        manifest = self.load_manifest()
        current_branch = self._get_current_branch()

        for task in manifest["managed_tasks"]:
            if task["kind"] != kind or task["state"] not in TASK_STATES_ACTIVE:
                continue
            if any(
                reviewer["branch_name"] == current_branch for reviewer in task["reviewers"]
            ):
                return {
                    "success": True,
                    "kind": kind,
                    "current_branch": current_branch,
                    "task": self._serialize_task(task=task),
                }

        return {
            "success": True,
            "kind": kind,
            "current_branch": current_branch,
            "task": None,
        }

    def create_task(
        self, *, kind: str, reviewer_logins: list[str], created_by: str
    ) -> Dict[str, Any]:
        """Create a new managed-review task and persist it in the manifest."""

        if kind not in SUPPORTED_KINDS:
            raise ValueError(f"Unsupported managed review kind: {kind}")

        if len(reviewer_logins) != 2:
            raise ValueError("Exactly two reviewer logins are required.")
        if len(set(reviewer_logins)) != 2:
            raise ValueError("Reviewer logins must be unique.")

        readiness = self.get_task_readiness(kind=kind)
        if not readiness["ready"]:
            raise ValueError(" ".join(readiness["issues"]))

        git_repo = self.review_manager.dataset.git_repo.repo
        manifest = self.load_manifest()
        task_id = (
            f"{kind}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
        )
        reviewers = []
        for role, login in zip(REVIEWER_ROLES, reviewer_logins):
            reviewers.append(
                {
                    "role": role,
                    "github_login": login,
                    "branch_name": f"review/{kind}/{task_id}/{self._sanitize_login(login)}",
                    "last_seen_commit": None,
                }
            )

        existing_refs = {
            head.name for head in git_repo.heads
        } | {
            ref.remote_head for remote in git_repo.remotes for ref in remote.refs
        }
        for reviewer in reviewers:
            if reviewer["branch_name"] in existing_refs:
                raise ValueError(
                    f"Branch {reviewer['branch_name']} already exists. Try launching again."
                )

        # Pre-fetch abstracts on dev before bifurcating reviewer branches.
        # Doing this here (instead of lazily during review on each reviewer
        # branch) means the launch commit captures the enriched state, so:
        # (1) reviewers see abstracts immediately without a fetch delay, and
        # (2) reviewer branches don't accumulate non-task metadata diffs that
        # would otherwise block reconciliation.
        enrichment_summary = self._enrich_eligible_records(
            kind=kind, record_ids=readiness["eligible_record_ids"]
        )

        task = {
            "id": task_id,
            "kind": kind,
            "mode": "double_screen_same_set",
            "state": "active",
            "base_branch": "dev",
            "base_commit": git_repo.head.commit.hexsha,
            "eligible_state": readiness["eligible_state"],
            "record_ids": readiness["eligible_record_ids"],
            "reviewers": reviewers,
            "created_by": created_by,
            "created_at": self._now(),
            "completed_at": None,
            "canceled_at": None,
            "reconciliation_summary": None,
        }
        manifest["managed_tasks"].append(task)
        self.save_manifest(manifest=manifest, add_to_git=True)
        self.review_manager.create_commit(
            msg=f"Managed {kind} launch: {task_id}",
        )

        return {
            "success": True,
            "task": self._serialize_task(task=task),
            "launch_ref": git_repo.head.commit.hexsha,
            "enriched_count": enrichment_summary["enriched_count"],
            "enrichment_failed_count": enrichment_summary["failed_count"],
            "enrichment_skipped_count": enrichment_summary["skipped_count"],
        }

    def _enrich_eligible_records(
        self, *, kind: str, record_ids: list[str]
    ) -> Dict[str, int]:
        """Enrich abstracts for eligible records on dev and commit the result.

        Skips no-op enrichments (already-present abstracts). When at least one
        record was enriched, creates a commit so the launch base is reproducible
        across reviewer branches. Errors do not abort the launch — failed
        records simply stay without abstracts and the launch proceeds.
        """
        if not record_ids:
            return {"enriched_count": 0, "failed_count": 0, "skipped_count": 0}

        # Lazy import: keep the service-layer module free of ui_jsonrpc deps
        # at load time. The progress channel is best-effort — if it can't be
        # emitted (e.g., outside an RPC context), enrichment still runs.
        from colrev.ui_jsonrpc._record_enrichment import enrich_records
        from colrev.ui_jsonrpc.framework import ProgressEvent
        from colrev.ui_jsonrpc.framework import ProgressEventKind
        from colrev.ui_jsonrpc.framework import emit_progress

        def on_progress(current: int, total: int, message: str) -> None:
            emit_progress(
                ProgressEvent(
                    kind=ProgressEventKind.prep_progress,
                    message=message,
                    current=current,
                    total=total,
                    source=f"managed_{kind}_launch_enrich",
                )
            )

        result = enrich_records(
            self.review_manager,
            list(record_ids),
            on_progress=on_progress,
        )

        if result["enriched_count"] > 0:
            self.review_manager.create_commit(
                msg=f"Enrich abstracts before managed {kind} launch",
            )

        return {
            "enriched_count": result["enriched_count"],
            "failed_count": result["failed_count"],
            "skipped_count": result["skipped_count"],
        }

    def cancel_task(self, *, task_id: str, canceled_by: str) -> Dict[str, Any]:
        """Cancel an existing managed-review task."""

        manifest = self.load_manifest()
        task = self._find_task(manifest=manifest, task_id=task_id)

        if task["state"] == "completed":
            raise ValueError("Completed tasks cannot be canceled.")
        if task["state"] == "aborted":
            return {"success": True, "task": self._serialize_task(task=task)}

        task["state"] = "aborted"
        task["canceled_at"] = self._now()
        task["canceled_by"] = canceled_by
        self.save_manifest(manifest=manifest, add_to_git=True)
        self.review_manager.create_commit(msg=f"Managed review canceled: {task_id}")
        return {"success": True, "task": self._serialize_task(task=task)}

    def get_task_queue(self, *, task_id: str) -> Dict[str, Any]:
        """Return the current branch's queue for a managed-review task."""

        manifest = self.load_manifest()
        task = self._find_task(manifest=manifest, task_id=task_id)
        current_records = self._load_records_from_ref(
            ref=None, kind=task["kind"], header_only=True
        )
        records = [
            {
                **self._task_record_summary(record=current_records[record_id]),
                "status": self._normalize_status(
                    current_records[record_id].get(Fields.STATUS, "")
                ),
            }
            for record_id in task["record_ids"]
            if record_id in current_records
        ]
        return {
            "success": True,
            "task_id": task_id,
            "kind": task["kind"],
            "records": records,
            "total_count": len(records),
        }

    def get_reconciliation_preview(self, *, task_id: str) -> Dict[str, Any]:
        """Compare reviewer branches and build a reconciliation preview."""

        self._require_dev_branch(action="Managed review reconciliation")
        manifest = self.load_manifest()
        task = self._find_task(manifest=manifest, task_id=task_id)
        kind = task["kind"]
        base_records = self._load_records_from_ref(
            ref=task["base_commit"], kind=kind
        )
        current_records = self._load_records_from_ref(ref=None, kind=kind)
        reviewer_records: Dict[str, Dict[str, Dict[str, Any]]] = {}

        for reviewer in task["reviewers"]:
            branch_ref = self._branch_ref(branch_name=reviewer["branch_name"])
            if branch_ref is None:
                reviewer_records[reviewer["role"]] = {}
                continue
            reviewer_records[reviewer["role"]] = self._load_records_from_ref(
                ref=branch_ref, kind=kind
            )

        items = []
        summary = {
            "auto_resolved_count": 0,
            "manual_conflict_count": 0,
            "pending_count": 0,
            "blocked_count": 0,
            "total_count": len(task["record_ids"]),
        }

        for record_id in task["record_ids"]:
            base_record = base_records.get(record_id)
            current_record = current_records.get(record_id)
            blocked_reasons: list[str] = []

            if base_record is None or current_record is None:
                blocked_reasons.append("Record is missing from the base or current dev branch.")

            if (
                base_record is not None
                and current_record is not None
                and self._strip_task_fields(kind=kind, record=current_record)
                != self._strip_task_fields(kind=kind, record=base_record)
            ):
                blocked_reasons.append(
                    "Non-task metadata changed on dev after the task was launched."
                )

            reviewer_entries = []
            for reviewer in task["reviewers"]:
                reviewer_record = reviewer_records[reviewer["role"]].get(record_id)
                if reviewer_record is None:
                    blocked_reasons.append(
                        f"Record is missing on reviewer branch {reviewer['branch_name']}."
                    )
                    reviewer_entries.append(
                        {
                            **reviewer,
                            "status": "",
                            "criteria_string": "",
                            "criteria": {},
                        }
                    )
                    continue

                if (
                    base_record is not None
                    and self._strip_task_fields(kind=kind, record=reviewer_record)
                    != self._strip_task_fields(kind=kind, record=base_record)
                ):
                    blocked_reasons.append(
                        f"Non-task metadata changed on reviewer branch {reviewer['branch_name']}."
                    )

                decision = self._extract_decision(kind=kind, record=reviewer_record)
                reviewer_entries.append(
                    {
                        **reviewer,
                        "status": decision.status,
                        "criteria_string": decision.criteria_string,
                        "criteria": decision.criteria,
                    }
                )

            item_summary = self._task_record_summary(
                record=current_record or base_record or {Fields.ID: record_id}
            )
            item = {
                **item_summary,
                "status": "pending",
                "blocked_reasons": blocked_reasons,
                "reviewers": reviewer_entries,
                "auto_resolution": None,
            }

            if blocked_reasons:
                item["status"] = "blocked"
                summary["blocked_count"] += 1
                items.append(item)
                continue

            eligible_state = task["eligible_state"]
            if any(
                reviewer_entry["status"] == eligible_state
                for reviewer_entry in reviewer_entries
            ):
                item["status"] = "pending"
                summary["pending_count"] += 1
                items.append(item)
                continue

            first_decision = reviewer_entries[0]
            second_decision = reviewer_entries[1]
            if (
                first_decision["status"] == second_decision["status"]
                and first_decision["criteria_string"] == second_decision["criteria_string"]
            ):
                item["status"] = "auto"
                item["auto_resolution"] = {
                    "selected_reviewer": first_decision["role"],
                    "status": first_decision["status"],
                    "criteria_string": first_decision["criteria_string"],
                }
                summary["auto_resolved_count"] += 1
            else:
                item["status"] = "conflict"
                summary["manual_conflict_count"] += 1

            items.append(item)

        return {
            "success": True,
            "task": self._serialize_task(task=task),
            "summary": summary,
            "items": items,
        }

    _NON_TASK_METADATA_BLOCK_PREFIX = "Non-task metadata changed"

    def _reclassify_overridable_blocks(
        self, *, preview: Dict[str, Any], task: Dict[str, Any]
    ) -> None:
        """Reclassify blocked items whose only block is non-task-metadata drift.

        Mutates ``preview`` in place. Items blocked solely by
        ``Non-task metadata changed`` reasons are re-resolved against their
        reviewer decisions (auto / conflict / pending) and tagged with
        ``_was_overridden=True`` so the audit trail can record it. Items with
        any other reason (e.g., record missing) are left blocked.
        """
        eligible_state = task["eligible_state"]
        summary = preview["summary"]
        for item in preview["items"]:
            if item["status"] != "blocked":
                continue
            if not item["blocked_reasons"] or not all(
                reason.startswith(self._NON_TASK_METADATA_BLOCK_PREFIX)
                for reason in item["blocked_reasons"]
            ):
                continue

            reviewer_entries = item["reviewers"]
            summary["blocked_count"] -= 1
            item["_was_overridden"] = True

            if any(r["status"] == eligible_state for r in reviewer_entries):
                item["status"] = "pending"
                summary["pending_count"] += 1
                continue

            first, second = reviewer_entries[0], reviewer_entries[1]
            if (
                first["status"] == second["status"]
                and first["criteria_string"] == second["criteria_string"]
            ):
                item["status"] = "auto"
                item["auto_resolution"] = {
                    "selected_reviewer": first["role"],
                    "status": first["status"],
                    "criteria_string": first["criteria_string"],
                }
                summary["auto_resolved_count"] += 1
            else:
                item["status"] = "conflict"
                summary["manual_conflict_count"] += 1

    def apply_reconciliation(
        self,
        *,
        task_id: str,
        resolutions: list[Dict[str, Any]],
        resolved_by: str,
        override_blocks: bool = False,
    ) -> Dict[str, Any]:
        """Apply a reconciliation to dev and store an audit trail."""

        self._require_dev_branch(action="Applying managed review reconciliation")
        preview = self.get_reconciliation_preview(task_id=task_id)
        task = preview["task"]
        if override_blocks:
            self._reclassify_overridable_blocks(preview=preview, task=task)
        if preview["summary"]["blocked_count"] > 0:
            raise ValueError(
                "Resolve blocked records before applying reconciliation."
            )
        if preview["summary"]["pending_count"] > 0:
            raise ValueError(
                "Both reviewers must finish all records before reconciliation."
            )

        resolution_map: Dict[str, Dict[str, Any]] = {
            resolution["record_id"]: resolution for resolution in resolutions
        }
        current_records = self._load_records_from_ref(ref=None, kind=task["kind"])
        records_to_save: Dict[str, Dict[str, Any]] = {}
        audit_rows = []

        for item in preview["items"]:
            if item["status"] == "blocked":
                raise ValueError(
                    f"Record {item['id']} is blocked and cannot be reconciled automatically."
                )
            if item["status"] == "pending":
                raise ValueError(
                    f"Record {item['id']} is still pending reviewer decisions."
                )

            resolution = resolution_map.get(item["id"], {})
            has_custom = (
                item["status"] != "auto"
                and task["kind"] == "screen"
                and resolution.get("resolved_status") is not None
                and resolution.get("resolved_criteria_string") is not None
            )

            record_dict = deepcopy(current_records[item["id"]])
            record = colrev.record.record.Record(record_dict)

            if item["status"] == "auto":
                selected_role = item["auto_resolution"]["selected_reviewer"]
                selected_reviewer = next(
                    r for r in item["reviewers"] if r["role"] == selected_role
                )
                resolved_status = selected_reviewer["status"]
                resolved_criteria_string = selected_reviewer["criteria_string"]
                resolution_type = "auto"
                if task["kind"] == "prescreen":
                    record.set_status(FINAL_STATES_BY_KIND["prescreen"][resolved_status])
                else:
                    if resolved_criteria_string:
                        record.data[Fields.SCREENING_CRITERIA] = resolved_criteria_string
                    else:
                        record.data.pop(Fields.SCREENING_CRITERIA, None)
                    record.set_status(FINAL_STATES_BY_KIND["screen"][resolved_status])
            elif has_custom:
                resolved_status = resolution["resolved_status"]
                resolved_criteria_string_raw = resolution["resolved_criteria_string"] or ""
                if resolved_status not in FINAL_STATES_BY_KIND["screen"]:
                    raise ValueError(
                        f"Invalid resolved_status for record {item['id']}: {resolved_status!r}"
                    )
                resolved_criteria_string = self._format_criteria(
                    self._parse_criteria(resolved_criteria_string_raw)
                )
                if resolved_criteria_string:
                    record.data[Fields.SCREENING_CRITERIA] = resolved_criteria_string
                else:
                    record.data.pop(Fields.SCREENING_CRITERIA, None)
                record.set_status(FINAL_STATES_BY_KIND["screen"][resolved_status])
                selected_role = None
                resolution_type = "manual_custom"
            else:
                selected_role = resolution.get("selected_reviewer")
                if selected_role not in REVIEWER_ROLES:
                    raise ValueError(
                        f"Missing reconciliation choice for record {item['id']}."
                    )
                selected_reviewer = next(
                    r for r in item["reviewers"] if r["role"] == selected_role
                )
                resolved_status = selected_reviewer["status"]
                resolved_criteria_string = selected_reviewer["criteria_string"]
                resolution_type = "manual"
                if task["kind"] == "prescreen":
                    record.set_status(FINAL_STATES_BY_KIND["prescreen"][resolved_status])
                else:
                    if resolved_criteria_string:
                        record.data[Fields.SCREENING_CRITERIA] = resolved_criteria_string
                    else:
                        record.data.pop(Fields.SCREENING_CRITERIA, None)
                    record.set_status(FINAL_STATES_BY_KIND["screen"][resolved_status])

            if item.get("_was_overridden"):
                resolution_type = f"override_{resolution_type}"

            records_to_save[item["id"]] = record.get_data()
            audit_rows.append(
                {
                    "record_id": item["id"],
                    "title": item["title"],
                    "author": item["author"],
                    "year": item["year"],
                    "resolution_type": resolution_type,
                    "selected_reviewer": selected_role,
                    "resolved_status": resolved_status,
                    "resolved_criteria_string": resolved_criteria_string,
                    "reviewers": item["reviewers"],
                }
            )

        manifest = self.load_manifest()
        manifest_task = self._find_task(manifest=manifest, task_id=task_id)
        resolved_at = self._now()
        manifest_task["state"] = "completed"
        manifest_task["completed_at"] = resolved_at
        manifest_task["reconciliation_summary"] = {
            "resolved_by": resolved_by,
            "resolved_at": resolved_at,
            "auto_resolved_count": preview["summary"]["auto_resolved_count"],
            "manual_conflict_count": preview["summary"]["manual_conflict_count"],
            "record_count": preview["summary"]["total_count"],
        }
        manifest["reconciliation_audit"].append(
            {
                "task_id": task_id,
                "kind": manifest_task["kind"],
                "base_commit": manifest_task["base_commit"],
                "resolved_by": resolved_by,
                "resolved_at": resolved_at,
                "reviewers": manifest_task["reviewers"],
                "records": audit_rows,
            }
        )

        self.review_manager.dataset.save_records_dict(records_to_save, partial=True)
        self.save_manifest(manifest=manifest, add_to_git=True)
        self.review_manager.create_commit(
            msg=f"Managed {manifest_task['kind']} reconciliation: {task_id}",
        )
        commit_sha = self.review_manager.dataset.git_repo.repo.head.commit.hexsha
        return {
            "success": True,
            "task_id": task_id,
            "commit_sha": commit_sha,
            "resolved_count": len(audit_rows),
        }

    def export_reconciliation_audit(
        self, *, task_id: str, export_format: str
    ) -> Dict[str, Any]:
        """Export a reconciliation audit as CSV or JSON."""

        if export_format not in {"csv", "json"}:
            raise ValueError("export_format must be 'csv' or 'json'")

        manifest = self.load_manifest()
        task = self._find_task(manifest=manifest, task_id=task_id)
        audit_entry = next(
            (
                entry
                for entry in reversed(manifest["reconciliation_audit"])
                if entry["task_id"] == task_id
            ),
            None,
        )
        if audit_entry is None:
            raise ValueError("No reconciliation audit exists for this task yet.")

        filename = f"{task_id}-audit.{export_format}"
        if export_format == "json":
            return {
                "success": True,
                "filename": filename,
                "content": json.dumps(audit_entry, indent=2, sort_keys=True),
            }

        output = io.StringIO()
        writer = csv.DictWriter(
            output,
            fieldnames=[
                "task_id",
                "kind",
                "record_id",
                "title",
                "author",
                "year",
                "resolution_type",
                "selected_reviewer",
                "resolved_status",
                "resolved_criteria_string",
                "reviewer_a_login",
                "reviewer_a_status",
                "reviewer_a_criteria_string",
                "reviewer_b_login",
                "reviewer_b_status",
                "reviewer_b_criteria_string",
                "resolved_by",
                "resolved_at",
            ],
        )
        writer.writeheader()
        for row in audit_entry["records"]:
            reviewers = {reviewer["role"]: reviewer for reviewer in row["reviewers"]}
            writer.writerow(
                {
                    "task_id": audit_entry["task_id"],
                    "kind": audit_entry["kind"],
                    "record_id": row["record_id"],
                    "title": row["title"],
                    "author": row["author"],
                    "year": row["year"],
                    "resolution_type": row["resolution_type"],
                    "selected_reviewer": row["selected_reviewer"],
                    "resolved_status": row["resolved_status"],
                    "resolved_criteria_string": row["resolved_criteria_string"],
                    "reviewer_a_login": reviewers["reviewer_a"]["github_login"],
                    "reviewer_a_status": reviewers["reviewer_a"]["status"],
                    "reviewer_a_criteria_string": reviewers["reviewer_a"][
                        "criteria_string"
                    ],
                    "reviewer_b_login": reviewers["reviewer_b"]["github_login"],
                    "reviewer_b_status": reviewers["reviewer_b"]["status"],
                    "reviewer_b_criteria_string": reviewers["reviewer_b"][
                        "criteria_string"
                    ],
                    "resolved_by": audit_entry["resolved_by"],
                    "resolved_at": audit_entry["resolved_at"],
                }
            )

        return {
            "success": True,
            "filename": filename,
            "content": output.getvalue(),
        }
