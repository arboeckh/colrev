# CoLRev JSON-RPC Server

A JSON-RPC 2.0 server for CoLRev operations, designed to be packaged as a standalone executable for use with Electron apps.

## Features

- **JSON-RPC 2.0 compliant** server using stdio protocol
- **Full CoLRev workflow support**: init, status, search, prep, dedupe, screen, data
- **Modular architecture** with separate handlers for each operation
- **Automatic git repository initialization** (handled by CoLRev)
- **Comprehensive error handling** with detailed error messages
- **PyInstaller packaging** for standalone distribution

## Building the Executable

### Prerequisites

```bash
# Install PyInstaller
pip install pyinstaller

# Or with uv
uv pip install pyinstaller
```

### Build

```bash
# Using the spec file (recommended)
pyinstaller colrev_jsonrpc.spec

# Or using the command line
pyinstaller --onefile --name colrev-jsonrpc main.py
```

The executable will be created in the `dist/` directory.

## Running the Server

### From Source

```bash
# Using the Python module
python -m colrev.ui_jsonrpc.server [--log-level LEVEL]

# Or using the entry point (after pip install)
colrev-jsonrpc [--log-level LEVEL]

# Or using the main.py launcher
python main.py [--log-level LEVEL]
```

### From Executable

```bash
./dist/colrev-jsonrpc [--log-level LEVEL]
```

**Options:**
- `--log-level`: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)

**Example:**
```bash
./dist/colrev-jsonrpc --log-level INFO
```

**Note:** The server uses stdio for communication (reads from stdin, writes to stdout). All logging goes to stderr to avoid interference with JSON-RPC communication.

## API Methods

### 1. `init_project`

Initialize a new CoLRev project.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "init_project",
  "params": {
    "project_id": "my_literature_review",
    "review_type": "colrev.literature_review",
    "example": false,
    "force_mode": true,
    "light": false,
    "base_path": "./projects"
  },
  "id": 1
}
```

**Parameters:**
- `project_id` (required): Unique alphanumeric identifier for the project
- `review_type` (optional): Type of review (default: `colrev.literature_review`)
  - Options: `colrev.literature_review`, `colrev.scoping_review`, `colrev.meta_analysis`, etc.
- `example` (optional): Include example records (default: `false`)
- `force_mode` (optional): Force initialization even if directory exists (default: `true`)
- `light` (optional): Light mode without Docker dependencies (default: `false`)
- `base_path` (optional): Base directory for projects (default: `./projects`)

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "project_id": "my_literature_review",
    "path": "/absolute/path/to/projects/my_literature_review",
    "review_type": "colrev.literature_review",
    "message": "Project initialized successfully at projects/my_literature_review"
  },
  "id": 1
}
```

**Notes:**
- Creates directory at `{base_path}/{project_id}`
- Automatically initializes a git repository
- Project ID is sanitized to alphanumeric characters, hyphens, and underscores only

### 2. `get_status`

Get the status of an existing CoLRev project.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "get_status",
  "params": {
    "project_id": "my_literature_review",
    "base_path": "./projects"
  },
  "id": 2
}
```

**Parameters:**
- `project_id` (required): Project identifier
- `base_path` (optional): Base directory for projects (default: `./projects`)

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "project_id": "my_literature_review",
    "path": "/absolute/path/to/projects/my_literature_review",
    "status": {
      "... project status details ..."
    }
  },
  "id": 2
}
```

### 3. `search`

Execute search operation to retrieve records from sources.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "search",
  "params": {
    "project_id": "my_literature_review",
    "base_path": "./projects",
    "source": "all",
    "rerun": false,
    "skip_commit": false
  },
  "id": 3
}
```

**Parameters:**
- `project_id` (required): Project identifier
- `base_path` (optional): Base directory for projects (default: `./projects`)
- `source` (optional): Source selection string (default: `"all"`)
- `rerun` (optional): Rerun API-based searches (default: `false`)
- `skip_commit` (optional): Skip git commit (default: `false`)

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "operation": "search",
    "project_id": "my_literature_review",
    "message": "Search operation completed successfully",
    "details": {
      "source": "all",
      "rerun": false,
      "message": "Search completed"
    }
  },
  "id": 3
}
```

### 4. `prep`

Execute metadata preparation operation.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "prep",
  "params": {
    "project_id": "my_literature_review",
    "base_path": "./projects"
  },
  "id": 4
}
```

**Parameters:**
- `project_id` (required): Project identifier
- `base_path` (optional): Base directory for projects (default: `./projects`)

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "operation": "prep",
    "project_id": "my_literature_review",
    "message": "Prep operation completed successfully",
    "details": {
      "message": "Metadata preparation completed"
    }
  },
  "id": 4
}
```

