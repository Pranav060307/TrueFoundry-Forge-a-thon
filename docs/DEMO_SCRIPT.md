# TrueForge Coding Agent: 4-Minute Demo Video Walkthrough Script

This script serves as the exact turn-by-turn production guide for recording the **4-minute Round 1 Demo Video** for the **TrueFoundry Forge-a-thon (Techfest 2026-27, IIT Bombay)**.

> **Rules Checklist (PDF Page 5-6):**
> - Maximum duration: **4:00 minutes** (do not exceed).
> - Editor must remain clearly visible throughout.
> - Tasks **A**, **B**, and **C** in that **exact order**.
> - Each task must be followed by its **on-screen terminal verification**.
> - The **TrueForge session view** (turns and tool calls) must be shown briefly during **Task B**.
> - You may cut out model waiting time; **do not cut between prompt and diff appearance**.

---

## ⏱️ Video Timeline & Scene Breakdown

### Scene 1: Introduction & System Health (00:00 – 00:14)
* **Visual:** VS Code editor open with `pallets/flask` workspace (tag `3.1.3`, commit `22d92470`).
* **Actions:**
  1. Show status bar showing `$(check) TrueForge: Connected (:8790)` and `$(check) Sidecar: Healthy (:4545)`.
  2. Briefly display the Agent Panel in the sidebar.
* **On-Screen Text / Voiceover:**
  > *"This is TrueForge Coding Agent, an editor-native coding assistant built strictly on TrueFoundry's TrueForge harness. All reasoning runs on TrueForge at localhost:8790, while editor capabilities are exposed as MCP tools via a local Python sidecar."*

---

### Scene 2: Task A – Inline Edit & Diff Review (00:15 – 00:52)
* **Visual:** Open `src/flask/helpers.py`, navigate to line 26 (`def get_debug_flag()`).
* **Actions:**
  1. Highlight the `get_debug_flag` function.
  2. Press `Ctrl+I` (or `Cmd+I` on macOS) to open the TrueForge Inline Edit floating bar.
  3. Type the exact prompt:
     `Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.`
  4. Press `Enter`. Show the in-memory staging in action:
     - Side-by-side virtual diff opens (`trueforge-diff://src/flask/helpers.py`).
     - 0-line context Myers diff hunks appear with CodeLens action buttons: `[✓ Accept Hunk] [✗ Reject Hunk]`.
  5. Click `[✓ Accept Hunk]` on each hunk (or click `✓ Accept` in the TrueForge panel status bar).
* **On-Screen Verification (Terminal):**
  1. Run:
     ```bash
     FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"
     ```
  2. Terminal prints: `False` (Baseline was `True`).
  3. Run:
     ```bash
     FLASK_DEBUG=n python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"
     ```
  4. Terminal prints: `False`.
  5. Press `Ctrl+Z` to show native VS Code undo restoring the original file cleanly.

---

### Scene 3: Task B – Autonomous Agent Mode Across 3+ Files (00:53 – 02:08)
* **Visual:** Switch focus to the sidebar Agent Panel.
* **Actions:**
  1. In the prompt input, enter the exact unprompted instruction (no files named):
     `Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as '***'. It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.`
  2. Click **Send** (`Enter`).
  3. **Context Engine Display:** The agent displays the Context Assembly explanation table in the panel, showing:
     - Okapi BM25 scores and AST symbol extraction across workspace files.
     - Strict 4,000-token budget utilization.
  4. **Autonomous MCP Tool Loop:**
     - Agent autonomously invokes `search_workspace` and `read_file`.
     - Agent discovers the 3 target files: `src/flask/cli.py`, `tests/test_cli.py`, and `docs/cli.rst`.
     - Agent invokes `propose_write` for each file, buffering them strictly in memory.
  5. **TrueForge Session Inspection:** Switch briefly to browser / terminal showing the TrueForge session at `http://localhost:8790` (showing turns, dynamic subagents, and tool calls).
  6. **Diff Review:** Virtual diff tabs open for all 3 files. Click `[Accept All Hunks]`.
