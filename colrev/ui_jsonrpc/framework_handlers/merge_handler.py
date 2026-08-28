"""Framework-native merge handler.

Engine-owned divergence merge for collaborator sync. The Electron app calls
``analyze_merge`` after a pull reports divergence, shows the returned
status/settings conflicts in a resolution dialog, then calls ``apply_merge``
with the user's decisions. All BibTeX parsing/writing happens in core
(``colrev.ops.merge``) — no bib content is ever parsed outside the engine.

``settings.json`` is reconciled here at field level with real JSON parsing:
core's merge ignores settings conflicts, so this module owns the minimal
3-way field merge (dicts recursed, lists and scalars atomic).
"""

from __future__ import annotations

import copy
import json
import logging
from typing import Any
from typing import Dict
from typing import List
from typing import Literal
from typing import Optional
from typing import Tuple

import git
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

import colrev.ops.merge
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)

MERGE_COMMIT_MESSAGE = "Sync: merge remote changes"
# ``colrev validate --merge`` only reports agreement stats for merge commits
# whose message mentions prescreen/screen — keep the marker in reconciling
# merges so inter-rater agreement stays discoverable.
RECONCILE_COMMIT_MESSAGE = "Sync: merge remote changes (reconcile prescreen/screen)"

# ---------------------------------------------------------------------------
# settings.json 3-way field merge
# ---------------------------------------------------------------------------

_MISSING = object()
_PATH_SEP = "."


def _flatten_settings(
    obj: Any, prefix: Tuple[str, ...] = ()
) -> Dict[Tuple[str, ...], Any]:
    """Flatten nested dicts to {path_tuple: value}. Lists are atomic values."""
    if isinstance(obj, dict) and obj:
        out: Dict[Tuple[str, ...], Any] = {}
        for key, value in obj.items():
            out.update(_flatten_settings(value, prefix + (str(key),)))
        return out
    return {prefix: obj} if prefix else {}


def _set_settings_path(obj: dict, path: Tuple[str, ...], value: Any) -> None:
    """Set (or delete, when value is _MISSING) a value at a nested dict path."""
    current = obj
    for segment in path[:-1]:
        if not isinstance(current.get(segment), dict):
            current[segment] = {}
        current = current[segment]
    if value is _MISSING:
        current.pop(path[-1], None)
    else:
        current[path[-1]] = value


def merge_settings(
    base: dict,
    ours: dict,
    theirs: dict,
    decisions: Optional[Dict[str, str]] = None,
) -> Tuple[dict, List[dict]]:
    """3-way field-level merge of settings.json contents.

    Returns (merged, conflicts). ``merged`` starts from ours and applies
    theirs-only changes plus any ``decisions`` ({dotted_path: "ours"|"theirs"}).
    ``conflicts`` lists both-changed-differently paths that have no decision:
    [{path, ours, theirs}] with values as parsed JSON (None when the side
    deleted the field).
    """
    # pylint: disable=too-many-locals
    decisions = decisions or {}
    base_flat = _flatten_settings(base)
    ours_flat = _flatten_settings(ours)
    theirs_flat = _flatten_settings(theirs)

    merged = copy.deepcopy(ours)
    conflicts: List[dict] = []

    all_paths = sorted(set(base_flat) | set(ours_flat) | set(theirs_flat))
    for path in all_paths:
        base_val = base_flat.get(path, _MISSING)
        ours_val = ours_flat.get(path, _MISSING)
        theirs_val = theirs_flat.get(path, _MISSING)

        ours_changed = not _values_equal(ours_val, base_val)
        theirs_changed = not _values_equal(theirs_val, base_val)

        if not theirs_changed:
            continue  # ours (possibly changed) already in merged
        if not ours_changed:
            _set_settings_path(merged, path, theirs_val)
            continue
        if _values_equal(ours_val, theirs_val):
            continue  # both changed to the same value

        dotted = _PATH_SEP.join(path)
        decision = decisions.get(dotted)
        if decision == "theirs":
            _set_settings_path(merged, path, theirs_val)
        elif decision == "ours":
            continue
        else:
            conflicts.append(
                {
                    "path": dotted,
                    "ours": None if ours_val is _MISSING else ours_val,
                    "theirs": None if theirs_val is _MISSING else theirs_val,
                }
            )

    return merged, conflicts


