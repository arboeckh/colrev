#!/bin/bash
# Build script for CoLRev JSON-RPC executable

echo "================================================"
echo "Building CoLRev JSON-RPC Server Executable"
echo "================================================"

# Check if pyinstaller is installed
if ! command -v pyinstaller &> /dev/null; then
    echo ""
    echo "Error: PyInstaller is not installed"
    echo "Install with: pip install pyinstaller"
    echo ""
    read -p "Press Enter to continue..."
    exit 1
fi

# Clean previous builds
echo ""
echo "Cleaning previous builds..."
rm -rf build/ dist/ 2>/dev/null || true

# Build using the spec file
echo ""
echo "Building executable..."
pyinstaller colrev_jsonrpc.spec

# Check if build was successful
echo ""
if [ -f "dist/colrev-jsonrpc" ] || [ -f "dist/colrev-jsonrpc.exe" ]; then
    echo "================================================"
    echo "Build successful!"
    echo "================================================"
    echo ""
    echo "Executable location:"
    ls -lh dist/colrev-jsonrpc* 2>/dev/null || true
    echo ""
    echo "To run the server:"
    echo "  ./dist/colrev-jsonrpc --host 127.0.0.1 --port 8765"
    echo ""
    echo "To test the server:"
    echo "  python test_jsonrpc_client.py"
    echo ""
else
    echo "================================================"
    echo "Build failed - executable not found"
    echo "================================================"
    echo ""
    echo "Check the output above for errors."
    echo ""
fi

echo "Press Enter to close..."
read
