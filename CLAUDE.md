# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

This monorepo contains three main components:

```
colrev/
├── colrev/              # Python library - Core CoLRev functionality
├── colrev_jsonrpc/      # Python JSON-RPC server - Bridge between Electron and CoLRev
├── electron-app/        # Electron + Vue.js desktop application
├── scripts/             # Build and utility scripts
├── tests/               # Python test suite
└── docs/                # Sphinx documentation
```

### ColRev is Read Only

It is important not to touch any of the core logic of colrev. Only the json-rpc ui folder can be modified

### Component Overview

| Component         | Language       | Purpose                                                           |
| ----------------- | -------------- | ----------------------------------------------------------------- |
| `colrev/`         | Python         | Core library for literature review operations                     |
| `colrev_jsonrpc/` | Python         | JSON-RPC 2.0 server exposing CoLRev operations via stdio          |
| `electron-app/`   | TypeScript/Vue | Desktop GUI that spawns and communicates with the JSON-RPC server |

## Project Overview

CoLRev is an open-source environment for collaborative literature reviews. It integrates with different synthesis tools, manages data quality, and facilitates Git-based collaboration. The project supports all literature review steps: problem formulation, search, dedupe, prescreen/screen, PDF retrieval/preparation, and synthesis.

**Core Library Technology Stack (colrev/):**

- Python 3.10-3.12 (no 3.13 support yet due to lingua-language-detector)
- CLI-based tool using Click
- Git-based workflow with pre-commit hooks
- Extensible package architecture (100+ packages)
- Uses `uv` for dependency management
- Pydantic for settings validation

**Electron App Technology Stack (electron-app/):**

- Electron 40.x with electron-vite for build tooling
- Vue.js 3.5 with TypeScript
- Tailwind CSS v4 for styling
- shadcn-vue for UI components (based on Reka UI primitives)
- Uses `@` path alias for imports (maps to `src/renderer/`)

**Documentation Lookup:**
When working on the Electron frontend, use Context7 MCP to look up documentation for:

- Tailwind CSS v4 (`/websites/v3_tailwindcss` or `/tailwindlabs/tailwindcss.com`)
- shadcn-vue (`/llmstxt/shadcn-vue_llms-full_txt` or `/unovue/shadcn-vue`)
- Vue.js, Electron, or other libraries as needed

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

**Recommended: Use the Conda Environment**

For persistent development and testing, use the existing conda environment:

```bash
# Activate the colrev environment
conda activate colrev

# If needed, install/update with dev dependencies
pip install -e ".[dev]"

# Now you can run tests anytime with:
conda activate colrev
pytest
```

The conda environment persists across sessions, so you only need to run `conda activate colrev` before testing.

**Alternative: Using uv/venv**

If you prefer not to use conda:

```bash
python3.12 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -e ".[dev]"
```

**Running Tests:**

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

Run JSON-RPC handler tests:

```bash
pytest tests/4_jsonrpc/
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

## Data Structure Quick Reference

For detailed data structure documentation, see `llm_context/data_structures.md`.

### RecordState Workflow

States flow: `md_retrieved` → `md_imported` → `md_prepared` → `md_processed` →
`rev_prescreen_included` → `pdf_imported` → `pdf_prepared` → `rev_included` → `rev_synthesized`

### Key Fields (from `Fields` class in `colrev/constants.py`)

| Category | Fields |
|----------|--------|
| Identity | `ID`, `ENTRYTYPE` |
| Status | `colrev_status`, `colrev_origin`, `colrev_pdf_id` |
| Provenance | `colrev_masterdata_provenance`, `colrev_data_provenance` |
| Bibliographic | `title`, `author`, `year`, `journal`, `booktitle`, `doi`, `abstract` |
| Screening | `screening_criteria` (format: `"criterion1=in;criterion2=out"`) |

### Protected Fields (cannot update via JSON-RPC API)

`ID`, `colrev_origin`, `colrev_masterdata_provenance`, `colrev_data_provenance`

### JSON-RPC Response Patterns

- **Operations**: `{success, operation, project_id, details}`
- **Queries**: `{success, total_count, records, pagination}`
- **Errors**: Codes `-32000` (repo setup), `-32001` (operation), `-32004` (parameter)

---

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

---

## JSON-RPC Server (colrev_jsonrpc/)

The JSON-RPC server provides a bridge between the Electron app and CoLRev Python library.

**Key Files:**

- `colrev_jsonrpc/server.py` - Main JSON-RPC server implementation
- `colrev_jsonrpc/__main__.py` - Entry point for running as module

**Protocol:**

- Uses JSON-RPC 2.0 over stdio (stdin/stdout)
- Electron spawns the server as a child process
- Each request/response is a single JSON line

**Building the Server:**

```bash
# Build standalone executable with PyInstaller
./scripts/build_jsonrpc.sh
```

The built executable is placed in `dist/colrev-jsonrpc` and bundled with the Electron app.

### JSON-RPC Endpoint Development Guidelines

When implementing new JSON-RPC endpoints, follow this structured approach:

**1. Implementation Checklist:**

- [ ] Add endpoint specification to `/Users/ab/.claude/plans/mutable-hopping-willow.md` (implementation spec)
- [ ] Create or update handler in `colrev/ui_jsonrpc/handlers/<category>_handler.py`
- [ ] Add routing in `colrev/ui_jsonrpc/handler.py`
- [ ] Add response formatter in `colrev/ui_jsonrpc/response_formatter.py` if needed
- [ ] Create tests in `tests/4_jsonrpc/test_<category>_handler.py`
- [ ] Document in `docs/source/api/jsonrpc/<category>.rst`

**2. Handler Structure:**
Each handler class follows this pattern:

```python
"""Handler for <category> operations.

JSON-RPC Endpoints:
    - method_name: Brief description
    - another_method: Brief description

See docs/api/jsonrpc/<category>.rst for full endpoint documentation.
"""

