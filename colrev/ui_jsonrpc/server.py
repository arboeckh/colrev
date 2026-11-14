"""JSON-RPC server for CoLRev operations via stdio."""
import json
import logging
import re
import sys
from typing import Any
from typing import Dict

from colrev.ui_jsonrpc import transport

# Configure logging to stderr only (stdout is for JSON-RPC communication)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger(__name__)


class MalformedRequestError(Exception):
    """A request line that could not be decoded or parsed.

    Carries the id recovered from the line (``None`` when there is none), so
    the loop can still answer the request it belongs to.
    """

    def __init__(self, message: str, data: str, request_id: Any = None) -> None:
        super().__init__(message)
        self.message = message
        self.data = data
        self.request_id = request_id


_ID_PATTERN = re.compile(r'"id"\s*:\s*(-?\d+|"(?:[^"\\]|\\.)*")')


def _recover_request_id(text: str) -> Any:
    """Best-effort id of a request line that did not parse as a whole."""
    matches = _ID_PATTERN.findall(text)
    if not matches:
        return None
    try:
        # Electron writes the id last, so the last match is the request's.
        return json.loads(matches[-1])
    except ValueError:
        return None


def configure_stdio_encoding() -> None:
    """Make stdin and stderr UTF-8 whatever the platform's default is.

    Electron writes UTF-8; on Windows a piped stdin would otherwise be decoded
    with the ANSI code page. Does not rely on PYTHONUTF8 / PYTHONIOENCODING.
    """
    for stream in (sys.stdin, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8")


def _read_line() -> str:
    """Read one raw line from stdin; ``''`` only at real EOF."""
    buffer = getattr(sys.stdin, "buffer", None)
    if buffer is None:  # in-process tests replace stdin with a StringIO
        return sys.stdin.readline()
    raw = buffer.readline()
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        text = raw.decode("utf-8", errors="replace")
        raise MalformedRequestError(
            "Parse error", f"Request is not valid UTF-8: {exc}", _recover_request_id(text)
        ) from exc


def read_jsonrpc_request() -> Any:
    """
    Read a JSON-RPC request from stdin.

    Blank lines are skipped; only real EOF ends the stream.

    Returns:
        Parsed JSON value of the request line

    Raises:
        EOFError: At end of input
        MalformedRequestError: If the line is not valid UTF-8 or JSON
    """
    while True:
        raw_line = _read_line()
        if raw_line == "":
            raise EOFError("No input received")
        line = raw_line.strip()
        if line:
            break
    try:
        return json.loads(line)
    except json.JSONDecodeError as exc:
        raise MalformedRequestError(
            "Parse error", str(exc), _recover_request_id(line)
        ) from exc


def write_jsonrpc_response(response: Dict[str, Any]) -> None:
    """
    Write a JSON-RPC response to the wire (the original stdout).

    Goes through :mod:`colrev.ui_jsonrpc.transport` so the dispatcher's
    per-request fd 1 redirect cannot swallow responses.

    Args:
        response: JSON-RPC response dictionary
    """
    transport.write_line(transport.dumps(response))


def _error(
    code: int, message: str, request_id: Any, data: Any = None
) -> Dict[str, Any]:
    error: Dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": "2.0", "error": error, "id": request_id}


def run_stdio_server() -> None:
    """Run the JSON-RPC server using stdio protocol."""
    import threading

    from colrev.ui_jsonrpc.framework.events import install_default_emitter
    from colrev.ui_jsonrpc.handler import JSONRPCHandler

    configure_stdio_encoding()

    logger.info("CoLRev JSON-RPC server starting (stdio mode)")
    logger.info("Ready to receive requests via stdin")

    # Capture fd 1 as the private JSON-RPC wire before anything can redirect
    # it. The dispatcher redirects fd 1 to /dev/null around every
    # project-scoped handler; responses and progress notifications written
    # through the wire are unaffected.
    transport.init_wire()

    # Route ProgressEvent emissions onto the same wire as responses,
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
            request_id: Any = None
            try:
                # Read request from stdin
                request = read_jsonrpc_request()
                if not isinstance(request, dict):
                    write_jsonrpc_response(_error(-32600, "Invalid Request", None))
                    continue
                request_id = request.get("id")
                logger.debug(f"Received request: {request.get('method')}")

                # Process request
                response = handler.handle_request(request)

                # Write response to stdout
                write_jsonrpc_response(response)

            except EOFError:
                logger.info("EOF received, shutting down")
                break
            except MalformedRequestError as e:
                logger.error(f"{e.message}: {e.data}")
                write_jsonrpc_response(_error(-32700, e.message, e.request_id, e.data))
            except Exception as e:
                logger.exception("Unexpected error in server loop")
                write_jsonrpc_response(
                    _error(-32603, "Internal error", request_id, str(e))
                )

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

    # E2E hook: install requests-level PubMed mock if env var is set.
    # No-op in production (env var unset).
    from colrev.ui_jsonrpc import _pubmed_mock

    _pubmed_mock.install_if_enabled()

    # Run stdio server
    run_stdio_server()


if __name__ == "__main__":
    main()
