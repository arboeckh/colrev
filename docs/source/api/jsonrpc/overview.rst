API Overview
============

The CoLRev JSON-RPC API provides a complete interface for building desktop and web
frontends for systematic literature reviews.

Architecture
------------

The API is designed as a subprocess that communicates via stdio:

.. code-block:: text

    Electron App (Main Process)
      ↓ (writes JSON request to stdin)
    colrev-jsonrpc Server (Python subprocess)
      ↓ (processes request)
    JSONRPCHandler routes to appropriate handler
      ↓ (executes operation via ReviewManager)
    Response formatter creates JSON response
      ↓ (writes JSON response to stdout)
    Electron App reads response from stdout

Starting the Server
-------------------

.. code-block:: bash

    # Run directly
    python -m colrev.ui_jsonrpc

    # Or use the built executable
    ./dist/colrev-jsonrpc

Endpoint Categories
-------------------

1. **Project & Status** - Project initialization, status queries, validation
2. **Settings** - Project configuration management
3. **Search Sources** - Configure and execute searches
4. **Records** - CRUD operations on bibliographic records
5. **Deduplication** - Duplicate detection and merging
6. **Pre-screening** - Title/abstract screening
7. **Screening** - Full-text screening with criteria
8. **Data Extraction** - Synthesis and export
9. **Git** - Version control and collaboration

Common Parameters
-----------------

Most endpoints require these parameters:

``project_id`` (required)
    Alphanumeric project identifier (hyphens and underscores allowed)

``base_path`` (optional)
    Base directory containing projects. Defaults to ``./projects``

``skip_commit`` (optional)
    If true, skip automatic Git commit after operation. Default: false

``force`` (optional)
    If true, skip safety checks. Default: true for JSON-RPC

Example: Complete Workflow
--------------------------

.. code-block:: javascript

    // 1. Initialize project
    await call("init_project", {
        project_id: "my_review",
        review_type: "colrev.literature_review"
    });

    // 2. Check status
    const status = await call("get_status", { project_id: "my_review" });

    // 3. Add search source
    await call("add_source", {
        project_id: "my_review",
        endpoint: "colrev.crossref",
        search_type: "API",
        search_parameters: { query: "machine learning" }
    });

    // 4. Run search
    await call("run_search", { project_id: "my_review" });

    // 5. Load results
    await call("load", { project_id: "my_review" });

    // 6. Continue with prep, dedupe, screen, etc.