### 5. `dedupe`

Execute deduplication operation.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "dedupe",
  "params": {
    "project_id": "my_literature_review",
    "base_path": "./projects"
  },
  "id": 5
}
```

**Parameters:**
- `project_id` (required): Project identifier
- `base_path` (optional): Base directory for projects (default: `./projects`)

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "operation": "dedupe",
    "project_id": "my_literature_review",
    "message": "Dedupe operation completed successfully",
    "details": {
      "message": "Deduplication completed"
    }
  },
  "id": 5
}
```

### 6. `screen`

Execute screening operation.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "screen",
  "params": {
    "project_id": "my_literature_review",
    "base_path": "./projects"
  },
  "id": 6
}
```

**Parameters:**
- `project_id` (required): Project identifier
- `base_path` (optional): Base directory for projects (default: `./projects`)

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "operation": "screen",
    "project_id": "my_literature_review",
    "message": "Screen operation completed successfully",
    "details": {
      "message": "Screening completed"
    }
  },
  "id": 6
}
```

### 7. `data`

Execute data extraction and synthesis operation.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "data",
  "params": {
    "project_id": "my_literature_review",
    "base_path": "./projects"
  },
  "id": 7
}
```

**Parameters:**
- `project_id` (required): Project identifier
- `base_path` (optional): Base directory for projects (default: `./projects`)

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "operation": "data",
    "project_id": "my_literature_review",
    "message": "Data operation completed successfully",
    "details": {
      "message": "Data extraction and synthesis completed"
    }
  },
  "id": 7
}
```

### 8. `validate`

Validate the CoLRev project.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "validate",
  "params": {
    "project_id": "my_literature_review",
    "base_path": "./projects"
  },
  "id": 8
}
```

**Parameters:**
- `project_id` (required): Project identifier
- `base_path` (optional): Base directory for projects (default: `./projects`)

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "operation": "validate",
    "project_id": "my_literature_review",
    "message": "Validate operation completed successfully",
    "details": {
      "message": "Validation completed"
    }
  },
  "id": 8
}
```

### 9. `ping`

Health check method.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "ping",
  "params": {},
  "id": 9
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "status": "pong"
  },
  "id": 9
}
```

## Error Responses

**Standard JSON-RPC error codes:**
- `-32700`: Parse error (Invalid JSON)
- `-32600`: Invalid Request (Missing required fields)
- `-32601`: Method not found
- `-32602`: Invalid params
- `-32603`: Internal error

**CoLRev-specific error codes:**
- `-32000`: CoLRev repository setup error
- `-32001`: CoLRev operation error
- `-32002`: Service not available
- `-32003`: Missing dependency
- `-32004`: Parameter error

**Example error response:**
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Project nonexistent does not exist at /path/to/projects/nonexistent",
    "data": "ValueError"
  },
  "id": 1
}
```

## Using from Electron App

### Start the Server as a Subprocess

The server uses stdio for communication. Launch it as a subprocess and communicate via stdin/stdout:

```javascript
const { spawn } = require('child_process');

// Start the JSON-RPC server
const colrevServer = spawn('./path/to/colrev-jsonrpc', ['--log-level', 'INFO']);

let requestId = 0;
const pendingRequests = new Map();

// Handle responses from stdout
colrevServer.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(line => line.trim());

  for (const line of lines) {
    try {
      const response = JSON.parse(line);
      const callback = pendingRequests.get(response.id);

      if (callback) {
        pendingRequests.delete(response.id);
        if (response.error) {
          callback.reject(new Error(response.error.message));
        } else {
          callback.resolve(response.result);
        }
      }
    } catch (err) {
      console.error('Failed to parse response:', err);
    }
  }
});

// Handle server errors/logs from stderr
colrevServer.stderr.on('data', (data) => {
  console.log(`Server log: ${data}`);
});

// Helper function to make JSON-RPC calls
function callRPC(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;

    pendingRequests.set(id, { resolve, reject });

    const request = {
      jsonrpc: '2.0',
      method: method,
      params: params,
      id: id
    };

    colrevServer.stdin.write(JSON.dumps(request) + '\n');

    // Timeout after 60 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }
    }, 60000);
  });
}

// Usage examples
async function initProject(projectId) {
  try {
    const result = await callRPC('init_project', {
      project_id: projectId,
      review_type: 'colrev.literature_review',
      force_mode: true,
      light: true
    });
    console.log('Project initialized:', result);
    return result;
  } catch (error) {
    console.error('Error initializing project:', error);
    throw error;
  }
}

async function getStatus(projectId) {
  try {
    const result = await callRPC('get_status', {
      project_id: projectId
    });
    console.log('Status:', result);
    return result;
  } catch (error) {
    console.error('Error getting status:', error);
    throw error;
  }
}

// Health check
async function checkHealth() {
  try {
    const result = await callRPC('ping', {});
    return result.status === 'pong';
  } catch (error) {
    return false;
  }
}
```

