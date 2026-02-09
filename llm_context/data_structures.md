# CoLRev Data Structures & JSON-RPC Reference

This document provides a comprehensive reference for the data structures used in CoLRev and documents the JSON-RPC endpoint implementations.

---

## 1. Core Data Structures

### 1.1 RecordState Enum (`colrev/constants.py`)

The workflow state machine with 15 states:

```
md_retrieved (1)     → Retrieved, stored in ./search directory
md_imported (2)      → Imported into records.bib
md_needs_manual_preparation (3) → Requires manual fixes
md_prepared (4)      → Prepared, fields validated
md_processed (5)     → Dedupe checked
rev_prescreen_excluded (6)   → Excluded in prescreen
rev_prescreen_included (7)   → Included in prescreen
pdf_needs_manual_retrieval (8)  → Manual PDF retrieval needed
pdf_imported (9)     → PDF imported
pdf_not_available (10)    → No PDF available
pdf_needs_manual_preparation (11) → PDF needs manual work
pdf_prepared (12)    → PDF prepared/validated
rev_excluded (13)    → Excluded in full-text screen
rev_included (14)    → Included in full-text screen
rev_synthesized (15) → Data synthesized
```

**State Transitions by Operation**:
- **Load**: `md_retrieved` → `md_imported` or `md_needs_manual_preparation`
- **Prep**: `md_imported` → `md_prepared` or `md_needs_manual_preparation`
- **Dedupe**: `md_prepared` → `md_processed`
- **Prescreen**: `md_processed` → `rev_prescreen_included` or `rev_prescreen_excluded`
- **PDF Get**: `rev_prescreen_included` → `pdf_imported`, `pdf_not_available`, or `pdf_needs_manual_retrieval`
- **PDF Prep**: `pdf_imported` → `pdf_prepared` or `pdf_needs_manual_preparation`
- **Screen**: `pdf_prepared` → `rev_included` or `rev_excluded`
- **Data**: `rev_included` → `rev_synthesized`

### 1.2 Fields Constants (`colrev/constants.py`)

**Core Fields**:
```python
ID = "ID"
ENTRYTYPE = "ENTRYTYPE"
```

**Provenance Fields**:
```python
MD_PROV = "colrev_masterdata_provenance"  # Identifying field provenance
D_PROV = "colrev_data_provenance"         # Data field provenance
ORIGIN = "colrev_origin"                   # Source origins (list)
STATUS = "colrev_status"                   # RecordState enum
PDF_ID = "colrev_pdf_id"                   # PDF identifier
```

**Identifying Fields** (tracked in masterdata provenance):
```python
TITLE, AUTHOR, YEAR, JOURNAL, BOOKTITLE, CHAPTER,
PUBLISHER, VOLUME, NUMBER, PAGES, EDITOR, INSTITUTION
```

**External Identifiers**:
```python
DOI, URL, ISSN, ISBN, PUBMED_ID, DBLP_KEY, SEMANTIC_SCHOLAR_ID, WEB_OF_SCIENCE_ID
```

**Screening Fields**:
```python
SCREENING_CRITERIA = "screening_criteria"   # Format: "criterion1=in;criterion2=out"
PRESCREEN_EXCLUSION = "prescreen_exclusion"
```

### 1.3 Field Sets (`colrev/constants.py`)

```python
PROVENANCE_KEYS = [MD_PROV, D_PROV, ORIGIN, STATUS, PDF_ID]

IDENTIFYING_FIELD_KEYS = [TITLE, AUTHOR, YEAR, JOURNAL, BOOKTITLE,
                          CHAPTER, PUBLISHER, VOLUME, NUMBER, PAGES,
                          EDITOR, INSTITUTION]

MASTERDATA = IDENTIFYING_FIELD_KEYS + [CURATED]

NO_PROVENANCE = PROVENANCE_KEYS + [ID, ENTRYTYPE, COLREV_ID,
                                    METADATA_SOURCE_REPOSITORY_PATHS]

LIST_FIELDS = [ORIGIN]  # Stored as newline-separated
```

