"""Shared helpers for managed-review gating in stage handlers.

Coupling note: ``ManagedReviewService._find_task`` and
``_get_current_branch`` are name-mangled-by-convention privates on a
core-colrev class. Promoting them to public is tracked separately as a
core-colrev change; until then the gate logic stays in this module so
the privacy break exists in exactly one place.
"""

from __future__ import annotations

from typing import Optional
from typing import Set

import colrev.review_manager
from colrev.managed_review import ManagedReviewService


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
