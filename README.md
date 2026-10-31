# TrueForge VS Code Coding Agent

An autonomous VS Code coding agent extension whose core agent reasoning loop runs on [TrueForge](https://github.com/truefoundry/trueforge) (`@truefoundry/trueforge`), TrueFoundry's open-source agent harness.

Developed for the **TrueFoundry Forge-a-thon (Techfest 2026-27, IIT Bombay)**.

---

## Architecture Overview

The extension is **strictly a client** of the local TrueForge agent harness:
1. **Agent Loop on TrueForge:** All reasoning, turns, sessions, and state management run inside TrueForge (`http://localhost:8790`). The extension never calls model providers directly.
2. **Editor Capabilities as MCP Tools:** The editor exposes workspace tools (`read_file`, `search_workspace`, `list_dir`, `propose_write`, `run_command`) as an embedded MCP server (`http://127.0.0.1:4545/mcp`) running in a Python FastAPI sidecar.
3. **In-Memory Non-Destructive Writes:** The agent's `propose_write` tool buffers edits in memory. Nothing is written silently to disk. Every change is reviewed hunk-by-hunk and applied via `vscode.WorkspaceEdit`, preserving full native undo (`Ctrl+Z`).
4. **Resilience & Fallback:** TrueForge currently configures a single model per agent spec (multi-model fallback is documented as planned in the TrueForge roadmap). The extension client implements automatic model failover with zero user intervention when an endpoint is unreachable or credentials are misconfigured.
5. **Zero-Setup Local Execution:** TrueForge's internal SSRF guard (`assertSafeOutboundUrl`) blocks private loopback IPs (`127.0.0.1`, `localhost`) by default. The extension automatically spawns TrueForge with `NETWORK_POLICY_ENABLED=false` and `OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1","localhost"]'`, ensuring seamless local MCP server connectivity out of the box.

---

## Clean-Clone Setup

### 1. Prerequisites
- Node.js (v22+)
- Python (3.10+)
- VS Code (v1.90+)

### 2. Install Dependencies & Build
```bash
git clone <repo-url>
cd "True foundary"
npm install
npm run build
```

### 3. Configure Models
Create your local gitignored config file:
```bash
cp agent/trueforge.config.example.json agent/trueforge.config.json
```
Add your real model provider API key(s) (Anthropic, OpenAI, or any OpenAI-compatible endpoint) into `agent/trueforge.config.json`. This file is gitignored and will never be committed.

### 4. Running the Extension
Open this repository folder in VS Code and press `F5` (or run `npm run dev`).
The extension automatically starts:
1. The Python MCP sidecar on `http://127.0.0.1:4545`
2. The TrueForge harness on `http://localhost:8790` with loopback enabled
3. The TrueForge Agent sidebar Webview panel

---

## Verification & Testing
Run automated unit tests:
```bash
# Test TypeScript TrueForge client
npm test

# Test Python MCP backend tools
python tests/test_backend.py

# Test Flask 3.1.3 baseline test suite
D:\flask\.venv\Scripts\pytest.exe D:\flask\tests\test_cli.py -q
```

---

## License
MIT License. See [LICENSE](LICENSE) for details.
