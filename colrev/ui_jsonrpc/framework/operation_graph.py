"""Operation graph derived from core's ProcessModel.

Single source of truth for "what are the pipeline operations, in what
order, and which record states feed / leave each one". Everything here is
computed from ``ProcessModel.transitions`` so an upstream state-machine
change propagates automatically — no hand-maintained operation order or
operation→state maps.

Terminology:

- *canonical* operation: a main pipeline operation (load, prep, dedupe, …).
- *auxiliary* operation: a repair loop attached to a canonical operation
  (prep_man, pdf_get_man, pdf_prep_man). Structurally: its source state is
  produced by the canonical operation and (at least one of) its dest states
  re-joins the canonical operation's dest set. Auxiliary operations are
  folded into their canonical operation for status purposes, which is what
  the UI reflects (e.g. records in ``md_needs_manual_preparation`` still
  count as "pending for prep").

``search`` is not part of ``ProcessModel`` (it produces search-result files,
not record transitions) and is handled by the callers.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any
from typing import Dict
from typing import List
from typing import Optional
from typing import Tuple

from colrev.constants import RecordState
from colrev.process.model import ProcessModel


def _transitions() -> List[dict]:
    return ProcessModel.transitions


@lru_cache(maxsize=1)
def _state_depths() -> Dict[RecordState, int]:
    """Longest-path depth of each state in the transition DAG."""
    transitions = _transitions()
    states = {t["source"] for t in transitions} | {t["dest"] for t in transitions}
    incoming: Dict[RecordState, List[RecordState]] = {s: [] for s in states}
    for t in transitions:
        incoming[t["dest"]].append(t["source"])

    depths: Dict[RecordState, int] = {}

    def depth(state: RecordState, _seen: frozenset = frozenset()) -> int:
        if state in depths:
            return depths[state]
        if state in _seen:  # pragma: no cover - transitions form a DAG
            raise ValueError(f"Cycle in ProcessModel transitions at {state}")
        preds = incoming[state]
        value = 0 if not preds else 1 + max(depth(p, _seen | {state}) for p in preds)
        depths[state] = value
        return value

    for state in states:
        depth(state)
    return depths


@lru_cache(maxsize=1)
def _operation_dests() -> Dict[str, set]:
    dests: Dict[str, set] = {}
    for t in _transitions():
        dests.setdefault(str(t["trigger"]), set()).add(t["dest"])
    return dests


@lru_cache(maxsize=1)
def _operation_sources() -> Dict[str, set]:
    sources: Dict[str, set] = {}
    for t in _transitions():
        sources.setdefault(str(t["trigger"]), set()).add(t["source"])
    return sources


@lru_cache(maxsize=1)
def _auxiliary_map() -> Dict[str, str]:
    """Map auxiliary operation -> its canonical operation."""
    dests = _operation_dests()
    sources = _operation_sources()
    aux: Dict[str, str] = {}
    for op, op_sources in sources.items():
        for other, other_dests in dests.items():
            if other == op:
                continue
            if op_sources <= other_dests and dests[op] & other_dests:
                if op in aux:  # pragma: no cover - would be a model change
                    raise ValueError(
                        f"Operation {op} is auxiliary to both "
                        f"{aux[op]} and {other}"
                    )
                aux[op] = other
    return aux


@lru_cache(maxsize=1)
def operation_order() -> Tuple[str, ...]:
    """Canonical pipeline operations, ordered by their input state's position
    in the transition chain (derived, not hardcoded)."""
    aux = _auxiliary_map()
    sources = _operation_sources()
    depths = _state_depths()
    canonical = [op for op in sources if op not in aux]
    canonical.sort(key=lambda op: min(depths[s] for s in sources[op]))
    return tuple(canonical)


@lru_cache(maxsize=1)
def _input_states_map() -> Dict[str, Tuple[RecordState, ...]]:
    """Canonical operation -> record states pending for it (its own source
    states plus the source states of its auxiliary repair operations)."""
    aux = _auxiliary_map()
    sources = _operation_sources()
    depths = _state_depths()
    result: Dict[str, Tuple[RecordState, ...]] = {}
    for op in operation_order():
        states = set(sources[op])
        for aux_op, canonical in aux.items():
            if canonical == op:
                states |= sources[aux_op]
        result[op] = tuple(sorted(states, key=lambda s: (depths[s], s.name)))
    return result


@lru_cache(maxsize=1)
def _output_states_map() -> Dict[str, Tuple[RecordState, ...]]:
    """Canonical operation -> record states it forwards records into
    (dest states of the operation and its auxiliaries, minus states that are
    inputs of the same operation, i.e. minus internal repair states)."""
    aux = _auxiliary_map()
    dests = _operation_dests()
    depths = _state_depths()
    inputs = _input_states_map()
    result: Dict[str, Tuple[RecordState, ...]] = {}
    for op in operation_order():
        states = set(dests[op])
        for aux_op, canonical in aux.items():
            if canonical == op:
                states |= dests[aux_op]
        states -= set(inputs[op])
        result[op] = tuple(sorted(states, key=lambda s: (depths[s], s.name)))
    return result


def input_states(operation: str) -> Tuple[RecordState, ...]:
    """Record states pending for a canonical operation."""
    return _input_states_map()[operation]


def output_states(operation: str) -> Tuple[RecordState, ...]:
    """Record states a canonical operation forwards records into."""
    return _output_states_map()[operation]


def _count(counts: Any, state: RecordState) -> int:
    return int(getattr(counts, state.name, 0) or 0)


def pending_count(operation: str, currently: Any) -> int:
    """Records currently waiting for a canonical operation."""
    return sum(_count(currently, s) for s in input_states(operation))


def processed_count(operation: str, currently: Any) -> int:
    """Records currently sitting in the operation's forward-output states."""
    return sum(_count(currently, s) for s in output_states(operation))


