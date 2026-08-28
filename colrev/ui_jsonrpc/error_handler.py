"""Error handling and mapping for JSON-RPC responses."""
import logging
from typing import Any
from typing import Dict
from typing import Optional

import colrev.exceptions as colrev_exceptions
from colrev.ui_jsonrpc.errors import MethodNotFoundError
from colrev.ui_jsonrpc.errors import NotFoundError

logger = logging.getLogger(__name__)

# JSON-RPC 2.0 standard error codes
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

# CoLRev-specific error codes (starting from -32000 as per JSON-RPC spec).
# The renderer branches on these (see electron-app/src/renderer/lib/rpc-errors.ts)
# — keep both sides in sync when adding codes.
COLREV_REPO_SETUP_ERROR = -32000
COLREV_OPERATION_ERROR = -32001
COLREV_SERVICE_NOT_AVAILABLE = -32002
COLREV_MISSING_DEPENDENCY = -32003
COLREV_PARAMETER_ERROR = -32004
# The operation refused to run because the repo is not in the required state
# (uncommitted changes, unresolved merge, ...). UI: "commit or discard first".
COLREV_PRECONDITION_FAILED = -32005
# A lock (e.g. .git/index.lock) is held by another process after retries.
COLREV_RESOURCE_LOCKED = -32006
# A referenced resource (project, record, source) does not exist.
COLREV_NOT_FOUND = -32007

# Exceptions signalling "repo not in the required state to run this".
_PRECONDITION_EXCEPTIONS = (
    colrev_exceptions.UnstagedGitChangesError,
    colrev_exceptions.CleanRepoRequiredError,
    colrev_exceptions.DirtyRepoAfterProcessingError,
    colrev_exceptions.GitConflictError,
)


def map_exception_to_error_code(exception: Exception) -> int:
    """
    Map Python exception to JSON-RPC error code.

    Args:
        exception: The exception to map

    Returns:
        Appropriate JSON-RPC error code
    """
    if isinstance(exception, MethodNotFoundError):
        return METHOD_NOT_FOUND
    elif isinstance(exception, NotFoundError):
        return COLREV_NOT_FOUND
    elif isinstance(exception, colrev_exceptions.GitNotAvailableError):
        return COLREV_RESOURCE_LOCKED
    elif isinstance(exception, _PRECONDITION_EXCEPTIONS):
        return COLREV_PRECONDITION_FAILED
    elif isinstance(exception, colrev_exceptions.RepoSetupError):
        return COLREV_REPO_SETUP_ERROR
    elif isinstance(exception, colrev_exceptions.ServiceNotAvailableException):
        return COLREV_SERVICE_NOT_AVAILABLE
    elif isinstance(exception, colrev_exceptions.MissingDependencyError):
        return COLREV_MISSING_DEPENDENCY
    elif isinstance(exception, (ValueError, TypeError)):
        return INVALID_PARAMS
    elif isinstance(exception, colrev_exceptions.CoLRevException):
        return COLREV_OPERATION_ERROR
    else:
        return INTERNAL_ERROR


def create_error_response(
    code: int,
    message: str,
    data: Optional[str] = None,
    request_id: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Create JSON-RPC 2.0 error response.

    Args:
        code: Error code
        message: Error message
        data: Optional additional error data
        request_id: Request ID from the original request

    Returns:
        JSON-RPC error response dictionary
    """
    error = {"code": code, "message": message}
    if data:
        error["data"] = data

    return {
        "jsonrpc": "2.0",
        "error": error,
        "id": request_id,
    }


def handle_exception(
    exception: Exception, request_id: Optional[Any] = None
) -> Dict[str, Any]:
    """
    Handle exception and create appropriate error response.

    Args:
        exception: The exception to handle
        request_id: Request ID from the original request

    Returns:
        JSON-RPC error response dictionary
    """
    # Log the exception
    logger.exception(f"Error handling request: {exception}")

    # Map to error code
    error_code = map_exception_to_error_code(exception)

    # Create error message
    error_message = str(exception)
    if not error_message:
        error_message = exception.__class__.__name__

    # Create response
    return create_error_response(
        code=error_code,
        message=error_message,
        data=exception.__class__.__name__,
        request_id=request_id,
    )