### 1.4 Entry Types (`colrev/constants.py`)

```python
ARTICLE, INPROCEEDINGS, BOOK, INBOOK, PROCEEDINGS, INCOLLECTION,
PHDTHESIS, THESIS, MASTERSTHESIS, BACHELORTHESIS, TECHREPORT,
UNPUBLISHED, MISC, SOFTWARE, ONLINE, CONFERENCE
```

**Field Requirements per Entry Type**:
```python
ARTICLE: [AUTHOR, TITLE, JOURNAL, YEAR, VOLUME, NUMBER]
INPROCEEDINGS: [AUTHOR, TITLE, BOOKTITLE, YEAR]
BOOK: [AUTHOR, TITLE, PUBLISHER, YEAR]
# ... etc
```

### 1.5 Search Types (`colrev/constants.py`)

```python
API = "API"           # Keyword-based API searches
DB = "DB"             # Database with query
TOC = "TOC"           # Table of contents
BACKWARD_SEARCH       # Citation backward search
FORWARD_SEARCH        # Citation forward search
FILES = "FILES"       # Import from files
OTHER = "OTHER"       # Other sources
MD = "MD"             # Metadata source
```

### 1.6 Defect Codes (`colrev/constants.py`)

Quality issue codes for metadata:
```python
MISSING, INCONSISTENT_WITH_ENTRYTYPE, INCONSISTENT_CONTENT,
INCOMPLETE_FIELD, HTML_TAGS, MOSTLY_ALL_CAPS, NAME_ABBREVIATED,
YEAR_FORMAT, DOI_NOT_MATCHING_PATTERN, ISBN_NOT_MATCHING_PATTERN,
LANGUAGE_FORMAT_ERROR, PAGE_RANGE, RECORD_NOT_IN_TOC, ...
```

---

## 2. Record Data Structure

### 2.1 Complete Record Dictionary

```python
{
    # Identity
    "ID": "Smith2020",
    "ENTRYTYPE": "article",

    # CoLRev Status
    "colrev_status": RecordState.md_prepared,
    "colrev_origin": ["pubmed.bib/Smith2020", "crossref.bib/Smith2020"],
    "colrev_pdf_id": "data/pdfs/Smith2020.pdf",

    # Provenance Tracking
    "colrev_masterdata_provenance": {
        "title": {"source": "pubmed.bib/Smith2020", "note": ""},
        "author": {"source": "crossref.bib/Smith2020", "note": "name-abbreviated"},
        "CURATED": {"source": "manual-curation", "note": ""}
    },
    "colrev_data_provenance": {
        "abstract": {"source": "pubmed.bib/Smith2020", "note": ""},
        "keywords": {"source": "scopus.bib/Smith2020", "note": ""}
    },

    # Bibliographic Metadata
    "title": "Paper Title",
    "author": "Smith, John and Doe, Jane",
    "year": "2020",
    "journal": "Journal Name",
    "volume": "45",
    "number": "3",
    "pages": "1309-1348",
    "doi": "10.1234/example.2020",
    "abstract": "...",
    "keywords": "keyword1, keyword2",

    # Screening (optional)
    "screening_criteria": "criterion1=in;criterion2=out"
}
```

### 2.2 Provenance Structure

Each field in `colrev_masterdata_provenance` or `colrev_data_provenance`:
```python
{
    "source": "filename/RecordID",  # e.g., "pubmed.bib/Smith2020"
    "note": ""                       # DefectCode or "IGNORE:code" or ""
}
```

### 2.3 Origin Format

List of source references:
```python
["pubmed.bib/Smith2020", "crossref.bib/Smith2020"]
```

---

## 3. Search File Structure

### 3.1 ExtendedSearchFile (`colrev/search_file.py`)

