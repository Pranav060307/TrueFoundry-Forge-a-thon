import os
import sys
sys.path.insert(0, os.path.abspath("."))
from backend.main import (
    app,
    read_file,
    list_dir,
    search_workspace,
    propose_write,
    run_command,
    assemble_context,
    get_workspace_outline,
    pending_edits,
    health_check,
    get_pending_edits,
    clear_pending_edits,
    ClearEditRequest,
    get_mentions,
)

def test_backend():
    print("Testing Python Backend Sidecar...")

    # 1. Health check
    data = health_check()
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
    pe_data = get_pending_edits()
    assert len(pe_data["pending_edits"]) == 1

    # Clear pending edits
    clear_pending_edits(ClearEditRequest())
    assert len(pending_edits) == 0
    print("  ✓ /api/pending_edits and clear verified")

    # 7. run_command tool
    cmd_res = run_command("python --version")
    assert "Python" in cmd_res
    print("  ✓ run_command executed successfully")

    # 8. Milestone 6: assemble_context tool with budget and explanation
    ctx_res = assemble_context("TrueForge coding agent instructions", mentions=["AGENTS.md"], max_tokens=2000)
    assert "Context Assembly Summary" in ctx_res
    assert "AGENTS.md" in ctx_res
    assert "Explicit @file mention" in ctx_res
    print("  ✓ assemble_context generated transparent summary with token budget")

    # 9. Milestone 6: get_workspace_outline tool (AST symbols)
    outline_res = get_workspace_outline()
    assert "Workspace AST Symbols" in outline_res
    assert "ASTSymbolExtractor" in outline_res or "ContextAssembler" in outline_res
    print("  ✓ get_workspace_outline extracted Python AST symbols and docstrings")

    # 10. Milestone 5 & 6: /api/mentions endpoint for @file and @symbol autocomplete
    m_data = get_mentions(query="context")
    assert any("context" in f.lower() for f in m_data["files"]) or any("context" in s["name"].lower() for s in m_data["symbols"])
    print("  ✓ /api/mentions endpoint returned matching files and symbols")

    print("\nAll Python backend sidecar tests passed successfully! 🚀")

if __name__ == "__main__":
    test_backend()
