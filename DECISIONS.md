# Architectural Decisions & Design Rationale

## Decision 1: Lean Extension from Scratch vs. Forking (Cline / Continue / Roo Code)
- **Decision:** Build a lean extension from scratch using TypeScript and VS Code APIs, with a Python sidecar for backend tools.
- **Rationale:**
  - Hard constraint: The agent loop must run on TrueForge.
  - Cline / Roo Code have their agent loops (`Cline.ts`) tightly coupled to hundreds of internal functions, direct LLM API calls, and custom state machines. Ripping it out while keeping their UI creates immense technical debt and high bug risk. Furthermore, Cline lacks in-editor inline diff editing (Ctrl+I).
  - Continue is a massive multi-language monorepo where core indexing, autocomplete, and LLM calls are deeply entwined.
  - Building a lean extension guarantees zero dead code, strict adherence to competition rules, rapid build times (< 2s via esbuild), and 100% focus on the 5 mandatory capabilities and 3 demo tasks.

## Decision 2: Backend in Python for MCP Tools & Context Indexing
- **Decision:** The extension host launches a lightweight Python sidecar server (`backend/mcp_server.py`) exposing the MCP tools and context search engine.
- **Rationale:**
  - Python provides fast, mature libraries for code parsing (AST, tree-sitter, jedi/pyright), BM25 text retrieval, and subprocess execution.
  - The Python server exposes standard MCP HTTP/SSE endpoints that TrueForge interacts with natively.
  - The VS Code extension connects to the Python sidecar via local IPC / HTTP for bidirectional communication (buffering proposed writes and triggering editor diff decorations).

## Decision 3: In-Memory Edit Staging (Zero Silent Writes & Safe Cancellation)
- **Decision:** The agent's `propose_write` tool writes nothing to disk. All proposed modifications are kept in memory (`StagedChangesRegistry`).
- **Rationale:**
  - Writing directly to disk and rolling back on cancel is error-prone, risks data loss, and leaves dirty git working trees.
  - In-memory staging guarantees that cancellation immediately clears pending hunks without touching disk files.
  - Disk writes only happen when the user clicks "Accept Hunk" or "Accept All", applied via `vscode.workspace.applyEdit` so the operation enters VS Code's native undo stack (`Ctrl+Z`).

## Decision 4: TrueForge Network Policy Configuration
- **Decision:** Launch TrueForge with `NETWORK_POLICY_ENABLED=false` or `OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1","localhost"]'`.
- **Rationale:**
  - TrueForge's internal SSRF guard (`assertSafeOutboundUrl`) blocks private loopback IPs by default.
  - Disabling the outbound guard for local execution allows TrueForge to connect to the local Python MCP server without encountering connection refused errors.

## Decision 5: Two-Tier Context Assembly with Strict Token Budget
- **Decision:** Explicit `@file` and `@symbol` mentions are given top priority, followed by top-K ranked workspace snippets from AST outline and BM25 search, capped at a strict 4,000-token budget.
- **Rationale:**
  - Prevents context window bloat and runaway latency.
  - Fulfills the requirement that the agent visibly explains why each file was selected.
