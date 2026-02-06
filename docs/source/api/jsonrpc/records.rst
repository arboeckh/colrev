Records Management Endpoints
============================

These endpoints handle CRUD operations on bibliographic records.

get_records
-----------

Get records with filtering and pagination.

**Method:** ``get_records``

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
   * - filters
     - object
     - No
     - Filter criteria (see below)
   * - sort
     - object
     - No
     - Sort configuration
   * - pagination
     - object
     - No
     - Pagination settings
   * - fields
     - string[]
     - No
     - Specific fields to return

**Filter Options:**

.. code-block:: typescript

    {
        status?: RecordState[],
        search_source?: string,
        entrytype?: string[],
        search_text?: string,
        has_pdf?: boolean,
        year_from?: number,
        year_to?: number
    }

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        total_count: number,
        records: Record[],
        pagination: {
            offset: number,
            limit: number,
            has_more: boolean
        }
    }

----

get_record
----------

Get a single record by ID.

**Method:** ``get_record``

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
   * - record_id
     - string
     - Yes
     - Record identifier

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        record: Record
    }

----

update_record
-------------

Update a record's fields.

**Method:** ``update_record``

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
   * - record_id
     - string
     - Yes
     - Record identifier
   * - fields
     - object
     - Yes
     - Fields to update
   * - skip_commit
     - boolean
     - No
     - Skip git commit (default: false)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        record: Record,
        message: string
    }

----

delete_record
-------------

Remove a record from the dataset.

**Method:** ``delete_record``

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
   * - record_id
     - string
     - Yes
     - Record identifier
   * - skip_commit
     - boolean
     - No
     - Skip git commit (default: false)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        message: string
    }

----

run_prep
--------

Run metadata preparation on records.

**Method:** ``run_prep``

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
   * - record_ids
     - string[]
     - No
     - Specific records (omit for all eligible)
   * - skip_commit
     - boolean
     - No
     - Skip git commit (default: false)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        operation: "prep",
        records_prepared: number,
        records_needs_manual: number,
        message: string
    }
