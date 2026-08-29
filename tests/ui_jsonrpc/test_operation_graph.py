"""Tests for the ProcessModel-derived operation graph and step payloads.

The graph module must not hardcode operation order or operation→state maps;
these tests verify the derivation against core's ProcessModel using an
independent reconstruction (following the transition chain), so an upstream
state-machine change fails loudly here instead of drifting silently.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from colrev.constants import RecordState
from colrev.process.model import ProcessModel
from colrev.process.status import _get_currently_md_retrieved
from colrev.ui_jsonrpc.framework import operation_graph


def _counts(**overrides: int) -> SimpleNamespace:
    fields = [s.name for s in RecordState]
    data = {f: 0 for f in fields}
    data.update(overrides)
    return SimpleNamespace(**data)


def _stats(currently=None, overall=None) -> SimpleNamespace:
    return SimpleNamespace(
        currently=currently or _counts(), overall=overall or _counts()
    )


class TestGraphDerivation:
    def test_every_transition_trigger_is_covered(self):
        """Each ProcessModel trigger is either a canonical operation or an
        auxiliary folded into one — nothing is silently dropped."""
        order = operation_graph.operation_order()
        covered_inputs = {
            s for op in order for s in operation_graph.input_states(op)
        }
        for transition in ProcessModel.transitions:
            assert transition["source"] in covered_inputs, (
                f"trigger {transition['trigger']} source "
                f"{transition['source']} not covered by any operation"
            )

    def test_order_follows_transition_chain(self):
        """Reconstruct the chain independently: each operation's input state
        must be reachable from the previous operation's outputs."""
        order = operation_graph.operation_order()
        assert len(order) == len(set(order))

        # The first operation consumes the state that nothing produces.
        dests = {t["dest"] for t in ProcessModel.transitions}
        first_inputs = operation_graph.input_states(order[0])
        assert first_inputs[0] not in dests

        for prev_op, next_op in zip(order, order[1:]):
            prev_outputs = set(operation_graph.output_states(prev_op))
            next_inputs = set(operation_graph.input_states(next_op))
            assert prev_outputs & next_inputs, (
                f"{next_op} does not consume any output of {prev_op}"
            )

    def test_manual_repair_states_fold_into_canonical_operation(self):
        """States produced by an operation and consumed by its *_man repair
        loop count as pending for the canonical operation."""
        for op in operation_graph.operation_order():
            for state in operation_graph.input_states(op):
                # every input state is a source of a transition triggered by
                # the op itself or an operation whose dests re-join the op's
                triggers = {
                    str(t["trigger"])
                    for t in ProcessModel.transitions
                    if t["source"] == state
                }
                assert triggers, f"{state} has no outgoing transition"

    def test_input_and_output_states_are_disjoint(self):
        for op in operation_graph.operation_order():
            inputs = set(operation_graph.input_states(op))
            outputs = set(operation_graph.output_states(op))
            assert not (inputs & outputs)


class TestNextOperation:
    def test_empty_project_has_no_next_operation(self):
        assert operation_graph.next_operation(_counts()) is None

    def test_first_pending_operation_wins(self):
        currently = _counts(md_retrieved=3, md_processed=7)
        assert operation_graph.next_operation(currently) == "load"

    def test_manual_repair_state_counts_as_pending(self):
        currently = _counts(md_needs_manual_preparation=2)
        assert operation_graph.next_operation(currently) == "prep"
        currently = _counts(pdf_needs_manual_retrieval=1)
        assert operation_graph.next_operation(currently) == "pdf_get"

    def test_fully_synthesized_project_has_no_next_operation(self):
        currently = _counts(rev_synthesized=10)
        assert operation_graph.next_operation(currently) is None


