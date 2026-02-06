Git & Collaboration Endpoints
=============================

These endpoints handle version control and collaboration features.

get_git_status
--------------

Get Git repository status.

**Method:** ``get_git_status``

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
        git: {
            branch: string,
            is_clean: boolean,
            uncommitted_changes: number,
            untracked_files: string[],
            modified_files: string[],
            staged_files: string[],
            ahead: number,
            behind: number,
            remote_url?: string,
            last_commit: {
                hash: string,
                message: string,
                author: string,
                timestamp: string
            }
        }
    }

----

commit
------

Create a Git commit.

**Method:** ``commit``

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
   * - message
     - string
     - Yes
     - Commit message
   * - files
     - string[]
     - No
     - Specific files (omit to commit all staged)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        commit_hash: string,
        message: string
    }

----

get_branches
------------

List Git branches.

**Method:** ``get_branches``

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
        current: string,
        local: string[],
        remote: string[]
    }

----

checkout_branch
---------------

Switch to or create a branch.

**Method:** ``checkout_branch``

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
   * - branch
     - string
     - Yes
     - Branch name
   * - create
     - boolean
     - No
     - Create if doesn't exist (default: false)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        branch: string,
        message: string
    }

----

pull
----

Pull changes from remote.

**Method:** ``pull``

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
   * - remote
     - string
     - No
     - Remote name (default: "origin")
   * - branch
     - string
     - No
     - Branch name (default: current)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        commits_pulled: number,
        conflicts: string[],
        message: string
    }

----

push
----

Push changes to remote.

**Method:** ``push``

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
   * - remote
     - string
     - No
     - Remote name (default: "origin")
   * - branch
     - string
     - No
     - Branch name (default: current)
   * - set_upstream
     - boolean
     - No
     - Set upstream tracking (default: false)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        commits_pushed: number,
        message: string
    }

----

get_commit_history
------------------

Get commit history.

**Method:** ``get_commit_history``

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
     - Max commits to return (default: 50)
   * - branch
     - string
     - No
     - Branch name (default: current)

**Returns:**

.. code-block:: typescript

    {
        success: boolean,
        commits: {
            hash: string,
            short_hash: string,
            message: string,
            author: string,
            timestamp: string,
            operation?: string
        }[]
    }
