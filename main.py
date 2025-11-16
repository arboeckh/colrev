#!/usr/bin/env python
"""
JSON-RPC server for CoLRev operations via stdio.
This serves as the entry point for PyInstaller packaging.
"""

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional

# Patch subprocess BEFORE any CoLRev imports
import subprocess
import shutil

_original_check_call = subprocess.check_call


def _patched_check_call(cmd, *args, **kwargs):
    """Intercept pre-commit calls and run as Python module in frozen mode."""
    if getattr(sys, "frozen", False) and isinstance(cmd, list) and len(cmd) > 0:
        if "pre-commit" in str(cmd[0]):
            # Run pre-commit as Python module instead of subprocess
            logging.info(f"Running pre-commit command: {' '.join(cmd)}")
            import pre_commit.main

            try:
                # Run pre-commit with the arguments
                result = pre_commit.main.main(cmd[1:])
                if result != 0:
                    raise subprocess.CalledProcessError(result, cmd)
                return 0
            except SystemExit as e:
                if e.code != 0:
                    raise subprocess.CalledProcessError(e.code, cmd)
                return 0
    return _original_check_call(cmd, *args, **kwargs)


subprocess.check_call = _patched_check_call

# Also patch shutil.which to make pre-commit appear available
_original_which = shutil.which


def _patched_which(cmd, *args, **kwargs):
    """Make pre-commit appear available in frozen mode."""
    if getattr(sys, "frozen", False) and cmd == "pre-commit":
        return "pre-commit"  # Return non-None to indicate it's available
    return _original_which(cmd, *args, **kwargs)


shutil.which = _patched_which

# NOW import CoLRev (after patching)
import colrev.ops.init
import colrev.review_manager
from colrev.package_manager.package_manager import PackageManager

# Configure logging to stderr only (stdout is used for JSON-RPC communication)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    stream=sys.stderr,  # Ensure logs go to stderr, not stdout
)
logger = logging.getLogger(__name__)


# Monkey-patch PackageManager for PyInstaller frozen environment
# In frozen mode, all packages are bundled, so we always return True
def _is_frozen():
    """Check if running in a PyInstaller frozen environment."""
    return getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")


