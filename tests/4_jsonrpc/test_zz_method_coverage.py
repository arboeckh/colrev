#!/usr/bin/env python
"""Registry-driven RPC coverage gate (WP-08 §3).

Every RPC method should have at least one test that drives it to a successful
result and one that drives it to an error. Rather than trusting a
hand-maintained list, ``conftest`` records what actually happened: it wraps
``JSONRPCHandler.handle_request`` for the whole session and notes, per method,
whether a ``result`` and an ``error`` were ever produced. This file compares
that against the live registry.

Consequences worth knowing before you edit this file:

* Registering a new RPC method fails this test until it has tests. That is
  the point — new surface arrives covered or it arrives loudly uncovered.
* ``HAPPY_PATH_GAPS`` is a *shrinking* allowlist, not a config knob. Each
  entry names why the happy path is not exercised here. Do not add to it to
  make a red build green; add a test, or if the method genuinely cannot be
  driven hermetically, add it with a reason.

The file is named ``test_zz_*`` so it collects last: the recording it reads
is only complete once every other module in this package has run.

Running a subset (``-k``, a single file) leaves the recording partial, so the
assertions skip themselves unless the whole package was collected.
"""
from __future__ import annotations

from pathlib import Path

import pytest

import colrev.ui_jsonrpc.framework_handlers  # noqa: F401  (registers methods)
from colrev.ui_jsonrpc.framework import registry

#: Methods with no happy-path test in this package, and why.
#:
#: These all drive a full CoLRev operation whose packages reach the network
#: (Crossref/PubMed/OpenAlex metadata prep, PDF retrieval, local_index).
#: Running them here would either hit the network or need a large HTTP
#: recording layer; the Playwright pipeline (electron-app/e2e) covers them
#: against recorded fixtures instead. Their *failure* modes are covered by
#: `test_universal_failures.py`.
HAPPY_PATH_GAPS: dict[str, str] = {
    # --- reach the network or a heavy package chain ------------------------
    "data": "runs the data operation (paper_md endpoint) — covered by e2e 07-data",
    "pdf_get": "retrieves PDFs over the network — covered by e2e 04-pdf-get",
    "pdf_prep": "runs the OCR/grobid package chain — covered by e2e 04-pdf-get",
    "prep": "runs metadata prep against external APIs — covered by e2e 02-preprocessing",
    "search": "issues live API searches — covered by e2e 01-search (recorded HTTP)",
    # --- need a project carried far down the pipeline ----------------------
    "export_data_csv": "needs a populated data/data.csv — covered by e2e 07-data",
    "save_data_extraction": "runs the data operation on rev_included records — e2e 07-data",
    "include_all_screen": "needs records at pdf_prepared — covered by e2e 06-screen",
    "prescreen": "batch prescreen over a loaded dataset — covered by e2e 03-prescreen",
    "screen": "batch screen over a loaded dataset — covered by e2e 06-screen",
    "screen_record": "needs records at pdf_prepared — covered by e2e 06-screen",
    "update_screen_decisions": "needs records at pdf_prepared — covered by e2e 06-screen",
    "update_prescreen_decisions": "needs records at md_processed in a queue — e2e 03-prescreen",
    "enrich_record_metadata": "enriches from external metadata APIs — e2e 03-prescreen",
    "restore_pdf_file": "needs a record whose metadata already references a file — e2e 04",
    # --- managed review: multi-account / multi-branch flows ----------------
    "cancel_managed_review_task": "needs a live task with reviewer branches — e2e 03",
    "get_managed_review_task_queue": "needs a live task with reviewer branches — e2e 03",
    # --- need a configured remote -----------------------------------------
    "reset_to_remote": "needs an origin to reset onto — covered by e2e 08-branch-switch",
    # --- source edits on a registered, non-stale source --------------------
    "remove_source": "removing a source rewrites search history — covered by e2e 01-search",
    "update_source": "editing a source re-runs staleness derivation — e2e 01-search",
}

#: Methods with no reachable failure mode: no required params, no lookup that
#: can miss. Forcing one would mean inventing an error the handler does not
#: have.
NO_FAILURE_MODE: dict[str, str] = {
    "get_connector_api_key_status": "no params; reads an env var and reports a bool",
    "get_csv_source_templates": "no params; returns a static list",
    "list_projects": "no required params; a missing base_path yields an empty list",
}


def _package_test_modules() -> set[str]:
    here = Path(__file__).parent
    return {p.name for p in here.glob("test_*.py")}


def _require_full_run(collected_test_modules: set[str]) -> None:
    missing = _package_test_modules() - collected_test_modules
    if missing:
        pytest.skip(
            "partial run: coverage recording is incomplete "
            f"(not collected: {', '.join(sorted(missing))})"
        )


def test_every_method_has_a_happy_path(rpc_outcomes, collected_test_modules) -> None:
    _require_full_run(collected_test_modules)

    uncovered = sorted(
        spec.name
        for spec in registry.all()
        if "happy" not in rpc_outcomes.get(spec.name, set())
        and spec.name not in HAPPY_PATH_GAPS
    )

    assert not uncovered, (
        "RPC methods with no test that reaches a successful result:\n  "
        + "\n  ".join(uncovered)
        + "\n\nAdd a handler test, or record the reason in HAPPY_PATH_GAPS."
    )


def test_every_method_has_a_failure_path(rpc_outcomes, collected_test_modules) -> None:
    _require_full_run(collected_test_modules)

    uncovered = sorted(
        spec.name
        for spec in registry.all()
        if "failure" not in rpc_outcomes.get(spec.name, set())
        and spec.name not in NO_FAILURE_MODE
    )

    assert not uncovered, (
        "RPC methods with no test that reaches an error response:\n  "
        + "\n  ".join(uncovered)
        + "\n\n`test_universal_failures.py` covers this for every registered "
        "method; a name here means the method escaped that sweep."
    )


def test_the_gap_list_has_no_stale_entries(rpc_outcomes, collected_test_modules) -> None:
    """A method that gained a happy path must be removed from the allowlist."""
    _require_full_run(collected_test_modules)

    registered = {spec.name for spec in registry.all()}
    unregistered = sorted((set(HAPPY_PATH_GAPS) | set(NO_FAILURE_MODE)) - registered)
    assert not unregistered, (
        f"the allowlists name methods that are not registered: {unregistered}"
    )

    now_covered = sorted(
        name for name in HAPPY_PATH_GAPS if "happy" in rpc_outcomes.get(name, set())
    )
    assert not now_covered, (
        f"these now have a happy-path test — remove them from "
        f"HAPPY_PATH_GAPS: {now_covered}"
    )
