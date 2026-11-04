import os
import sys
# Ensure parent directory is in sys.path so 'backend' package resolves regardless of cwd
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

import json
import asyncio
import fnmatch
import subprocess
import argparse
from typing import Optional, Dict, Any, List
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from mcp.server.mcpserver import MCPServer
import httpx2

try:
    from backend.context_engine import ContextAssembler, ASTSymbolExtractor
except ImportError:
    from context_engine import ContextAssembler, ASTSymbolExtractor

# Initialize FastAPI and MCPServer
app = FastAPI(title="TrueForge Python Sidecar Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

mcp = MCPServer(
    name="vscode-tools",
    instructions="Tools for exploring the workspace, reading files, searching code, proposing non-destructive edits, and running commands."
)

# Global in-memory state
workspace_root: str = os.path.abspath(os.environ.get("WORKSPACE_ROOT", os.getcwd()))
pending_edits: Dict[str, Dict[str, Any]] = {}
thought_signatures: Dict[str, str] = {}
context_assembler = ContextAssembler(workspace_root)

# ----------------- MCP Tools -----------------

@mcp.tool(
    name="read_file",
    description="Read the complete, exact contents of a file in the workspace."
)
def read_file(path: str) -> str:
    full_path = os.path.abspath(os.path.join(workspace_root, path))
    if not full_path.startswith(workspace_root) and not os.path.exists(full_path):
        return f"Error: Path '{path}' is outside workspace or does not exist."
    if not os.path.exists(full_path):
        return f"Error: File '{path}' not found."
    if os.path.isdir(full_path):
        return f"Error: '{path}' is a directory, not a file."

    print(f"[Sidecar MCP Tool] read_file(path={path})", flush=True)
    try:
        with open(full_path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except Exception as exc:
        return f"Error reading file '{path}': {str(exc)}"


@mcp.tool(name="list_dir", description="List files and directories in a workspace folder.")
def list_dir(directory: str = ".", recursive: bool = False, limit: int = 100) -> str:
    print(f"[Sidecar MCP Tool] list_dir(dir={directory}, rec={recursive})", flush=True)
    target_dir = os.path.abspath(os.path.join(workspace_root, directory))
    if not os.path.exists(target_dir):
        return f"Error: Directory '{directory}' not found."

    ignored_dirs = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "out", ".idea", ".vscode"}
    results: List[str] = []

    try:
        if recursive:
            for root, dirs, files in os.walk(target_dir):
                dirs[:] = [d for d in dirs if d not in ignored_dirs and not d.startswith(".")]
                rel_root = os.path.relpath(root, workspace_root)
                for f in files:
                    if f.startswith("."):
                        continue
                    rel_file = os.path.normpath(os.path.join(rel_root, f))
                    results.append(rel_file)
                    if len(results) >= limit:
                        break
                if len(results) >= limit:
                    break
        else:
            entries = sorted(os.listdir(target_dir))
            for entry in entries:
                if entry in ignored_dirs or entry.startswith("."):
                    continue
                p = os.path.join(target_dir, entry)
                suffix = "/" if os.path.isdir(p) else ""
                results.append(entry + suffix)
                if len(results) >= limit:
                    break

        return "\n".join(results) if results else "(empty directory)"
    except Exception as exc:
        return f"Error listing directory '{directory}': {str(exc)}"


@mcp.tool(name="search_workspace", description="Search for text or regex patterns across workspace files.")
def search_workspace(query: str, is_regex: bool = False, file_pattern: Optional[str] = None) -> str:
    print(f"[Sidecar MCP Tool] search_workspace(query='{query}', regex={is_regex}, pattern={file_pattern})", flush=True)
    ignored_dirs = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "out"}
    matches: List[str] = []
    max_matches = 50

    try:
        import re
        pattern = re.compile(query if is_regex else re.escape(query), re.IGNORECASE)

        for root, dirs, files in os.walk(workspace_root):
            dirs[:] = [d for d in dirs if d not in ignored_dirs and not d.startswith(".")]
            for filename in files:
                if file_pattern and not fnmatch.fnmatch(filename, file_pattern):
                    continue
                if filename.startswith(".") or filename.endswith((".pyc", ".png", ".jpg", ".exe", ".bin")):
                    continue

                filepath = os.path.join(root, filename)
                rel_path = os.path.relpath(filepath, workspace_root)
                try:
                    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                        for line_num, line in enumerate(f, 1):
                            if pattern.search(line):
                                matches.append(f"{rel_path}:{line_num}: {line.strip()}")
                                if len(matches) >= max_matches:
                                    return "\n".join(matches) + f"\n... (truncated at {max_matches} matches)"
                except Exception:
                    continue

        return "\n".join(matches) if matches else f"No matches found for '{query}'."
    except Exception as exc:
        return f"Search error: {str(exc)}"


