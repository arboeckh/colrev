"""Format operation results for JSON-RPC responses."""

from pathlib import Path
from typing import Any, Dict


def format_path(path: Path) -> str:
    """
    Convert Path object to string.

    Args:
        path: Path object to format

    Returns:
        String representation of the path
    """
    return str(path.resolve())


def format_success_response(
    result: Any,
    message: str = "Operation completed successfully",
) -> Dict[str, Any]:
    """
    Create a simple success response.

    Args:
        result: Result data to include
        message: Success message

    Returns:
        Formatted success response dictionary
    """
    response = {
        "success": True,
        "message": message,
    }

    # Add result data if provided
    if result is not None:
        if isinstance(result, dict):
            response.update(result)
        else:
            response["data"] = result

    return response


def format_init_response(
    project_id: str,
    project_path: Path,
    review_type: str,
) -> Dict[str, Any]:
    """
    Format response for init_project operation.

    Args:
        project_id: Project identifier
        project_path: Path to the project directory
        review_type: Type of review initialized

    Returns:
        Formatted response dictionary
    """
    return {
        "success": True,
        "project_id": project_id,
        "path": format_path(project_path),
        "review_type": review_type,
        "message": f"Project initialized successfully at {project_path}",
    }


def format_status_response(
    project_id: str,
    project_path: Path,
    status_stats: Any,
) -> Dict[str, Any]:
    """
    Format response for get_status operation.

    Args:
        project_id: Project identifier
        project_path: Path to the project directory
        status_stats: Status statistics from ReviewManager

    Returns:
        Formatted response dictionary
    """
    # Convert status stats to dictionary
    status_dict = {
        "completeness_condition": status_stats.completeness_condition,
        "currently_completed": status_stats.completed_atomic_steps,
    }

    return {
        "success": True,
        "project_id": project_id,
        "path": format_path(project_path),
        "status": status_dict,
    }


def format_operation_response(
    operation_name: str,
    project_id: str,
    details: Dict[str, Any] = None,
) -> Dict[str, Any]:
    """
    Format response for generic operation.

    Args:
        operation_name: Name of the operation executed
        project_id: Project identifier
        details: Optional operation-specific details

    Returns:
        Formatted response dictionary
    """
    response = {
        "success": True,
        "operation": operation_name,
        "project_id": project_id,
        "message": f"{operation_name.capitalize()} operation completed successfully",
    }

    if details:
        response["details"] = details

    return response
