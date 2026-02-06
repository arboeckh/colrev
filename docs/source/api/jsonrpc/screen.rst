Screening Endpoints
===================

These endpoints handle full-text screening with criteria.

get_screening_criteria
----------------------

Get configured screening criteria.

**Method:** ``get_screening_criteria``

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
        criteria: {
            name: string,
            explanation: string,
            comment: string
        }[]
    }

----

add_screening_criterion
-----------------------

Add a new screening criterion.

**Method:** ``add_screening_criterion``

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
   * - name
     - string
     - Yes
     - Criterion name
   * - explanation
     - string
     - Yes
     - Criterion explanation
   * - comment
     - string
     - No
     - Additional comment

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        criteria: ScreeningCriterion[],
        message: string
    }

----

remove_screening_criterion
--------------------------

Remove a screening criterion.

**Method:** ``remove_screening_criterion``

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
   * - name
     - string
     - Yes
     - Criterion name to remove

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        message: string
    }

----

get_screen_queue
----------------

Get records awaiting screening.

**Method:** ``get_screen_queue``

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
            pdf_path?: string,
            current_criteria?: Record<string, "in" | "out" | "TODO">
        }[]
    }

----

screen_record
-------------

Submit screening decision for a single record.

**Method:** ``screen_record``

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
   * - criteria_decisions
     - object
     - Yes
     - Map of criterion name to "in" or "out"
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

screen_batch
------------

Submit screening decisions for multiple records.

**Method:** ``screen_batch``

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
     - Array of {record_id, decision, criteria_decisions} objects
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

include_all_screen
------------------

Include all remaining records in screen (skip full-text screening).

**Method:** ``include_all_screen``

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
