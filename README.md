# TrueForge VS Code Coding Agent

An autonomous VS Code coding agent extension whose core agent reasoning loop runs on [TrueForge](https://github.com/truefoundry/trueforge) (`@truefoundry/trueforge`), TrueFoundry's open-source agent harness.

Built for the **TrueFoundry Forge-a-thon (Techfest 2026-27, IIT Bombay)**.

---

## 🏛️ Architecture Overview

The extension is **strictly a client** of the local TrueForge agent harness:

```
┌─────────────────────────────────────────────────────────────┐
│                       VS Code Extension                     │
│  ┌─────────────────────────┐  ┌──────────────────────────┐  │
│  │   React + Vite Webview  │  │   Native VS Code Host    │  │
│  │   - Live token stream   │  │   - Myers diff engine    │  │
│  │   - Tool-call timeline  │  │   - Virtual diff scheme  │  │
│  │   - @file/@symbol popup │  │   - Per-hunk CodeLens    │  │
│  │   - Instant cancel      │  │   - WorkspaceEdit (undo) │  │
│  └───────────┬─────────────┘  └────────────┬─────────────┘  │
└──────────────┼─────────────────────────────┼────────────────┘
               │ postMessage                 │ IPC / HTTP
               ▼                             ▼
┌────────────────────────────┐ ┌──────────────────────────────┐
│  TrueForge Harness Runtime │ │    Python MCP Sidecar        │
│  (npx @truefoundry/        │ │    (FastAPI + MCP 2.x)       │
│   trueforge@latest :8790)  │ │    - read_file               │
│  - Agent Loop & Reasoning  │ │    - list_dir                │
│  - Session & Turn Stream   │ │    - search_workspace        │
│  - Tool Approval Flow      │ │    - propose_write (memory)  │
│  - Model Agnostic Engine   │ │    - run_command (HITL)      │
│  - Context Compaction      │ │    - AST & BM25 indexer      │
└──────────────▲─────────────┘ └─────────────▲────────────────┘
               │                             │
               └────────── Remote MCP ───────┘
```

1. **Agent Loop on TrueForge:** All reasoning, turns, sessions, and state management run strictly inside TrueForge (`http://localhost:8790`). The extension never calls model providers directly.
2. **Editor Capabilities as MCP Tools:** The editor exposes workspace tools (`read_file`, `search_workspace`, `list_dir`, `propose_write`, `run_command`, `assemble_context`, `get_workspace_outline`) as an embedded MCP server (`http://127.0.0.1:4545/mcp`) running in a Python FastAPI sidecar.
3. **In-Memory Non-Destructive Writes:** The agent's `propose_write` tool buffers edits strictly in memory. Nothing is written silently to disk. Every change is reviewed hunk-by-hunk and applied via `vscode.WorkspaceEdit`, preserving full native undo (`Ctrl+Z`).
4. **Resilience & Auto Fallback:** When the primary model encounters a failure (401 Unauthorized, unreachable endpoint, rate limit, or 5xx error), the client catches it and transparently failovers to the secondary healthy model without user intervention or editor locks.
5. **Zero-Setup Loopback Support:** TrueForge's internal SSRF guard blocks private loopback IPs (`127.0.0.1`, `localhost`) by default. The extension automatically spawns TrueForge with `NETWORK_POLICY_ENABLED=false` and `OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1","localhost"]'`, ensuring seamless local MCP server connectivity out of the box.

---

## ⚡ The 5 Mandatory Capabilities

1. **Inline Edit (`Ctrl+I` / `Cmd+I`):** Select code in any editor, press `Ctrl+I`, and type a natural-language prompt. TrueForge streams the surgical modifications through in-memory staging into a side-by-side virtual diff editor (`trueforge-diff://`) with clickable per-hunk CodeLens controls (`[✓ Accept Hunk] [✗ Reject Hunk]`).
2. **Agent Mode (Multi-File Autonomous Editing):** Send a high-level task into the sidebar Agent Panel. The agent autonomously navigates the workspace via MCP tools (`search_workspace`, `read_file`), discovering and staging edits across 3+ files simultaneously without the user naming them.
3. **Context Assembly (AST Outline + BM25 Search with Strict Budget):** Supports explicit `@file` and `@symbol` autocomplete mentions, plus automatic workspace retrieval using Python AST symbol extraction and Okapi BM25 keyword search. Every turn features a transparent markdown explanation table showing which files were selected, the reason for inclusion, and the exact token consumption within a strict 4,000-token budget.
4. **Diff Review & Native Undo:** Zero silent writes to disk. Every proposed edit is buffered in memory. Each isolated hunk features in-editor CodeLens buttons. Applying hunks uses `vscode.WorkspaceEdit`, guaranteeing seamless integration with VS Code's native undo stack (`Ctrl+Z`) and an explicit `trueforge.undoLastTurn` rollback command.
5. **Resilience & Safe Cancellation:** Interactive Stop button instantly halts turn execution via `POST /api/v1/sessions/{id}/cancel` without freezing the UI or leaving dirty disk edits. Automatic client-side failover transparently reroutes turns on primary model failure.

---

## 🧪 Verification of the Three Fixed Demo Tasks (Pallets/Flask)

All 3 demo tasks have been executed and verified against **Pallets/Flask** (tag `3.1.3`, commit `22d92470`):

### Task A (Inline Edit)
- **Target:** `src/flask/helpers.py`, function `get_debug_flag`.
- **Instruction:** *"Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false."*
- **Verification:**
  - Baseline: `FLASK_DEBUG=off` returned `True`.
  - After edit: `FLASK_DEBUG=off`, `FLASK_DEBUG=OFF`, `FLASK_DEBUG=n`, `FLASK_DEBUG=N` all return `False`.
  - `FLASK_DEBUG=1` returns `True`.
  - `pytest tests/test_cli.py -q` passes with 55 tests passing.
  - Automated test: `npm test` runs `tests/test_task_a.mjs`.

### Task B (Agent Mode across 3+ Files)
- **Instruction:** *"Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as '***'. It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands."*
- **Verification:**
  - Files discovered and edited: `src/flask/cli.py`, `tests/test_cli.py`, `docs/cli.rst`.
  - `flask --help` displays `config`.
  - `flask config` outputs formatted JSON with `SECRET`, `PASSWORD`, `TOKEN`, `KEY` masked as `'***'`.
  - `pytest tests/test_cli.py -q` passes with 56 tests passing (56 passed, 3 skipped).
  - `git diff --stat` verifies 3 files touched.
  - Automated test: `npm test` runs `tests/test_task_b.mjs`.

### Task C (Resilience & Auto Fallback)
- **Target:** Primary model configured with an invalid/unreachable endpoint.
- **Verification:**
  - Primary model fails (401 / connection error).
  - Client transparently catches failure and re-routes turn to healthy secondary model.
  - User receives subtle status notification; editor never crashes or locks up.
  - Automated test: `npm test` runs `tests/test_task_c.mjs`.

---

## 🚀 Clean-Clone Quickstart

### 1. Prerequisites
- Node.js (v20+)
- Python (3.10+)
- VS Code (v1.90+)

### 2. Install & Build
```bash
git clone <repo-url>
cd "True foundary"
npm install
npm run build
```

### 3. Model Configuration
Copy the example config:
```bash
cp agent/trueforge.config.example.json agent/trueforge.config.json
```
Add your model provider API key into `agent/trueforge.config.json` (Anthropic, OpenAI, or any OpenAI-compatible provider). **This file is gitignored and will never be committed.**

### 4. Run the Extension
Press `F5` in VS Code (or run `npm run dev`) to launch the Extension Development Host.

### 5. Automated Test Suite
Run the full TypeScript and Python test suites:
```bash
# Run all 5 unit & verification test suites (Myers diff, Task A, Task B, Task C)
npm test

# Run Python sidecar & MCP tools test suite
python tests/test_backend.py
```

---

## 🔒 Security & Hard Rules Compliance
- **Zero Provider Direct Calls:** All model calls route through the local TrueForge harness.
- **Zero Silent Writes:** All modifications are buffered in memory until explicit user acceptance.
- **Zero API Keys in Repository:** `agent/trueforge.config.json` is strictly gitignored.
- **Public-Ready Repository:** Clean git history, MIT License, and comprehensive documentation.

---

## 📄 License
MIT License. See [LICENSE](LICENSE) for details.
