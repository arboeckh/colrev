"""OpenAlex CSV transform behaviour tests."""

from __future__ import annotations

from colrev.ui_jsonrpc.csv_transforms import transform_csv

LEGACY_CSV = """\
id,doi,display_name,authorships.author.display_name,publication_year,type,primary_location.source.display_name,cited_by_count
https://openalex.org/W123,https://doi.org/10.1000/test,Legacy Title,Alice A|Bob B,2023,article,Test Journal,42
"""

HUMAN_READABLE_CSV = """\
Title,Author,Year,DOI,Type,Source,Citation count,Abstract,ID
Phase 3 Trial,Alice A|Bob B,2023,https://doi.org/10.1056/example,article,New England Journal of Medicine,618,A trial abstract.,https://openalex.org/W4323293924
"""

EMPTY_ROW_CSV = """\
Title,Author,Year,ID
,,,
Real Title,Author One,2024,https://openalex.org/W999
"""


def test_legacy_openalex_csv_maps_title_and_authors() -> None:
    bib = transform_csv(LEGACY_CSV, "openalex")
    assert "Legacy Title" in bib
    assert "Alice A and Bob B" in bib
    assert "Test Journal" in bib
    assert "cited_by = {42}" in bib


def test_human_readable_openalex_csv_maps_metadata() -> None:
    bib = transform_csv(HUMAN_READABLE_CSV, "openalex")
    assert "Phase 3 Trial" in bib
    assert "Alice A and Bob B" in bib
    assert "New England Journal of Medicine" in bib
    assert "cited_by = {618}" in bib
    assert "A trial abstract." in bib
    assert "10.1056/example" in bib
    assert "W4323293924" in bib


def test_empty_rows_are_skipped() -> None:
    bib = transform_csv(EMPTY_ROW_CSV, "openalex")
    assert bib.count("@") == 1
    assert "Real Title" in bib
