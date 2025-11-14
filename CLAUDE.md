# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CoLRev is an open-source environment for collaborative literature reviews. It integrates with different synthesis tools, manages data quality, and facilitates Git-based collaboration. The project supports all literature review steps: problem formulation, search, dedupe, prescreen/screen, PDF retrieval/preparation, and synthesis.

**Technology Stack:**
- Python 3.10-3.12 (no 3.13 support yet due to lingua-language-detector)
- CLI-based tool using Click
- Git-based workflow with pre-commit hooks
- Extensible package architecture (100+ packages)
- Uses `uv` for dependency management
- Pydantic for settings validation

## Development Setup

Install for development:
```bash
uv venv
uv pip install --editable .
```

Install development dependencies:
```bash
uv pip install --editable ".[dev]"
```

## Common Commands

### Testing

Run all tests:
```bash
pytest
```

Run a specific test module:
```bash
pytest tests/0_core/record_test.py
```

Run a specific test method:
```bash
pytest tests/0_core/record_test.py -k "test_update_metadata_status"
```

Generate coverage report:
```bash
coverage run -m pytest
coverage html
coverage-badge -o tests/coverage.svg
```

Check slow tests:
```bash
pytest --durations=5
```

Test with custom basetemp (if cross-device link errors occur):
```bash
pytest --basetemp=<a_path_inside_your_home_folder>
```

### Linting and Formatting

Run all pre-commit hooks:
```bash
pre-commit run -a
```

The project uses:
- `black` for code formatting
- `flake8` for linting (max line length: 110)
- `pylint` with custom CoLRev-specific plugins
- `mypy` for type checking (Python 3.12)
- `autoflake` for removing unused imports
- `reorder-python-imports` for import sorting

### Building Documentation

Generate docs:
```bash
cd docs
make html
```

Check for broken links:
```bash
make linkcheck
# Review docs/build/linkcheck/output.txt
```

## Architecture

### Core Components

**ReviewManager** (`colrev/review_manager.py`)
- Central interface for managing CoLRev projects
- Handles initialization, configuration, logging, and dataset access
- Entry point for all operations

**Settings** (`colrev/settings.py`)
- Uses Pydantic models for configuration validation
- Contains ProjectSettings, Author, Protocol, and package-specific settings
- All settings classes kept in one file for performance (loading settings is critical path)

**Record** (`colrev/record/record.py`)
- Base class for bibliography records
- Handles record data, metadata status, quality checks
- Extensions: PrepRecord, PDFRecord, RecordSimilarity, RecordMerger

**Dataset** (`colrev/dataset.py`)
- Manages the records dataset
- Handles loading, saving, and validation of record data

**Operations** (`colrev/ops/`)
- Each operation is a separate module (e.g., `search.py`, `prep.py`, `dedupe.py`, `screen.py`)
- Operations follow the literature review workflow:
  - `init.py` - Initialize new review project
  - `search.py` - Search for papers
  - `load.py` - Load search results
  - `prep.py` - Prepare/clean metadata
  - `dedupe.py` - Deduplicate records
  - `prescreen.py` - Initial screening
  - `pdf_get.py` - Retrieve PDFs
  - `pdf_prep.py` - Prepare/validate PDFs
  - `screen.py` - Full-text screening
  - `data.py` - Data extraction and synthesis

### Package System

CoLRev uses an extensible package architecture with base classes in `colrev/package_manager/package_base_classes.py`:

**Package Types:**
- `ReviewTypePackageBaseClass` - Different review methodologies
- `SearchSourcePackageBaseClass` - Data source integrations (APIs, databases)
- `PrepPackageBaseClass` - Metadata preparation
- `DedupePackageBaseClass` - Deduplication strategies
- `PrescreenPackageBaseClass` - Prescreen implementations
- `PDFGetPackageBaseClass` - PDF retrieval methods
- `PDFPrepPackageBaseClass` - PDF preparation
- `ScreenPackageBaseClass` - Screen implementations
- `DataPackageBaseClass` - Data extraction and synthesis

All packages are located in `colrev/packages/`, with 100+ built-in packages.

### Data Flow

1. **Search Sources** → `data/search/` (search files)
2. **Load** → `data/records.bib` (main dataset)
3. **Prep** → Quality checks, metadata cleanup
4. **Dedupe** → Merge duplicates
5. **Prescreen/Screen** → Inclusion decisions
6. **PDF Get/Prep** → `data/pdfs/` with quality checks
7. **Data** → Synthesis outputs

### Important Directories

- `colrev/` - Core library code
  - `ops/` - Operation implementations
  - `packages/` - 100+ built-in packages
  - `record/` - Record handling and quality model
  - `loader/` - File format parsers (BibTeX, RIS, ENL, NBIB, etc.)
  - `env/` - Environment management (local index, GROBID, language detection)
  - `ui_cli/` - CLI interface
  - `package_manager/` - Package discovery and management
  - `linter/` - Custom pylint plugins for CoLRev conventions

- `tests/` - Test suite organized by component
  - `0_core/` - Core functionality
  - `0_record/` - Record operations
  - `1_env/` - Environment tests
  - `2_loader/` - Loader tests
  - `3_packages_search/` - Search package tests
  - `conftest.py` - Shared test fixtures

- `docs/` - Sphinx documentation

## Coding Standards

**Variable Naming:**
- Use named parameters over positional parameters
- `record` for `colrev.record.record.Record` instances
- `record_dict` for dictionary representations
- Variable names should indicate type when needed to avoid ambiguity

**Custom Pylint Rules:**
The project includes custom linters in `colrev/linter/`:
- `colrev_direct_status_assign.py` - Enforces proper status transitions
- `colrev_missed_constant_usage.py` - Ensures constants are used instead of magic strings
- `colrev_records_variable_naming_convention.py` - Enforces record variable naming
- `colrev_search_source_requests_import.py` - Ensures proper requests import for search sources

**Status Management:**
- Records have a `colrev_status` field tracking their state
- Don't assign status directly; use proper transition methods
- States flow through: md_imported → md_prepared → md_processed → rev_excluded/rev_included/rev_synthesized

**Constants:**
- Use constants from `colrev/constants.py` instead of hardcoded strings
- Common constants: `Fields`, `ENTRYTYPES`, `RecordState`, `FieldSet`, `DefectCodes`

## Git Workflow

The project uses Git extensively for collaboration and reproducibility:
- All operations create Git commits automatically
- Pre-commit hooks ensure code quality (`colrev-hooks-*`)
- Each record change is tracked through Git history
- Use `colrev trace` to view record history

## Testing Notes

- Tests use `conf.run_around_tests()` to restore repository state after each test
- For debugging, you can temporarily disable the cleanup
- Use iterative testing with chained commands:
  ```bash
  git reset --hard <commit> && colrev prep && gitk
  ```

## Package Development

When creating new packages:
1. Packages live in `colrev/packages/<package_name>/`
2. Must implement the appropriate base class from `package_base_classes.py`
3. Include `CURRENT_SYNTAX_VERSION` for search sources
4. Define `ci_supported` flag
5. Use custom scripts in `colrev/ops/custom_scripts/` as templates

## Performance Considerations

- Settings parsing is performance-critical (all in one file)
- Record instantiation should be lightweight (avoid parsing on init)
- Records must be pickle-able for multiprocessing
- Use `review_manager.high_level_operation` flag for output formatting
