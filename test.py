#!/usr/bin/env python
"""
Test script for initializing a CoLRev project programmatically.
This demonstrates how to use CoLRev as a library instead of via CLI.
"""

from pathlib import Path
import colrev.ops.init
import colrev.review_manager


def init_colrev_project(
    target_path: str,
    review_type: str = "colrev.literature_review",
    example: bool = False,
    force_mode: bool = False,
    light: bool = False,
) -> colrev.review_manager.ReviewManager:
    """
    Initialize a CoLRev project programmatically.

    Args:
        target_path: Directory path where the project should be initialized
        review_type: Type of review to create (e.g., 'colrev.literature_review',
                     'colrev.blank', 'colrev.scoping_review', etc.)
        example: Whether to include example records (default: False)
        force_mode: Whether to force initialization even if directory is not empty (default: False)
        light: Whether to use light mode without Docker (default: False)

    Returns:
        ReviewManager instance for the initialized project
    """
    target_path_obj = Path(target_path).resolve()

    # Ensure the target directory exists
    target_path_obj.mkdir(parents=True, exist_ok=True)

    # Initialize the CoLRev project
    colrev.ops.init.Initializer(
        review_type=review_type,
        target_path=target_path_obj,
        example=example,
        force_mode=force_mode,
        light=light,
        exact_call="",  # Can be used to track how the project was created
    )

    print(f"CoLRev project initialized successfully at: {target_path_obj}")
    print(f"Review type: {review_type}")

    # Return a ReviewManager instance for the initialized project
    return colrev.review_manager.ReviewManager(path_str=str(target_path_obj))


if __name__ == "__main__":
    # Initialize a literature review project in a test directory
    # Using current directory + 'test_project' as a more practical default
    test_project_path = Path.cwd() / "test_project"

    review_manager = init_colrev_project(
        target_path=str(test_project_path),
        review_type="colrev.literature_review",
        example=False,
        force_mode=True,  # Set to True to allow initialization in non-empty directory
        light=False,  # Set to True if Docker is not available
    )