def processed_ever_count(operation: str, overall: Any) -> int:
    """Records that have ever passed through the operation."""
    return sum(_count(overall, s) for s in output_states(operation))


def next_operation(currently: Any) -> Optional[str]:
    """First pipeline operation with pending records, in derived order."""
    for op in operation_order():
        if pending_count(op, currently) > 0:
            return op
    return None


def prior_operation(operation: str) -> Optional[str]:
    """The canonical operation immediately before the given one."""
    order = operation_order()
    idx = order.index(operation)
    return order[idx - 1] if idx > 0 else None


def build_step_payloads(
    status_stats: Any,
    *,
    search_stale: bool,
    search_sources_configured: int,
    total_records: int,
) -> List[Dict[str, Any]]:
    """Per-step status payload: one entry for ``search`` plus one per
    canonical pipeline operation. This (plus the raw counts already in the
    status payload) is everything the UI needs to render step status.

    ``state`` semantics:
    - ``in_progress``: records are currently pending for this operation
    - ``complete``: nothing pending, records have passed through, and no
      earlier operation still has pending records
    - ``ready``: nothing has ever passed through, but the operation's inputs
      could arrive next (the immediately prior operation is complete)
    - ``locked``: earlier pipeline work has not reached this operation yet
    """
    currently = status_stats.currently
    overall = status_stats.overall

    steps: List[Dict[str, Any]] = []

    # -- search (not part of ProcessModel) ---------------------------------
    search_runnable = search_sources_configured > 0
    search_complete = search_runnable and not search_stale and total_records > 0
    steps.append(
        {
            "operation": "search",
            "state": "complete" if search_complete else (
                "in_progress" if total_records > 0 else "ready"
            ),
            "runnable": search_runnable,
            "reason": None if search_runnable else "No search sources configured",
            "needs_rerun": search_stale,
            "needs_rerun_reason": "Search sources are stale" if search_stale else None,
            "pending_records": 0,
            "processed_records": _count(currently, RecordState.md_retrieved),
            "processed_ever": _count(overall, RecordState.md_retrieved),
            "input_states": [],
            "output_states": [RecordState.md_retrieved.name],
            "state_counts": {
                RecordState.md_retrieved.name: _count(
                    currently, RecordState.md_retrieved
                )
            },
        }
    )

    prior_pending = False
    for op in operation_order():
        pending = pending_count(op, currently)
        processed = processed_count(op, currently)
        ever = processed_ever_count(op, overall)

        if pending > 0:
            state = "in_progress"
        elif ever > 0 and not prior_pending:
            state = "complete"
        elif prior_pending or ever == 0 and total_records == 0:
            state = "locked"
        else:
            state = "ready"

        prior = prior_operation(op)
        if pending > 0:
            reason = None
        elif prior is None:
            reason = f"No records ready for {op} (run search first)"
        else:
            reason = f"No records ready for {op} (run {prior} first)"

        state_counts = {
            s.name: _count(currently, s)
            for s in (*input_states(op), *output_states(op))
        }

        steps.append(
            {
                "operation": op,
                "state": state,
                "runnable": pending > 0,
                "reason": reason,
                "needs_rerun": pending > 0,
                "needs_rerun_reason": (
                    f"{pending} record(s) pending for {op}" if pending > 0 else None
                ),
                "pending_records": pending,
                "processed_records": processed,
                "processed_ever": ever,
                "input_states": [s.name for s in input_states(op)],
                "output_states": [s.name for s in output_states(op)],
                "state_counts": state_counts,
            }
        )
        prior_pending = prior_pending or pending > 0

    return steps