## Testing the Server

### Using Python Test Client

The repository includes a comprehensive test client in `test_jsonrpc_client.py`:

```bash
# After building the executable
python test_jsonrpc_client.py
```

This will test:
- Server health (ping)
- Project initialization
- Status retrieval
- Error handling

### Manual Testing with Echo and Python

You can test the server manually using echo and Python's json module:

```bash
# Start the server
python -m colrev.ui_jsonrpc.server &
SERVER_PID=$!

# Send a ping request
echo '{"jsonrpc": "2.0", "method": "ping", "params": {}, "id": 1}' | \
  python -m colrev.ui_jsonrpc.server

# Initialize a project
echo '{"jsonrpc": "2.0", "method": "init_project", "params": {"project_id": "test", "light": true}, "id": 2}' | \
  python -m colrev.ui_jsonrpc.server

# Get status
echo '{"jsonrpc": "2.0", "method": "get_status", "params": {"project_id": "test"}, "id": 3}' | \
  python -m colrev.ui_jsonrpc.server

# Clean up
kill $SERVER_PID
```

### Using Python Subprocess

Quick test script:

```python
import json
import subprocess
import sys

# Start server
proc = subprocess.Popen(
    [sys.executable, "-m", "colrev.ui_jsonrpc.server"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    bufsize=1
)

# Send request
request = {"jsonrpc": "2.0", "method": "ping", "params": {}, "id": 1}
proc.stdin.write(json.dumps(request) + "\n")
proc.stdin.flush()

# Read response
response = json.loads(proc.stdout.readline())
print(response)

# Clean up
proc.terminate()
proc.wait()
```

## Project Structure

Projects are created in the following structure:

```
projects/
└── {project_id}/
    ├── .git/                    # Git repository (auto-initialized)
    ├── .pre-commit-config.yaml  # Pre-commit hooks
    ├── settings.json            # CoLRev settings
    ├── readme.md                # Project README
    └── data/
        ├── records.bib          # Bibliography records
        ├── search/              # Search results
        └── pdfs/                # PDF files
```

## Architecture

The JSON-RPC server has been refactored into a modular architecture for better maintainability:

```
colrev/ui_jsonrpc/
├── __init__.py                 # Module exports
├── server.py                   # Server lifecycle and stdio protocol
├── handler.py                  # Request routing and dispatch
├── handlers/                   # Operation handlers
│   ├── init_handler.py        # Project initialization
│   ├── status_handler.py      # Status and validation
│   ├── search_handler.py      # Search operations
│   ├── prep_handler.py        # Metadata preparation
│   ├── dedupe_handler.py      # Deduplication
│   ├── screen_handler.py      # Screening
│   └── data_handler.py        # Data extraction
├── response_formatter.py      # Result formatting
├── error_handler.py           # Exception mapping
└── validation.py              # Parameter validation
```

Each operation handler:
- Receives a ReviewManager instance
- Validates parameters
- Calls the appropriate Operation class from `colrev.ops.*`
- Formats the response

## Troubleshooting

### Permission Denied

On Linux/Mac, make the executable runnable:

```bash
chmod +x ./dist/colrev-jsonrpc
```

### Missing Dependencies

If running from source, ensure all CoLRev dependencies are installed:

```bash
uv pip install --editable .
```

### Server Not Responding

Check stderr for error messages:

```bash
python -m colrev.ui_jsonrpc.server --log-level DEBUG 2> server.log
```

### PyInstaller Build Issues

If the build fails, try cleaning and rebuilding:

```bash
rm -rf build dist
pyinstaller colrev_jsonrpc.spec
```

## Security Notes

- Project IDs are sanitized to prevent path traversal attacks
- Server uses stdio protocol (no network exposure)
- All operations run in the context of the project directory
- Git hooks validate data quality on commits
- For production use with network protocols, consider adding authentication and encryption