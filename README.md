# TrueForge VS Code Coding Agent

An autonomous VS Code coding agent extension whose core agent reasoning loop runs on [TrueForge](https://github.com/truefoundry/trueforge) (`@truefoundry/trueforge`), TrueFoundry's open-source agent harness.

Developed for the **TrueFoundry Forge-a-thon (Techfest 2026-27, IIT Bombay)**.

---

## Architecture Overview

The extension is **strictly a client** of the local TrueForge agent harness:
1. **Agent Loop on TrueForge:** All reasoning, turns, sessions, and state management run inside TrueForge (`http://localhost:8790`). The extension never calls model providers directly.
2. **Editor Capabilities as MCP Tools:** The editor exposes workspace tools (`read_file`, `search_workspace`, `list_files`, `propose_write`, `run_command`) as an embedded MCP server (`http://127.0.0.1:4545/mcp`).
3. **In-Memory Non-Destructive Writes:** The agent's `propose_write` tool buffers edits in memory. Nothing is written silently to disk. Every change is reviewed hunk-by-hunk and applied via `vscode.WorkspaceEdit`, preserving full native undo (`Ctrl+Z`).
4. **Resilience & Fallback:** Supports automatic model failover with zero user intervention when an endpoint is unreachable or credentials are misconfigured.

---

## Clean-Clone Setup

### 1. Prerequisites
- Node.js (v22+)
- Python (3.10+)
- VS Code (v1.90+)

### 2. Install Dependencies & Build Extension
```bash
git clone <repo-url>
cd "True foundary"
npm install
npm run build
```

### 3. Configure Models
Copy the example configuration file:
```bash
cp trueforge/trueforge.config.example.json trueforge.config.json
```
Edit `trueforge.config.json` with your model provider API key(s) (Anthropic, OpenAI, or any OpenAI-compatible endpoint).

### 4. Start Local TrueForge Harness
TrueForge runs locally via `npx @truefoundry/trueforge@latest`. Because TrueForge connects to the local extension MCP server, start it with `NETWORK_POLICY_ENABLED=false`:

**Windows (PowerShell):**
```powershell
.\trueforge\start-trueforge.ps1
```

**Linux / macOS:**
```bash
chmod +x ./trueforge/start-trueforge.sh
./trueforge/start-trueforge.sh
```

### 5. Run & Debug Extension in VS Code
1. Open this repository folder in VS Code.
2. Press `F5` to launch an Extension Development Host window.
3. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:
   - `TrueForge: Stream Hello Prompt` (tests live streaming connection)
   - `TrueForge: Inline Edit Selection` (`Ctrl+I` on active selection)

---

## Verification & Testing
Run automated unit tests:
```bash
npm test
```

---

## License
MIT License. See [LICENSE](LICENSE) for details.
