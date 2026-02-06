Deduplication Endpoints
=======================

These endpoints handle duplicate detection and merging.

run_dedupe
----------

Run automatic deduplication.

**Method:** ``run_dedupe``

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
   * - skip_commit
     - boolean
     - No
     - Skip git commit (default: false)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        operation: "dedupe",
        duplicates_merged: number,
        records_processed: number,
        validation_needed: boolean,
        message: string
    }

----

get_duplicate_candidates
------------------------

Get pairs of records that might be duplicates for manual review.

**Method:** ``get_duplicate_candidates``

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
   * - source
     - string
     - No
     - "algorithm", "validation_file", or both (default)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        candidates: {
            record1_id: string,
            record2_id: string,
            record1: Record,
            record2: Record,
            similarity_score: number,
            matching_fields: string[]
        }[]
    }

----

merge_records
-------------

Manually merge duplicate records.

**Method:** ``merge_records``

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
     - Yes
     - Records to merge (first is primary)
   * - skip_commit
     - boolean
     - No
     - Skip git commit (default: false)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        merged_record: Record,
        message: string
    }

----

unmerge_record
--------------

Unmerge a previously merged record.

**Method:** ``unmerge_record``

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
     - Record identifier to unmerge
   * - skip_commit
     - boolean
     - No
     - Skip git commit (default: false)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        unmerged_records: Record[],
        message: string
    }

----

mark_not_duplicate
------------------

Mark two records as not duplicates.

**Method:** ``mark_not_duplicate``

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
   * - record1_id
     - string
     - Yes
     - First record identifier
   * - record2_id
     - string
     - Yes
     - Second record identifier
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
