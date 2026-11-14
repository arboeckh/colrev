"""Shared helpers for managed-review gating in stage handlers.

Coupling note: ``ManagedReviewService._find_task`` and
``_get_current_branch`` are underscore-private methods on the service.
The gate logic stays in this module so the privacy break exists in
exactly one place.
"""

from __future__ import annotations

from typing import Iterable
from typing import Optional
from typing import Set

import colrev.review_manager
from colrev.constants import Fields
from colrev.ui_jsonrpc.errors import ManagedTaskActiveError
from colrev.ui_jsonrpc.managed_review import ELIGIBLE_STATE_BY_KIND
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
        raise ValueError(
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
    _raise_if_covered(
        review_manager=review_manager, stage=stage, record_ids=[record_id]
    )


def require_no_covered_record_to_decide(
    *,
    review_manager: colrev.review_manager.ReviewManager,
    stage: str,
) -> None:
    """Refuse a bulk decision call that would decide a covered record.

    For the calls that decide every record still awaiting a decision of
    ``stage`` (the batch ``prescreen`` / ``screen`` and ``include_all_screen``)
    and take no ``task_id``. The records they would change are the ones in the
    stage's source state; the call is refused when an active task of this
    ``stage`` covers any of them.

    Raises:
        ManagedTaskActiveError: an active task of this ``stage`` covers a record
            the call would decide.
    """
    to_decide = {
        record_id
        for record_id, record in (
            review_manager.dataset.load_records_dict() or {}
        ).items()
        if record.get(Fields.STATUS) == ELIGIBLE_STATE_BY_KIND[stage]
    }
    _raise_if_covered(review_manager=review_manager, stage=stage, record_ids=to_decide)


def _raise_if_covered(
    *,
    review_manager: colrev.review_manager.ReviewManager,
    stage: str,
    record_ids: Iterable[str],
) -> None:
    record_id_set = set(record_ids)
    if not record_id_set:
        return
    service = ManagedReviewService(review_manager=review_manager)
    for task in service.load_manifest()["managed_tasks"]:
        if task["kind"] != stage or task["state"] not in TASK_STATES_ACTIVE:
            continue
        covered = sorted(record_id_set & set(task["record_ids"]))
        if covered:
            raise ManagedTaskActiveError(
                f"Record '{covered[0]}' is part of the active managed {stage} task "
                f"{task['id']}. Decide it on your reviewer branch with that task's "
                "id; the decisions are reconciled on dev."
            )
