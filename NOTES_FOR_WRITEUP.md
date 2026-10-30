# Notes for Final Write-up (1-3 Page PDF)

## 1. System Architecture
- **Client:** VS Code Extension (TypeScript, VS Code API, esbuild).
  - Webview sidebar (chat interface, tool timeline, cancellation control).
  - Inline Diff Editor (Ctrl+I, CodeLens hunk accept/reject, decorations).
  - Native Undo integration via `vscode.WorkspaceEdit`.
- **Backend Sidecar:** Python MCP Server (`backend/mcp_server.py`).
  - Implements Model Context Protocol over HTTP/SSE.
  - Exposes `workspace_read_file`, `workspace_search_text`, `workspace_list_files`, `workspace_write_file_proposal`, `workspace_run_command`.
  - Context engine: AST indexing, BM25 keyword search, and token budget enforcement.
- **Harness & Agent Runtime:** TrueForge (`@truefoundry/trueforge`).
  - Manages agent reasoning loop, sessions, turns, tool approvals, and context compaction.
  - Connects to model providers (OpenAI, Anthropic, Gemini, or local OpenAI-compatible endpoints).

## 2. Exposed MCP Tools
1. `workspace_read_file(path, start_line?, end_line?)`: Safe file reader with optional range slicing.
2. `workspace_search_text(query, is_regex?, file_pattern?)`: Fast ripgrep/workspace regex search.
3. `workspace_list_files(directory?, pattern?)`: Glob file search respecting `.gitignore`.
4. `workspace_write_file_proposal(path, content, reason)`: In-memory staged edit tool. Triggers human-in-the-loop review. Does not write to disk.
5. `workspace_run_command(command, cwd?)`: Terminal execution requiring explicit approval.

## 3. Context Strategy & Budgeting
- **Ceiling:** 4,000 tokens (~16 KB).
- **Partition:** 40% active editor buffer, 35% explicit `@file` and `@symbol` mentions, 25% automatic BM25 relevance retrieval.
- **Explanation:** Agent visibly logs selected files and the justification for each choice before executing edits.

## 4. Models & Fallback Configuration
- Primary Model: Anthropic Claude Sonnet 3.5 / OpenAI GPT-4o or compatible endpoint.
- Fallback Model: Backup endpoint or secondary provider.
- Automatic failover triggered seamlessly on network timeout or authentication rejection.

## 5. Scoring Priorities Addressed
- Per-hunk accept/reject with native undo shown live.
- Zero silent writes (all edits staged in-memory).
- Automatic model fallback without user intervention.
- Immediate cancellation leaving git status clean.
