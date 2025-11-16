#!/usr/bin/env python
"""
JSON-RPC server for CoLRev operations.
This serves as the entry point for PyInstaller packaging.

The actual server implementation is in colrev.ui_jsonrpc.server
"""

from colrev.ui_jsonrpc.server import main

if __name__ == "__main__":
    main()
