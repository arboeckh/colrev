"""JSON-RPC server for CoLRev operations via stdio."""

import json
import logging
import shutil
import subprocess
import sys
from typing import Any, Dict

# Configure logging to stderr only (stdout is for JSON-RPC communication)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger(__name__)


def _is_frozen() -> bool:
    """Check if running in a PyInstaller frozen environment."""
    return getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")


def _apply_pyinstaller_patches() -> None:
    """Apply compatibility patches for PyInstaller frozen environment."""
    if not _is_frozen():
        return

    logger.info("Running in frozen mode - applying PyInstaller compatibility patches")

    # Patch subprocess.check_call for pre-commit
    original_check_call = subprocess.check_call

    def _patched_check_call(cmd, *args, **kwargs):
        """Intercept pre-commit calls and run as Python module in frozen mode."""
        if isinstance(cmd, list) and len(cmd) > 0 and "pre-commit" in str(cmd[0]):
            logger.info(f"Running pre-commit command: {' '.join(cmd)}")
            import pre_commit.main

            try:
                result = pre_commit.main.main(cmd[1:])
                if result != 0:
                    raise subprocess.CalledProcessError(result, cmd)
                return 0
            except SystemExit as e:
                if e.code != 0:
                    raise subprocess.CalledProcessError(e.code, cmd)
                return 0
        return original_check_call(cmd, *args, **kwargs)

    subprocess.check_call = _patched_check_call

    # Patch shutil.which for pre-commit
    original_which = shutil.which

    def _patched_which(cmd, *args, **kwargs):
        """Make pre-commit appear available in frozen mode."""
        if cmd == "pre-commit":
            return "pre-commit"
        return original_which(cmd, *args, **kwargs)

    shutil.which = _patched_which

    # Patch PackageManager for frozen mode
    from colrev.package_manager.package_manager import PackageManager

    def _patched_is_installed(self, package_identifier: str) -> bool:
        """Always return True in frozen mode since all packages are bundled."""
        logger.debug(f"Package check bypassed for: {package_identifier}")
        return True

    def _patched_install_project(self, *args, **kwargs) -> None:
        """No-op in frozen mode since all packages are already bundled."""
        logger.debug("Package installation skipped in frozen mode")
        return None

    PackageManager.is_installed = _patched_is_installed
    PackageManager.install_project = _patched_install_project

    # Patch Package class for missing metadata
    import importlib
    from pathlib import Path
    from types import SimpleNamespace

    import colrev.package_manager.package
    from colrev.constants import EndpointType

    original_package_init = colrev.package_manager.package.Package.__init__

    def _patched_package_init(self, package_identifier: str) -> None:
        """Handle package initialization in frozen mode without metadata."""
        try:
            original_package_init(self, package_identifier)
        except Exception:
            logger.info(
                f"Creating mock package for {package_identifier} in frozen mode"
            )

            if not package_identifier.startswith("colrev."):
                raise ValueError(
                    f"Package identifier {package_identifier} does not follow CoLRev naming convention"
                )

            package_short_name = package_identifier.replace("colrev.", "")
            module_path = (
                f"colrev.packages.{package_short_name}.src.{package_short_name}"
            )
            class_name = "".join(
                word.capitalize() for word in package_short_name.split("_")
            )

            # Determine package directory
            try:
                module = importlib.import_module(module_path)
                module_file = getattr(module, "__file__", None)
                if module_file:
                    package_dir = Path(module_file).parent
                else:
                    package_dir = (
                        Path(sys._MEIPASS)
                        / "colrev"
                        / "packages"
                        / package_short_name
                    )
            except ImportError:
                package_dir = (
                    Path(sys._MEIPASS) / "colrev" / "packages" / package_short_name
                )

            # Detect endpoint type
            endpoint_value = f"{module_path}:{class_name}"
            entry_points = []

            try:
                module = importlib.import_module(module_path)
                if hasattr(module, class_name):
                    cls = getattr(module, class_name)
                    import colrev.package_manager.package_base_classes as base_classes

                    for endpoint_type, base_class in [
                        (EndpointType.review_type, base_classes.ReviewTypePackageBaseClass),
                        (EndpointType.search_source, base_classes.SearchSourcePackageBaseClass),
                        (EndpointType.prep, base_classes.PrepPackageBaseClass),
                        (EndpointType.dedupe, base_classes.DedupePackageBaseClass),
                        (EndpointType.prescreen, base_classes.PrescreenPackageBaseClass),
                        (EndpointType.pdf_get, base_classes.PDFGetPackageBaseClass),
                        (EndpointType.pdf_prep, base_classes.PDFPrepPackageBaseClass),
                        (EndpointType.screen, base_classes.ScreenPackageBaseClass),
                        (EndpointType.data, base_classes.DataPackageBaseClass),
                    ]:
                        if issubclass(cls, base_class):
                            entry_points.append(
                                SimpleNamespace(
                                    name=endpoint_type.value, value=endpoint_value
                                )
                            )
                            break
            except Exception:
                # Fallback to review_type
                entry_points.append(
                    SimpleNamespace(
                        name=EndpointType.review_type.value, value=endpoint_value
                    )
                )

            self.package = SimpleNamespace(
                metadata={"Name": package_identifier, "Version": "1.0.0"},
                files=[SimpleNamespace(locate=lambda: package_dir / "__init__.py")],
                entry_points=entry_points,
            )
            self.package_dir = package_dir
            self.name = package_identifier
            self.version = "1.0.0"

    colrev.package_manager.package.Package.__init__ = _patched_package_init


