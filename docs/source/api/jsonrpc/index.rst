JSON-RPC API Reference
======================

This documentation describes the JSON-RPC 2.0 API for the CoLRev desktop frontend.
The API provides programmatic access to all CoLRev operations via stdio communication.

.. toctree::
   :maxdepth: 2
   :caption: Contents:

   overview
   status
   settings
   search
   records
   dedupe
   prescreen
   screen
   data
   git

Protocol
--------

The API uses JSON-RPC 2.0 over stdio (stdin/stdout). Each request and response is a
single JSON line terminated with a newline character.

Request Format
~~~~~~~~~~~~~~

.. code-block:: json

    {
        "jsonrpc": "2.0",
        "method": "method_name",
        "params": {
            "project_id": "my_project",
            "base_path": "/path/to/projects"
        },
        "id": 1
    }

Response Format (Success)
~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: json

    {
        "jsonrpc": "2.0",
        "result": {
            "success": true,
            ...
        },
        "id": 1
    }

Response Format (Error)
~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: json

    {
        "jsonrpc": "2.0",
        "error": {
            "code": -32000,
            "message": "Error description",
            "data": "ExceptionType"
        },
        "id": 1
    }

Error Codes
-----------

Standard JSON-RPC 2.0 error codes:

.. list-table::
   :header-rows: 1
   :widths: 15 30 55

   * - Code
     - Name
     - Description
   * - -32700
     - Parse error
     - Invalid JSON was received
   * - -32600
     - Invalid Request
     - Invalid JSON-RPC structure
   * - -32601
     - Method not found
     - Unknown method
   * - -32602
     - Invalid params
     - Invalid method parameters
   * - -32603
     - Internal error
     - Internal server error

CoLRev-specific error codes:

.. list-table::
   :header-rows: 1
   :widths: 15 35 50

   * - Code
     - Name
     - Description
   * - -32000
     - COLREV_REPO_SETUP_ERROR
     - Project repository setup issue
   * - -32001
     - COLREV_OPERATION_ERROR
     - Operation execution failed
   * - -32002
     - COLREV_SERVICE_NOT_AVAILABLE
     - External service unavailable
   * - -32003
     - COLREV_MISSING_DEPENDENCY
     - Required dependency not installed
   * - -32004
     - COLREV_PARAMETER_ERROR
     - Invalid parameter value
