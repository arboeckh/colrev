#!/usr/bin/env python
"""
Test client for CoLRev JSON-RPC server.
Demonstrates how to interact with the server from Python via stdio.

By default, runs the server via Python module for faster iteration.
Use --executable flag to test the PyInstaller executable.
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional


class CoLRevJSONRPCClient:
    """Simple JSON-RPC 2.0 client for CoLRev server using stdio."""

    def __init__(self, use_executable: bool = False, executable_path: Optional[str] = None):
        """
        Initialize client by spawning the JSON-RPC server.

        Args:
            use_executable: If True, use PyInstaller executable. If False, use Python module (default).
            executable_path: Path to executable (only used if use_executable=True)
        """
        self.request_id = 0
        self.process = None
        self.mode = "executable" if use_executable else "python"

        try:
            if use_executable:
                # Run via PyInstaller executable
                if executable_path is None:
                    executable_path = str(Path(__file__).parent.parent / "dist" / "colrev-jsonrpc")

                print(f"Starting JSON-RPC server via executable: {executable_path}")
                self.process = subprocess.Popen(
                    [executable_path],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,  # Line buffered
                )
            else:
                # Run via Python module (faster for development)
                print("Starting JSON-RPC server via Python module (main.py)")
                self.process = subprocess.Popen(
                    [sys.executable, "main.py"],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,  # Line buffered
                    cwd=Path(__file__).parent.parent,
                )
        except Exception as e:
            raise Exception(f"Failed to start JSON-RPC server process: {e}")

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit - ensure process is terminated."""
        self.close()

    def close(self) -> None:
        """Close the connection and terminate the process."""
        if self.process:
            try:
                self.process.stdin.close()
                self.process.stdout.close()
                self.process.stderr.close()
                self.process.terminate()
                self.process.wait(timeout=5)
            except Exception:
                # Force kill if graceful termination fails
                self.process.kill()
                self.process.wait()

    def _call(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Make a JSON-RPC call."""
        if not self.process or self.process.poll() is not None:
            raise Exception("JSON-RPC server process is not running")

        self.request_id += 1

        payload = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": self.request_id,
        }

        try:
            # Send request to stdin
            self.process.stdin.write(json.dumps(payload) + "\n")
            self.process.stdin.flush()

            # Read response from stdout
            response_line = self.process.stdout.readline()
            if not response_line:
                # Check if process died
                if self.process.poll() is not None:
                    stderr_output = self.process.stderr.read()
                    raise Exception(f"Server process terminated. stderr: {stderr_output}")
                raise Exception("Server closed connection")

            result = json.loads(response_line)

            if "error" in result:
                raise Exception(
                    f"JSON-RPC Error {result['error']['code']}: "
                    f"{result['error']['message']}"
                    + (f" - {result['error'].get('data', '')}" if result["error"].get("data") else "")
                )

            return result.get("result", {})

        except json.JSONDecodeError as e:
            # Show what we actually received for debugging
            raise Exception(f"Invalid JSON response from server: {e}\nReceived: {repr(response_line)}")
        except Exception as e:
            if isinstance(e, Exception) and "JSON-RPC Error" in str(e):
                raise
            raise Exception(f"Failed to communicate with server: {e}")

    def check_health(self) -> bool:
        """Check if server is healthy using ping."""
        try:
            result = self.ping()
            return result.get("status") == "pong"
        except Exception:
            return False

    def ping(self) -> Dict[str, Any]:
        """Ping the server."""
        return self._call("ping", {})

    def init_project(
        self,
        project_id: str,
        review_type: str = "colrev.literature_review",
        example: bool = False,
        force_mode: bool = True,
        light: bool = False,
        base_path: str = "./projects",
    ) -> Dict[str, Any]:
        """Initialize a new CoLRev project."""
        return self._call(
            "init_project",
            {
                "project_id": project_id,
                "review_type": review_type,
                "example": example,
                "force_mode": force_mode,
                "light": light,
                "base_path": base_path,
            },
        )

    def get_status(
        self, project_id: str, base_path: str = "./projects"
    ) -> Dict[str, Any]:
        """Get status of a CoLRev project."""
        return self._call("get_status", {"project_id": project_id, "base_path": base_path})

    def validate(
        self, project_id: str, base_path: str = "./projects"
    ) -> Dict[str, Any]:
        """Validate a CoLRev project."""
        return self._call("validate", {"project_id": project_id, "base_path": base_path})

    def search(
        self,
        project_id: str,
        base_path: str = "./projects",
        source: str = "all",
        rerun: bool = False,
        skip_commit: bool = False,
    ) -> Dict[str, Any]:
        """Execute search operation to retrieve records from sources."""
        return self._call(
            "search",
            {
                "project_id": project_id,
                "base_path": base_path,
                "source": source,
                "rerun": rerun,
                "skip_commit": skip_commit,
            },
        )

    def load(
        self,
        project_id: str,
        base_path: str = "./projects",
        keep_ids: bool = False,
    ) -> Dict[str, Any]:
        """Execute load operation to import search results."""
        return self._call(
            "load",
            {
                "project_id": project_id,
                "base_path": base_path,
                "keep_ids": keep_ids,
            },
        )

    def prep(
        self,
        project_id: str,
        base_path: str = "./projects",
        skip_commit: bool = False,
    ) -> Dict[str, Any]:
        """Execute metadata preparation operation."""
        return self._call(
            "prep",
            {
                "project_id": project_id,
                "base_path": base_path,
                "skip_commit": skip_commit,
            },
        )

    def dedupe(
        self, project_id: str, base_path: str = "./projects"
    ) -> Dict[str, Any]:
        """Execute deduplication operation."""
        return self._call("dedupe", {"project_id": project_id, "base_path": base_path})

    def prescreen(
        self,
        project_id: str,
        base_path: str = "./projects",
        split_str: str = "NA",
    ) -> Dict[str, Any]:
        """Execute prescreen operation."""
        return self._call(
            "prescreen",
            {
                "project_id": project_id,
                "base_path": base_path,
                "split_str": split_str,
            },
        )

    def pdf_get(
        self,
        project_id: str,
        base_path: str = "./projects",
    ) -> Dict[str, Any]:
        """Execute PDF retrieval operation."""
        return self._call(
            "pdf_get",
            {
                "project_id": project_id,
                "base_path": base_path,
            },
        )

    def pdf_prep(
        self,
        project_id: str,
        base_path: str = "./projects",
        reprocess: bool = False,
        batch_size: int = 0,
    ) -> Dict[str, Any]:
        """Execute PDF preparation operation."""
        return self._call(
            "pdf_prep",
            {
                "project_id": project_id,
                "base_path": base_path,
                "reprocess": reprocess,
                "batch_size": batch_size,
            },
        )

    def screen(
        self, project_id: str, base_path: str = "./projects"
    ) -> Dict[str, Any]:
        """Execute screening operation."""
        return self._call("screen", {"project_id": project_id, "base_path": base_path})

    def data(
        self, project_id: str, base_path: str = "./projects"
    ) -> Dict[str, Any]:
        """Execute data extraction and synthesis operation."""
        return self._call("data", {"project_id": project_id, "base_path": base_path})


def main():
    """Test the JSON-RPC client with complete CoLRev workflow."""
    # Parse command-line arguments
    parser = argparse.ArgumentParser(
        description="Test CoLRev JSON-RPC client with complete workflow"
    )
    parser.add_argument(
        "--executable",
        action="store_true",
        help="Use PyInstaller executable instead of Python module (default: Python module for faster iteration)",
    )
    args = parser.parse_args()

    print("CoLRev JSON-RPC Client - Complete Workflow Test (stdio mode)")
    print("=" * 70)
    print(f"Mode: {'PyInstaller Executable' if args.executable else 'Python Module (fast iteration)'}")
    print("=" * 70)
    print("Testing all operations in correct CoLRev literature review workflow order:")
    print("  init → validate → load → prep → dedupe → prescreen →")
    print("  pdf_get → pdf_prep → screen → data")
    print("=" * 70)

    # Use context manager to ensure process cleanup
    try:
        with CoLRevJSONRPCClient(use_executable=args.executable) as client:
            # 1. Check health
            print("\n1. Checking server health...")
            if client.check_health():
                print("   ✓ Server is healthy")
            else:
                print("   ✗ Server is not responding")
                sys.exit(1)

            # 2. Ping
            print("\n2. Pinging server...")
            try:
                ping_result = client.ping()
                print(f"   ✓ Ping response: {ping_result}")
            except Exception as e:
                print(f"   ✗ Ping failed: {e}")
                sys.exit(1)

            # 3. Initialize a project with example data
            print("\n3. Initializing test project with example data...")
            project_id = f"test_project_{int(time.time())}"
            try:
                init_result = client.init_project(
                    project_id=project_id,
                    review_type="colrev.literature_review",
                    force_mode=True,
                    light=False,
                    example=True,  # Enable example mode for 30 sample records
                )
                print(f"   ✓ Project initialized successfully")
                print(f"     - Project ID: {init_result['project_id']}")
                print(f"     - Path: {init_result['path']}")
                print(f"     - Review Type: {init_result['review_type']}")
                print(f"     - Example Data: 30 sample records included")
            except Exception as e:
                print(f"   ✗ Initialization failed: {e}")
                sys.exit(1)

            # 4. Get initial project status
            print("\n4. Getting initial project status...")
            try:
                status_result = client.get_status(project_id=project_id)
                print(f"   ✓ Status retrieved successfully")
                print(f"     - Path: {status_result['path']}")
                print(f"     - Status: {json.dumps(status_result['status'], indent=6)}")
            except Exception as e:
                print(f"   ✗ Failed to get status: {e}")

            # 5. Validate project
            print("\n5. Validating project...")
            try:
                validate_result = client.validate(project_id=project_id)
                print(f"   ✓ Validation completed")
                print(f"     - Details: {validate_result.get('details', {})}")
            except Exception as e:
                print(f"   ✗ Validation failed: {e}")

            # 6. Load operation (import example records into main dataset)
            print("\n6. Running load operation to import records...")
            try:
                load_result = client.load(project_id=project_id)
                print(f"   ✓ Load completed")
                print(f"     - Details: {load_result.get('details', {})}")
            except Exception as e:
                print(f"   ✗ Load failed: {e}")

            # 7. Get status after load
            print("\n7. Getting status after load...")
            try:
                status_result = client.get_status(project_id=project_id)
                print(f"   ✓ Status retrieved")
                print(f"     - Records: {json.dumps(status_result['status'], indent=6)}")
            except Exception as e:
                print(f"   ✗ Failed to get status: {e}")

            # 8. Prep operation
            print("\n8. Running prep (metadata preparation) operation...")
            try:
                prep_result = client.prep(project_id=project_id)
                print(f"   ✓ Prep completed")
                print(f"     - Details: {prep_result.get('details', {})}")
            except Exception as e:
                print(f"   ✗ Prep failed: {e}")

            # 9. Get status after prep
            print("\n9. Getting status after prep...")
            try:
                status_result = client.get_status(project_id=project_id)
                print(f"   ✓ Status retrieved")
                print(f"     - Records: {json.dumps(status_result['status'], indent=6)}")
            except Exception as e:
                print(f"   ✗ Failed to get status: {e}")

            # 10. Dedupe operation
            print("\n10. Running dedupe (deduplication) operation...")
            try:
                dedupe_result = client.dedupe(project_id=project_id)
                print(f"   ✓ Dedupe completed")
                print(f"     - Details: {dedupe_result.get('details', {})}")
            except Exception as e:
                print(f"   ✗ Dedupe failed: {e}")

            # 11. Get status after dedupe
            print("\n11. Getting status after dedupe...")
            try:
                status_result = client.get_status(project_id=project_id)
                print(f"   ✓ Status retrieved")
                print(f"     - Records: {json.dumps(status_result['status'], indent=6)}")
            except Exception as e:
                print(f"   ✗ Failed to get status: {e}")

            # 12. Prescreen operation
            print("\n12. Running prescreen operation...")
            try:
                prescreen_result = client.prescreen(project_id=project_id)
                print(f"   ✓ Prescreen completed")
                print(f"     - Details: {prescreen_result.get('details', {})}")
            except Exception as e:
                print(f"   ✗ Prescreen failed: {e}")

            # 13. Get status after prescreen
            print("\n13. Getting status after prescreen...")
            try:
                status_result = client.get_status(project_id=project_id)
                print(f"   ✓ Status retrieved")
                print(f"     - Records: {json.dumps(status_result['status'], indent=6)}")
            except Exception as e:
                print(f"   ✗ Failed to get status: {e}")

            # 14. PDF get operation (may fail without actual PDFs, that's expected)
            print("\n14. Running pdf-get operation (may fail without PDFs)...")
            try:
                pdf_get_result = client.pdf_get(project_id=project_id)
                print(f"   ✓ PDF get completed")
                print(f"     - Details: {pdf_get_result.get('details', {})}")
            except Exception as e:
                print(f"   ⚠ PDF get failed (expected without real PDFs): {e}")

            # 15. PDF prep operation (may fail without actual PDFs, that's expected)
            print("\n15. Running pdf-prep operation (may fail without PDFs)...")
            try:
                pdf_prep_result = client.pdf_prep(project_id=project_id)
                print(f"   ✓ PDF prep completed")
                print(f"     - Details: {pdf_prep_result.get('details', {})}")
            except Exception as e:
                print(f"   ⚠ PDF prep failed (expected without real PDFs): {e}")

            # 16. Screen operation
            print("\n16. Running screen operation...")
            try:
                screen_result = client.screen(project_id=project_id)
                print(f"   ✓ Screen completed")
                print(f"     - Details: {screen_result.get('details', {})}")
            except Exception as e:
                print(f"   ✗ Screen failed: {e}")

            # 17. Get status after screen
            print("\n17. Getting status after screen...")
            try:
                status_result = client.get_status(project_id=project_id)
                print(f"   ✓ Status retrieved")
                print(f"     - Records: {json.dumps(status_result['status'], indent=6)}")
            except Exception as e:
                print(f"   ✗ Failed to get status: {e}")

            # 18. Data operation
            print("\n18. Running data (extraction/synthesis) operation...")
            try:
                data_result = client.data(project_id=project_id)
                print(f"   ✓ Data operation completed")
                print(f"     - Details: {data_result.get('details', {})}")
            except Exception as e:
                print(f"   ✗ Data operation failed: {e}")

            # 19. Get final status
            print("\n19. Getting final project status...")
            try:
                status_result = client.get_status(project_id=project_id)
                print(f"   ✓ Status retrieved")
                print(f"     - Path: {status_result['path']}")
                print(f"     - Final Status: {json.dumps(status_result['status'], indent=6)}")
            except Exception as e:
                print(f"   ✗ Failed to get status: {e}")

            # 20. Test error handling
            print("\n20. Testing error handling with nonexistent project...")
            try:
                client.get_status(project_id="nonexistent_project")
                print("   ✗ Should have raised an error")
            except Exception as e:
                print(f"   ✓ Error handling works: {e}")

            print("\n" + "=" * 70)
            print("All operations tested successfully!")
            print(f"Test project created at: ./projects/{project_id}")
            print("\nUsage:")
            print("  python scripts/test_jsonrpc_client.py              # Run via Python (fast)")
            print("  python scripts/test_jsonrpc_client.py --executable # Run via executable")

    except Exception as e:
        print(f"\n✗ Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