def read_jsonrpc_request() -> Dict[str, Any]:
    """
    Read a JSON-RPC request from stdin.

    Returns:
        Parsed JSON-RPC request dictionary

    Raises:
        json.JSONDecodeError: If input is not valid JSON
    """
    line = sys.stdin.readline().strip()
    if not line:
        raise EOFError("No input received")
    return json.loads(line)


def write_jsonrpc_response(response: Dict[str, Any]) -> None:
    """
    Write a JSON-RPC response to stdout.

    Args:
        response: JSON-RPC response dictionary
    """
    print(json.dumps(response), flush=True)


def run_stdio_server() -> None:
    """Run the JSON-RPC server using stdio protocol."""
    from colrev.ui_jsonrpc.handler import JSONRPCHandler

    logger.info("CoLRev JSON-RPC server starting (stdio mode)")
    logger.info("Ready to receive requests via stdin")

    handler = JSONRPCHandler()

    try:
        while True:
            try:
                # Read request from stdin
                request = read_jsonrpc_request()
                logger.debug(f"Received request: {request.get('method')}")

                # Process request
                response = handler.handle_request(request)

                # Write response to stdout
                write_jsonrpc_response(response)

            except EOFError:
                logger.info("EOF received, shutting down")
                break
            except json.JSONDecodeError as e:
                logger.error(f"JSON parse error: {e}")
                error_response = {
                    "jsonrpc": "2.0",
                    "error": {
                        "code": -32700,
                        "message": "Parse error",
                        "data": str(e),
                    },
                    "id": None,
                }
                write_jsonrpc_response(error_response)
            except Exception as e:
                logger.exception("Unexpected error in server loop")
                error_response = {
                    "jsonrpc": "2.0",
                    "error": {
                        "code": -32603,
                        "message": "Internal error",
                        "data": str(e),
                    },
                    "id": None,
                }
                write_jsonrpc_response(error_response)

    except KeyboardInterrupt:
        logger.info("Server stopped by user")


def main() -> None:
    """Main entry point for the JSON-RPC server."""
    import argparse

    parser = argparse.ArgumentParser(description="CoLRev JSON-RPC Server")
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        help="Logging level (default: INFO)",
    )

    args = parser.parse_args()

    # Set log level
    logging.getLogger().setLevel(getattr(logging, args.log_level))

    # Apply PyInstaller patches if running in frozen mode
    _apply_pyinstaller_patches()

    # Run stdio server
    run_stdio_server()


if __name__ == "__main__":
    main()
