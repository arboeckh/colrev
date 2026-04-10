"""Handler for managed dual-review workflows."""
from __future__ import annotations

from typing import Any
from typing import Dict

import colrev.review_manager
from colrev.managed_review import ManagedReviewService


class ManagedReviewHandler:
    """Handle managed-review JSON-RPC methods."""

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        self.review_manager = review_manager
        self.service = ManagedReviewService(review_manager=review_manager)

    def get_managed_review_task_readiness(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return self.service.get_task_readiness(kind=params["kind"])

    def list_managed_review_tasks(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return self.service.list_tasks(kind=params["kind"])

    def get_current_managed_review_task(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return self.service.get_current_branch_task(kind=params["kind"])

    def create_managed_review_task(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return self.service.create_task(
            kind=params["kind"],
            reviewer_logins=params["reviewer_logins"],
            created_by=params.get("created_by", "unknown"),
        )

    def cancel_managed_review_task(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return self.service.cancel_task(
            task_id=params["task_id"],
            canceled_by=params.get("canceled_by", "unknown"),
        )

    def get_managed_review_task_queue(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return self.service.get_task_queue(task_id=params["task_id"])

    def get_reconciliation_preview(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return self.service.get_reconciliation_preview(task_id=params["task_id"])

    def apply_reconciliation(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return self.service.apply_reconciliation(
            task_id=params["task_id"],
            resolutions=params.get("resolutions", []),
            resolved_by=params.get("resolved_by", "unknown"),
        )

    def export_reconciliation_audit(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return self.service.export_reconciliation_audit(
            task_id=params["task_id"],
            export_format=params["format"],
        )
