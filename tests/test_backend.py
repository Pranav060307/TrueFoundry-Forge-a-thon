import os
import sys
sys.path.insert(0, os.path.abspath("."))
from starlette.testclient import TestClient
from backend.main import app, read_file, list_dir, search_workspace, propose_write, run_command, pending_edits

def test_backend():
    print("Testing Python Backend Sidecar...")
    client = TestClient(app)

    # 1. Health check
    res = client.get("/health")
    assert res.status_code == 200, f"Health check failed: {res.text}"
    data = res.json()
    assert data["status"] == "healthy"
    print("  ✓ /health endpoint returned healthy")

    # 2. read_file tool
    content = read_file("AGENTS.md", start_line=1, end_line=5)
    assert "TrueForge" in content
    print("  ✓ read_file tool returned contents with line numbers")

    # 3. list_dir tool
    files = list_dir(".")
    assert "AGENTS.md" in files
    print("  ✓ list_dir tool listed directory contents")

    # 4. search_workspace tool
    search_res = search_workspace("Zero Tolerance")
    assert "AGENTS.md" in search_res
    print("  ✓ search_workspace found target pattern in AGENTS.md")

    # 5. propose_write tool (IN-MEMORY STAGING ONLY)
    pending_edits.clear()
    dummy_file = "test_non_existent.py"
    if os.path.exists(dummy_file):
        os.remove(dummy_file)

    pw_res = propose_write(dummy_file, "print('hello from staged')", "testing memory staging")
    assert "[STAGED IN MEMORY]" in pw_res
    assert len(pending_edits) == 1
    assert not os.path.exists(dummy_file), "CRITICAL FAILURE: propose_write touched disk!"
    print("  ✓ propose_write buffered in-memory and left disk clean")

    # 6. REST pending_edits endpoint
    pe_res = client.get("/api/pending_edits")
    assert pe_res.status_code == 200
    assert len(pe_res.json()["pending_edits"]) == 1

    # Clear pending edits
    client.post("/api/pending_edits/clear", json={})
    assert len(pending_edits) == 0
    print("  ✓ /api/pending_edits and clear verified")

    # 7. run_command tool
    cmd_res = run_command("python --version")
    assert "Python" in cmd_res
    print("  ✓ run_command executed successfully")

    print("All Python backend sidecar tests passed successfully!")

if __name__ == "__main__":
    test_backend()
