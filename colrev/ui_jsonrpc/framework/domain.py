"""Shared domain models for RPC payloads.

These are the types the backend returns in record-bearing responses and
writes into JSON Schema (and from there into generated TypeScript). The
frontend gets strict typing on known fields while still accepting the
passthrough of arbitrary bib fields (author, journal, doi, etc.).

Kept separate from ``framework/models.py`` so the framework scaffolding
stays tiny and domain concerns live next to what uses them.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal
from typing import Optional

from pydantic import BaseModel
from pydantic import ConfigDict

from colrev.constants import RecordState as _RecordStateEnum


# RecordState as a string-valued enum for JSON Schema export.
#
# Built dynamically from :class:`colrev.constants.RecordState` so the
# names always match — adding a state in core colrev is reflected here
# at the next import without a manual mirror update. JSON Schema sees
# this as an ``enum`` of strings (frontend codegen gets a string-literal
# union).
RecordStateName = Enum(  # type: ignore[misc]
    "RecordStateName",
    {s.name: s.name for s in _RecordStateEnum},
    type=str,
)


class RecordPayload(BaseModel):
    """A CoLRev record as returned over JSON-RPC.

    Known fields are typed. Additional bib fields (author, journal, doi,
    pubmedid, abstract, etc.) pass through via ``extra="allow"``. The
    frontend still gets IntelliSense on the known subset without losing
    the ability to render arbitrary metadata.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    # Core identity (always present).
    ID: str
    ENTRYTYPE: str = ""

    # CoLRev workflow state.
    colrev_status: Optional[RecordStateName] = None


class RecordSummary(BaseModel):
    """Lightweight record view used by queue endpoints.

    Used by ``get_prescreen_queue``, ``get_screen_queue``, and similar —
    where the frontend needs just enough to render a list item. Extra
    fields are allowed so endpoints can tack on e.g. ``pdf_path`` or
    ``current_criteria`` without a schema change.
    """

    model_config = ConfigDict(extra="allow")

    id: str
    title: str = ""
    author: str = ""
    year: str = ""


class ProgressEventKind(str, Enum):
    """Top-level discriminator for structured progress events (Phase E)."""

    search_progress = "search_progress"
    load_progress = "load_progress"
    prep_progress = "prep_progress"
    dedupe_progress = "dedupe_progress"
    pdf_get_progress = "pdf_get_progress"
    pdf_prep_progress = "pdf_prep_progress"
    generic = "generic"


class ProgressEvent(BaseModel):
    """Structured progress event emitted by long-running handlers.

    Emitted as a JSON-RPC notification on stdout (no ``id`` field). The
    frontend subscribes via ``window.colrev.onProgress`` (Phase E) instead
    of regex-parsing stderr.

    ``kind`` discriminates event type; ``details`` carries kind-specific
    data (``extra="allow"`` lets handlers attach arbitrary structured
    context without a schema change).
    """

    model_config = ConfigDict(extra="allow")

    kind: ProgressEventKind
    message: str
    current: Optional[int] = None
    total: Optional[int] = None
    source: Optional[str] = None
    level: Literal["info", "warning", "error"] = "info"