@mcp.tool(
    name="propose_write",
    description="REQUIRED tool to submit code edits. DO NOT print code in chat. Submit your proposed file modifications by calling this tool with path, content, and reason. Buffers in memory for human diff review."
)
def propose_write(path: str, content: str, reason: str) -> str:
    print(f"[Sidecar MCP Tool] propose_write(path={path}, reason={reason[:50]}..., length={len(content)})", flush=True)
    full_path = os.path.abspath(os.path.join(workspace_root, path))
    norm_path = os.path.relpath(full_path, workspace_root).replace("\\", "/")

    original_content = ""
    is_new_file = True
    if os.path.exists(full_path):
        is_new_file = False
        try:
            with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                original_content = f.read()
        except Exception as e:
            original_content = f"(Failed to read original: {str(e)})"

    pending_edits[norm_path] = {
        "path": norm_path,
        "is_new_file": is_new_file,
        "original_content": original_content,
        "proposed_content": content,
        "reason": reason,
    }

    return (
        f"[STAGED IN MEMORY] Edit for '{norm_path}' buffered successfully.\n"
        f"Reason: {reason}\n"
        f"Status: Waiting for user to review and accept hunks in VS Code. Disk has NOT been touched."
    )


@mcp.tool(
    name="run_command",
    description="Execute a terminal command in the workspace directory. Requires user approval before execution."
)
def run_command(command: str, timeout_seconds: int = 30) -> str:
    try:
        proc = subprocess.run(
            command,
            cwd=workspace_root,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
        output = proc.stdout
        if proc.stderr:
            output += ("\nSTDERR:\n" + proc.stderr)
        output += f"\n(Exit code: {proc.returncode})"
        return output.strip()
    except subprocess.TimeoutExpired:
        return f"Error: Command timed out after {timeout_seconds} seconds."
    except Exception as exc:
        return f"Execution error: {str(exc)}"


@mcp.tool(
    name="assemble_context",
    description="Assemble workspace context using BM25 search and AST symbol ranking under a strict 4,000-token budget with an explanation table."
)
def assemble_context(query: str, mentions: Optional[List[str]] = None, max_tokens: int = 4000) -> str:
    context_assembler.workspace_root = workspace_root
    context_assembler.max_tokens = max_tokens
    res = context_assembler.assemble(query, mentions)
    return res["full_context"]


@mcp.tool(
    name="get_workspace_outline",
    description="Get AST symbol outline (classes, functions, methods) for Python files in workspace."
)
def get_workspace_outline(target_file: Optional[str] = None) -> str:
    if target_file:
        full_path = os.path.abspath(os.path.join(workspace_root, target_file))
        syms = ASTSymbolExtractor.extract_symbols_from_file(full_path, target_file)
    else:
        syms = context_assembler.get_all_symbols()

    if not syms:
        return "No symbols found."

    lines = [f"- `{s['name']}` ({s['kind']}) in {s['file']}:{s['line']} - {s['doc']}" for s in syms[:40]]
    return f"Workspace AST Symbols ({len(syms)} total):\n" + "\n".join(lines)


# ----------------- REST Endpoints -----------------

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "trueforge-backend",
        "workspace": workspace_root,
        "pending_edits_count": len(pending_edits),
    }

class SetWorkspaceRequest(BaseModel):
    workspace_root: str

@app.post("/api/workspace")
def set_workspace(req: SetWorkspaceRequest):
    global workspace_root, context_assembler
    if os.path.exists(req.workspace_root):
        workspace_root = os.path.abspath(req.workspace_root)
        context_assembler = ContextAssembler(workspace_root)
        return {"status": "ok", "workspace": workspace_root}
    raise HTTPException(status_code=400, detail="Workspace directory does not exist")

@app.get("/api/pending_edits")
def get_pending_edits():
    return {"pending_edits": list(pending_edits.values())}

class ClearEditRequest(BaseModel):
    path: Optional[str] = None

@app.post("/api/pending_edits/clear")
def clear_pending_edits(req: ClearEditRequest):
    if req.path:
        norm_path = req.path.replace("\\", "/")
        if norm_path in pending_edits:
            del pending_edits[norm_path]
    else:
        pending_edits.clear()
    return {"status": "ok", "remaining": len(pending_edits)}

@app.get("/api/mentions")
def get_mentions(query: str = ""):
    files = context_assembler.get_all_files()
    symbols = context_assembler.get_all_symbols()

    q = query.lower()
    matching_files = [f for f in files if q in f.lower()][:15]
    matching_syms = [
        {"name": s["name"], "kind": s["kind"], "file": s["file"], "line": s["line"]}
        for s in symbols if q in s["name"].lower()
    ][:15]

    return {
        "files": matching_files,
        "symbols": matching_syms,
    }

# ----------------- Google Gemini OpenAI Compatibility Bridge -----------------
# Seamlessly preserves thought_signatures required for Gemini 3 tool calling
GOOGLE_OPENAI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"

