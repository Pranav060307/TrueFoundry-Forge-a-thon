import os
import ast
import re
import math
from typing import List, Dict, Any, Optional, Tuple

class ASTSymbolExtractor:
    """
    Extracts top-level and class-level symbols (classes, functions, methods)
    and docstrings from Python source files using Python's ast module.
    """
    @staticmethod
    def extract_symbols_from_code(code: str, file_path: str) -> List[Dict[str, Any]]:
        symbols: List[Dict[str, Any]] = []
        try:
            tree = ast.parse(code, filename=file_path)
        except Exception:
            return symbols

        for node in ast.iter_child_nodes(tree):
            if isinstance(node, ast.FunctionDef) or isinstance(node, getattr(ast, "AsyncFunctionDef", ast.FunctionDef)):
                doc = ast.get_docstring(node) or ""
                doc_summary = doc.strip().split("\n")[0] if doc else ""
                symbols.append({
                    "name": node.name,
                    "kind": "function",
                    "file": file_path,
                    "line": node.lineno,
                    "doc": doc_summary,
                })
            elif isinstance(node, ast.ClassDef):
                class_doc = ast.get_docstring(node) or ""
                class_doc_summary = class_doc.strip().split("\n")[0] if class_doc else ""
                symbols.append({
                    "name": node.name,
                    "kind": "class",
                    "file": file_path,
                    "line": node.lineno,
                    "doc": class_doc_summary,
                })
                # Methods within class
                for item in node.body:
                    if isinstance(item, ast.FunctionDef) or isinstance(item, getattr(ast, "AsyncFunctionDef", ast.FunctionDef)):
                        method_doc = ast.get_docstring(item) or ""
                        method_summary = method_doc.strip().split("\n")[0] if method_doc else ""
                        symbols.append({
                            "name": f"{node.name}.{item.name}",
                            "kind": "method",
                            "file": file_path,
                            "line": item.lineno,
                            "doc": method_summary,
                        })
        return symbols

    @classmethod
    def extract_symbols_from_file(cls, full_path: str, rel_path: str) -> List[Dict[str, Any]]:
        if not full_path.endswith(".py") or not os.path.exists(full_path):
            return []
        try:
            with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                code = f.read()
            return cls.extract_symbols_from_code(code, rel_path)
        except Exception:
            return []


class BM25Ranker:
    """
    Lightweight, robust in-memory Okapi BM25 implementation for workspace files.
    Calculates TF-IDF and length-normalized BM25 scores.
    """
    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.docs: List[Dict[str, Any]] = []
        self.doc_lengths: List[int] = []
        self.avg_doc_len: float = 0.0
        self.df: Dict[str, int] = {}
        self.total_docs: int = 0

    @staticmethod
    def tokenize(text: str) -> List[str]:
        return [w.lower() for w in re.findall(r"[A-Za-z0-9_]{2,}", text)]

    def index_documents(self, documents: List[Dict[str, Any]]) -> None:
        """
        documents: list of {"path": str, "content": str}
        """
        self.docs = documents
        self.total_docs = len(documents)
        self.doc_lengths = []
        self.df = {}

        total_len = 0
        for doc in self.docs:
            tokens = self.tokenize(doc["content"])
            doc["tokens"] = tokens
            doc["tf"] = {}
            seen = set()
            for t in tokens:
                doc["tf"][t] = doc["tf"].get(t, 0) + 1
                if t not in seen:
                    self.df[t] = self.df.get(t, 0) + 1
                    seen.add(t)
            doc_len = len(tokens)
            self.doc_lengths.append(doc_len)
            total_len += doc_len

        self.avg_doc_len = (total_len / self.total_docs) if self.total_docs > 0 else 0.0

    def query(self, query_text: str, top_k: int = 5) -> List[Tuple[Dict[str, Any], float]]:
        query_tokens = self.tokenize(query_text)
        if not query_tokens or self.total_docs == 0:
            return []

        scores: List[Tuple[Dict[str, Any], float]] = []

        for idx, doc in enumerate(self.docs):
            score = 0.0
            doc_len = self.doc_lengths[idx]
            for q in query_tokens:
                if q not in doc["tf"]:
                    continue
                # Inverse Document Frequency
                n_q = self.df.get(q, 0)
                idf = math.log(((self.total_docs - n_q + 0.5) / (n_q + 0.5)) + 1.0)
                # Term Frequency with length penalty
                tf = doc["tf"][q]
                num = tf * (self.k1 + 1.0)
                den = tf + self.k1 * (1.0 - self.b + self.b * (doc_len / self.avg_doc_len if self.avg_doc_len > 0 else 1.0))
                score += idf * (num / den)

            if score > 0.0:
                scores.append((doc, score))

        scores.sort(key=lambda x: x[1], reverse=True)
        return scores[:top_k]


