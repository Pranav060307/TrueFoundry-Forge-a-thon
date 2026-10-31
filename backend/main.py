import os
import sys
import json
import fnmatch
import subprocess
import argparse
from typing import Optional, Dict, Any, List
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from mcp.server.mcpserver import MCPServer

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

# ----------------- MCP Tools -----------------

@mcp.tool(name="read_file", description="Read the contents of a file within the workspace. Supports optional line range slicing.")
def read_file(path: str, start_line: Optional[int] = None, end_line: Optional[int] = None) -> str:
    full_path = os.path.abspath(os.path.join(workspace_root, path))
    if not full_path.startswith(workspace_root) and not os.path.exists(full_path):
        return f"Error: Path '{path}' is outside workspace or does not exist."
    if not os.path.exists(full_path):
        return f"Error: File '{path}' not found."
    if os.path.isdir(full_path):
        return f"Error: '{path}' is a directory, not a file."

    try:
        with open(full_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()

        total_lines = len(lines)
        s = 1 if start_line is None else max(1, start_line)
        e = total_lines if end_line is None else min(total_lines, end_line)

        selected = lines[s - 1 : e]
        numbered_lines = [f"{s + idx}: {line}" for idx, line in enumerate(selected)]
        return f"File: {path} (Lines {s}-{e} of {total_lines})\n" + "".join(numbered_lines)
    except Exception as exc:
        return f"Error reading file '{path}': {str(exc)}"


@mcp.tool(name="list_dir", description="List files and directories in a workspace folder.")
def list_dir(directory: str = ".", recursive: bool = False, limit: int = 100) -> str:
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
    description="Propose creating or updating a file. DOES NOT WRITE TO DISK. Buffers edit in memory for human diff review."
)
def propose_write(path: str, content: str, reason: str) -> str:
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
    global workspace_root
    if os.path.exists(req.workspace_root):
        workspace_root = os.path.abspath(req.workspace_root)
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

# Mount the MCP server as an SSE application under /mcp
app.mount("/mcp", mcp.sse_app())

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TrueForge Python Sidecar")
    parser.add_argument("--port", type=int, default=4545, help="Port to listen on")
    parser.add_argument("--workspace", type=str, default=os.getcwd(), help="Target workspace path")
    args = parser.parse_args()

    workspace_root = os.path.abspath(args.workspace)
    import uvicorn
    print(f"[Sidecar] Starting on http://127.0.0.1:{args.port} (Workspace: {workspace_root})")
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")

