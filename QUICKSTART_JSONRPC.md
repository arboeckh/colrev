# Quick Start Guide - CoLRev JSON-RPC Server

This guide will help you quickly build and test the CoLRev JSON-RPC server for Electron integration.

## Overview

The JSON-RPC server allows you to control CoLRev programmatically from any application (especially Electron apps). It provides:

- **HTTP-based JSON-RPC 2.0 API** - Standard protocol, easy to integrate
- **Project initialization** with unique project IDs in `projects/{id}` directories
- **Automatic git repository setup** (handled by CoLRev initialization)
- **Standalone executable** - No Python installation needed on client machines

## Files Created

- `main.py` - Main JSON-RPC server implementation (PyInstaller entry point)
- `test.py` - Simple programmatic usage example (not needed for JSON-RPC)
- `test_jsonrpc_client.py` - Python client for testing
- `colrev_jsonrpc.spec` - PyInstaller specification file
- `build_jsonrpc.sh` - Build script
- `electron_example.js` - Electron/Node.js integration example
- `JSONRPC_README.md` - Complete API documentation

## Quick Start

### 1. Build the Executable

```bash
# Make sure you have PyInstaller installed
pip install pyinstaller

# Build the executable
./build_jsonrpc.sh

# Or manually:
pyinstaller colrev_jsonrpc.spec
```

The executable will be at: `dist/colrev-jsonrpc`

### 2. Run the Server

```bash
# Run the server
./dist/colrev-jsonrpc --host 127.0.0.1 --port 8765

# Or from source for development:
python main.py --host 127.0.0.1 --port 8765
```

You should see:
```
CoLRev JSON-RPC server starting on 127.0.0.1:8765
Press Ctrl+C to stop the server
```

### 3. Test the Server

In another terminal:

```bash
# Using the Python test client
python test_jsonrpc_client.py

# Or using curl
curl -X POST http://127.0.0.1:8765 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "init_project",
    "params": {"project_id": "test_review_001"},
    "id": 1
  }'
```

### 4. Check the Result

After initializing a project, you'll find it at:

```
projects/
└── test_review_001/
    ├── .git/                    # Git repo (automatically initialized)
    ├── settings.json            # CoLRev configuration
    ├── readme.md               # Project README
    └── data/
        ├── records.bib         # Bibliography database
        ├── search/             # Search results
        └── pdfs/               # PDF storage
```

## Usage in Electron

### Basic Example

```javascript
const { CoLRevServer } = require('./electron_example.js');

// Create server instance
const server = new CoLRevServer('./dist/colrev-jsonrpc', '127.0.0.1', 8765);

// Start server
await server.start();

// Use client
const client = server.getClient();

// Initialize a project
const result = await client.initProject({
  projectId: 'my_review_001',
  reviewType: 'colrev.literature_review',
  forceMode: true
});

console.log('Project created at:', result.path);
```

See `electron_example.js` for complete integration code.

## API Reference

### init_project

Initialize a new CoLRev project with automatic git setup.

```json
{
  "jsonrpc": "2.0",
  "method": "init_project",
  "params": {
    "project_id": "my_review_001",
    "review_type": "colrev.literature_review",
    "force_mode": true,
    "base_path": "./projects"
  },
  "id": 1
}
```

**Creates**: `projects/my_review_001/` with full CoLRev structure + git repo

### get_status

Get status of an existing project.

```json
{
  "jsonrpc": "2.0",
  "method": "get_status",
  "params": {
    "project_id": "my_review_001",
    "base_path": "./projects"
  },
  "id": 2
}
```

### ping

Simple health check.

```json
{
  "jsonrpc": "2.0",
  "method": "ping",
  "params": {},
  "id": 3
}
```

## Directory Structure

By default, projects are created in:

```
./projects/{project_id}/
```

You can customize this with the `base_path` parameter.

## Review Types Available

- `colrev.literature_review` (default)
- `colrev.scoping_review`
- `colrev.meta_analysis`
- `colrev.systematic_review`
- `colrev.blank`
- `colrev.narrative_review`
- `colrev.critical_review`
- And many more...

See CoLRev documentation for full list.

## Troubleshooting

### Build fails with missing dependencies

```bash
# Install CoLRev with all dependencies
pip install --editable .
```

### Server won't start

- Check if port 8765 is already in use: `lsof -i :8765`
- Try a different port: `./dist/colrev-jsonrpc --port 8766`

### Can't connect from Electron

- Make sure server is running on `127.0.0.1` (localhost)
- Check firewall settings
- Verify with health check: `curl http://127.0.0.1:8765/health`

## Next Steps

1. **Read full API documentation**: `JSONRPC_README.md`
2. **Integrate with Electron**: See `electron_example.js`
3. **Add more methods**: Edit `main.py` to add search, prep, screen, etc.
4. **Deploy**: Copy `dist/colrev-jsonrpc` to your Electron app resources

## Development

To modify and rebuild:

```bash
# Edit main.py
vim main.py

# Rebuild
./build_jsonrpc.sh

# Test
python test_jsonrpc_client.py
```

For detailed API documentation and advanced usage, see `JSONRPC_README.md`.