class ContextAssembler:
    """
    Coordinates AST symbol outline, BM25 text retrieval, and strict token budget
    capping (default 4,000 tokens) with a transparent explanation header.
    """
    def __init__(self, workspace_root: str, max_tokens: int = 4000):
        self.workspace_root = workspace_root
        self.max_tokens = max_tokens
        self.bm25 = BM25Ranker()
        self.symbols_cache: List[Dict[str, Any]] = []
        self.file_index: List[Dict[str, Any]] = []
        self._indexed = False

    def estimate_tokens(self, text: str) -> int:
        # Approximate 1 token ~= 4 characters or ~0.75 words
        return max(1, len(text) // 4)

    def build_index(self) -> None:
        ignored_dirs = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "out", "build", ".egg-info"}
        docs: List[Dict[str, Any]] = []
        symbols: List[Dict[str, Any]] = []

        for root, dirs, files in os.walk(self.workspace_root):
            dirs[:] = [d for d in dirs if d not in ignored_dirs and not d.startswith(".")]
            for filename in files:
                if filename.startswith(".") or filename.endswith((".pyc", ".png", ".jpg", ".exe", ".bin", ".whl")):
                    continue
                full_path = os.path.join(root, filename)
                rel_path = os.path.relpath(full_path, self.workspace_root).replace("\\", "/")

                # Read text
                try:
                    with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()
                    docs.append({"path": rel_path, "content": content, "full_path": full_path})
                    if rel_path.endswith(".py"):
                        symbols.extend(ASTSymbolExtractor.extract_symbols_from_code(content, rel_path))
                except Exception:
                    continue

        self.file_index = docs
        self.symbols_cache = symbols
        self.bm25.index_documents(docs)
        self._indexed = True

    def get_all_symbols(self) -> List[Dict[str, Any]]:
        if not self._indexed:
            self.build_index()
        return self.symbols_cache

    def get_all_files(self) -> List[str]:
        if not self._indexed:
            self.build_index()
        return [d["path"] for d in self.file_index]

    def assemble(self, user_query: str, mentions: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Assembles context prioritizing explicit mentions, then top BM25 matches,
        under a strict token budget.
        """
        if not self._indexed:
            self.build_index()

        mentions = mentions or []
        budget_remaining = self.max_tokens
        selected_sections: List[Dict[str, Any]] = []
        total_tokens_used = 0

        # Tier 1: Explicit @file or @symbol mentions (Guaranteed Top Priority)
        for mention in mentions:
            mention = mention.strip().lstrip("@")
            # File mention
            matching_files = [f for f in self.file_index if f["path"] == mention or f["path"].endswith(mention)]
            for mf in matching_files:
                tokens = self.estimate_tokens(mf["content"])
                snippet = mf["content"]
                if tokens > budget_remaining:
                    snippet = mf["content"][: budget_remaining * 4]
                    tokens = budget_remaining

                selected_sections.append({
                    "file": mf["path"],
                    "reason": f"Explicit @file mention '{mention}'",
                    "tokens": tokens,
                    "content": snippet,
                })
                budget_remaining -= tokens
                total_tokens_used += tokens
                if budget_remaining <= 0:
                    break

            # Symbol mention
            if budget_remaining > 0:
                matching_syms = [s for s in self.symbols_cache if s["name"].lower() == mention.lower()]
                for ms in matching_syms:
                    sym_desc = f"Symbol {ms['name']} ({ms['kind']}) at {ms['file']}:{ms['line']} - {ms['doc']}"
                    s_tokens = self.estimate_tokens(sym_desc)
                    if s_tokens <= budget_remaining:
                        selected_sections.append({
                            "file": ms["file"],
                            "reason": f"Explicit @symbol mention '{mention}'",
                            "tokens": s_tokens,
                            "content": sym_desc,
                        })
                        budget_remaining -= s_tokens
                        total_tokens_used += s_tokens

        # Tier 2: BM25 Relevant Code Retrieval
        if budget_remaining > 200:
            top_bm25 = self.bm25.query(user_query, top_k=6)
            for doc, score in top_bm25:
                # Skip if already added via mention
                if any(s["file"] == doc["path"] for s in selected_sections):
                    continue

                full_content = doc["content"]
                doc_tokens = self.estimate_tokens(full_content)

                # Cap individual file to avoid hogging whole budget
                slice_tokens = min(doc_tokens, min(1200, budget_remaining))
                snippet = full_content[: slice_tokens * 4]

                selected_sections.append({
                    "file": doc["path"],
                    "reason": f"BM25 keyword relevance (score: {score:.2f})",
                    "tokens": slice_tokens,
                    "content": snippet,
                })
                budget_remaining -= slice_tokens
                total_tokens_used += slice_tokens
                if budget_remaining < 100:
                    break

        # Tier 3: AST Symbols Outline for relevant files
        if budget_remaining > 100:
            rel_files = {s["file"] for s in selected_sections}
            relevant_symbols = [s for s in self.symbols_cache if s["file"] in rel_files]
            if relevant_symbols:
                outline_lines = [f"- `{s['name']}` ({s['kind']}) at {s['file']}:{s['line']}" for s in relevant_symbols[:20]]
                outline_text = "### Workspace AST Symbols Outline\n" + "\n".join(outline_lines)
                outline_tokens = self.estimate_tokens(outline_text)
                if outline_tokens <= budget_remaining:
                    selected_sections.append({
                        "file": "(Workspace Symbols)",
                        "reason": "AST Outline for active context",
                        "tokens": outline_tokens,
                        "content": outline_text,
                    })
                    total_tokens_used += outline_tokens

        # Generate Transparent Markdown Explanation Header
        explanation_lines = [
            f"## Context Assembly Summary ({total_tokens_used} / {self.max_tokens} tokens budget)",
            "| File / Source | Reason for Inclusion | Approx. Tokens |",
            "|---|---|---:|",
        ]
        for sec in selected_sections:
            explanation_lines.append(f"| `{sec['file']}` | {sec['reason']} | ~{sec['tokens']} |")

        explanation_header = "\n".join(explanation_lines) + "\n\n"

        # Combine payload
        final_prompt_context = explanation_header
        for sec in selected_sections:
            final_prompt_context += f"### File: {sec['file']} ({sec['reason']})\n```\n{sec['content']}\n```\n\n"

        return {
            "total_tokens": total_tokens_used,
            "max_tokens": self.max_tokens,
            "sections": selected_sections,
            "explanation": explanation_header,
            "full_context": final_prompt_context,
        }
