#!/usr/bin/env python
"""
Test client for CoLRev JSON-RPC server.
Demonstrates how to interact with the server from Python via stdio.
"""

import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional


class CoLRevJSONRPCClient:
    """Simple JSON-RPC 2.0 client for CoLRev server using stdio."""

    def __init__(self, executable_path: Optional[str] = None):
        """Initialize client by spawning the PyInstaller executable."""
        if executable_path is None:
            # Default to the PyInstaller executable in the dist folder
            executable_path = str(Path(__file__).parent / "dist" / "colrev-jsonrpc")

        self.request_id = 0
        self.process = None

        try:
            # Spawn the JSON-RPC server process (directly run the executable)
            self.process = subprocess.Popen(
                [executable_path],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,  # Line buffered
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


def main():
    """Test the JSON-RPC client."""
    print("CoLRev JSON-RPC Client Test (stdio mode)")
    print("=" * 50)

    # Use context manager to ensure process cleanup
    try:
        with CoLRevJSONRPCClient() as client:
            # Check health
            print("\n1. Checking server health...")
            if client.check_health():
                print("   ✓ Server is healthy")
            else:
                print("   ✗ Server is not responding")
                sys.exit(1)

            # Ping
            print("\n2. Pinging server...")
            try:
                ping_result = client.ping()
                print(f"   ✓ Ping response: {ping_result}")
            except Exception as e:
                print(f"   ✗ Ping failed: {e}")
                sys.exit(1)

            # Initialize a project
            print("\n3. Initializing test project...")
            project_id = f"test_project_{int(time.time())}"
            try:
                init_result = client.init_project(
                    project_id=project_id,
                    review_type="colrev.literature_review",
                    force_mode=True,
                    light=False,
                )
                print(f"   ✓ Project initialized successfully")
                print(f"     - Project ID: {init_result['project_id']}")
                print(f"     - Path: {init_result['path']}")
                print(f"     - Review Type: {init_result['review_type']}")
            except Exception as e:
                print(f"   ✗ Initialization failed: {e}")
                sys.exit(1)

            # Get project status
            print("\n4. Getting project status...")
            try:
                status_result = client.get_status(project_id=project_id)
                print(f"   ✓ Status retrieved successfully")
                print(f"     - Path: {status_result['path']}")
                print(f"     - Status: {json.dumps(status_result['status'], indent=6)}")
            except Exception as e:
                print(f"   ✗ Failed to get status: {e}")

            # Test error handling
            print("\n5. Testing error handling...")
            try:
                client.get_status(project_id="nonexistent_project")
                print("   ✗ Should have raised an error")
            except Exception as e:
                print(f"   ✓ Error handling works: {e}")

            print("\n" + "=" * 50)
            print("All tests completed!")

    except Exception as e:
        print(f"\n✗ Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
