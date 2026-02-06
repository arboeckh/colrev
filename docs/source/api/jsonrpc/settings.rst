Settings Endpoints
==================

These endpoints handle project configuration and settings management.

get_settings
------------

Get current project settings.

**Method:** ``get_settings``

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
        settings: Settings
    }

**Example:**

.. code-block:: json

    // Request
    {
        "jsonrpc": "2.0",
        "method": "get_settings",
        "params": {"project_id": "my_review"},
        "id": 1
    }

----

update_settings
---------------

Update project settings (partial update).

**Method:** ``update_settings``

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
   * - settings
     - object
     - Yes
     - Partial settings object with fields to update

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        message: string,
        updated_fields: string[]
    }

----

get_available_review_types
--------------------------

List available review types for initialization.

**Method:** ``get_available_review_types``

**Parameters:** None

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        review_types: {
            identifier: string,
            name: string,
            description: string,
            short_name: string
        }[]
    }

----

get_available_packages
----------------------

List available packages by endpoint type.

**Method:** ``get_available_packages``

**Parameters:**

.. list-table::
   :header-rows: 1
   :widths: 20 15 10 55

   * - Name
     - Type
     - Required
     - Description
   * - endpoint_type
     - string
     - Yes
     - One of: "search_source", "prep", "dedupe", "prescreen", "pdf_get", "pdf_prep", "screen", "data"

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        packages: {
            identifier: string,
            name: string,
            description: string,
            ci_supported: boolean
        }[]
    }
