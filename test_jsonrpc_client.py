#!/usr/bin/env python
"""
Test client for CoLRev JSON-RPC server.
Demonstrates how to interact with the server from Python.
"""

import json
import sys
import time
from typing import Any, Dict
from urllib.error import URLError
from urllib.request import Request, urlopen


class CoLRevJSONRPCClient:
    """Simple JSON-RPC 2.0 client for CoLRev server."""

    def __init__(self, url: str = "http://127.0.0.1:8765"):
        """Initialize client with server URL."""
        self.url = url
        self.request_id = 0

    def _call(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Make a JSON-RPC call."""
        self.request_id += 1

        payload = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": self.request_id,
        }

        request = Request(
            self.url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )

        try:
            with urlopen(request, timeout=30) as response:
                result = json.loads(response.read().decode("utf-8"))

            if "error" in result:
                raise Exception(
                    f"JSON-RPC Error {result['error']['code']}: "
                    f"{result['error']['message']}"
                    + (f" - {result['error'].get('data', '')}" if result["error"].get("data") else "")
                )

            return result.get("result", {})

        except URLError as e:
            raise Exception(f"Failed to connect to server: {e}")

    def check_health(self) -> bool:
        """Check if server is healthy."""
        try:
            request = Request(f"{self.url}/health")
            with urlopen(request, timeout=5) as response:
                data = json.loads(response.read().decode("utf-8"))
                return data.get("status") == "ok"
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
    client = CoLRevJSONRPCClient()

    print("CoLRev JSON-RPC Client Test")
    print("=" * 50)

    # Check health
    print("\n1. Checking server health...")
    if client.check_health():
        print("   ✓ Server is healthy")
    else:
        print("   ✗ Server is not responding")
        print("   Please start the server first: python main.py")
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


if __name__ == "__main__":
    main()
