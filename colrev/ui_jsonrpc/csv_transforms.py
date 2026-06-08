"""CSV source templates for transforming database exports to standard field names.

Each template defines column mappings and value transforms for a specific
database export format (e.g., OpenAlex, Scopus). The frontend presents these
as a dropdown so the user explicitly picks their source.

The transform reads the source CSV and outputs **BibTeX** format. This avoids
the pandas NaN problem (pd.read_csv converts empty cells to float NaN, which
crashes quality-model checkers that expect strings). BibTeX simply omits empty
fields, so only fields with actual data are included.

To add a new source, add an entry to CSV_SOURCE_TEMPLATES with:
    - label: Display name for the dropdown
    - column_map: {original_column: standard_field_name}
    - value_transforms: {standard_field_name: callable} for post-rename transforms
"""

from __future__ import annotations

import csv
import logging
from io import StringIO
from typing import Any, Callable, Dict, List

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Template registry
# ---------------------------------------------------------------------------
#
# OpenAlex previously shipped a CSV-upload template here. It was removed once
# the OpenAlex API connector landed (see open_alex_query_builder). The generic
# transform machinery below is retained for future database export templates;
# the registry is intentionally empty until one is added.

CSV_SOURCE_TEMPLATES: Dict[str, Dict[str, Any]] = {}


# ---------------------------------------------------------------------------
# BibTeX helpers
# ---------------------------------------------------------------------------

def _escape_bibtex(value: str) -> str:
    """Escape characters that are special in BibTeX values."""
    # Wrap in braces to protect case and special chars
    return value.replace("{", r"\{").replace("}", r"\}")


def _make_bibtex_id(record: Dict[str, str], index: int) -> str:
    """Generate a BibTeX citation key from a record."""
    # Use OpenAlex ID if available, otherwise fallback to index
    openalex_id = record.get("colrev.open_alex.id", "")
    if openalex_id:
        return openalex_id
    return str(index + 1).zfill(6)


def _records_to_bibtex(records: List[Dict[str, str]]) -> str:
    """Convert a list of record dicts to a BibTeX string.

    Each record dict has standard CoLRev field names.
    The 'ENTRYTYPE' and 'ID' keys are used for the entry header.
    All other non-empty fields are written as BibTeX fields.
    Empty values are simply omitted (no NaN issues).
    """
    lines: List[str] = []

    for i, record in enumerate(records):
        entrytype = record.pop("ENTRYTYPE", "misc")
        record_id = _make_bibtex_id(record, i)

        lines.append(f"@{entrytype}{{{record_id},")

        for key, value in record.items():
            if not value:
                continue
            escaped = _escape_bibtex(value)
            lines.append(f"  {key} = {{{escaped}}},")

        lines.append("}")
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_available_templates() -> List[Dict[str, str]]:
    """Return the list of available CSV source templates for the frontend dropdown."""
    return [
        {"id": template_id, "label": template["label"]}
        for template_id, template in CSV_SOURCE_TEMPLATES.items()
    ]


def transform_csv(content: str, template_id: str) -> str:
    """Transform a CSV string to BibTeX using the named source template.

    Reads the source CSV, maps columns and values according to the template,
    and outputs BibTeX format. BibTeX is used instead of CSV to avoid the
    pandas NaN problem (pd.read_csv converts empty cells to float NaN).

    Args:
        content: Raw CSV file content as a string.
        template_id: Key into CSV_SOURCE_TEMPLATES (e.g. "openalex").

    Returns:
        BibTeX-formatted string with standardised field names and values.

    Raises:
        ValueError: If template_id is not found in the registry.
    """
    if template_id not in CSV_SOURCE_TEMPLATES:
        raise ValueError(
            f"Unknown CSV source template '{template_id}'. "
            f"Available: {list(CSV_SOURCE_TEMPLATES.keys())}"
        )

    template = CSV_SOURCE_TEMPLATES[template_id]
    column_map: Dict[str, str] = template["column_map"]
    value_transforms: Dict[str, Callable[[str], str]] = template.get(
        "value_transforms", {}
    )

    reader = csv.DictReader(StringIO(content))
    if reader.fieldnames is None:
        return content  # empty file

    # Only map columns that exist in the source file
    source_columns = [c for c in reader.fieldnames if c in column_map]

    records: List[Dict[str, str]] = []
    for row in reader:
        new_record: Dict[str, str] = {}
        for src_col in source_columns:
            target_col = column_map[src_col]
            value = row.get(src_col, "")
            if not value:
                continue  # skip empty values entirely
            # Apply value transform if registered
            transform = value_transforms.get(target_col)
            if transform:
                value = transform(value)
            if value:  # skip if transform produced empty
                new_record[target_col] = value
        if not new_record:
            continue

        openalex_id = new_record.get("colrev.open_alex.id")
        if openalex_id:
            new_record["openalex_id"] = openalex_id

        records.append(new_record)

    return _records_to_bibtex(records)