def _values_equal(a: Any, b: Any) -> bool:
    if a is _MISSING or b is _MISSING:
        return a is b
    return a == b


def _parse_settings_stages(
    settings_stages: Dict[int, str],
) -> Tuple[Optional[Tuple[dict, dict, dict]], Optional[str]]:
    """Parse the (base, ours, theirs) settings stages.

    Returns ((base, ours, theirs), None) on success or (None, reason) when
    the conflict cannot be reconciled at field level.
    """
    if 2 not in settings_stages or 3 not in settings_stages:
        return None, "settings.json was deleted on one side of the merge"
    try:
        base = json.loads(settings_stages[1]) if 1 in settings_stages else {}
        ours = json.loads(settings_stages[2])
        theirs = json.loads(settings_stages[3])
    except json.JSONDecodeError as exc:
        return None, f"settings.json could not be parsed: {exc}"
    if not all(isinstance(x, dict) for x in (base, ours, theirs)):
        return None, "settings.json is not a JSON object"
    return (base, ours, theirs), None


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class AnalyzeMergeRequest(ProjectScopedRequest):
    """Request for analyze_merge."""

    theirs: str = Field(
        ...,
        min_length=1,
        description="Ref to merge (the branch's upstream tracking ref)",
    )
    ours: Optional[str] = Field(
        default=None,
        description="Expected current branch; mismatch is an error.",
    )


class StatusConflictItem(BaseModel):
    """A per-record colrev_status disagreement between the merge sides."""

    model_config = ConfigDict(extra="forbid")

    id: str
    ours: str
    theirs: str
    title: Optional[str] = None
    author: Optional[str] = None
    year: Optional[str] = None


class MergeBlockerItem(BaseModel):
    """A reason the merge cannot proceed through the app."""

    model_config = ConfigDict(extra="forbid")

    id: Optional[str] = None
    reason: str


class SettingsConflictItem(BaseModel):
    """A settings.json field changed differently on both sides."""

    model_config = ConfigDict(extra="forbid")

    path: str
    ours: Any = None
    theirs: Any = None


class AnalyzeMergeResponse(ProjectResponse):
    """Structured divergence report for the conflict-resolution dialog."""

    auto_mergeable: bool
    status_conflicts: List[StatusConflictItem] = Field(default_factory=list)
    settings_conflicts: List[SettingsConflictItem] = Field(default_factory=list)
    blockers: List[MergeBlockerItem] = Field(default_factory=list)
    settings_conflict: bool = False


class ApplyMergeRequest(ProjectScopedRequest):
    """Request for apply_merge with the user's per-conflict decisions."""

    theirs: str = Field(..., min_length=1)
    resolutions: Dict[str, Literal["ours", "theirs"]] = Field(default_factory=dict)
    settings_resolutions: Dict[str, Literal["ours", "theirs"]] = Field(
        default_factory=dict
    )


class ApplyMergeResponse(ProjectResponse):
    """Result of a completed merge commit."""

    merged: bool
    commit_sha: str
    statistics: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