class CategoryHandler:
    """Handle <category>-related JSON-RPC methods."""

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        self.review_manager = review_manager

    def method_name(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Full docstring with Args and Returns.

        Args:
            params: Method parameters containing:
                - param1 (type): Description
                - param2 (type, optional): Description

        Returns:
            Dict containing:
                - success (bool): ...
                - field (type): ...

        Raises:
            ValueError: When ...
        """
        # Implementation
```

**3. Documentation Format (RST):**
Each endpoint in `docs/source/api/jsonrpc/<category>.rst` uses this structure:

```rst
method_name
-----------

Brief description of what this endpoint does.

**Method:** ``method_name``

**Parameters:**

.. list-table::
   :header-rows: 1
   :widths: 20 15 10 55

   * - Name
     - Type
     - Required
     - Description
   * - param_name
     - string
     - Yes
     - Parameter description

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        field: type
    }

**Example:**

.. code-block:: json

    // Request
    {"jsonrpc": "2.0", "method": "method_name", "params": {...}, "id": 1}

    // Response
    {"jsonrpc": "2.0", "result": {...}, "id": 1}
```

**4. Test Structure:**
Tests in `tests/4_jsonrpc/` follow this pattern:

```python
class TestMethodNameEndpoint:
    """Tests for the method_name endpoint."""

    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        """Set up a test project for each test."""
        # Setup mocks, initialize project
        self.handler = JSONRPCHandler()

    def test_method_returns_expected_structure(self):
        """Test that method returns expected response structure."""
        request = {
            "jsonrpc": "2.0",
            "method": "method_name",
            "params": {"project_id": self.project_id, "base_path": str(self.base_path)},
            "id": 1,
        }
        response = self.handler.handle_request(request)
        assert "error" not in response
        assert response["result"]["success"] is True
```

**5. Common Parameters:**
Most endpoints require:

- `project_id` (required): Project identifier
- `base_path` (optional): Base directory containing project (default: "./projects")
- `skip_commit` (optional): Skip automatic Git commit (default: false)

**6. Error Handling:**
Use CoLRev-specific error codes:

- `-32000`: COLREV_REPO_SETUP_ERROR
- `-32001`: COLREV_OPERATION_ERROR
- `-32002`: COLREV_SERVICE_NOT_AVAILABLE
- `-32003`: COLREV_MISSING_DEPENDENCY
- `-32004`: COLREV_PARAMETER_ERROR

**7. Endpoint Categories:**

- `status_handler.py` - Project status, validation, operation info
- `init_handler.py` - Project initialization
- `settings_handler.py` - Settings management
- `search_handler.py` - Search sources and search execution
- `records_handler.py` - Record CRUD operations
- `dedupe_handler.py` - Deduplication
- `prescreen_handler.py` - Pre-screening
- `screen_handler.py` - Full-text screening
- `data_handler.py` - Data extraction
- `git_handler.py` - Git operations

---

## Electron App (electron-app/)

Desktop GUI application that communicates with CoLRev via the JSON-RPC server.

### Directory Structure

```
electron-app/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # Window creation, IPC handlers
│   │   ├── colrev-backend.ts    # JSON-RPC subprocess manager
│   │   └── git-env.ts           # Git environment (dugite)
│   ├── preload/
│   │   └── index.ts             # Context bridge (secure IPC)
│   └── renderer/                # Vue.js frontend
│       ├── App.vue              # Main application component
│       ├── main.ts              # Vue app entry point
│       ├── index.css            # Tailwind CSS + shadcn-vue theme
│       ├── components/ui/       # shadcn-vue components
│       └── lib/utils.ts         # Utility functions (cn helper)
├── electron.vite.config.ts      # Vite configuration
├── components.json              # shadcn-vue configuration
└── package.json
```

### Development Commands

```bash
cd electron-app

# Development with hot reload
npm run dev

# Production build
npm run build

# Package for distribution
npm run package:mac    # macOS DMG
npm run package:win    # Windows portable
npm run package:linux  # Linux AppImage
```

### Dev Mode Project Location

In development mode, Electron stores projects in the app's user data directory, NOT in the repository:

```
~/Library/Application Support/colrev-electron-poc/projects/
```

For example, a project named "my-review" would be at:
```
~/Library/Application Support/colrev-electron-poc/projects/my-review/
├── settings.json           # Project configuration
├── data/
│   ├── records.bib         # Main records (after load operation)
│   └── search/
│       ├── pubmed.bib      # Search results from PubMed
│       └── *_search_history.json  # Search history files
└── .git/                   # Git repository
```

**Debugging tip:** To inspect raw files after running search/load operations:
```bash
ls -la ~/Library/Application\ Support/colrev-electron-poc/projects/
cat ~/Library/Application\ Support/colrev-electron-poc/projects/<project>/data/search/pubmed.bib
```

### Adding shadcn-vue Components

```bash
cd electron-app
npx shadcn-vue@latest add <component-name>
```

Available components: button, card, input, dialog, dropdown-menu, etc.
See full list: https://www.shadcn-vue.com/docs/components

### IPC Communication

The Electron app uses a secure IPC pattern:

1. **Main Process** (`src/main/`) - Spawns JSON-RPC server, handles system operations
2. **Preload Script** (`src/preload/`) - Exposes safe API via `contextBridge`
3. **Renderer** (`src/renderer/`) - Vue app accesses backend via `window.colrev`

**Available API (in renderer):**

```typescript
window.colrev.start(); // Start JSON-RPC server
window.colrev.stop(); // Stop server
window.colrev.call(method, params); // Make RPC call
window.colrev.onLog(callback); // Subscribe to logs
window.colrev.onError(callback); // Subscribe to errors
window.appInfo.get(); // Get app metadata
```

### Styling Guidelines

- Use Tailwind CSS utility classes for styling
- Use shadcn-vue components for UI elements (Button, Card, Input, etc.)
- Theme colors are defined as CSS variables in `src/renderer/index.css`
- Dark mode is enabled by default (`.dark` class on root element)
- Use the `cn()` utility from `@/lib/utils` to merge class names

### E2E Testing with Playwright

The Electron app includes Playwright E2E tests that allow iterative debugging of the JSON-RPC backend.

**IMPORTANT:** The Electron app spawns `python main.py` to run the JSON-RPC backend as a child process. The test fixture automatically configures the PATH to use the conda environment.

**Conda Environment Location:**
The colrev conda environment is located at: `~/miniforge3/envs/colrev`

The Playwright fixture (`e2e/fixtures/electron.fixture.ts`) automatically adds this to the PATH when launching Electron, so tests should work without manually activating conda first.

**Running Tests:**

```bash
# From electron-app directory (recommended)
cd electron-app
npm run build                  # Build the Electron app first
npx playwright test            # Run all tests
npx playwright test --headed   # Run with visible Electron window
npx playwright test --debug    # Run with Playwright inspector

# Run specific test file
npx playwright test e2e/specs/search-workflow.spec.ts

# Run specific test by name
npx playwright test --grep "should add a PubMed"

# From repository root using Makefile
make test-e2e                  # Build and run tests
make test-e2e-headed           # Build and run with visible window
```

**If tests fail with Python/conda errors:**

1. Verify the conda environment exists: `ls ~/miniforge3/envs/colrev/bin/python`
2. Verify colrev is installed: `~/miniforge3/envs/colrev/bin/python -c "import colrev; print('OK')"`
3. If needed, update the path in `e2e/fixtures/electron.fixture.ts`

**Debugging Backend Errors:**

When tests timeout or fail unexpectedly, the issue is often a backend Python error. The test output includes backend logs that show Python tracebacks. Look for lines like:

```
[backend] ERROR - Error executing method <method_name>
Traceback (most recent call last):
  ...
AttributeError: '...' object has no attribute '...'
```

Common backend errors and fixes:

- `AttributeError: 'Dataset' object has no attribute 'create_commit'` → Use `self.review_manager.create_commit()` instead of `self.review_manager.dataset.create_commit()`
- JSON serialization errors → Check that response objects can be serialized (use `.model_dump()` for Pydantic models)

**Always check backend logs first when tests fail** - don't wait for timeouts. The error is usually visible in the test output.

**Test Structure:**

```
electron-app/e2e/
├── fixtures/
│   └── electron.fixture.ts    # Custom fixtures for Electron + debug access
├── helpers/
│   └── test-utils.ts          # Utilities for formatting logs, assertions
└── specs/
    ├── app-launch.spec.ts     # Basic launch tests
    └── backend-rpc.spec.ts    # RPC communication tests
```

**Available Test Fixtures:**

- `window` - Playwright Page object for the Electron renderer
- `getDebugData()` - Returns `{ logs, backendLogs, backendStatus, hasErrors }`
- `getRpcLogs()` - Returns only RPC request/response/error log entries
- `waitForRpcResponse(method?, timeout?)` - Wait for a specific RPC response
- `clearDebugLogs()` - Clear all debug logs between test actions
- `waitForBackend(timeout?)` - Wait for backend status to be 'running'

**Writing Tests with RPC Debugging:**

```typescript
import { test, expect } from "../fixtures/electron.fixture";
import { formatRpcLogs, printDebugData } from "../helpers/test-utils";

test("example with RPC debugging", async ({
  window,
  getRpcLogs,
  getDebugData,
  waitForBackend,
  clearDebugLogs,
}) => {
  // 1. Wait for app to be ready
  await window.waitForSelector("#app", { timeout: 10000 });
  await waitForBackend(30000);

  // 2. Clear logs to isolate this test's activity
  await clearDebugLogs();

  // 3. Perform UI action (click button, fill form, etc.)
  await window.click('[data-testid="some-button"]');

  // 4. Wait for RPC response
  await window.waitForTimeout(1000);

  // 5. Get and print RPC logs for debugging
  const rpcLogs = await getRpcLogs();
  console.log("=== RPC Activity ===");
  console.log(formatRpcLogs(rpcLogs));

  // 6. Get full debug data including backend stderr
  const debug = await getDebugData();
  printDebugData(debug);

  // 7. Make assertions
  expect(debug.hasErrors).toBe(false);
  expect(debug.backendStatus).toBe("running");
});
```

**Iterative Debugging Workflow:**

1. Write a test for the feature/button you want to implement
2. Run `npm run test:e2e` and observe the console output
3. The test will print:
   - All RPC requests with their parameters
   - All RPC responses with their data and duration
   - Backend stderr logs
   - Error messages if any occurred
4. If errors occur, fix the JSON-RPC handler or frontend code
5. Re-run the test until it passes

**Debug Data Structure:**

```typescript
interface DebugData {
  logs: DebugLogEntry[]; // All debug log entries
  backendLogs: string[]; // Backend stderr output
  backendStatus: "stopped" | "starting" | "running" | "error";
  hasErrors: boolean; // True if any error logs exist
}

interface DebugLogEntry {
  id: string;
  type: "rpc-request" | "rpc-response" | "error" | "backend" | "info";
  message: string; // e.g., "→ list_projects" or "← list_projects"
  data?: unknown; // Request params or response data
  timestamp: string;
  duration?: number; // Response time in ms (for rpc-response)
  requestId?: string; // Links request to response
}
```

**Tips for Claude:**

- Always call `clearDebugLogs()` before the action you want to test
- Use `formatRpcLogs()` for readable console output
- Check `debug.hasErrors` and `debug.backendLogs` when things fail
- The `waitForRpcResponse(method)` fixture waits for a specific method's response
- Pinia stores are exposed via `window.__pinia__` for direct access if needed

### Selector Best Practices

**Always prefer `data-testid` attributes for test stability:**

```typescript
// GOOD - Stable, won't break with UI changes
await window.click('[data-testid="submit-create-project"]');
await window.fill('[data-testid="project-id-input"]', "my-project");

// AVOID - Fragile, breaks if text or structure changes
await window.click('button:has-text("Create Project")');
await window.click(".bg-primary");
```

**When adding testable UI elements in Vue components:**

```vue
<Button data-testid="submit-create-project" @click="createProject">
  Create Project
</Button>

<Input v-model="projectId" data-testid="project-id-input" />

<!-- For dynamic IDs (e.g., list items) -->
<Card v-for="project in projects" :data-testid="`project-card-${project.id}`" />
```

**Naming conventions for data-testid:**

- Use kebab-case: `submit-create-project`, not `submitCreateProject`
- Be descriptive: `project-id-input`, not `input1`
- For actions: `{action}-{target}` (e.g., `submit-create-project`, `cancel-dialog`)
- For containers: `{component}-{identifier}` (e.g., `project-card-my-review`)

### Common Test Patterns

**CRITICAL: Clicking Disabled Buttons**

Playwright's `click()` will execute on disabled buttons but the action won't trigger. This is a common source of test flakiness. Always wait for buttons to be enabled before clicking:

```typescript
// BAD - Button may be disabled, click does nothing
await window.fill('[data-testid="input"]', "value");
await window.click('[data-testid="submit-button"]'); // May fail silently!

// GOOD - Wait for button to be enabled first
await window.fill('[data-testid="input"]', "value");
await window.waitForSelector('[data-testid="submit-button"]:not([disabled])', {
  timeout: 5000,
});
await window.click('[data-testid="submit-button"]');

// BEST - Use the helper function from test-utils.ts
import { clickWhenEnabled } from "../helpers/test-utils";
await window.fill('[data-testid="input"]', "value");
await clickWhenEnabled(window, '[data-testid="submit-button"]');
```

This is especially important for form submit buttons that have `:disabled="!canSubmit"` bindings in Vue.

**Project Creation Flow:**

```typescript
// Open dialog
await window.click('button:has-text("New Project")');

// Fill form using data-testid
await window.waitForSelector('[data-testid="project-id-input"]', {
  timeout: 5000,
});
await window.fill('[data-testid="project-id-input"]', projectId);

// Submit (use clickWhenEnabled for buttons that may be disabled)
await clickWhenEnabled(window, '[data-testid="submit-create-project"]');

// Wait for RPC and verify
await waitForRpcResponse("init_project", 60000);
await window.waitForSelector(`[data-testid="project-card-${projectId}"]`, {
  timeout: 10000,
});
```

**Navigation Pattern (avoid waitForURL):**

```typescript
// GOOD - Wait for content instead of URL
await window.click(`[data-testid="project-card-${projectId}"]`);
await window.waitForSelector("text=Project Overview", { timeout: 15000 });

// AVOID - waitForURL can be flaky in Electron
await window.waitForURL(`**/#/project/${projectId}`, { timeout: 10000 });
```

**Unique Test Data:**

```typescript
// Always use unique IDs to avoid test interference
const projectId = `test-project-${Date.now()}`;
```

**Handling Known Backend Errors:**

```typescript
// Filter out known issues, fail on unexpected errors
const criticalErrors = debugData.logs.filter(
  (log) => log.type === "error" && !log.message.includes("known_issue_method"),
);
if (criticalErrors.length > 0) {
  throw new Error(
    `Critical errors: ${criticalErrors.map((e) => e.message).join(", ")}`,
  );
}
```

### Existing data-testid Attributes

**LandingPage.vue:**

- `project-id-input` - New project name input
- `submit-create-project` - Create project button in dialog
- `cancel-create-project` - Cancel button in dialog

**ProjectCard.vue:**

- `project-card-{projectId}` - Project card (dynamic ID)

**Add data-testid when creating new interactive elements.**

### Frontend Feature Documentation

See `electron-app/docs/FRONTEND_FEATURES.md` for a working table of:

- Features implemented by workflow step
- Test coverage status for each feature
- Planned vs. implemented functionality

---

## LLM Context Documentation

The `llm_context/` directory contains detailed documentation intended for LLM consumption:

- `data_structures.md` - Comprehensive reference for CoLRev data structures, RecordState enum, Fields constants, and JSON-RPC endpoint documentation

When adding new LLM-relevant documentation (e.g., detailed API references, data model documentation, workflow specifications), place it in the `llm_context/` directory rather than CLAUDE.md. Keep CLAUDE.md focused on quick references and development guidance.
