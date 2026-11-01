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
  status?: 'running' | 'completed';
}

interface MentionItem {
  type: 'file' | 'symbol';
  name: string;
  detail: string;
}

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'system',
      content: 'TrueForge Coding Agent ready. Ask a question, request multi-file edits, or mention @files and @symbols.',
    },
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [trueforgeStatus, setTrueforgeStatus] = useState<'connected' | 'offline' | 'checking'>('checking');
  const [sidecarStatus, setSidecarStatus] = useState<'healthy' | 'offline' | 'checking'>('checking');
  const [pendingEditsCount, setPendingEditsCount] = useState(0);

  // Mention autocomplete state
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionSuggestions, setMentionSuggestions] = useState<MentionItem[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'statusUpdate':
          if (msg.trueforge) setTrueforgeStatus(msg.trueforge);
          if (msg.sidecar) setSidecarStatus(msg.sidecar);
          if (typeof msg.pendingEdits === 'number') setPendingEditsCount(msg.pendingEdits);
          break;

        case 'turnCreated':
          setIsStreaming(true);
          setMessages((prev) => [
            ...prev,
            { id: msg.turnId || Date.now().toString(), role: 'agent', content: '' },
          ]);
          break;

        case 'tokenDelta':
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
              last.content = msg.result || '';
              last.status = 'completed';
            }
            return next;
          });
          break;

        case 'turnDone':
          setIsStreaming(false);
          break;

        case 'error':
          setIsStreaming(false);
          setMessages((prev) => [
            ...prev,
            { id: Date.now().toString(), role: 'system', content: `[Error] ${msg.message}` },
          ]);
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
  }, [messages]);

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

      // Query sidecar / extension for suggestions
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
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: '10px', boxSizing: 'border-box' }}>
      {/* Top Status Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: '8px',
          borderBottom: '1px solid var(--vscode-panel-border, #333)',
          marginBottom: '8px',
        }}
      >
        <div style={{ fontWeight: 'bold', fontSize: '13px' }}>TrueForge Coding Agent</div>
        <div style={{ display: 'flex', gap: '6px', fontSize: '11px' }}>
          <span
            style={{
              padding: '2px 6px',
              borderRadius: '4px',
              backgroundColor: trueforgeStatus === 'connected' ? '#1b5e20' : '#b71c1c',
              color: '#fff',
            }}
          >
            TrueForge: {trueforgeStatus}
          </span>
          <span
            style={{
              padding: '2px 6px',
              borderRadius: '4px',
              backgroundColor: sidecarStatus === 'healthy' ? '#0d47a1' : '#b71c1c',
              color: '#fff',
            }}
          >
            Sidecar: {sidecarStatus}
          </span>
          {pendingEditsCount > 0 && (
            <span
              style={{
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: '#e65100',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
              title="Click to open side-by-side diff review"
              onClick={() => vscodeApi?.postMessage({ type: 'reviewDiff' })}
            >
              {pendingEditsCount} Pending Hunk{pendingEditsCount > 1 ? 's' : ''} (Review)
            </span>
          )}
        </div>
      </div>

      {/* Messages Scroll View */}
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '92%',
              backgroundColor:
                m.role === 'user'
                  ? 'var(--vscode-button-background, #007acc)'
                  : m.role === 'system'
                  ? 'var(--vscode-badge-background, #2d2d2d)'
                  : m.role === 'tool'
                  ? '#1e2428'
                  : 'var(--vscode-editor-inactiveSelectionBackground, #2a2d2e)',
              color: 'var(--vscode-foreground, #fff)',
              wordBreak: 'break-word',
              border: m.role === 'tool' ? '1px solid #37474f' : 'none',
            }}
          >
            {m.role === 'tool' ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '11px', color: '#80cbc4', fontWeight: 'bold' }}>
                    🔧 Tool: {m.toolName}
                  </span>
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
                {m.toolArgs && (
                  <pre
                    style={{
                      margin: '4px 0',
                      padding: '4px 6px',
                      backgroundColor: '#101416',
                      borderRadius: '4px',
                      fontSize: '10px',
                      color: '#b0bec5',
                      maxHeight: '100px',
                      overflowY: 'auto',
                    }}
                  >
                    {m.toolArgs}
                  </pre>
                )}
                {m.content && (
                  <div style={{ fontSize: '11px', color: '#cfd8dc', marginTop: '4px' }}>
                    {m.content}
                  </div>
                )}
              </div>
            ) : (
              <MarkdownView content={m.content} />
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

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
            }}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
