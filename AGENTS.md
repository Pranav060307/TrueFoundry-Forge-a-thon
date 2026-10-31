# TrueForge Coding Agent: Agent Specification & Instructions

## Project Overview
A VS Code extension coding agent where the agent execution loop runs entirely on **TrueForge** (`@truefoundry/trueforge`). The extension is strictly a client that creates sessions, sends turns via SSE, renders streamed events, and provides editor capabilities through local MCP tools.

---

## Hard Rules (Zero Tolerance)
1. **The agent loop is TrueForge's.** We never write our own agent loop.
2. **The extension NEVER calls a model provider directly.** All models are configured inside TrueForge (catalog provider or OpenAI-compatible endpoint). Must remain model-agnostic.
3. **Editor capabilities are exposed as MCP tools.** The agent autonomously decides what to read, search, and change.
4. **No silent writes to disk.** Every modification goes through hunk-by-hunk review via `propose_write` (in-memory buffer), and every applied change must be undoable.
5. **No API keys committed.** Configuration templates live in `trueforge.config.example.*`, real credentials stay gitignored.
6. **Public-ready repo:** Clean git history, MIT LICENSE, comprehensive README.
7. **Out of scope:** No tab completion/FIM, model training/hosting, hosted backend/database, auth/accounts, or Marketplace publishing.

---

## Architectural Stack Decisions
- **Extension Host:** TypeScript, native VS Code Extension API.
  - Myers diff calculation & virtual document diff provider (`TextDocumentContentProvider`).
  - CodeLens for per-hunk Accept/Reject.
  - Native `vscode.WorkspaceEdit` application ensuring full VS Code native undo (`Ctrl+Z`).
- **Webview UI:** React + Vite + TypeScript.
  - Communicates strictly via `postMessage`.
  - Shows connection status for TrueForge and Python sidecar.
  - Renders live token stream, tool-call timeline, @file/@symbol mentions, and cancellation button.
- **Backend Sidecar:** Python (FastAPI / HTTP MCP Server).
  - Exposes MCP tools: `read_file`, `list_dir`, `search_workspace`, `propose_write` (in-memory staging), `run_command` (HITL gated).
  - Context engine: AST symbol outline + BM25 keyword search under a strict token budget.
- **Agent Harness:** Local TrueForge runtime (`npx @truefoundry/trueforge@latest` on port 8790).

---

## Three Fixed Demo Tasks (Pallets/Flask tag 3.1.3, commit 22d92470)

### Task A (Inline Edit)
- Target: `src/flask/helpers.py`, function `get_debug_flag`.
- Instruction: *"Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false."*
- Review & accept diff hunk-by-hunk.
- Verification: `FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"` prints `False`.

### Task B (Agent Mode, No Files Named)
- Instruction: *"Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as '***'. It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands."*
- Agent discovers files via MCP tools, issues `propose_write` across 3+ files (`src/flask/cli.py`, `tests/test_cli.py`, docs).
- Verification: `pytest tests/test_cli.py -q` passes, `flask config` outputs masked JSON, diff touches 3+ files.

### Task C (Resilience & Auto Fallback)
- Configure invalid API key or unreachable URL on primary model.
- Repeat Task A: Editor remains responsive, automatic fallback transparently routes to healthy secondary model without user intervention, diff is accepted, and `git status` remains clean on failure.
