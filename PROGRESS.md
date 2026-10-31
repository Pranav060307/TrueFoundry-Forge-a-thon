# Implementation Progress: TrueForge VS Code Coding Agent

**Status:** Active  
**Current Milestone:** Milestone 4 (Complete) $\rightarrow$ Milestone 5 & 6 (Agent Panel UI & Context Assembly / Task B)

---

## Milestone Tracker

- [x] **M0: Learn TrueForge & Architecture Verification**
  - Read TrueForge codebase, OpenAPI docs, and SDK.
  - Documented sessions, turns, streaming events, MCP registration, approvals, agent specs, models, fallbacks, and context engineering.
  - Verified local startup flags and SSRF bypass requirements.
  - Deliverable: `TRUEFORGE_API.md`, `DECISIONS.md`, `NOTES_FOR_WRITEUP.md`.
  - Commit: `docs: notes on TrueForge API`

- [x] **M1: Scaffold + Live Handshake**
  - Project organized into `/extension` (TS), `/webview` (React + Vite + TS), `/backend` (Python + FastAPI), `/agent` (TrueForge manifest & config), `/docs`.
  - Extension host features TrueForgeClient module (session/turn streaming and cancel), SidecarManager with lifecycle management & health checks, ConfigLoader.
  - Webview features React + Vite app with CSP + asWebviewUri, postMessage protocol, TrueForge/sidecar health badges, token streaming.
  - Unified dev and build commands in root package.json (`npm run build`, `npm test`).
  - All test suites passing (`npm test`, `python tests/test_backend.py`).
  - Commit: `feat: scaffold extension, webview, sidecar with live streaming`

- [x] **M2: MCP Tools in Python Sidecar**
  - Python MCP server implemented in `backend/main.py` using official MCP 2.x `MCPServer`.
  - Tools implemented: `read_file`, `list_dir`, `search_workspace`, `propose_write`, `run_command`.
  - `propose_write` strictly buffers edits in memory; verified that disk is untouched (`git -C D:\flask status` clean).
  - Unit tests verifying all 5 MCP tools and non-destructive in-memory edit staging passing.
  - Flask 3.1.3 target repo cloned at commit `22d92470` to `D:\flask`; virtualenv configured with `pytest<8.2`; `pytest tests/test_cli.py -q` passing (55 passed, 3 skipped).
  - Task A baseline verified: `$env:FLASK_DEBUG='off'; python -c "..."` prints `True`.
  - `TrueForgeManager` added to extension to auto-launch TrueForge with loopback SSRF bypass (`NETWORK_POLICY_ENABLED=false`).
  - Secret scan completed across repo and git history (0 secrets).
  - Commit: `test: end-to-end agent to MCP verification`

- [x] **M3: Diff Review & Undo Engine**
  - Implemented `extension/src/diffEngine.ts`: Myers diff calculation with 0-line context isolating each contiguous edit into a distinct reviewable hunk.
  - Line ending normalization preserving CRLF and LF across Windows and Linux environments without introducing phantom carriage returns (`\r\r\n`).
  - Implemented `extension/src/diffContentProvider.ts`: `vscode.TextDocumentContentProvider` for `trueforge-diff://` virtual document scheme.
  - Implemented `extension/src/hunkRegistry.ts`: Staged in-memory edit registry with live event refresh on hunk accept/reject, synchronized with Python sidecar.
  - Implemented `extension/src/codeLensProvider.ts`: In-editor CodeLens buttons for `✓ Accept Hunk`, `✗ Reject Hunk`, `✓ Accept All Hunks`, `✗ Reject All Hunks`.
  - Implemented `extension/src/undoManager.ts`: Direct `vscode.WorkspaceEdit` application ensuring full VS Code native undo (`Ctrl+Z`), plus explicit `trueforge.undoLastTurn` rollback command.
  - Comprehensive unit test suite in `tests/test_diff_engine.mjs` verifying 8 test cases.
  - Commit: `feat: native diff review engine with per-hunk CodeLens and undo`

- [x] **M4: Inline Edit (Task A)**
  - Registered `trueforge.inlineEdit` command (`Ctrl+I` / `Cmd+I`) with active selection capture and instruction prompt box.
  - Prompt dispatch to TrueForge session with MCP `vscode-tools` registration.
  - Propose writes flow directly through in-memory staging into M3 hunk review and diff editor.
  - Verified Task A on `pallets/flask` (commit `22d92470`):
    - Baseline: `FLASK_DEBUG=off` returned `True`.
    - Function `get_debug_flag` and docstring updated to treat `"0"`, `"false"`, `"no"`, `"off"`, and `"n"` as false case-insensitively.
    - Verified: `FLASK_DEBUG=off`, `FLASK_DEBUG=OFF`, `FLASK_DEBUG=n`, `FLASK_DEBUG=N` all return `False`.
    - Verified: `FLASK_DEBUG=1` returns `True`.
    - Verified: `pytest tests/test_cli.py -q` passed 55 tests with 0 regressions.
    - Verified: Rollback left `D:\flask` git status 100% clean.
  - Test runner: `tests/test_task_a.mjs` automated in `npm test`.
  - Commit: `feat: inline edit capability and verified Task A on Flask`

- [ ] **M5: Agent Panel (Webview)**
  - Sidebar chat UI with live token streaming and tool-call timeline.
  - @file and @symbol mention autocomplete.
  - Instant Stop button that aborts TrueForge turn and cleans staged hunks.
  - Verification: Multi-turn chat without UI freezes, safe cancellation.

- [ ] **M6: Context Assembly (Task B)**
  - Python-powered workspace indexer (AST symbols + BM25 keyword search).
  - Strict 4,000-token budget manager with visible file selection explanation.
  - Verification: Task B (`flask config` command across 3+ files) passes with `pytest tests/test_cli.py -q`.

- [ ] **M7: Resilience & Model Fallback (Task C)**
  - Configured primary + fallback models.
  - Automatic retry and silent failover on primary error.
  - Verification: Task C on invalid endpoint transparently recovers and passes.