@app.post("/openai/chat/completions")
@app.post("/openai/v1/chat/completions")
async def openai_chat_completions(req: Request):
    body = await req.json()
    auth = req.headers.get("authorization", "")
    model = body.get("model", "")
    messages = body.get("messages", [])

    print(f"\n[Bridge Request] Model: {model} | Messages count: {len(messages)} | Last role: {messages[-1].get('role') if messages else 'none'}", flush=True)

    # Re-inject thought signatures for any tool calls in assistant messages
    re_injected_count = 0
    for msg in messages:
        if msg.get("role") == "assistant" and "tool_calls" in msg:
            for tc in msg.get("tool_calls", []):
                t_id = tc.get("id")
                if t_id and t_id in thought_signatures:
                    tc["extra_content"] = {
                        "google": {
                            "thought_signature": thought_signatures[t_id]
                        }
                    }
                    re_injected_count += 1
                elif t_id:
                    print(f"[Bridge Warning] Tool call {t_id} NOT found in signatures cache! (Cached: {list(thought_signatures.keys())})", flush=True)

    if re_injected_count > 0:
        print(f"[Bridge] Successfully re-injected {re_injected_count} thought signature(s).", flush=True)

    headers = {"Authorization": auth, "Content-Type": "application/json"}
    is_stream = body.get("stream", False)
    client = httpx2.AsyncClient(timeout=120.0)

    if not is_stream:
        try:
            resp = await client.post(GOOGLE_OPENAI_URL, json=body, headers=headers)
            try:
                data = resp.json()
                for choice in data.get("choices", []):
                    msg = choice.get("message", {})
                    for tc in msg.get("tool_calls", []):
                        t_id = tc.get("id")
                        sig = tc.get("extra_content", {}).get("google", {}).get("thought_signature")
                        if t_id and sig:
                            thought_signatures[t_id] = sig
            except Exception:
                pass
            return Response(content=resp.content, status_code=resp.status_code, media_type="application/json")
        finally:
            await client.aclose()
    else:
        max_retries = 3
        google_resp = None
        for attempt in range(max_retries):
            google_req = client.build_request("POST", GOOGLE_OPENAI_URL, json=body, headers=headers)
            google_resp = await client.send(google_req, stream=True)
            if google_resp.status_code == 429 and attempt < max_retries - 1:
                body_bytes = await google_resp.aread()
                retry_sec = 15
                try:
                    err_json = json.loads(body_bytes.decode())
                    for detail in err_json.get("error", {}).get("details", []):
                        if "retryDelay" in detail:
                            delay_str = detail["retryDelay"].rstrip("s")
                            retry_sec = max(int(float(delay_str)), 5)
                except Exception:
                    pass
                print(f"\n[Bridge 429 Throttle] Pausing {retry_sec}s for Google rate limit window reset...", flush=True)
                await asyncio.sleep(retry_sec + 1)
                continue
            break

        async def stream_generator():
            try:
                buffer = ""
                async for chunk in google_resp.aiter_bytes():
                    buffer += chunk.decode("utf-8", errors="ignore")
                    lines = buffer.split("\n")
                    buffer = lines.pop()
                    for line in lines:
                        if line.startswith("data: ") and not line.strip().endswith("[DONE]"):
                            try:
                                d = json.loads(line[6:].strip())
                                for choice in d.get("choices", []):
                                    delta = choice.get("delta", {})
                                    for tc in delta.get("tool_calls", []):
                                        t_id = tc.get("id")
                                        fn = tc.get("function", {})
                                        fn_name = fn.get("name")
                                        fn_args = fn.get("arguments")
                                        if fn_name:
                                            print(f"\n[Bridge LLM Generates Tool Call]: {fn_name}", flush=True)
                                        if fn_args:
                                            print(f" {fn_args}", end="", flush=True)
                                        sig = tc.get("extra_content", {}).get("google", {}).get("thought_signature")
                                        if t_id and sig:
                                            thought_signatures[t_id] = sig
                                            print(f"\n[Bridge Stream] Cached thought signature for {t_id}: {sig[:30]}...", flush=True)
                            except Exception:
                                pass
                    yield chunk
            finally:
                await google_resp.aclose()
                await client.aclose()

        return StreamingResponse(
            stream_generator(),
            status_code=google_resp.status_code,
            media_type="text/event-stream"
        )

@app.get("/mcp")
def mcp_redirect():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/mcp/sse")

# Mount the MCP server as an SSE application under /mcp
app.mount("/mcp", mcp.sse_app())

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TrueForge Python Sidecar")
    parser.add_argument("--port", type=int, default=4545, help="Port to listen on")
    parser.add_argument("--workspace", type=str, default=os.getcwd(), help="Target workspace path")
    args = parser.parse_args()

    workspace_root = os.path.abspath(args.workspace)
    context_assembler = ContextAssembler(workspace_root)
    import uvicorn
    print(f"[Sidecar] Starting on http://127.0.0.1:{args.port} (Workspace: {workspace_root})")
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")
