"""Handler for review definition operations.

JSON-RPC Endpoints:
    - get_review_definition: Get review definition including type, title, protocol, keywords, objectives, and criteria
    - update_review_definition: Update review definition fields (protocol_url, keywords, objectives)
    - get_screening_criteria: Get all configured screening criteria
    - add_screening_criterion: Add a new screening criterion
    - update_screening_criterion: Update an existing screening criterion
    - remove_screening_criterion: Remove a screening criterion

See docs/source/api/jsonrpc/review_definition.rst for full endpoint documentation.
"""

import logging
from typing import Any, Dict

import colrev.review_manager
import colrev.settings
from colrev.constants import ScreenCriterionType
from colrev.settings import ScreenCriterion
from colrev.ui_jsonrpc import response_formatter, validation

logger = logging.getLogger(__name__)


class ReviewDefinitionHandler:
    """Handle review definition-related JSON-RPC methods.

    This handler provides endpoints for managing the review definition,
    including project metadata, objectives, and screening criteria.

    Attributes:
        review_manager: ReviewManager instance for the current project
    """

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """Initialize review definition handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def get_review_definition(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get review definition including type, title, protocol, keywords, objectives, and criteria.

        Returns the review definition fields from project settings and screen settings.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - project_id (str): Project identifier
                - review_type (str): Type of review (e.g. "literature_review")
                - title (str): Project title
                - protocol_url (str): Protocol URL (empty string if not set)
                - keywords (list): List of keyword strings
                - objectives (str): Review objectives/explanation (empty string if not set)
                - criteria (dict): Screening criteria keyed by name, each with:
                    - explanation (str): Criterion explanation
                    - comment (str or null): Optional comment
                    - criterion_type (str): "inclusion_criterion" or "exclusion_criterion"
        """
        project_id = params["project_id"]
        logger.info(f"Getting review definition for project {project_id}")

        settings = self.review_manager.settings

        # Get protocol URL safely
        protocol_url = ""
        if settings.project.protocol is not None:
            protocol_url = settings.project.protocol.url

        # Serialize criteria
        criteria_dict = self._serialize_criteria(settings.screen.criteria)

        return {
            "success": True,
            "project_id": project_id,
            "review_type": settings.project.review_type,
            "title": settings.project.title,
            "protocol_url": protocol_url,
            "keywords": settings.project.keywords,
            "objectives": settings.screen.explanation or "",
            "criteria": criteria_dict,
        }

    def update_review_definition(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Update review definition fields.

        Updates protocol URL, keywords, and objectives. Only provided fields
        are updated; omitted fields remain unchanged.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - protocol_url (str, optional): Protocol URL to set
                - keywords (list, optional): List of keyword strings
                - objectives (str, optional): Review objectives/explanation
                - skip_commit (bool, optional): Skip git commit (default: False)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - operation (str): "update_review_definition"
                - project_id (str): Project identifier
                - details (dict): Operation results with:
                    - message (str): Success message
                    - updated_fields (list): List of updated field names

        Raises:
            ValueError: If keywords is provided but not a list
        """
        project_id = params["project_id"]
        skip_commit = validation.get_optional_param(params, "skip_commit", False)

        logger.info(f"Updating review definition for project {project_id}")

        settings = self.review_manager.settings
        updated_fields = []

        # Update protocol URL
        if "protocol_url" in params:
            protocol_url = params["protocol_url"]
            if settings.project.protocol is not None:
                settings.project.protocol.url = protocol_url
            else:
                settings.project.protocol = colrev.settings.Protocol(
                    url=protocol_url
                )
            updated_fields.append("protocol_url")

        # Update keywords
        if "keywords" in params:
            keywords = params["keywords"]
            if not isinstance(keywords, list):
                raise ValueError("keywords must be a list of strings")
            settings.project.keywords = keywords
            updated_fields.append("keywords")

        # Update objectives
        if "objectives" in params:
            settings.screen.explanation = params["objectives"]
            updated_fields.append("objectives")

        # Save settings
        self.review_manager.save_settings()

        # Create commit if not skipped and there were updates
        if not skip_commit and updated_fields:
            self.review_manager.create_commit(
                msg=f"Update review definition: {', '.join(updated_fields)}",
            )

        return response_formatter.format_operation_response(
            operation_name="update_review_definition",
            project_id=project_id,
            details={
                "message": f"Updated {len(updated_fields)} field(s)",
                "updated_fields": updated_fields,
            },
        )

    def get_screening_criteria(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get all configured screening criteria.

        Returns the screening criteria from the screen settings.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - project_id (str): Project identifier
                - criteria (dict): Screening criteria keyed by name, each with:
                    - explanation (str): Criterion explanation
                    - comment (str or null): Optional comment
                    - criterion_type (str): "inclusion_criterion" or "exclusion_criterion"
        """
        project_id = params["project_id"]
        logger.info(f"Getting screening criteria for project {project_id}")

        criteria_dict = self._serialize_criteria(
            self.review_manager.settings.screen.criteria
        )

        return {
            "success": True,
            "project_id": project_id,
            "criteria": criteria_dict,
        }

    def add_screening_criterion(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Add a new screening criterion.

        Creates a new ScreenCriterion and adds it to the screen settings.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - name (str): Criterion name/key (required)
                - explanation (str): Criterion explanation (required)
                - comment (str, optional): Optional comment (default: None)
                - criterion_type (str): Type - "inclusion_criterion" or "exclusion_criterion" (required)
                - skip_commit (bool, optional): Skip git commit (default: False)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - operation (str): "add_screening_criterion"
                - project_id (str): Project identifier
                - details (dict): Operation results with:
                    - message (str): Success message
                    - criterion_name (str): Name of the added criterion

        Raises:
            ValueError: If required parameters are missing or criterion_type is invalid
            ValueError: If a criterion with the given name already exists
        """
        project_id = params["project_id"]
        skip_commit = validation.get_optional_param(params, "skip_commit", False)

        name = params.get("name")
        if not name:
            raise ValueError("name parameter is required")

        explanation = params.get("explanation")
        if not explanation:
            raise ValueError("explanation parameter is required")

        comment = params.get("comment", None)

        criterion_type_str = params.get("criterion_type")
        if not criterion_type_str:
            raise ValueError("criterion_type parameter is required")

        # Validate and convert criterion_type
        criterion_type = self._parse_criterion_type(criterion_type_str)

        logger.info(
            f"Adding screening criterion '{name}' to project {project_id}"
        )

        screen_settings = self.review_manager.settings.screen

        # Check if criterion already exists
        if name in screen_settings.criteria:
            raise ValueError(
                f"Screening criterion '{name}' already exists"
            )

        # Create and add the criterion
        criterion = ScreenCriterion(
            explanation=explanation,
            comment=comment,
            criterion_type=criterion_type,
        )
        screen_settings.criteria[name] = criterion

        # Save settings
        self.review_manager.save_settings()

        # Create commit if not skipped
        if not skip_commit:
            self.review_manager.create_commit(
                msg=f"Add screening criterion: {name}",
            )

        return response_formatter.format_operation_response(
            operation_name="add_screening_criterion",
            project_id=project_id,
            details={
                "message": f"Added screening criterion '{name}'",
                "criterion_name": name,
            },
        )

    def update_screening_criterion(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Update an existing screening criterion.

        Updates the specified fields of an existing criterion. Only provided
        fields are updated; omitted fields remain unchanged.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - criterion_name (str): Name of the criterion to update (required)
                - explanation (str, optional): New explanation
                - comment (str, optional): New comment
                - criterion_type (str, optional): New type - "inclusion_criterion" or "exclusion_criterion"
                - skip_commit (bool, optional): Skip git commit (default: False)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - operation (str): "update_screening_criterion"
                - project_id (str): Project identifier
                - details (dict): Operation results with:
                    - message (str): Success message
                    - criterion_name (str): Name of the updated criterion
                    - updated_fields (list): List of updated field names

        Raises:
            ValueError: If criterion_name is missing or criterion does not exist
            ValueError: If criterion_type value is invalid
        """
        project_id = params["project_id"]
        skip_commit = validation.get_optional_param(params, "skip_commit", False)

        criterion_name = params.get("criterion_name")
        if not criterion_name:
            raise ValueError("criterion_name parameter is required")

        logger.info(
            f"Updating screening criterion '{criterion_name}' in project {project_id}"
        )

        screen_settings = self.review_manager.settings.screen

        if criterion_name not in screen_settings.criteria:
            raise ValueError(
                f"Screening criterion '{criterion_name}' not found"
            )

        criterion = screen_settings.criteria[criterion_name]
        updated_fields = []

        if "explanation" in params:
            criterion.explanation = params["explanation"]
            updated_fields.append("explanation")

        if "comment" in params:
            criterion.comment = params["comment"]
            updated_fields.append("comment")

        if "criterion_type" in params:
            criterion.criterion_type = self._parse_criterion_type(
                params["criterion_type"]
            )
            updated_fields.append("criterion_type")

        # Save settings
        self.review_manager.save_settings()

        # Create commit if not skipped and there were updates
        if not skip_commit and updated_fields:
            self.review_manager.create_commit(
                msg=f"Update screening criterion: {criterion_name}",
            )

        return response_formatter.format_operation_response(
            operation_name="update_screening_criterion",
            project_id=project_id,
            details={
                "message": f"Updated screening criterion '{criterion_name}'",
                "criterion_name": criterion_name,
                "updated_fields": updated_fields,
            },
        )

    def remove_screening_criterion(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Remove a screening criterion.

        Removes the specified criterion from the screen settings.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - criterion_name (str): Name of the criterion to remove (required)
                - skip_commit (bool, optional): Skip git commit (default: False)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - operation (str): "remove_screening_criterion"
                - project_id (str): Project identifier
                - details (dict): Operation results with:
                    - message (str): Success message
                    - criterion_name (str): Name of the removed criterion

        Raises:
            ValueError: If criterion_name is missing or criterion does not exist
        """
        project_id = params["project_id"]
        skip_commit = validation.get_optional_param(params, "skip_commit", False)

        criterion_name = params.get("criterion_name")
        if not criterion_name:
            raise ValueError("criterion_name parameter is required")

        logger.info(
            f"Removing screening criterion '{criterion_name}' from project {project_id}"
        )

        screen_settings = self.review_manager.settings.screen

        if criterion_name not in screen_settings.criteria:
            raise ValueError(
                f"Screening criterion '{criterion_name}' not found"
            )

        del screen_settings.criteria[criterion_name]

        # Save settings
        self.review_manager.save_settings()

        # Create commit if not skipped
        if not skip_commit:
            self.review_manager.create_commit(
                msg=f"Remove screening criterion: {criterion_name}",
            )

        return response_formatter.format_operation_response(
            operation_name="remove_screening_criterion",
            project_id=project_id,
            details={
                "message": f"Removed screening criterion '{criterion_name}'",
                "criterion_name": criterion_name,
            },
        )

    def _serialize_criteria(
        self, criteria: Dict[str, ScreenCriterion]
    ) -> Dict[str, Dict[str, Any]]:
        """Serialize screening criteria to a JSON-safe dictionary.

        Args:
            criteria: Dictionary of criterion name to ScreenCriterion objects

        Returns:
            Dictionary of criterion name to serialized criterion data
        """
        result = {}
        for name, criterion in criteria.items():
            result[name] = {
                "explanation": criterion.explanation,
                "comment": criterion.comment,
                "criterion_type": criterion.criterion_type.value,
            }
        return result

    def _parse_criterion_type(self, criterion_type_str: str) -> ScreenCriterionType:
        """Parse a criterion type string into a ScreenCriterionType enum.

        Args:
            criterion_type_str: String value - "inclusion_criterion" or "exclusion_criterion"

        Returns:
            ScreenCriterionType enum value

        Raises:
            ValueError: If the string does not match a valid criterion type
        """
        try:
            return ScreenCriterionType(criterion_type_str)
        except ValueError:
            valid_options = ScreenCriterionType.get_options()
            raise ValueError(
                f"Invalid criterion_type '{criterion_type_str}'. "
                f"Must be one of: {', '.join(valid_options)}"
            )