if _is_frozen():
    logger.info("Running in frozen mode - bypassing package installation checks")

    # Override is_installed to always return True in frozen mode
    def _patched_is_installed(self, package_identifier: str) -> bool:
        """Always return True in frozen mode since all packages are bundled."""
        logger.debug(f"Package check bypassed for: {package_identifier}")
        return True

    # Override install_project to do nothing in frozen mode (packages already bundled)
    def _patched_install_project(self, *args, **kwargs) -> None:
        """No-op in frozen mode since all packages are already bundled."""
        logger.debug("Package installation skipped in frozen mode")
        return None

    PackageManager.is_installed = _patched_is_installed
    PackageManager.install_project = _patched_install_project

    # Patch Package class to handle missing metadata in frozen mode
    import colrev.package_manager.package
    import importlib
    from pathlib import Path
    from types import SimpleNamespace

    _original_package_init = colrev.package_manager.package.Package.__init__

    def _patched_package_init(self, package_identifier: str) -> None:
        """Handle package initialization in frozen mode without metadata."""
        try:
            # Try original initialization first
            _original_package_init(self, package_identifier)
        except Exception as e:
            # In frozen mode, create a mock package object
            logger.info(
                f"Creating mock package for {package_identifier} in frozen mode"
            )

            try:
                from colrev.constants import EndpointType

                # Derive the actual module path from package identifier
                # CoLRev packages follow: colrev.PACKAGE_NAME -> colrev.packages.PACKAGE_NAME.src.PACKAGE_NAME
                if package_identifier.startswith("colrev."):
                    package_short_name = package_identifier.replace("colrev.", "")
                    module_path = (
                        f"colrev.packages.{package_short_name}.src.{package_short_name}"
                    )

                    # Determine the class name (convert snake_case to PascalCase)
                    class_name = "".join(
                        word.capitalize() for word in package_short_name.split("_")
                    )

                    # Try to locate the package directory
                    try:
                        # Import the actual module to verify it exists and get its path
                        module = importlib.import_module(module_path)
                        module_file = getattr(module, "__file__", None)
                        if module_file:
                            package_dir = Path(module_file).parent
                        else:
                            # Fallback to sys._MEIPASS
                            package_dir = (
                                Path(sys._MEIPASS)
                                / "colrev"
                                / "packages"
                                / package_short_name
                            )
                    except ImportError:
                        # If we can't import, construct the path
                        if hasattr(sys, "_MEIPASS"):
                            package_dir = (
                                Path(sys._MEIPASS)
                                / "colrev"
                                / "packages"
                                / package_short_name
                            )
                        else:
                            package_dir = (
                                Path(__file__).parent
                                / "colrev"
                                / "packages"
                                / package_short_name
                            )

                    # Determine endpoint type by trying to import and inspect the module
                    entry_points = []
                    endpoint_value = f"{module_path}:{class_name}"
                    detected_endpoint = None

                    try:
                        # Try to import the module to detect its endpoint type
                        module = importlib.import_module(module_path)
                        if hasattr(module, class_name):
                            cls = getattr(module, class_name)
                            # Check which base class it inherits from
                            import colrev.package_manager.package_base_classes as base_classes

                            if issubclass(cls, base_classes.ReviewTypePackageBaseClass):
                                detected_endpoint = EndpointType.review_type
                            elif issubclass(
                                cls, base_classes.SearchSourcePackageBaseClass
                            ):
                                detected_endpoint = EndpointType.search_source
                            elif issubclass(cls, base_classes.PrepPackageBaseClass):
                                detected_endpoint = EndpointType.prep
                            elif issubclass(cls, base_classes.DedupePackageBaseClass):
                                detected_endpoint = EndpointType.dedupe
                            elif issubclass(
                                cls, base_classes.PrescreenPackageBaseClass
                            ):
                                detected_endpoint = EndpointType.prescreen
                            elif issubclass(cls, base_classes.PDFGetPackageBaseClass):
                                detected_endpoint = EndpointType.pdf_get
                            elif issubclass(cls, base_classes.PDFPrepPackageBaseClass):
                                detected_endpoint = EndpointType.pdf_prep
                            elif issubclass(cls, base_classes.ScreenPackageBaseClass):
                                detected_endpoint = EndpointType.screen
                            elif issubclass(cls, base_classes.DataPackageBaseClass):
                                detected_endpoint = EndpointType.data

                            logger.debug(
                                f"Detected endpoint type {detected_endpoint} for {package_identifier}"
                            )
                    except Exception as inspect_error:
                        logger.debug(
                            f"Could not inspect module {module_path}: {inspect_error}"
                        )
                        # Fall back to name-based detection
                        pass

                    # If we detected an endpoint type, use it
                    if detected_endpoint:
                        entry_points.append(
                            SimpleNamespace(
                                name=detected_endpoint.value, value=endpoint_value
                            )
                        )
                    else:
                        # Fall back to name-based detection for common patterns
                        if any(
                            x in package_short_name
                            for x in [
                                "literature_review",
                                "scoping_review",
                                "meta_analysis",
                                "systematic_review",
                                "narrative_review",
                                "critical_review",
                                "blank",
                                "conceptual_review",
                                "descriptive_review",
                                "theoretical_review",
                                "umbrella_review",
                            ]
                        ):
                            detected_endpoint = EndpointType.review_type
                        elif (
                            "_search" in package_short_name
                            or "search_source" in package_short_name
                        ):
                            detected_endpoint = EndpointType.search_source
                        elif "prep" in package_short_name:
                            detected_endpoint = EndpointType.prep
                        elif "dedupe" in package_short_name:
                            detected_endpoint = EndpointType.dedupe

                        if detected_endpoint:
                            entry_points.append(
                                SimpleNamespace(
                                    name=detected_endpoint.value, value=endpoint_value
                                )
                            )
                            logger.debug(
                                f"Using name-based detection: {detected_endpoint} for {package_identifier}"
                            )
                        else:
                            # Last resort: assume review_type
                            logger.warning(
                                f"Could not determine endpoint type for {package_identifier}, assuming review_type"
                            )
                            entry_points.append(
                                SimpleNamespace(
                                    name=EndpointType.review_type.value,
                                    value=endpoint_value,
                                )
                            )

                    # Create a mock distribution object with all required attributes
                    self.package = SimpleNamespace(
                        metadata={"Name": package_identifier, "Version": "1.0.0"},
                        files=[
                            SimpleNamespace(locate=lambda: package_dir / "__init__.py")
                        ],
                        entry_points=entry_points,
                    )
                    self.package_dir = package_dir
                    self.name = package_identifier
                    self.version = "1.0.0"

                    logger.debug(
                        f"Mock package created for {package_identifier} at {package_dir}"
                    )
                else:
                    raise ValueError(
                        f"Package identifier {package_identifier} does not follow CoLRev naming convention"
                    )

            except Exception as mock_error:
                logger.error(
                    f"Failed to create mock package for {package_identifier}: {mock_error}"
                )
                logger.exception("Detailed error:")
                raise

    colrev.package_manager.package.Package.__init__ = _patched_package_init


