Project & Status Endpoints
==========================

These endpoints handle project initialization, status queries, and validation.

ping
----

Health check endpoint to verify the server is running.

**Method:** ``ping``

**Parameters:** None

**Returns:**

.. code-block:: typescript

    {
        status: "pong"
    }

**Example:**

.. code-block:: json

    // Request
    {"jsonrpc": "2.0", "method": "ping", "id": 1}

    // Response
    {"jsonrpc": "2.0", "result": {"status": "pong"}, "id": 1}

----

init_project
------------

Initialize a new CoLRev project repository.

**Method:** ``init_project``

**Parameters:**

.. list-table::
   :header-rows: 1
   :widths: 20 15 10 55

   * - Name
     - Type
     - Required
     - Description
   * - project_id
     - string
     - Yes
     - Unique identifier (alphanumeric, hyphens, underscores)
   * - base_path
     - string
     - No
     - Base directory (default: "./projects")
   * - review_type
     - string
     - Yes
     - Review type identifier (e.g., "colrev.literature_review")
   * - example
     - boolean
     - No
     - Include example records (default: false)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        project_id: string,
        path: string,           // Absolute path to project
        review_type: string,
        message: string
    }

**Available Review Types:**

- ``colrev.literature_review`` - General literature review
- ``colrev.scoping_review`` - Scoping review
- ``colrev.meta_analysis`` - Meta-analysis
- ``colrev.critical_review`` - Critical review
- ``colrev.theoretical_review`` - Theoretical review
- ``colrev.narrative_review`` - Narrative review

**Example:**

.. code-block:: json

    // Request
    {
        "jsonrpc": "2.0",
        "method": "init_project",
        "params": {
            "project_id": "my_review",
            "review_type": "colrev.literature_review"
        },
        "id": 1
    }

    // Response
    {
        "jsonrpc": "2.0",
        "result": {
            "success": true,
            "project_id": "my_review",
            "path": "/home/user/projects/my_review",
            "review_type": "colrev.literature_review",
            "message": "Project initialized successfully"
        },
        "id": 1
    }

----

get_status
----------

Get comprehensive project status including record counts by state.

**Method:** ``get_status``

**Alias:** ``status``

**Parameters:**

.. list-table::
   :header-rows: 1
   :widths: 20 15 10 55

   * - Name
     - Type
     - Required
     - Description
   * - project_id
     - string
     - Yes
     - Project identifier
   * - base_path
     - string
     - No
     - Base directory containing project

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        project_id: string,
        path: string,
        status: {
            overall: {
                md_retrieved: number,
                md_imported: number,
                md_prepared: number,
                md_processed: number,
                rev_prescreen_excluded: number,
                rev_prescreen_included: number,
                pdf_not_available: number,
                pdf_imported: number,
                pdf_prepared: number,
                rev_excluded: number,
                rev_included: number,
                rev_synthesized: number
            },
            currently: {
                md_retrieved: number,
                md_imported: number,
                md_needs_manual_preparation: number,
                md_prepared: number,
                md_processed: number,
                rev_prescreen_excluded: number,
                rev_prescreen_included: number,
                pdf_needs_manual_retrieval: number,
                pdf_not_available: number,
                pdf_imported: number,
                pdf_needs_manual_preparation: number,
                pdf_prepared: number,
                rev_excluded: number,
                rev_included: number,
                rev_synthesized: number
            },
            total_records: number,
            next_operation: string | null,
            completeness_condition: boolean,
            atomic_steps: number,
            completed_atomic_steps: number,
            has_changes: boolean,
            duplicates_removed: number,
            nr_origins: number,
            screening_statistics: object
        }
    }

**Status Fields Explained:**

- ``overall``: Cumulative counts (records that have passed through each state)
- ``currently``: Current counts (records in each state now)
- ``next_operation``: Suggested next operation to run
- ``has_changes``: Whether there are uncommitted Git changes

**Example:**

.. code-block:: json

    // Request
    {
        "jsonrpc": "2.0",
        "method": "get_status",
        "params": {"project_id": "my_review"},
        "id": 1
    }

    // Response
    {
        "jsonrpc": "2.0",
        "result": {
            "success": true,
            "project_id": "my_review",
            "path": "/home/user/projects/my_review",
            "status": {
                "total_records": 150,
                "next_operation": "prescreen",
                "currently": {
                    "md_processed": 150,
                    "rev_prescreen_included": 0,
                    ...
                },
                ...
            }
        },
        "id": 1
    }

----

get_operation_info
------------------

Get information about what a specific operation will do before running it.

**Method:** ``get_operation_info``

**Parameters:**

.. list-table::
   :header-rows: 1
   :widths: 20 15 10 55

   * - Name
     - Type
     - Required
     - Description
   * - project_id
     - string
     - Yes
     - Project identifier
   * - base_path
     - string
     - No
     - Base directory containing project
   * - operation
     - string
     - Yes
     - Operation name (see below)

**Valid Operations:**

- ``search`` - Search configured sources
- ``load`` - Import search results
- ``prep`` - Prepare metadata
- ``dedupe`` - Deduplicate records
- ``prescreen`` - Pre-screen records
- ``pdf_get`` - Retrieve PDFs
- ``pdf_prep`` - Prepare PDFs
- ``screen`` - Full-text screen
- ``data`` - Data extraction

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        operation: string,
        can_run: boolean,
        reason: string | null,      // Why operation cannot run
        affected_records: number,   // Records that will be affected
        description: string         // Human-readable description
    }

**Example:**

.. code-block:: json

    // Request
    {
        "jsonrpc": "2.0",
        "method": "get_operation_info",
        "params": {
            "project_id": "my_review",
            "operation": "prescreen"
        },
        "id": 1
    }

    // Response
    {
        "jsonrpc": "2.0",
        "result": {
            "success": true,
            "operation": "prescreen",
            "can_run": true,
            "reason": null,
            "affected_records": 150,
            "description": "Screen records based on titles and abstracts"
        },
        "id": 1
    }

----

validate
--------

Validate the project state and check for issues.

**Method:** ``validate``

**Parameters:**

.. list-table::
   :header-rows: 1
   :widths: 20 15 10 55

   * - Name
     - Type
     - Required
     - Description
   * - project_id
     - string
     - Yes
     - Project identifier
   * - base_path
     - string
     - No
     - Base directory containing project
   * - scope
     - string
     - No
     - Validation scope: "HEAD" (default), commit hash, or "all"
   * - filter_setting
     - string
     - No
     - Filter: "general" (default), "prep", "dedupe", etc.

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        operation: "validate",
        project_id: string,
        details: {
            message: string,
            result: ValidationResult
        }
    }

**Example:**

.. code-block:: json

    // Request
    {
        "jsonrpc": "2.0",
        "method": "validate",
        "params": {
            "project_id": "my_review",
            "scope": "HEAD"
        },
        "id": 1
    }
