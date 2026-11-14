"""Parameter validation for JSON-RPC requests."""
import re
from pathlib import Path
from typing import Any
from typing import Dict

from colrev.ui_jsonrpc.errors import NotFoundError


# What GitHub accepts in a repository name (letters, digits, ``.``, ``-``,
# ``_``), minus a leading dot: a project id is a directory name, and a cloned
# repository's id is its GitHub name.
_PROJECT_ID_PATTERN = re.compile(r"[A-Za-z0-9_-][A-Za-z0-9._-]*")


def validate_project_id(project_id: Any) -> str:
    """
    Validate a project_id, which names a directory directly under the base path.

    The id is checked, never rewritten: rewriting made ``review.v2`` resolve to
    a different directory (``reviewv2``) than the one that was listed.

    Args:
        project_id: The project identifier to validate

    Returns:
        The unchanged project_id

    Raises:
        ValueError: If project_id is empty, or contains anything other than
            letters, digits, ``.``, ``-`` and ``_``, or starts with a dot (which
            excludes ``.``, ``..`` and path separators).
    """
    if not project_id:
        raise ValueError("project_id is required")

    if not isinstance(project_id, str) or not _PROJECT_ID_PATTERN.fullmatch(project_id):
        raise ValueError(
            f"Invalid project_id {project_id!r}: use only letters, digits, "
            "'.', '-' and '_', and do not start with a dot"
        )

    return project_id


def validate_project_path(params: Dict[str, Any]) -> Path:
    """
    Validate and construct project path from params.

    Args:
        params: Request parameters containing project_id and optionally base_path

    Returns:
        Absolute path to the project directory

    Raises:
        ValueError: If project_id is missing or invalid
    """
    project_id = params.get("project_id")
    if not project_id:
        raise ValueError("project_id is required")

    # Reject anything that could leave the base path
    project_id = validate_project_id(project_id)

    # Get base path or use default
    base_path = Path(params.get("base_path", "./projects"))
    target_path = base_path / project_id

    # Resolve to absolute path
    return target_path.resolve()


def validate_existing_project(params: Dict[str, Any]) -> Path:
    """
    Validate project exists and return its path.

    Args:
        params: Request parameters containing project_id and optionally base_path

    Returns:
        Absolute path to the existing project directory

    Raises:
        NotFoundError: If project doesn't exist
    """
    target_path = validate_project_path(params)

    if not target_path.exists():
        raise NotFoundError(
            f"Project {params['project_id']} does not exist at {target_path}"
        )

    return target_path
