"""Shared base request/response Pydantic models for the RPC framework."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel
from pydantic import ConfigDict


class _FrameworkModel(BaseModel):
    """Base for all framework models. Forbids unknown fields by default so
    request drift surfaces at validation time."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class NoProjectRequest(_FrameworkModel):
    """Request for methods that don't operate on a project (ping, list_projects).

    ``base_path`` is accepted but ignored: the electron frontend injects it
    into every RPC call (see ``backend.ts``) so no-project methods must tolerate
    it rather than reject with ``extra=forbid``.
    """

    base_path: str | None = None


class ProjectScopedRequest(_FrameworkModel):
    """Request for methods that operate on an existing project.

    ``base_path`` defaults to ``./projects`` relative to the server's cwd;
    the dispatcher resolves it to an absolute path before constructing the
    ReviewManager.

    ``verbose`` controls ReviewManager verbose_mode.
    """

    project_id: str
    base_path: str | None = None
    verbose: bool = False


class SuccessResponse(_FrameworkModel):
    """Every successful response carries ``success=True``.

    Subclasses add domain fields; the dispatcher serializes via
    ``model_dump(mode='json', exclude_none=True)``.
    """

    model_config = ConfigDict(extra="allow")  # subclasses may add fields freely

    success: Literal[True] = True


class ProjectResponse(SuccessResponse):
    """Response that echoes the project_id for client-side correlation."""

    project_id: str


class PingResponse(SuccessResponse):
    """Readiness probe response. Lives here (not in system_handler) so the
    fast path in ``handler.py`` can construct it without importing
    ``framework_handlers`` (which would defeat the lazy-load design)."""

    status: Literal["pong"] = "pong"
