"""Shared helpers for managed-review gating in stage handlers.

Coupling note: ``ManagedReviewService._find_task`` and
``_get_current_branch`` are underscore-private methods on the service.
The gate logic stays in this module so the privacy break exists in
exactly one place.
"""

from __future__ import annotations

from typing import Optional
from typing import Set

import colrev.review_manager
from colrev.ui_jsonrpc.errors import InvalidStateError
from colrev.ui_jsonrpc.errors import ManagedTaskActiveError
from colrev.ui_jsonrpc.managed_review import TASK_STATES_ACTIVE
from colrev.ui_jsonrpc.managed_review import ManagedReviewService


def task_record_ids(
    *,
    review_manager: colrev.review_manager.ReviewManager,
    task_id: Optional[str],
    stage: str,
) -> Optional[Set[str]]:
    """Managed-review gate: when a task_id is given, return the constrained
    set of allowed record IDs and require the current branch is one of the
    task's reviewer branches.

    Args:
        review_manager: Active ReviewManager.
        task_id: Optional managed-review task identifier. ``None`` disables
            gating and the caller proceeds with the full record set.
        stage: Human-readable stage name used in the error message
            (e.g. ``"prescreen"``, ``"screen"``).

    Returns:
        Set of allowed record IDs, or ``None`` when no task_id was given.
    """
    if not task_id:
        return None
    service = ManagedReviewService(review_manager=review_manager)
    manifest = service.load_manifest()
    task = service._find_task(manifest=manifest, task_id=task_id)
    current_branch = service._get_current_branch()
    allowed_branches = {r["branch_name"] for r in task["reviewers"]}
    if current_branch not in allowed_branches:
        raise InvalidStateError(
            f"Managed {stage} tasks can only be reviewed from an "
            "assigned reviewer branch."
        )
    return set(task["record_ids"])


def require_task_id_for_covered_record(
    *,
    review_manager: colrev.review_manager.ReviewManager,
    task_id: Optional[str],
    stage: str,
    record_id: str,
) -> None:
    """Refuse an unmanaged decision on a record an active task covers.

    A decision made without ``task_id`` lands on the current branch as an
    ordinary decision. For a record that an active managed task covers, that
    would bypass reconciliation (on ``dev`` it would change the record behind
    the task's back). The check reads the manifest of the current branch, so
    it does not depend on the renderer's own access check, which fails open
    when listing tasks errors.

    Raises:
        ManagedTaskActiveError: ``task_id`` is missing and an active task of
            this ``stage`` covers ``record_id``.
    """
    if task_id:
        return
    service = ManagedReviewService(review_manager=review_manager)
    for task in service.load_manifest()["managed_tasks"]:
        if task["kind"] != stage or task["state"] not in TASK_STATES_ACTIVE:
            continue
        if record_id in task["record_ids"]:
            raise ManagedTaskActiveError(
                f"Record '{record_id}' is part of the active managed {stage} task "
                f"{task['id']}. Decide it on your reviewer branch with that task's "
                "id; the decisions are reconciled on dev."
            )
