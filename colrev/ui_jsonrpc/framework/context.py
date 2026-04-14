"""HandlerContext: the per-request object threaded through the framework."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import colrev.review_manager


@dataclass
class HandlerContext:
    """Everything a handler might need beyond the request model itself.

    Constructed by the Dispatcher before calling the handler. Contains the
    (already-validated) project path, the active ReviewManager (with
    ``interactive_mode=True``), and the MethodSpec that describes this call.

    For methods with ``requires_project=False``, ``project_path`` and
    ``review_manager`` are both ``None``.
    """

    method_name: str
    project_id: Optional[str]
    project_path: Optional[Path]
    review_manager: Optional[colrev.review_manager.ReviewManager]
    writes: bool