class MergeHandler(BaseHandler):
    """Divergence analysis and non-interactive merge for collaborator sync."""

    def _merge_operation(self) -> colrev.ops.merge.Merge:
        assert self.review_manager is not None
        return colrev.ops.merge.Merge(review_manager=self.review_manager)

    def _check_ours(self, ours: Optional[str]) -> None:
        if ours is None:
            return
        assert self.review_manager is not None
        repo = git.Repo(str(self.review_manager.path))
        active = repo.active_branch.name
        if active != ours:
            raise ValueError(
                f"Expected to be on branch {ours!r} but the project is on "
                f"{active!r}. Refresh and retry."
            )

    @rpc_method(
        name="analyze_merge",
        request=AnalyzeMergeRequest,
        response=AnalyzeMergeResponse,
    )
    def analyze_merge(self, req: AnalyzeMergeRequest) -> AnalyzeMergeResponse:
        """Analyze a divergence merge without changing repository state."""
        assert self.review_manager is not None
        logger.info(
            "analyze_merge for project %s (theirs=%s)", req.project_id, req.theirs
        )
        self._check_ours(req.ours)

        merge_op = self._merge_operation()
        report = merge_op.analyze(theirs=req.theirs)

        blockers = list(report["blockers"])
        settings_conflicts: List[dict] = []
        settings_conflict = report["settings_stages"] is not None
        if settings_conflict:
            parsed, reason = _parse_settings_stages(report["settings_stages"])
            if parsed is None:
                blockers.append({"id": "settings.json", "reason": reason})
            else:
                _, settings_conflicts = merge_settings(*parsed)

        auto_mergeable = (
            not blockers and not report["status_conflicts"] and not settings_conflicts
        )

        return AnalyzeMergeResponse(
            project_id=req.project_id,
            auto_mergeable=auto_mergeable,
            status_conflicts=[
                StatusConflictItem(**c) for c in report["status_conflicts"]
            ],
            settings_conflicts=[SettingsConflictItem(**c) for c in settings_conflicts],
            blockers=[MergeBlockerItem(**b) for b in blockers],
            settings_conflict=settings_conflict,
        )

    @rpc_method(
        name="apply_merge",
        request=ApplyMergeRequest,
        response=ApplyMergeResponse,
        writes=True,
    )
    def apply_merge(self, req: ApplyMergeRequest) -> ApplyMergeResponse:
        """Merge, reconcile, and commit with both merge parents."""
        assert self.review_manager is not None
        logger.info(
            "apply_merge for project %s (theirs=%s, %d record resolutions, "
            "%d settings resolutions)",
            req.project_id,
            req.theirs,
            len(req.resolutions),
            len(req.settings_resolutions),
        )

        merge_op = self._merge_operation()
        result = merge_op.apply(theirs=req.theirs, decisions=dict(req.resolutions))

        # From here the merge is in progress; any failure must roll it back.
        try:
            if result["settings_stages"] is not None:
                self._resolve_settings(
                    result["settings_stages"], dict(req.settings_resolutions)
                )

            message = (
                RECONCILE_COMMIT_MESSAGE
                if result["reconciled"]
                else MERGE_COMMIT_MESSAGE
            )
            repo = git.Repo(str(self.review_manager.path))
            repo.git.add("-A")
            repo.git.commit("-m", message, "--no-verify")
            commit_sha = repo.head.commit.hexsha
        except Exception:
            merge_op.abort_merge()
            raise

        return ApplyMergeResponse(
            project_id=req.project_id,
            merged=True,
            commit_sha=commit_sha,
            statistics=result["statistics"],
        )

    def _resolve_settings(
        self,
        settings_stages: Dict[int, str],
        decisions: Dict[str, str],
    ) -> None:
        assert self.review_manager is not None
        parsed, reason = _parse_settings_stages(settings_stages)
        if parsed is None:
            raise ValueError(f"Merge blocked: {reason}")
        merged, conflicts = merge_settings(*parsed, decisions=decisions)
        if conflicts:
            missing = ", ".join(c["path"] for c in conflicts)
            raise ValueError(f"Missing merge resolution for setting(s): {missing}")

        settings_path = self.review_manager.paths.settings
        with open(settings_path, "w", encoding="utf-8") as file:
            json.dump(merged, file, indent=4)
            file.write("\n")
