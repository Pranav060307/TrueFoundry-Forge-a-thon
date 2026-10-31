# Implementation Progress: TrueForge VS Code Coding Agent

**Status:** Active  
**Current Milestone:** Milestone 0 (Complete) $\rightarrow$ Milestone 1 (Starting)

---

## Milestone Tracker

- [x] **M0: Learn TrueForge & Architecture Verification**
  - Read TrueForge codebase, OpenAPI docs, and SDK.
  - Documented sessions, turns, streaming events, MCP registration, approvals, agent specs, models, fallbacks, and context engineering.
  - Verified local startup flags and SSRF bypass requirements.
  - Deliverable: `TRUEFORGE_API.md`, `DECISIONS.md`, `NOTES_FOR_WRITEUP.md`.
  - Commit: `docs: notes on TrueForge API`

- [x] **M1: Scaffold + Live Handshake**
  - Project reorganized into `/extension` (TS), `/webview` (React + Vite + TS), `/backend` (Python + FastAPI), `/agent` (TrueForge manifest & config), `/docs`.
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

- [ ] **M3: Diff Review & Undo Engine**
  - In-memory hunk registry.
  - Virtual document diff provider (`TextDocumentContentProvider`).
  - CodeLens and in-editor decorations for Accept/Reject per hunk.
  - WorkspaceEdit application with native undo (`Ctrl+Z`).
  - Verification: Fake edit reviewed, accepted hunk-by-hunk, and undone.

- [ ] **M4: Inline Edit (Task A)**
  - Selection keybinding (`Ctrl+I` / `Cmd+I`) and instruction input box.
  - Inline prompt sent to TrueForge with active selection context.
  - Diff flows through M3 review engine.
  - Verification: Task A on Flask `get_debug_flag` passes.

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
