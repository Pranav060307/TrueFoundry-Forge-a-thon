import React, { useState, useEffect, useRef } from 'react';
import { MarkdownView } from './MarkdownView';

// Acquire VS Code API once
let vscodeApi: any = null;
if (typeof acquireVsCodeApi === 'function') {
  vscodeApi = acquireVsCodeApi();
}

interface Message {
  id: string;
  role: 'user' | 'agent' | 'tool' | 'system';
  content: string;
  toolName?: string;
  toolArgs?: string;
  duration?: number;
  status?: 'running' | 'completed';
}

interface MentionItem {
  type: 'file' | 'symbol';
  name: string;
  detail: string;
}

interface DiffHunkItem {
  id: string;
  filePath: string;
  oldStart: number;
  oldLinesCount: number;
  newStart: number;
  newLinesCount: number;
  originalLines: string[];
  proposedLines: string[];
  state: 'pending' | 'accepted' | 'rejected';
}

interface StagedFileItem {
  filePath: string;
  reason?: string;
  totalHunks: number;
  pendingCount: number;
  hunks: DiffHunkItem[];
}

interface ContextStats {
  total_files: number;
  total_symbols: number;
  classes_count: number;
  functions_count: number;
  max_token_budget: number;
  workspace_root?: string;
}

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'system',
      content:
        '**TrueForge Coding Agent Ready.**\n\n- **Harness:** `@truefoundry/trueforge` (port 8790)\n- **Context Engine:** AST Symbol Outline + BM25 Ranker under 4,000-token budget\n- **Diff Safety:** 100% In-Memory Staging (`propose_write`) with granular CodeLens review & native Undo.\n\nType a request or click a quick task below:',
    },
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [trueforgeStatus, setTrueforgeStatus] = useState<'connected' | 'offline' | 'checking'>('checking');
  const [sidecarStatus, setSidecarStatus] = useState<'healthy' | 'offline' | 'checking'>('checking');
  const [pendingEditsCount, setPendingEditsCount] = useState(0);
  const [stagedFiles, setStagedFiles] = useState<StagedFileItem[]>([]);
  const [models, setModels] = useState<{ primary?: string; fallback?: string }>({});
  const [tokenMetrics, setTokenMetrics] = useState<{ totalTokens: number; speed: number }>({ totalTokens: 0, speed: 0 });

  // Tab & Inspector view state
  const [activeTab, setActiveTab] = useState<'chat' | 'staged' | 'context'>('chat');
  const [contextStats, setContextStats] = useState<ContextStats | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' } | null>(null);

  // Mention autocomplete state
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionSuggestions, setMentionSuggestions] = useState<MentionItem[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);

  const TASK_A_PROMPT =
    "In 'src/flask/helpers.py' (get_debug_flag): Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.";
  const TASK_B_PROMPT =
    "Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as '***'. It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.";
  const TASK_C_PROMPT =
    "In 'src/flask/helpers.py' (get_debug_flag): Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.";

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-dismiss toasts
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Load context engine stats on mount
  useEffect(() => {
    fetchContextStats();
  }, []);

  const fetchContextStats = async () => {
    try {
      const res = await fetch('http://127.0.0.1:4545/api/context_engine_stats');
      if (res.ok) {
        const data = await res.json();
        setContextStats(data);
      }
    } catch {
      // Sidecar starting
    }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'statusUpdate':
          if (msg.trueforge) setTrueforgeStatus(msg.trueforge);
          if (msg.sidecar) setSidecarStatus(msg.sidecar);
          if (typeof msg.pendingEdits === 'number') setPendingEditsCount(msg.pendingEdits);
          if (msg.stagedFiles) {
            setStagedFiles(msg.stagedFiles);
            if (msg.pendingEdits > 0 && activeTab === 'chat') {
              setToast({
                message: `✨ ${msg.pendingEdits} hunk(s) staged! Click '📝 Staged Changes' tab to review.`,
                type: 'success',
              });
            }
          }
          if (msg.models) setModels(msg.models);
          break;

        case 'turnCreated':
          setIsStreaming(true);
          setTokenMetrics({ totalTokens: 0, speed: 0 });
          setMessages((prev) => [
            ...prev,
            { id: msg.turnId || Date.now().toString(), role: 'agent', content: '' },
          ]);
          break;

        case 'tokenDelta':
          if (typeof msg.totalTokens === 'number') {
            setTokenMetrics({ totalTokens: msg.totalTokens, speed: msg.speed || 0 });
          }
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'agent') {
              last.content += msg.content;
            }
            return next;
          });
          break;

        case 'toolCall':
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              role: 'tool',
              toolName: msg.toolName,
              toolArgs: msg.args ? (typeof msg.args === 'string' ? msg.args : JSON.stringify(msg.args, null, 2)) : '',
              content: '',
              status: 'running',
            },
          ]);
          break;

        case 'toolResult':
          setMessages((prev) => {
            const next = [...prev];
            const last = next.slice().reverse().find((m) => m.role === 'tool' && m.toolName === msg.toolName);
            if (last) {
              last.content = typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result, null, 2);
              last.status = 'completed';
              last.duration = msg.duration;
            }
            return next;
          });
          break;

        case 'turnDone':
          setIsStreaming(false);
          fetchContextStats();
          break;

        case 'error':
          setIsStreaming(false);
          setMessages((prev) => [
            ...prev,
            { id: Date.now().toString(), role: 'system', content: `[Error] ${msg.message}` },
          ]);
          break;

        case 'statusNotice':
          setToast({ message: msg.message, type: 'info' });
          break;

        case 'mentionsResult':
          setMentionSuggestions(msg.items || []);
          break;
      }
    };

    window.addEventListener('message', handleMessage);

    if (vscodeApi) {
      vscodeApi.postMessage({ type: 'getHealth' });
    }

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  // Handle mention detection in prompt input
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setPrompt(val);

    const cursor = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursor);
    const atMatch = textBeforeCursor.match(/@([a-zA-Z0-9_\-\.\/]*)$/);

    if (atMatch) {
      const q = atMatch[1];
      setMentionQuery(q);
      setShowMentions(true);
      setMentionIndex(0);
      fetchMentions(q);
    } else {
      setShowMentions(false);
    }
  };

  const fetchMentions = async (query: string) => {
    try {
      const res = await fetch(`http://127.0.0.1:4545/api/mentions?query=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        const items: MentionItem[] = [
          ...data.files.map((f: string) => ({ type: 'file' as const, name: f, detail: 'Workspace File' })),
          ...data.symbols.map((s: any) => ({
            type: 'symbol' as const,
            name: s.name,
            detail: `${s.kind} at ${s.file}:${s.line}`,
          })),
        ];
        setMentionSuggestions(items);
      }
    } catch {
      // Fallback
    }
  };

  const insertMention = (item: MentionItem) => {
    const cursor = textareaRef.current?.selectionStart || prompt.length;
    const textBeforeCursor = prompt.slice(0, cursor);
    const textAfterCursor = prompt.slice(cursor);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    const prefix = textBeforeCursor.slice(0, atIndex);
    const insertText = `@${item.type}:${item.name} `;
    const newPrompt = prefix + insertText + textAfterCursor;

    setPrompt(newPrompt);
    setShowMentions(false);
    setTimeout(() => {
      textareaRef.current?.focus();
      const newCursor = prefix.length + insertText.length;
      textareaRef.current?.setSelectionRange(newCursor, newCursor);
    }, 50);
  };

  const handleSend = () => {
    if (!prompt.trim() || isStreaming) return;
    const userText = prompt.trim();
    setPrompt('');
    setShowMentions(false);

    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), role: 'user', content: userText },
    ]);

    if (vscodeApi) {
      vscodeApi.postMessage({ type: 'sendMessage', prompt: userText });
    }
  };

  const handleStop = () => {
    if (vscodeApi) {
      vscodeApi.postMessage({ type: 'cancel' });
    }
    setIsStreaming(false);
    setToast({ message: 'Turn execution halted immediately.', type: 'info' });
  };

  const handleAcceptHunk = (filePath: string, hunkId: string) => {
    if (vscodeApi) {
      vscodeApi.postMessage({ type: 'acceptHunk', filePath, hunkId });
      setToast({ message: `Hunk applied cleanly to ${filePath}. Native Undo (Ctrl+Z) active.`, type: 'success' });
    }
  };

  const handleRejectHunk = (filePath: string, hunkId: string) => {
    if (vscodeApi) {
      vscodeApi.postMessage({ type: 'rejectHunk', filePath, hunkId });
      setToast({ message: `Hunk rejected in ${filePath}.`, type: 'info' });
    }
  };

  const handleAcceptAll = () => {
    if (vscodeApi) {
      vscodeApi.postMessage({ type: 'acceptAll' });
      setToast({ message: 'All pending hunks applied to disk! Press Ctrl+Z anytime to undo.', type: 'success' });
    }
  };

  const handleRejectAll = () => {
    if (vscodeApi) {
      vscodeApi.postMessage({ type: 'rejectAll' });
      setToast({ message: 'All pending diffs discarded from memory buffer.', type: 'info' });
    }
  };

  const handleUndo = () => {
    if (vscodeApi) {
      vscodeApi.postMessage({ type: 'undoLastTurn' });
      setToast({ message: 'Undid last turn edits via native WorkspaceEdit undo stack.', type: 'info' });
    }
  };

  const handleOpenDiff = (filePath: string) => {
    if (vscodeApi) {
      vscodeApi.postMessage({ type: 'openDiff', filePath });
    }
  };

  const handleExportAuditReport = () => {
    const report = [
      '# TrueForge Coding Agent - Execution Audit Report',
      `**Timestamp:** ${new Date().toISOString()}`,
      `**TrueForge Harness:** Port 8790 (${trueforgeStatus})`,
      `**Sidecar MCP:** Port 4545 (${sidecarStatus})`,
      `**Active Model:** ${models.primary || 'gemini-flash-lite-latest'}`,
      `**Fallback Model:** ${models.fallback || 'openai/gpt-4o'}`,
      `**Pending Hunks Staged:** ${pendingEditsCount}`,
      '',
      '## Session Turns & Tool Sequence',
      ...messages.map((m) => {
        if (m.role === 'tool') {
          return `- **Tool:** \`${m.toolName}\` (${m.status || 'executed'}, ${m.duration ? `${m.duration}ms` : 'fast'})\n  Arguments: \`${m.toolArgs || 'none'}\``;
        }
        return `### ${m.role.toUpperCase()}:\n${m.content}\n`;
      }),
      '',
      '## Staged File Diff Modifications',
      ...stagedFiles.map((sf) => `- **File:** \`${sf.filePath}\` (Hunks: ${sf.totalHunks}, Pending: ${sf.pendingCount})\n  Reason: ${sf.reason || 'None'}`),
    ].join('\n');

    navigator.clipboard.writeText(report);
    setToast({ message: '📋 Audit report copied to clipboard!', type: 'success' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: '10px', boxSizing: 'border-box', fontFamily: 'var(--vscode-font-family, sans-serif)' }}>
      {/* Toast Alert Banner */}
      {toast && (
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '12px',
            zIndex: 9999,
            padding: '6px 12px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 'bold',
            backgroundColor: toast.type === 'success' ? '#1b5e20' : '#0d47a1',
            color: '#fff',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            animation: 'fadeIn 0.2s ease-in-out',
          }}
        >
          <span>{toast.type === 'success' ? '✓' : 'ℹ'}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Top Header & Status Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: '8px',
          borderBottom: '1px solid var(--vscode-panel-border, #333)',
          marginBottom: '6px',
          flexWrap: 'wrap',
          gap: '6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--vscode-foreground, #fff)' }}>
            TrueForge
          </span>
          <span
            style={{
              fontSize: '10px',
              padding: '1px 5px',
              borderRadius: '3px',
              backgroundColor: '#4a148c',
              color: '#e1bee7',
              fontWeight: 'bold',
            }}
          >
            v0.183
          </span>
        </div>

        {/* Telemetry Status Badges */}
        <div style={{ display: 'flex', gap: '5px', fontSize: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span
            style={{
              padding: '2px 5px',
              borderRadius: '3px',
              backgroundColor: trueforgeStatus === 'connected' ? '#1b5e20' : '#b71c1c',
              color: '#fff',
            }}
            title="TrueForge agent server connection status"
          >
            Harness: {trueforgeStatus}
          </span>

          <span
            style={{
              padding: '2px 5px',
              borderRadius: '3px',
              backgroundColor: sidecarStatus === 'healthy' ? '#0d47a1' : '#b71c1c',
              color: '#fff',
            }}
            title="Python MCP sidecar status"
          >
            MCP: {sidecarStatus}
          </span>

          {models.primary && (
            <span
              style={{
                padding: '2px 5px',
                borderRadius: '3px',
                backgroundColor: 'var(--vscode-badge-background, #2d3748)',
                color: 'var(--vscode-badge-foreground, #f7fafc)',
              }}
              title={`Primary: ${models.primary} | Fallback: ${models.fallback || 'None'}`}
            >
              Model: {models.primary.split('/').pop()}
            </span>
          )}

          {/* Quick Header Actions */}
          <button
            onClick={handleExportAuditReport}
            style={{
              padding: '2px 6px',
              fontSize: '10px',
              backgroundColor: 'transparent',
              border: '1px solid var(--vscode-panel-border, #4a5568)',
              color: 'var(--vscode-foreground, #ccc)',
              borderRadius: '3px',
              cursor: 'pointer',
            }}
            title="Copy structured execution audit log to clipboard"
          >
            📋 Audit
          </button>
        </div>
      </div>

      {/* Main Tab Switcher Bar */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          marginBottom: '8px',
          borderBottom: '1px solid var(--vscode-panel-border, #333)',
          paddingBottom: '4px',
        }}
      >
        <button
          onClick={() => setActiveTab('chat')}
          style={{
            padding: '4px 8px',
            fontSize: '11px',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            backgroundColor: activeTab === 'chat' ? 'var(--vscode-button-background, #007acc)' : 'transparent',
            color: activeTab === 'chat' ? '#fff' : 'var(--vscode-foreground, #aaa)',
            fontWeight: activeTab === 'chat' ? 'bold' : 'normal',
          }}
        >
          💬 Agent Chat
        </button>

        <button
          onClick={() => setActiveTab('staged')}
          style={{
            padding: '4px 8px',
            fontSize: '11px',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            backgroundColor: activeTab === 'staged' ? '#e65100' : 'transparent',
            color: activeTab === 'staged' ? '#fff' : 'var(--vscode-foreground, #aaa)',
            fontWeight: activeTab === 'staged' ? 'bold' : 'normal',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span>📝 Staged Changes</span>
          {pendingEditsCount > 0 && (
            <span
              style={{
                backgroundColor: '#fff',
                color: '#e65100',
                borderRadius: '8px',
                padding: '0 4px',
                fontSize: '9px',
                fontWeight: 'bold',
              }}
            >
              {pendingEditsCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('context')}
          style={{
            padding: '4px 8px',
            fontSize: '11px',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            backgroundColor: activeTab === 'context' ? '#4a148c' : 'transparent',
            color: activeTab === 'context' ? '#fff' : 'var(--vscode-foreground, #aaa)',
            fontWeight: activeTab === 'context' ? 'bold' : 'normal',
          }}
        >
          🧠 Context Reasoning Engine
        </button>
      </div>

      {/* Quick Actions Demo Bar */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          marginBottom: '8px',
          paddingBottom: '6px',
          borderBottom: '1px solid var(--vscode-panel-border, #333)',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: '10px', opacity: 0.65 }}>Preset Prompts:</span>
        <button
          style={{
            fontSize: '10px',
            padding: '2px 5px',
            backgroundColor: 'var(--vscode-badge-background, #2d3748)',
            color: 'var(--vscode-badge-foreground, #f7fafc)',
            border: '1px solid var(--vscode-panel-border, #4a5568)',
            borderRadius: '3px',
            cursor: 'pointer',
          }}
          title="Paste Task A prompt into chat"
          onClick={() => {
            setPrompt(TASK_A_PROMPT);
            setActiveTab('chat');
            textareaRef.current?.focus();
          }}
        >
          ⚡ Task A (Inline Edit)
        </button>
        <button
          style={{
            fontSize: '10px',
            padding: '2px 5px',
            backgroundColor: 'var(--vscode-badge-background, #2d3748)',
            color: 'var(--vscode-badge-foreground, #f7fafc)',
            border: '1px solid var(--vscode-panel-border, #4a5568)',
            borderRadius: '3px',
            cursor: 'pointer',
          }}
          title="Paste Task B prompt into chat"
          onClick={() => {
            setPrompt(TASK_B_PROMPT);
            setActiveTab('chat');
            textareaRef.current?.focus();
          }}
        >
          ⚡ Task B (3-File Agent Mode)
        </button>
        <button
          style={{
            fontSize: '10px',
            padding: '2px 5px',
            backgroundColor: 'var(--vscode-badge-background, #2d3748)',
            color: 'var(--vscode-badge-foreground, #f7fafc)',
            border: '1px solid var(--vscode-panel-border, #4a5568)',
            borderRadius: '3px',
            cursor: 'pointer',
          }}
          title="Paste Task C prompt into chat"
          onClick={() => {
            setPrompt(TASK_C_PROMPT);
            setActiveTab('chat');
            textareaRef.current?.focus();
          }}
        >
          ⚡ Task C (Failover)
        </button>
        <button
          style={{
            fontSize: '10px',
            padding: '2px 5px',
            backgroundColor: '#37474f',
            color: '#eceff1',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            marginLeft: 'auto',
          }}
          title="Revert last turn edits via native WorkspaceEdit undo"
          onClick={handleUndo}
        >
          ↺ Undo Turn
        </button>
      </div>

      {/* TAB 1: AGENT CHAT VIEW */}
      {activeTab === 'chat' && (
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {messages.map((m) => (
            <div
              key={m.id}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '94%',
                backgroundColor:
                  m.role === 'user'
                    ? 'var(--vscode-button-background, #007acc)'
                    : m.role === 'system'
                    ? 'var(--vscode-badge-background, #25282a)'
                    : m.role === 'tool'
                    ? '#14181a'
                    : 'var(--vscode-editor-inactiveSelectionBackground, #242728)',
                color: 'var(--vscode-foreground, #fff)',
                wordBreak: 'break-word',
                border: m.role === 'tool' ? '1px solid #37474f' : '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {m.role === 'tool' ? (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#80cbc4', fontWeight: 'bold' }}>
                      🔧 MCP Tool: {m.toolName}
                    </span>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      {m.duration !== undefined && (
                        <span style={{ fontSize: '9px', color: '#90a4ae' }}>
                          {m.duration}ms
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: '9px',
                          padding: '1px 4px',
                          borderRadius: '3px',
                          backgroundColor: m.status === 'running' ? '#f57f17' : '#2e7d32',
                          color: '#fff',
                        }}
                      >
                        {m.status || 'executed'}
                      </span>
                    </div>
                  </div>
                  {m.toolArgs && (
                    <pre
                      style={{
                        margin: '4px 0',
                        padding: '4px 6px',
                        backgroundColor: '#0a0d0e',
                        borderRadius: '4px',
                        fontSize: '10px',
                        color: '#b0bec5',
                        maxHeight: '110px',
                        overflowY: 'auto',
                      }}
                    >
                      {m.toolArgs}
                    </pre>
                  )}
                  {m.content && (
                    <div style={{ fontSize: '11px', color: '#cfd8dc', marginTop: '4px', maxHeight: '120px', overflowY: 'auto' }}>
                      {m.content}
                    </div>
                  )}
                </div>
              ) : (
                m.content ? (
                  <MarkdownView content={m.content} />
                ) : (
                  <div style={{ fontSize: '12px', color: '#81c784', display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' }}>
                    <span>⚡ Changes staged in memory.</span>
                    <button
                      onClick={() => setActiveTab('staged')}
                      style={{
                        padding: '3px 8px',
                        fontSize: '11px',
                        backgroundColor: '#e65100',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                      }}
                    >
                      Review Diff →
                    </button>
                  </div>
                )
              )}
            </div>
          ))}

          {isStreaming && (
            <div style={{ fontSize: '10px', color: '#80cbc4', fontStyle: 'italic', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span>⚡ Streaming from TrueForge harness...</span>
              {tokenMetrics.speed > 0 && (
                <span style={{ color: '#aaa' }}>
                  ({tokenMetrics.speed} tok/s | ~{tokenMetrics.totalTokens} tokens)
                </span>
              )}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* TAB 2: STAGED DIFF REVIEW VIEW */}
      {activeTab === 'staged' && (
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 8px',
              backgroundColor: '#263238',
              borderRadius: '4px',
            }}
          >
            <div>
              <span style={{ fontWeight: 'bold', fontSize: '11px', color: '#eceff1' }}>
                In-Memory Staging Buffer
              </span>
              <div style={{ fontSize: '10px', color: '#b0bec5' }}>
                Zero silent writes: review hunks before applying to disk.
              </div>
            </div>

            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={handleAcceptAll}
                disabled={pendingEditsCount === 0}
                style={{
                  padding: '3px 8px',
                  fontSize: '10px',
                  backgroundColor: '#2e7d32',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: pendingEditsCount > 0 ? 'pointer' : 'not-allowed',
                  fontWeight: 'bold',
                }}
              >
                ✓ Accept All
              </button>
              <button
                onClick={handleRejectAll}
                disabled={pendingEditsCount === 0}
                style={{
                  padding: '3px 8px',
                  fontSize: '10px',
                  backgroundColor: '#c62828',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: pendingEditsCount > 0 ? 'pointer' : 'not-allowed',
                  fontWeight: 'bold',
                }}
              >
                ✗ Reject All
              </button>
            </div>
          </div>

          {stagedFiles.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 10px', color: '#888', fontSize: '12px' }}>
              No edits currently staged in memory.<br />
              Ask the agent to make code modifications to see diff hunks here.
            </div>
          ) : (
            stagedFiles.map((sf) => (
              <div
                key={sf.filePath}
                style={{
                  border: '1px solid var(--vscode-editorWidget-border, #37474f)',
                  borderRadius: '6px',
                  backgroundColor: '#1b2023',
                  overflow: 'hidden',
                }}
              >
                {/* File Header */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 10px',
                    backgroundColor: '#101416',
                    borderBottom: '1px solid #263238',
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 'bold', fontSize: '11px', color: '#80cbc4' }}>
                      📄 {sf.filePath}
                    </span>
                    {sf.reason && (
                      <div style={{ fontSize: '10px', color: '#90a4ae', marginTop: '2px' }}>
                        {sf.reason}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleOpenDiff(sf.filePath)}
                    style={{
                      padding: '2px 6px',
                      fontSize: '10px',
                      backgroundColor: 'transparent',
                      border: '1px solid #455a64',
                      color: '#eceff1',
                      borderRadius: '3px',
                      cursor: 'pointer',
                    }}
                    title="Open native side-by-side virtual diff"
                  >
                    🔍 Virtual Diff
                  </button>
                </div>

                {/* Hunk List */}
                <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {sf.hunks.map((hunk, idx) => (
                    <div
                      key={hunk.id}
                      style={{
                        borderRadius: '4px',
                        border: '1px solid #263238',
                        backgroundColor: '#13181a',
                        padding: '6px',
                        fontSize: '10px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ color: '#b0bec5', fontWeight: 'bold' }}>
                          Hunk {idx + 1} (Line {hunk.oldStart} → {hunk.newStart})
                        </span>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {hunk.state === 'pending' ? (
                            <>
                              <button
                                onClick={() => handleAcceptHunk(sf.filePath, hunk.id)}
                                style={{
                                  padding: '1px 6px',
                                  backgroundColor: '#2e7d32',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: '2px',
                                  cursor: 'pointer',
                                  fontWeight: 'bold',
                                }}
                              >
                                ✓ Accept
                              </button>
                              <button
                                onClick={() => handleRejectHunk(sf.filePath, hunk.id)}
                                style={{
                                  padding: '1px 6px',
                                  backgroundColor: '#c62828',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: '2px',
                                  cursor: 'pointer',
                                  fontWeight: 'bold',
                                }}
                              >
                                ✗ Reject
                              </button>
                            </>
                          ) : (
                            <span
                              style={{
                                color: hunk.state === 'accepted' ? '#81c784' : '#e57373',
                                fontWeight: 'bold',
                              }}
                            >
                              {hunk.state.toUpperCase()}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Diff Line Box */}
                      <pre
                        style={{
                          margin: 0,
                          padding: '4px',
                          backgroundColor: '#0a0d0e',
                          borderRadius: '3px',
                          fontFamily: 'monospace',
                          maxHeight: '120px',
                          overflowY: 'auto',
                        }}
                      >
                        {hunk.originalLines.map((l, i) => (
                          <div key={`orig-${i}`} style={{ color: '#ef5350', backgroundColor: 'rgba(239, 83, 80, 0.15)' }}>
                            - {l}
                          </div>
                        ))}
                        {hunk.proposedLines.map((l, i) => (
                          <div key={`prop-${i}`} style={{ color: '#66bb6a', backgroundColor: 'rgba(102, 187, 106, 0.15)' }}>
                            + {l}
                          </div>
                        ))}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 3: CONTEXT REASONING ENGINE VIEW */}
      {activeTab === 'context' && (
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div
            style={{
              padding: '10px',
              backgroundColor: '#1e1b2e',
              borderRadius: '6px',
              border: '1px solid #4a148c',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontWeight: 'bold', fontSize: '12px', color: '#ce93d8' }}>
                🧠 Context Engine & Token Budget
              </span>
              <span style={{ fontSize: '10px', color: '#b39ddb' }}>
                Strict 4,000 Token Cap
              </span>
            </div>

            {/* Token Budget Gauge */}
            <div style={{ marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#e1bee7', marginBottom: '3px' }}>
                <span>Budget Manager</span>
                <span>Okapi BM25 + AST Outline Ranking</span>
              </div>
              <div style={{ height: '6px', backgroundColor: '#311b92', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: '65%', height: '100%', backgroundColor: '#ba68c8' }} />
              </div>
            </div>

            {/* Metric Grid Tiles */}
            {contextStats && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '10px' }}>
                <div style={{ padding: '6px', backgroundColor: '#2a1b40', borderRadius: '4px' }}>
                  <div style={{ color: '#ab47bc' }}>📁 Indexed Files</div>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#fff' }}>{contextStats.total_files}</div>
                </div>
                <div style={{ padding: '6px', backgroundColor: '#2a1b40', borderRadius: '4px' }}>
                  <div style={{ color: '#ab47bc' }}>🧩 AST Symbols</div>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#fff' }}>{contextStats.total_symbols}</div>
                </div>
                <div style={{ padding: '6px', backgroundColor: '#2a1b40', borderRadius: '4px' }}>
                  <div style={{ color: '#ab47bc' }}>🏛️ Python Classes</div>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#fff' }}>{contextStats.classes_count}</div>
                </div>
                <div style={{ padding: '6px', backgroundColor: '#2a1b40', borderRadius: '4px' }}>
                  <div style={{ color: '#ab47bc' }}>⚡ Functions / Methods</div>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#fff' }}>{contextStats.functions_count}</div>
                </div>
              </div>
            )}
          </div>

          {/* Explanation Architecture Note */}
          <div
            style={{
              padding: '8px 10px',
              backgroundColor: '#1b2023',
              borderRadius: '6px',
              border: '1px solid #263238',
              fontSize: '11px',
              color: '#cfd8dc',
              lineHeight: '1.4',
            }}
          >
            <div style={{ fontWeight: 'bold', color: '#80cbc4', marginBottom: '4px' }}>
              How TrueForge Context Compaction Works:
            </div>
            When you mention <code>@file</code> or <code>@symbol</code>, the Context Engine prioritizes explicit mentions first, followed by top-k BM25 workspace search snippets, all packed under the strict 4,000-token budget. TrueForge automatically triggers large-tool compaction to prevent context window overflow.
          </div>
        </div>
      )}

      {/* Autocomplete Popup for @file / @symbol Mentions */}
      {showMentions && mentionSuggestions.length > 0 && (
        <div
          style={{
            maxHeight: '140px',
            overflowY: 'auto',
            backgroundColor: 'var(--vscode-editorWidget-background, #252526)',
            border: '1px solid var(--vscode-editorWidget-border, #454545)',
            borderRadius: '4px',
            marginBottom: '4px',
            fontSize: '11px',
          }}
        >
          {mentionSuggestions.map((item, idx) => (
            <div
              key={`${item.type}-${item.name}-${idx}`}
              onClick={() => insertMention(item)}
              style={{
                padding: '4px 8px',
                cursor: 'pointer',
                backgroundColor: idx === mentionIndex ? 'var(--vscode-list-activeSelectionBackground, #094771)' : 'transparent',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>
                <strong>@{item.type === 'file' ? 'file' : 'symbol'}:</strong> {item.name}
              </span>
              <span style={{ color: '#888', fontSize: '10px' }}>{item.detail}</span>
            </div>
          ))}
        </div>
      )}

      {/* Input Box & Action Buttons */}
      <div style={{ display: 'flex', gap: '6px' }}>
        <textarea
          ref={textareaRef}
          rows={2}
          value={prompt}
          onChange={handleInputChange}
          onKeyDown={(e) => {
            if (showMentions && mentionSuggestions.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMentionIndex((i) => (i + 1) % mentionSuggestions.length);
                return;
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionIndex((i) => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length);
                return;
              } else if (e.key === 'Tab' || e.key === 'Enter') {
                e.preventDefault();
                insertMention(mentionSuggestions[mentionIndex]);
                return;
              } else if (e.key === 'Escape') {
                setShowMentions(false);
                return;
              }
            }

            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask TrueForge or type '@' to mention files and symbols..."
          style={{
            flex: 1,
            padding: '8px',
            backgroundColor: 'var(--vscode-input-background, #3c3c3c)',
            color: 'var(--vscode-input-foreground, #cccccc)',
            border: '1px solid var(--vscode-input-border, #3c3c3c)',
            borderRadius: '4px',
            resize: 'none',
            outline: 'none',
            fontSize: '12px',
          }}
        />
        {isStreaming ? (
          <button
            onClick={handleStop}
            style={{
              padding: '8px 14px',
              backgroundColor: '#c62828',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Stop
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!prompt.trim()}
            style={{
              padding: '8px 14px',
              backgroundColor: 'var(--vscode-button-background, #0e639c)',
              color: 'var(--vscode-button-foreground, #ffffff)',
              border: 'none',
              borderRadius: '4px',
              cursor: prompt.trim() ? 'pointer' : 'not-allowed',
              opacity: prompt.trim() ? 1 : 0.6,
              fontWeight: 'bold',
            }}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
