Pre-screening Endpoints
=======================

These endpoints handle title/abstract screening operations.

get_prescreen_queue
-------------------

Get records awaiting prescreening.

**Method:** ``get_prescreen_queue``

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
   * - limit
     - number
     - No
     - Max records to return (default: 50)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        total_count: number,
        records: {
            id: string,
            title: string,
            author: string,
            year: string,
            abstract?: string,
            journal?: string,
            booktitle?: string
        }[]
    }

----

prescreen_record
----------------

Submit prescreening decision for a single record.

**Method:** ``prescreen_record``

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
   * - decision
     - string
     - Yes
     - "include" or "exclude"
   * - skip_commit
     - boolean
     - No
     - Skip git commit (default: false)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        record: Record,
        remaining_count: number,
        message: string
    }

----

prescreen_batch
---------------

Submit prescreening decisions for multiple records.

**Method:** ``prescreen_batch``

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
   * - decisions
     - array
     - Yes
     - Array of {record_id, decision} objects
   * - skip_commit
     - boolean
     - No
     - Skip git commit (default: false)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        included_count: number,
        excluded_count: number,
        remaining_count: number,
        message: string
    }

----

include_all_prescreen
---------------------

Include all remaining records in prescreen (skip prescreening step).

**Method:** ``include_all_prescreen``

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
   * - persist
     - boolean
     - No
     - Add to settings to always skip (default: false)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        included_count: number,
        message: string
    }

----

export_prescreen_table
----------------------

Export records for external prescreening.

**Method:** ``export_prescreen_table``

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
     - "csv" or "xlsx"

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        path: string,
        record_count: number
    }

----

import_prescreen_table
----------------------

Import prescreening decisions from external file.

**Method:** ``import_prescreen_table``

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
   * - path
     - string
     - Yes
     - Path to CSV/XLSX file

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        imported_count: number,
        included_count: number,
        excluded_count: number,
        message: string
    }