* **On-Screen Verification (Terminal):**
  1. Show git diff stats touching 3 files:
     ```bash
     git diff --stat
     ```
     *(Outputs: docs/cli.rst, src/flask/cli.py, tests/test_cli.py - 3 files changed)*
  2. Verify command appears in help:
     ```bash
     flask --help
     ```
     *(Shows `config` command under Commands)*
  3. Verify JSON output and masking:
     ```bash
     flask config
     ```
     *(Displays formatted JSON with `SECRET_KEY`, `APP_SECRET`, `API_KEY` masked as `***`)*
  4. Run full CLI test suite:
     ```bash
     pytest tests/test_cli.py -q
     ```
     *(Shows: `56 passed, 3 skipped`)*

---

### Scene 4: Streaming & Instant Cancellation (02:09 – 02:35)
* **Visual:** Agent Panel in sidebar.
* **Actions:**
  1. Type a long multi-step exploration query:
     `Analyze all routes, blueprints, and request handlers across the entire Flask codebase and summarize them in detail.`
  2. Press **Send**.
  3. Watch tokens stream in real time via SSE from TrueForge.
  4. Click the **Stop (Cancel)** button mid-generation.
  5. Demonstrate:
     - Generation aborts immediately with `[Cancelled]`.
     - The editor never freezes or blocks.
     - Run `git status` in terminal -> working tree remains completely clean with no dirty half-applied writes.

---

### Scene 5: Task C – Resilience & Transparent Auto Fallback (02:36 – 03:25)
* **Visual:** Extension Settings / Configuration.
* **Actions:**
  1. Point the primary model to an invalid API key / unreachable endpoint (`anthropic/invalid-broken-endpoint`).
  2. Repeat the Task A inline edit instruction on `src/flask/helpers.py`.
  3. Press **Enter**.
  4. **Observation:**
     - Primary call returns 401 Unauthorized / Connection Error.
     - Extension's `ModelFailoverManager` catches failure.
     - Non-blocking status notification appears: `Primary model failed, transparently failover to: openai/gpt-4o-mini`.
     - Fallback model seamlessly completes the turn with zero user intervention.
     - Diff opens in diff viewer; accept hunks.
  5. Terminal verification: `git status` shows only accepted changes, zero corrupted state.

---

### Scene 6: Conclusion & Repository Transparency (03:26 – 04:00)
* **Visual:** Repository overview and terminal test run.
* **Actions:**
  1. Run full test suite in terminal:
     ```bash
     npm test
     ```
     *(Shows all 5 suites passing: Myers diff, Task A, Task B, Task C).*
  2. Run backend test suite:
     ```bash
     python tests/test_backend.py
     ```
     *(Shows all 10 MCP sidecar tests passing).*
  3. Show `docs/TrueForge_Coding_Agent_Writeup.pdf` (compliant 3-page write-up with Scorecard).
  4. Final statement:
     > *"Built from scratch for Techfest 2026-27 IIT Bombay. Zero silent writes, model-agnostic, and 100% powered by TrueForge."*

---

## 💡 Practical Recording Tips
1. **Resolution:** 1080p (1920x1080) at 30 or 60 fps with clear editor font size (14-16px).
2. **Terminal:** Have your commands pre-written in a side buffer or shell history so you can press `Up Arrow + Enter` quickly to avoid wasting time typing.
3. **Quick Action Task Prompt Buttons:** Use the one-click task prompt buttons in the Webview panel (`⚡ Task A`, `⚡ Task B (3 Files)`) to instantly paste the exact competition task prompts into the agent input.
4. **Video Upload:** Upload as **Unlisted** on YouTube or **Anyone with the link can view** on Google Drive as required by the Techfest Competition Portal.

