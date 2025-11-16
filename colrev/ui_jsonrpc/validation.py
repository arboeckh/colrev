"""Parameter validation for JSON-RPC requests."""

from pathlib import Path
from typing import Any, Dict


def sanitize_project_id(project_id: str) -> str:
    """
    Sanitize project_id to prevent path traversal attacks.

    Args:
        project_id: The project identifier to sanitize

    Returns:
        Sanitized project_id containing only alphanumeric characters, hyphens, and underscores

    Raises:
        ValueError: If project_id is empty or invalid after sanitization
    """
    if not project_id:
        raise ValueError("project_id is required")

    # Remove any characters that aren't alphanumeric, hyphen, or underscore
    sanitized = "".join(c for c in project_id if c.isalnum() or c in ("-", "_"))

    if not sanitized:
        raise ValueError("project_id must contain alphanumeric characters")

    return sanitized


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

    # Sanitize to prevent path traversal
    project_id = sanitize_project_id(project_id)

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
        ValueError: If project doesn't exist
    """
    target_path = validate_project_path(params)

    if not target_path.exists():
        raise ValueError(
            f"Project {params['project_id']} does not exist at {target_path}"
        )

    return target_path


def get_optional_param(params: Dict[str, Any], key: str, default: Any) -> Any:
    """
    Get optional parameter with default value.

    Args:
        params: Request parameters
        key: Parameter key
        default: Default value if not present

    Returns:
        Parameter value or default
    """
    return params.get(key, default)