```python
{
    "platform": "colrev.pubmed",
    "search_string": "diabetes AND treatment",
    "search_results_path": "data/search/pubmed.bib",
    "search_type": "API",
    "version": "1.0",
    "search_parameters": {
        "url": "https://eutils.ncbi.nlm.nih.gov/..."
    }
}
```

Stored as: `data/search/<source>_search_history.json`

---

## 4. Settings Structure (`colrev/settings.py`)

### 4.1 Main Settings

```python
Settings:
    project: ProjectSettings
    sources: List[ExtendedSearchFile]
    search: SearchSettings
    prep: PrepSettings
    dedupe: DedupeSettings
    prescreen: PrescreenSettings
    pdf_get: PDFGetSettings
    pdf_prep: PDFPrepSettings
    screen: ScreenSettings
    data: DataSettings
```

### 4.2 Screen Criteria

```python
ScreenCriterion:
    explanation: str
    comment: Optional[str]
    criterion_type: ScreenCriterionType  # inclusion_criterion | exclusion_criterion
```

---

## 5. JSON-RPC Endpoints

### 5.1 Endpoints Inventory (35 total)

| Category | Handler | Endpoints |
|----------|---------|-----------|
| Project | InitHandler | init_project, list_projects, delete_project |
| Status | StatusHandler | ping, get_status, status, validate, get_operation_info |
| Settings | SettingsHandler | get_settings, update_settings |
| Search | SearchHandler | search, get_sources, add_source, update_source, remove_source, upload_search_file, get_source_records |
| Records | RecordsHandler | get_records, get_record, update_record |
| Workflow | LoadHandler, PrepHandler, DedupeHandler, PDFGetHandler, PDFPrepHandler, DataHandler | load, prep, dedupe, pdf_get, pdf_prep, data |
| Screening | PrescreenHandler, ScreenHandler | prescreen, get_prescreen_queue, prescreen_record, screen, get_screen_queue, screen_record |
| Git | GitHandler | get_git_status |

### 5.2 Common Parameters

Most endpoints require:
- `project_id` (required): Project identifier
- `base_path` (optional): Base directory containing project (default: "./projects")
- `skip_commit` (optional): Skip automatic Git commit (default: false)

### 5.3 Error Codes

- `-32000`: COLREV_REPO_SETUP_ERROR
- `-32001`: COLREV_OPERATION_ERROR
- `-32002`: COLREV_SERVICE_NOT_AVAILABLE
- `-32003`: COLREV_MISSING_DEPENDENCY
- `-32004`: COLREV_PARAMETER_ERROR

### 5.4 Response Patterns

**Operations return**:
```json
{
    "success": true,
    "operation": "load",
    "project_id": "my-review",
    "details": { ... }
}
```

**Queries return**:
```json
{
    "success": true,
    "total_count": 150,
    "records": [ ... ],
    "pagination": { "offset": 0, "limit": 50 }
}
```

---

## 6. Protected Fields

The following fields cannot be updated via the `update_record` API:
- `ID`
- `colrev_origin`
- `colrev_masterdata_provenance`
- `colrev_data_provenance`

---

## 7. Verification Summary

The JSON-RPC endpoints are correctly implemented against the core CoLRev data structures:
- ✅ Fields constants usage (all handlers use `Fields.*` constants)
- ✅ RecordState enum handling (proper enum-to-string conversion)
- ✅ Provenance preservation (updates maintain provenance structure)
- ✅ State transition validation (e.g., prescreen verifies `md_processed` state)
- ✅ Protected field enforcement (ID, ORIGIN, MD_PROV, D_PROV)

### Minor API Inconsistencies (Cosmetic)

1. **Pagination styles vary**: Some endpoints use nested `pagination` object, others use flat `limit` parameter
2. **skip_commit support varies**: Not all operation handlers support this parameter
3. **Response formatting varies**: Some use `response_formatter`, others return raw dicts
