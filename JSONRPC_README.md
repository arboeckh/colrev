# CoLRev JSON-RPC Server

A JSON-RPC 2.0 server for CoLRev operations, designed to be packaged as a standalone executable for use with Electron apps.

## Features

- **JSON-RPC 2.0 compliant** server over HTTP
- **Initialize CoLRev projects** programmatically with project IDs
- **Get project status** for existing projects
- **Automatic git repository initialization** (handled by CoLRev)
- **CORS enabled** for Electron app integration
- **Health check endpoint** for monitoring

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
python main.py [--host HOST] [--port PORT] [--log-level LEVEL]
```

### From Executable

```bash
./dist/colrev-jsonrpc [--host HOST] [--port PORT] [--log-level LEVEL]
```

**Options:**
- `--host`: Host to bind to (default: `127.0.0.1`)
- `--port`: Port to bind to (default: `8765`)
- `--log-level`: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)

**Example:**
```bash
./dist/colrev-jsonrpc --host 127.0.0.1 --port 8765 --log-level INFO
```

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

### 3. `ping`

Health check method.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "ping",
  "params": {},
  "id": 3
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "status": "pong"
  },
  "id": 3
}
```

### Health Check Endpoint

A simple HTTP GET endpoint for health checks:

**Request:**
```
GET /health
```

**Response:**
```json
{
  "status": "ok"
}
```

## Error Responses

**Error codes:**
- `-32700`: Parse error (Invalid JSON)
- `-32600`: Invalid Request (Missing required fields)
- `-32601`: Method not found
- `-32603`: Internal error

**Example error response:**
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32600,
    "message": "Invalid Request",
    "data": "project_id is required"
  },
  "id": 1
}
```

## Using from Electron App

### Start the Server as a Subprocess

```javascript
const { spawn } = require('child_process');

// Start the JSON-RPC server
const colrevServer = spawn('./path/to/colrev-jsonrpc', [
  '--host', '127.0.0.1',
  '--port', '8765'
]);

colrevServer.stdout.on('data', (data) => {
  console.log(`Server: ${data}`);
});

colrevServer.stderr.on('data', (data) => {
  console.error(`Server Error: ${data}`);
});
```

### Make JSON-RPC Calls

```javascript
async function initProject(projectId) {
  const response = await fetch('http://127.0.0.1:8765', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'init_project',
      params: {
        project_id: projectId,
        review_type: 'colrev.literature_review',
        force_mode: true,
      },
      id: 1,
    }),
  });

  const result = await response.json();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.result;
}

// Usage
initProject('my_review_001')
  .then(result => {
    console.log('Project initialized:', result);
  })
  .catch(error => {
    console.error('Error:', error);
  });
```

### Check Server Health

```javascript
async function checkHealth() {
  try {
    const response = await fetch('http://127.0.0.1:8765/health');
    const data = await response.json();
    return data.status === 'ok';
  } catch (error) {
    return false;
  }
}
```

## Testing the Server

### Using curl

```bash
# Initialize a project
curl -X POST http://127.0.0.1:8765 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "init_project",
    "params": {
      "project_id": "test_project",
      "review_type": "colrev.literature_review"
    },
    "id": 1
  }'

# Get project status
curl -X POST http://127.0.0.1:8765 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "get_status",
    "params": {
      "project_id": "test_project"
    },
    "id": 2
  }'

# Ping
curl -X POST http://127.0.0.1:8765 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "ping",
    "params": {},
    "id": 3
  }'

# Health check
curl http://127.0.0.1:8765/health
```

### Using Python

See `test_jsonrpc_client.py` for a Python client example.

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

## Troubleshooting

### Port Already in Use

If port 8765 is already in use, specify a different port:

```bash
./dist/colrev-jsonrpc --port 8766
```

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

## Security Notes

- The server binds to `127.0.0.1` by default (localhost only)
- Project IDs are sanitized to prevent path traversal attacks
- CORS is enabled for local Electron app integration
- For production use, consider adding authentication and encryption