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

- [x] **M1: Extension & Client Scaffold**
  - Scaffolded TypeScript extension with `esbuild`.
  - Built TrueForge client module (`TrueForgeClient.ts`) with SSE reader, delta merger, and session/turn lifecycle.
  - Implemented configuration loader (`configManager.ts`) with fallback to `trueforge.config.example.json`.
  - Registered `trueforge.streamHello` command and output channel streaming handler.
  - Added unit test suite for TrueForgeClient delta and event handling (`npm test` passes).
  - Verification: Clean bundle generated (`dist/extension.js`, 10.5 KB) and tests pass.

- [ ] **M2: MCP Tool Server (Backend in Python)**
  - Python sidecar MCP server exposing:
    - `workspace_read_file`
    - `workspace_search_text`
    - `workspace_list_files`
    - `workspace_write_file_proposal` (in-memory buffer, no disk write)
    - `workspace_run_command` (terminal execution with approval)
  - Register MCP server with TrueForge.
  - Verification: Agent reads a test workspace file via MCP tool.

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
