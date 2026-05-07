"""Test-only requests mock for PubMed eutils endpoints.

Activated by setting COLREV_FAKE_PUBMED_REGISTRY=<path-to-fixture.json>.

The fixture is a JSON list of entries. Each entry matches by host + path; the
first match wins. Non-matching requests pass through to the real adapter.

Fixture entry shape:
    {
        "host": "eutils.ncbi.nlm.nih.gov",
        "path": "/entrez/eutils/esearch.fcgi",
        "response": {
            "status": 200,
            "headers": {"Content-Type": "application/json"},
            "content_b64": "<base64-encoded body bytes>"
        }
    }

Lives in the JSON-RPC layer (not colrev core) per CLAUDE.md.
"""
from __future__ import annotations

import base64
import json
import logging
import os
from io import BytesIO
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

_INSTALLED = False
_REGISTRY: List[Dict[str, Any]] = []


def _build_response(entry_response: Dict[str, Any], request) -> Any:
    """Construct a requests.Response from a fixture entry.

    The .raw attribute must be a urllib3.HTTPResponse (not a bare BytesIO):
    requests_cache reads response.raw._request_url when caching.
    """
    import requests
    from urllib3.response import HTTPResponse

    resp = requests.Response()
    resp.status_code = int(entry_response.get("status", 200))
    body_b64 = entry_response.get("content_b64") or ""
    body = base64.b64decode(body_b64) if body_b64 else b""
    resp._content = body  # noqa: SLF001
    headers = entry_response.get("headers") or {}
    raw = HTTPResponse(
        body=BytesIO(body),
        status=resp.status_code,
        headers=headers,
        preload_content=False,
    )
    raw._request_url = getattr(request, "url", "")  # noqa: SLF001
    resp.raw = raw
    resp.headers.update(headers)
    resp.url = getattr(request, "url", "")
    resp.request = request
    resp.encoding = "utf-8"
    return resp


def _find_entry(url: str) -> Optional[Dict[str, Any]]:
    parsed = urlparse(url)
    for entry in _REGISTRY:
        host = entry.get("host")
        path = entry.get("path")
        if host and parsed.hostname != host:
            continue
        if path and parsed.path != path:
            continue
        return entry
    return None


def install_if_enabled() -> None:
    """Install the requests-layer mock if the env var is set.

    Idempotent — safe to call multiple times.
    """
    global _INSTALLED, _REGISTRY  # noqa: PLW0603

    if _INSTALLED:
        return

    registry_path = os.environ.get("COLREV_FAKE_PUBMED_REGISTRY")
    if not registry_path:
        return

    try:
        with open(registry_path, "r", encoding="utf-8") as f:
            _REGISTRY = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning(
            "COLREV_FAKE_PUBMED_REGISTRY=%s could not be loaded: %s",
            registry_path, exc,
        )
        return

    import requests.adapters

    original_send = requests.adapters.HTTPAdapter.send

    def patched_send(self, request, *args, **kwargs):  # type: ignore[no-untyped-def]
        entry = _find_entry(request.url or "")
        if entry is None:
            return original_send(self, request, *args, **kwargs)
        logger.info("[pubmed-mock] intercepted %s", request.url)
        return _build_response(entry["response"], request)

    requests.adapters.HTTPAdapter.send = patched_send  # type: ignore[method-assign]
    _INSTALLED = True
    logger.info(
        "[pubmed-mock] installed with %d entries from %s",
        len(_REGISTRY), registry_path,
    )
