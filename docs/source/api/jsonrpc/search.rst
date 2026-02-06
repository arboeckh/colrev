Search Sources & Search Endpoints
==================================

These endpoints handle search source configuration and search execution.

get_sources
-----------

List all configured search sources.

**Method:** ``get_sources``

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
        sources: SearchSource[]
    }

**SearchSource Type:**

.. code-block:: typescript

    interface SearchSource {
        endpoint: string,
        filename: string,
        search_type: "DB" | "API" | "BACKWARD" | "FORWARD" | "TOC" | "OTHER" | "FILES" | "MD",
        search_parameters: Record<string, any>,
        comment: string | null,
        is_curated_source?: boolean
    }

----

add_source
----------

Add a new search source.

**Method:** ``add_source``

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
   * - endpoint
     - string
     - Yes
     - Source endpoint (e.g., "colrev.crossref")
   * - search_type
     - string
     - Yes
     - One of: "DB", "API", "BACKWARD", "FORWARD", "TOC", "OTHER", "FILES", "MD"
   * - search_parameters
     - object
     - No
     - Source-specific parameters
   * - filename
     - string
     - No
     - Target filename (auto-generated if not provided)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        source: SearchSource,
        message: string
    }

----

remove_source
-------------

Remove a search source.

**Method:** ``remove_source``

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
   * - filename
     - string
     - Yes
     - Source filename to remove

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        message: string
    }

----

run_search
----------

Execute search operation on configured sources.

**Method:** ``run_search``

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
   * - sources
     - string[]
     - No
     - Specific source filenames (omit for all)
   * - rerun
     - boolean
     - No
     - Re-search already searched sources (default: false)
   * - skip_commit
     - boolean
     - No
     - Skip git commit (default: false)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        operation: "search",
        results: {
            source: string,
            records_found: number,
            status: "success" | "skipped" | "error",
            error?: string
        }[],
        total_new_records: number
    }

----

load
----

Load search results into main records file.

**Method:** ``load``

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
   * - keep_ids
     - boolean
     - No
     - Keep original IDs (default: false)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        operation: "load",
        records_imported: number,
        message: string
    }

----

upload_search_file
------------------

Upload a search results file (RIS, BibTeX, etc.) to the project.

**Method:** ``upload_search_file``

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
   * - filename
     - string
     - Yes
     - Target filename in data/search/
   * - content
     - string
     - Yes
     - File content (base64 encoded for binary)
   * - encoding
     - string
     - No
     - "utf-8" (default) or "base64"

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        path: string,
        detected_format: string,
        message: string
    }