class CoLRevJSONRPCHandler:
    """JSON-RPC request handler for CoLRev operations."""

    def handle_jsonrpc_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Process JSON-RPC 2.0 request and return response."""
        # Validate JSON-RPC 2.0 structure
        if request.get("jsonrpc") != "2.0":
            return self.create_error_response(
                -32600,
                "Invalid Request",
                "jsonrpc version must be 2.0",
                request.get("id"),
            )

        method = request.get("method")
        params = request.get("params", {})
        request_id = request.get("id")

        if not method:
            return self.create_error_response(
                -32600, "Invalid Request", "method is required", request_id
            )

        # Route to appropriate method handler
        try:
            if method == "init_project":
                result = self.init_project(params)
            elif method == "get_status":
                result = self.get_status(params)
            elif method == "ping":
                result = {"status": "pong"}
            else:
                return self.create_error_response(
                    -32601,
                    "Method not found",
                    f"Method '{method}' not found",
                    request_id,
                )

            return {
                "jsonrpc": "2.0",
                "result": result,
                "id": request_id,
            }

        except Exception as e:
            logger.exception(f"Error executing method {method}")
            return self.create_error_response(
                -32603, "Internal error", str(e), request_id
            )

    def init_project(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Initialize a CoLRev project with full data quality features.

        Expected params:
            project_id (str): Unique identifier for the project
            review_type (str, optional): Type of review (default: colrev.literature_review)
            example (bool, optional): Include example records (default: False)
            force_mode (bool, optional): Force initialization (default: True)
            light (bool, optional): Light mode without Docker (default: True for JSON-RPC)
            base_path (str, optional): Base path for projects (default: ./projects)

        Note: Pre-commit hooks are automatically installed for data quality validation.
        """
        project_id = params.get("project_id")
        if not project_id:
            raise ValueError("project_id is required")

        # Sanitize project_id to prevent path traversal
        project_id = "".join(c for c in project_id if c.isalnum() or c in ("-", "_"))
        if not project_id:
            raise ValueError("project_id must contain alphanumeric characters")

        base_path = Path(params.get("base_path", "./projects"))
        target_path = base_path / project_id

        review_type = params.get("review_type", "colrev.literature_review")
        example = params.get("example", False)
        force_mode = params.get("force_mode", True)
        light = params.get("light", True)  # Default to light mode for JSON-RPC

        logger.info(f"Initializing project {project_id} at {target_path}")

        # Create base directory if it doesn't exist
        base_path.mkdir(parents=True, exist_ok=True)

        # Create target directory and resolve to absolute path
        target_path.mkdir(parents=True, exist_ok=True)
        target_path = target_path.resolve()  # Convert to absolute path

        # Save current working directory before initialization
        original_cwd = os.getcwd()

        # Initialize CoLRev project (this also initializes git repo with pre-commit hooks)
        try:
            # Redirect stdout to stderr to prevent non-JSON output
            import io
            original_stdout = sys.stdout
            sys.stdout = sys.stderr

            try:
                colrev.ops.init.Initializer(
                    review_type=review_type,
                    target_path=target_path,
                    example=example,
                    force_mode=force_mode,
                    light=light,
                    exact_call=f"jsonrpc:init_project:{project_id}",
                )
            finally:
                # Restore original stdout
                sys.stdout = original_stdout

            logger.info(f"Project {project_id} initialized successfully")

            return {
                "success": True,
                "project_id": project_id,
                "path": str(target_path.resolve()),
                "review_type": review_type,
                "message": f"Project initialized successfully at {target_path}",
            }

        except Exception as e:
            logger.exception(f"Failed to initialize project {project_id}")
            raise ValueError(f"Failed to initialize project: {str(e)}")
        finally:
            # Always restore the original working directory
            os.chdir(original_cwd)

    def get_status(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get status of a CoLRev project.

        Expected params:
            project_id (str): Unique identifier for the project
            base_path (str, optional): Base path for projects (default: ./projects)
        """
        project_id = params.get("project_id")
        if not project_id:
            raise ValueError("project_id is required")

        base_path = Path(params.get("base_path", "./projects"))
        target_path = base_path / project_id
        target_path = target_path.resolve()

        logger.info(f"Looking for project at: {target_path}")
        logger.info(f"Path exists: {target_path.exists()}")
        if target_path.exists():
            logger.info(f"Contents: {list(target_path.iterdir())}")

        if not target_path.exists():
            raise ValueError(f"Project {project_id} does not exist at {target_path}")

        try:
            # Redirect stdout to stderr to prevent non-JSON output
            original_stdout = sys.stdout
            sys.stdout = sys.stderr

            try:
                review_manager = colrev.review_manager.ReviewManager(
                    path_str=str(target_path)
                )
                status_stats = review_manager.get_status_stats()

                # Convert status stats to dictionary for JSON serialization
                status_dict = {
                    "completeness_condition": status_stats.completeness_condition,
                    "currently_completed": status_stats.completed_atomic_steps,
                }

                return {
                    "success": True,
                    "project_id": project_id,
                    "path": str(target_path.resolve()),
                    "status": status_dict,
                }
            finally:
                # Restore original stdout
                sys.stdout = original_stdout

        except Exception as e:
            logger.exception(f"Failed to get status for project {project_id}")
            raise ValueError(f"Failed to get status: {str(e)}")

    def create_error_response(
        self,
        code: int,
        message: str,
        data: Optional[str] = None,
        request_id: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """Create JSON-RPC 2.0 error response."""
        error = {"code": code, "message": message}
        if data:
            error["data"] = data

        return {
            "jsonrpc": "2.0",
            "error": error,
            "id": request_id,
        }



def run_stdio_server() -> None:
    """Run the JSON-RPC server over stdio."""
    handler = CoLRevJSONRPCHandler()

    logger.info("CoLRev JSON-RPC server starting (stdio mode)")
    logger.info("Press Ctrl+C or send EOF to stop the server")
    logger.info(
        f"Example request: "
        f'{{"jsonrpc": "2.0", "method": "init_project", '
        f'"params": {{"project_id": "my_review"}}, "id": 1}}'
    )

    try:
        # Read requests from stdin line by line
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            try:
                request = json.loads(line)
                response = handler.handle_jsonrpc_request(request)
                # Write response to stdout with newline and flush
                print(json.dumps(response), flush=True)
            except json.JSONDecodeError as e:
                error_response = handler.create_error_response(
                    -32700, "Parse error", str(e), None
                )
                print(json.dumps(error_response), flush=True)
            except Exception as e:
                logger.exception("Unexpected error handling request")
                error_response = handler.create_error_response(
                    -32603, "Internal error", str(e), None
                )
                print(json.dumps(error_response), flush=True)

    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except EOFError:
        logger.info("Server stopped (EOF received)")


def main() -> None:
    """Main entry point for the application."""
    import argparse

    parser = argparse.ArgumentParser(description="CoLRev JSON-RPC Server (stdio)")
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        help="Logging level (default: INFO)",
    )

    args = parser.parse_args()

    # Set log level
    logging.getLogger().setLevel(getattr(logging, args.log_level))

    # Run server
    run_stdio_server()


if __name__ == "__main__":
    main()
