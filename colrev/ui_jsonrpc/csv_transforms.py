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
import re
from io import StringIO
from typing import Any, Callable, Dict, List

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# OpenAlex value transform helpers
# ---------------------------------------------------------------------------

def _openalex_author(value: str) -> str:
    """Convert pipe-separated authors to 'and'-separated."""
    if not value:
        return value
    return " and ".join(a.strip() for a in value.split("|") if a.strip())


def _strip_doi_prefix(value: str) -> str:
    if not value:
        return value
    for prefix in ("https://doi.org/", "http://doi.org/"):
        if value.startswith(prefix):
            return value[len(prefix):]
    return value


def _strip_pubmed_prefix(value: str) -> str:
    if not value:
        return value
    prefix = "https://pubmed.ncbi.nlm.nih.gov/"
    if value.startswith(prefix):
        return value[len(prefix):].rstrip("/")
    return value


def _strip_openalex_prefix(value: str) -> str:
    if not value:
        return value
    prefix = "https://openalex.org/"
    if value.startswith(prefix):
        return value[len(prefix):]
    return value


OPENALEX_ENTRYTYPE_MAP = {
    "article": "article",
    "review": "article",
    "book": "book",
    "book-chapter": "inbook",
    "proceedings-article": "inproceedings",
    "dissertation": "phdthesis",
    "report": "techreport",
    "preprint": "article",
    "editorial": "article",
    "letter": "article",
    "erratum": "article",
    "paratext": "misc",
    "peer-review": "misc",
    "dataset": "misc",
}


def _openalex_entrytype(value: str) -> str:
    if not value:
        return "misc"
    return OPENALEX_ENTRYTYPE_MAP.get(value.lower().strip(), "misc")


# ---------------------------------------------------------------------------
# Template registry
# ---------------------------------------------------------------------------

CSV_SOURCE_TEMPLATES: Dict[str, Dict[str, Any]] = {
    "openalex": {
        "label": "OpenAlex",
        "column_map": {
            "display_name": "title",
            "authorships.author.display_name": "author",
            "primary_location.source.display_name": "journal",
            "publication_year": "year",
            "doi": "doi",
            "type": "ENTRYTYPE",
            "cited_by_count": "cited_by",
            "ids.pmid": "colrev.pubmed.pubmedid",
            "language": "language",
            "id": "colrev.open_alex.id",
            "primary_location.source.issn_l": "issn",
            "publication_date": "date",
        },
        "value_transforms": {
            "author": _openalex_author,
            "doi": _strip_doi_prefix,
            "colrev.pubmed.pubmedid": _strip_pubmed_prefix,
            "colrev.open_alex.id": _strip_openalex_prefix,
            "ENTRYTYPE": _openalex_entrytype,
        },
    },
}


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
        records.append(new_record)

    return _records_to_bibtex(records)
