"""JSON-RPC server for CoLRev operations via stdio."""

import json
import logging
import sys
from typing import Any, Dict

# Configure logging to stderr only (stdout is for JSON-RPC communication)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger(__name__)


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
    import threading

    from colrev.ui_jsonrpc.framework.events import install_default_emitter
    from colrev.ui_jsonrpc.handler import JSONRPCHandler

    logger.info("CoLRev JSON-RPC server starting (stdio mode)")
    logger.info("Ready to receive requests via stdin")

    # Route ProgressEvent emissions onto the same stdout channel as responses,
    # as JSON-RPC notifications (no ``id``). Frontend demultiplexes by the
    # presence of ``method`` / absence of ``id``.
    install_default_emitter()

    handler = JSONRPCHandler()

    # Warm the dispatcher (review_manager + all framework handlers) in the
    # background so the cost is paid while the renderer is rendering rather
    # than on the first real RPC. The ``ping`` fast-path in JSONRPCHandler
    # responds without waiting for this to finish.
    threading.Thread(
        target=handler.preload, name="jsonrpc-preload", daemon=True
    ).start()

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

    # Run stdio server
    run_stdio_server()


if __name__ == "__main__":
    main()
