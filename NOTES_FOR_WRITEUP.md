# TrueForge VS Code Coding Agent: Project Write-up & Submission Documentation

**Event:** TrueFoundry Forge-a-thon (Techfest 2026-27, IIT Bombay)  
**Project:** TrueForge Coding Agent VS Code Extension  
**License:** MIT  

---

## 1. Executive Summary & Problem Statement

Modern AI coding extensions (such as Cursor, Cline, or Continue) offer powerful editor integrations, but their agent execution loops are deeply proprietary or hardcoded to specific model providers. 

The **TrueForge Coding Agent** solves this by decoupling the editor client from the agent runtime:
- **TrueForge as the Single Agent Harness:** All agent planning, turn streaming, tool dispatch, context compaction, and state persist strictly inside `@truefoundry/trueforge` running locally (`http://localhost:8790`). The extension never executes an internal agent loop or calls model providers directly.
- **Pure MCP Architecture:** The editor exposes native capabilities (`read_file`, `search_workspace`, `list_dir`, `propose_write`, `run_command`, `assemble_context`) as a standardized Model Context Protocol (MCP 2.x) server running in a lightweight Python sidecar.
- **Zero Silent Writes & Native Undo:** Every edit proposed by the agent is buffered strictly in memory (`[STAGED IN MEMORY]`) and split into isolated diff hunks using the Myers diff algorithm. Users accept or reject hunks individually via in-editor CodeLens. Applying changes via `vscode.WorkspaceEdit` guarantees seamless native `Ctrl+Z` undo.

---

## 2. Architectural Design & Technical Highlights

### A. Extension Host (TypeScript, Native VS Code API)
- **Myers Diff & Hunk Isolation:** Custom diff engine (`diffEngine.ts`) splits structured patches with 0-line context, isolating each contiguous modification into a reviewable hunk. Handles LF vs. CRLF line endings flawlessly without phantom carriage return artifacts.
- **Virtual Document Diff Provider:** Implements `vscode.TextDocumentContentProvider` under `trueforge-diff://`, rendering proposed code side-by-side with disk files without touching the filesystem.
- **CodeLens per Hunk:** In-editor clickable `[✓ Accept Hunk]` and `[✗ Reject Hunk]` controls.
- **Native Undo:** Changes applied via `vscode.WorkspaceEdit` enter the editor's native undo buffer (`Ctrl+Z`), complemented by an explicit `trueforge.undoLastTurn` command.

### B. React + Vite Webview UI
- Communicates strictly via asynchronous `postMessage` protocol.
- Live token streaming into agent message bubbles.
- Collapsible interactive tool cards showing execution state, input arguments, and formatted output previews.
- `@file` and `@symbol` autocomplete popup triggered by typing `@`, querying the sidecar's symbol index in real-time.
- Instant Stop button that calls `POST /api/v1/sessions/{id}/cancel` to immediately abort turn execution without ghost diffs or UI freezes.

### C. Python MCP Sidecar (FastAPI + MCP 2.x)
- Mounts official `mcp.server.mcpserver.MCPServer` into FastAPI at `/mcp`.
- **AST Outline Engine:** Uses Python's `ast` module to extract classes, functions, methods, docstrings, and line numbers.
- **Deterministic BM25 Ranker:** Pure-Python Okapi BM25 ranking algorithm providing fast keyword retrieval without heavy C dependencies.
- **Strict 4,000-Token Budget Manager:** Prioritizes explicit mentions, followed by top-k BM25 snippets, and generates a transparent markdown explanation table detailing which files were selected, the reason for inclusion, and the exact token breakdown.

