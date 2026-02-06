Data Extraction Endpoints
=========================

These endpoints handle data extraction and synthesis operations.

get_data_endpoints
------------------

Get configured data extraction endpoints.

**Method:** ``get_data_endpoints``

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
        endpoints: {
            identifier: string,
            name: string,
            is_active: boolean,
            config: Record<string, any>
        }[]
    }

----

add_data_endpoint
-----------------

Add a data extraction endpoint.

**Method:** ``add_data_endpoint``

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
     - Endpoint identifier (e.g., "colrev.paper_md")
   * - config
     - object
     - No
     - Endpoint configuration

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        endpoint: DataEndpoint,
        message: string
    }

----

remove_data_endpoint
--------------------

Remove a data extraction endpoint.

**Method:** ``remove_data_endpoint``

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
     - Endpoint identifier to remove

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        message: string
    }

----

get_synthesis_status
--------------------

Get synthesis status for all included records.

**Method:** ``get_synthesis_status``

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
        total_included: number,
        synthesized: number,
        pending: number,
        records: {
            id: string,
            title: string,
            status: "rev_included" | "rev_synthesized",
            endpoints_completed: string[]
        }[]
    }

----

run_data
--------

Run data extraction/synthesis operation.

**Method:** ``run_data``

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
   * - endpoints
     - string[]
     - No
     - Specific endpoints (omit for all)
   * - skip_commit
     - boolean
     - No
     - Skip git commit (default: false)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        operation: "data",
        records_synthesized: number,
        ask_to_commit: boolean,
        message: string
    }

----

export_bibliography
-------------------

Export bibliography to various formats.

**Method:** ``export_bibliography``

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
   * - format
     - string
     - Yes
     - "bibtex", "ris", "csv", "xlsx", or "zotero"
   * - filters
     - object
     - No
     - Filter criteria (status, include_excluded)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        path: string,
        record_count: number,
        format: string
    }
