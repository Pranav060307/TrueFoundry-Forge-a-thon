# TrueForge API & Architecture Notes

## 1. Sessions & Turns
- **Session creation:** `POST /api/v1/sessions`
  - Body: `{ "agent": { "name": "<saved_agent_name>" } }` or inline spec `{ "agent": { "spec": { ... } } }`.
  - Response: `{ "data": { "id": "sess-...", "agent": { ... }, "created_at": "..." } }`.
  - Sessions persist in local SQLite (`~/.trueforge/trueforge.db` in standalone mode).
- **Turn creation:** `POST /api/v1/sessions/{session_id}/turns`
  - Body: `{ "input": [{ "type": "user.message", "content": "..." }] }` (or tool approval/response).
  - Defaults to `stream: true`, streaming Server-Sent Events (SSE).
  - Turns chain automatically (`previous_turn_id: "auto"`).
  - Only one active turn executes per session; posting a turn auto-cancels any in-flight turn.
- **Cancellation:** `POST /api/v1/sessions/{session_id}/cancel` stops turn execution immediately, terminates in-flight model calls, and closes the SSE stream with `turn.done` (`status: "cancelled"`).

## 2. Streaming Event Format
- All events carry: `{ "type": string, "id": string, "thread_id": string | null, "created_at": string }`.
  - `thread_id: "main"`: root agent.
  - `thread_id: "<id>"`: dynamic subagents (announced by `thread.created` / `thread.done`).
  - `thread_id: null`: session/turn-level events (`turn.created`, `turn.done`, `mcp.initialize`).
- Stream lifecycle:
  1. `turn.created`: Initial event with `turn_id` and `state: { "status": "running" }`.
  2. `mcp.initialize`: Connected MCP server metadata.
  3. `model.message`: Empty base event shell with unique `id`.
  4. `model.message.delta`: Text or tool call chunks with matching `id`. Merged with `mergeEventDelta()`.
  5. `tool.response`: Result of executed tool (`tool_call_id`, `content`).
  6. `tool.approval_required`: Emitted when gated tool needs approval (`tool_calls: [{ id, source_event_id }]`).
  7. `turn.done`: Terminal event. `state.status` is `done`, `cancelled`, or `error`. When paused for approval, `state.required_actions` contains the pending approval refs.

## 3. Registering MCP Tools
- Registered as remote HTTP/SSE servers via `POST /api/v1/settings/mcp-servers`:
  ```json
  {
    "manifest": {
      "type": "remote",
      "name": "vscode-tools",
      "url": "http://127.0.0.1:4545/mcp",
      "description": "Workspace tools for file reading, editing, and terminal commands"
    }
  }
  ```
- **SSRF Policy:** TrueForge guards private IPs (`127.0.0.1`, `localhost`). To connect to the local extension/sidecar MCP server, TrueForge must be started with:
  `NETWORK_POLICY_ENABLED=false` or `OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1","localhost"]'`.

## 4. Tool Approval Flow
- In `AgentSpec.mcp_servers`, configure `require_approval_for_tools`:
  `["@write", "@destructive", "propose_write_file", "run_terminal_command"]`.
- TrueForge pauses when the agent calls a gated tool, emitting `tool.approval_required`.
- The turn closes with `turn.done` (`state.status: "done"`, `output: null`).
- The client reads tool arguments from the base `model.message` via `source_event_id`, renders diff/prompt, and upon user confirmation sends a new turn:
  ```json
  {
    "input": [{
      "type": "user.tool_approval",
      "thread_id": "main",
      "tool_call_id": "<call_id>",
      "approval": { "status": "allow" }
    }]
  }
  ```

## 5. Agent Definitions
- Saved via `POST /api/v1/agents` or provided inline in `sessions.create`:
  ```json
  {
    "model": {
      "name": "anthropic/claude-sonnet-4-6",
      "params": { "max_tokens": 4096, "temperature": 0.2 }
    },
    "instructions": "System prompt for coding agent...",
    "mcp_servers": [{
      "name": "vscode-tools",
      "enable_tools": ["@all"],
      "require_approval_for_tools": ["@write", "@destructive"],
      "preload": false
    }],
    "config": {
      "sandbox": { "enabled": false },
      "dynamic_sub_agents": { "enabled": true },
      "context_management": {
        "compaction": { "enabled": true, "trigger": { "type": "input_tokens", "value": 50000 } },
        "large_tool_response": { "enabled": true }
      },
      "iteration_limit": 50
    }
  }
  ```

## 6. Configuring Models & Fallbacks
- Configured under `Settings -> Models` or via `packages/trueforge/catalog/model-catalog.yaml`.
- Supports OpenAI, Anthropic, Gemini, or any `custom` OpenAI-compatible base URL.
- TrueForge delegates multi-model routing to AI Gateway / provider endpoints.
- In client/extension: if the primary configured endpoint returns 401/timeout/error on turn initialization, the client automatically re-points to the secondary model spec and retries the turn transparently without user intervention (Task C resilience).

## 7. Context-Engineering Features
1. **Deferred Tool Loading:** Set `mcp_servers[].preload: false`. Tool schemas are discovered on demand, keeping initial prompts small.
2. **Context Compaction:** Enabled in `config.context_management.compaction`. Summarizes older dialogue when input tokens exceed threshold (default 80% of window or 50,000 tokens).
3. **Large Tool Response Offloading:** `config.context_management.large_tool_response.enabled: true`. Oversized tool outputs are written to sandbox/disk with a brief summary in active context.
4. **Dynamic Subagents:** `config.dynamic_sub_agents.enabled: true`. Main agent can delegate sub-tasks to parallel child agents, merging summarized outputs.
5. **Code Mode & Skills:** Enabled when `config.sandbox.enabled: true`. Allows running code scripts and loading git-backed `SKILL.md` instruction packs.