### D. Zero-Setup Local Execution & SSRF Bypass
- TrueForge's built-in SSRF protection blocks private loopback IPs (`127.0.0.1`, `localhost`) by default.
- The extension's `TrueForgeManager` automatically spawns the harness with `NETWORK_POLICY_ENABLED=false` and `OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1","localhost"]'`, ensuring out-of-the-box local connectivity on clean clones.

---

## 3. The Three Fixed Demo Tasks: Verification & Results

All 3 tasks were executed and verified against **Pallets/Flask** (tag `3.1.3`, commit `22d92470`):

| Task | Target & Objective | Verification Evidence | Result |
|---|---|---|---|
| **Task A (Inline Edit)** | `src/flask/helpers.py`<br>`get_debug_flag`: Treat `"off"` and `"n"` as false case-insensitively and update docstring. | `FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"`<br>Baseline: `True`<br>After accept: `False`<br>`pytest tests/test_cli.py -q`: 55 passed | **PASSED** |
| **Task B (Agent Mode, No Files Named)** | Add built-in CLI command `flask config` masking secrets as `'***'`. Touch 3+ files (`cli.py`, `test_cli.py`, `docs/cli.rst`). | `flask --help` displays `config`<br>`flask config` outputs masked JSON<br>`pytest tests/test_cli.py -q`: 56 passed<br>`git diff --stat`: 3 files touched | **PASSED** |
| **Task C (Resilience & Auto Fallback)** | Primary model configured with invalid endpoint/key. Automatically route to secondary model without user intervention. | Turn fails on primary $\rightarrow$ caught $\rightarrow$ re-routed to fallback $\rightarrow$ status notice displayed $\rightarrow$ edit completed without editor crash or dirty git status. | **PASSED** |

---

## 4. Video Demonstration Script (< 4 Minutes)

- **0:00 - 0:30 (Architecture & Setup):**
  - Show VS Code opening `D:\flask`.
  - Point to the status bar: Python Sidecar healthy (`:4545`), TrueForge harness connected (`:8790`).
  - Emphasize: Extension is strictly a client. Agent loop runs on TrueForge. No model provider called directly.
- **0:30 - 1:30 (Task A - Inline Edit):**
  - Open `src/flask/helpers.py`, highlight `get_debug_flag`.
  - Press `Ctrl+I`, enter instruction: *"Treat 'off' and 'n' as false as well, case-insensitively, and update docstring."*
  - TrueForge streams response $\rightarrow$ virtual diff opens side-by-side (`trueforge-diff://`).
  - Show CodeLens `[✓ Accept Hunk]` and `[✗ Reject Hunk]`.
  - Click Accept $\rightarrow$ run `FLASK_DEBUG=off python -c "..."` $\rightarrow$ prints `False`.
  - Press `Ctrl+Z` to show native VS Code undo restoring original file.
- **1:30 - 2:45 (Task B - Autonomous Agent Mode):**
  - Open Sidebar Agent Panel. Type: *"Add a new built-in CLI command flask config that prints loaded config as JSON, masking secrets as '***'. Add tests and docs."*
  - Show Context Assembly table: transparently explains why `cli.py`, `test_cli.py`, and `docs/cli.rst` were selected under the 4,000-token budget.
  - Watch tool timeline: `search_workspace`, `read_file`, and `propose_write` calls across 3 files.
  - Review 3-file diff in editor, click Accept All.
  - Run `flask --help` and `flask config` showing masked JSON.
  - Run `pytest tests/test_cli.py -q` showing 56 passed.
- **2:45 - 3:30 (Task C - Resilience & Auto Fallback):**
  - Introduce an invalid API key / bad endpoint for primary model in config.
  - Repeat prompt. Show subtle status notification: *"Primary failed, using fallback: gpt-4o"*.
  - Turn succeeds transparently without error popups or editor freezes.
- **3:30 - 4:00 (Cancellation & Wrap-Up):**
  - Send long turn and click the red Stop button.
  - Demonstrate immediate SSE cancellation, zero ghost diffs, and clean git status.

---

## 5. Security & Verification Checklist

- [x] Zero model provider keys committed (`agent/trueforge.config.json` gitignored).
- [x] Zero silent writes to disk (in-memory buffering via `propose_write`).
- [x] Zero custom agent loops (100% TrueForge harness execution).
- [x] All 5 automated test suites passing (`npm test`, `python tests/test_backend.py`).
- [x] Public-ready repository with clean commit history and MIT License.