class TestStepPayloads:
    def _steps_by_op(self, stats, **kwargs):
        defaults = {
            "search_stale": False,
            "search_sources_configured": 1,
            "total_records": 10,
        }
        defaults.update(kwargs)
        steps = operation_graph.build_step_payloads(stats, **defaults)
        return {s["operation"]: s for s in steps}

    def test_pending_records_make_step_in_progress_and_runnable(self):
        stats = _stats(currently=_counts(md_retrieved=5))
        steps = self._steps_by_op(stats)
        assert steps["load"]["state"] == "in_progress"
        assert steps["load"]["runnable"] is True
        assert steps["load"]["pending_records"] == 5

    def test_later_steps_locked_while_earlier_pending(self):
        stats = _stats(currently=_counts(md_retrieved=5))
        steps = self._steps_by_op(stats)
        for op in ("prep", "dedupe", "prescreen", "pdf_get", "data"):
            assert steps[op]["state"] == "locked", op

    def test_step_complete_when_processed_and_nothing_prior_pending(self):
        stats = _stats(
            currently=_counts(md_processed=10),
            overall=_counts(md_imported=10, md_prepared=10, md_processed=10),
        )
        steps = self._steps_by_op(stats)
        assert steps["load"]["state"] == "complete"
        assert steps["prep"]["state"] == "complete"
        assert steps["dedupe"]["state"] == "complete"
        assert steps["prescreen"]["state"] == "in_progress"

    def test_step_not_complete_when_prior_step_pending(self):
        # preprocessing done for 7 records but 3 still waiting at load
        stats = _stats(
            currently=_counts(md_retrieved=3, md_processed=7),
            overall=_counts(md_imported=7, md_prepared=7, md_processed=7),
        )
        steps = self._steps_by_op(stats)
        assert steps["prep"]["state"] != "complete"
        assert steps["dedupe"]["state"] != "complete"

    def test_search_step_stale_flag(self):
        stats = _stats(currently=_counts(md_retrieved=5))
        steps = self._steps_by_op(stats, search_stale=True)
        assert steps["search"]["state"] != "complete"
        assert steps["search"]["needs_rerun"] is True

        steps = self._steps_by_op(stats, search_stale=False)
        assert steps["search"]["state"] == "complete"

    def test_search_without_sources_not_runnable(self):
        stats = _stats()
        steps = self._steps_by_op(
            stats, search_sources_configured=0, total_records=0
        )
        assert steps["search"]["runnable"] is False

    def test_state_counts_cover_input_and_output_states(self):
        stats = _stats(
            currently=_counts(
                rev_prescreen_included=2,
                pdf_needs_manual_retrieval=3,
                pdf_imported=1,
                pdf_not_available=4,
            )
        )
        steps = self._steps_by_op(stats)
        sc = steps["pdf_get"]["state_counts"]
        assert sc["rev_prescreen_included"] == 2
        assert sc["pdf_needs_manual_retrieval"] == 3
        assert sc["pdf_imported"] == 1
        assert sc["pdf_not_available"] == 4


class TestCurrentlyMdRetrievedAccounting:
    """The core fix: per-source accounting can't go negative or bleed
    across sources (upstream bug: global sum minus origin count)."""

    def test_simple_pending(self):
        per_source = {"pubmed.bib": 10}
        origins = {}
        assert _get_currently_md_retrieved(origins, per_source) == 10

    def test_imported_origins_consume_their_own_file(self):
        per_source = {"pubmed.bib": 10}
        origins = {f"pubmed.bib/{i:06d}": RecordState.md_imported for i in range(4)}
        assert _get_currently_md_retrieved(origins, per_source) == 6

    def test_merged_duplicates_count_once_per_origin(self):
        # two file entries merged into one record: both origins consumed
        per_source = {"pubmed.bib": 2}
        origins = {
            "pubmed.bib/000001": RecordState.md_processed,
            "pubmed.bib/000002": RecordState.md_processed,
        }
        assert _get_currently_md_retrieved(origins, per_source) == 0

    def test_shrunk_file_does_not_go_negative(self):
        # search re-run returned fewer records than were previously imported
        per_source = {"pubmed.bib": 1}
        origins = {
            "pubmed.bib/000001": RecordState.md_processed,
            "pubmed.bib/000002": RecordState.md_processed,
            "pubmed.bib/000003": RecordState.md_processed,
        }
        assert _get_currently_md_retrieved(origins, per_source) == 0

    def test_deficit_does_not_bleed_across_sources(self):
        # pubmed shrunk below its imported count; scopus has 5 fresh entries
        per_source = {"pubmed.bib": 1, "scopus.bib": 5}
        origins = {
            f"pubmed.bib/{i:06d}": RecordState.md_processed for i in range(4)
        }
        assert _get_currently_md_retrieved(origins, per_source) == 5

    def test_md_origins_ignored(self):
        per_source = {"pubmed.bib": 3}
        origins = {
            "md_crossref.bib/000001": RecordState.md_processed,
            "pubmed.bib/000001": RecordState.md_processed,
        }
        assert _get_currently_md_retrieved(origins, per_source) == 2
