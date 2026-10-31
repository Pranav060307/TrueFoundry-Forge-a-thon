import React, { useState, useEffect, useRef } from 'react';

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
}

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'system',
      content: 'TrueForge Coding Agent ready. Ask a question, request code changes, or type a hello test.',
    },
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [trueforgeStatus, setTrueforgeStatus] = useState<'connected' | 'offline' | 'checking'>('checking');
  const [sidecarStatus, setSidecarStatus] = useState<'healthy' | 'offline' | 'checking'>('checking');
  const [pendingEditsCount, setPendingEditsCount] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);

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
              content: msg.args ? JSON.stringify(msg.args) : '',
            },
          ]);
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
      }
    };

    window.addEventListener('message', handleMessage);

    // Initial ping to extension
    if (vscodeApi) {
      vscodeApi.postMessage({ type: 'getHealth' });
    }

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!prompt.trim() || isStreaming) return;
    const userText = prompt.trim();
    setPrompt('');

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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: '10px' }}>
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
        <div style={{ fontWeight: 'bold' }}>TrueForge Agent</div>
        <div style={{ display: 'flex', gap: '8px', fontSize: '11px' }}>
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
              }}
              onClick={() => vscodeApi?.postMessage({ type: 'reviewDiff' })}
            >
              {pendingEditsCount} Pending Edit{pendingEditsCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Messages Scroll View */}
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%',
              backgroundColor:
                m.role === 'user'
                  ? 'var(--vscode-button-background, #007acc)'
                  : m.role === 'system'
                  ? 'var(--vscode-badge-background, #2d2d2d)'
                  : m.role === 'tool'
                  ? '#263238'
                  : 'var(--vscode-editor-inactiveSelectionBackground, #2a2d2e)',
              color: 'var(--vscode-foreground, #fff)',
              wordBreak: 'break-word',
            }}
          >
            {m.role === 'tool' && (
              <div style={{ fontSize: '11px', color: '#80cbc4', fontWeight: 'bold', marginBottom: '4px' }}>
                🔧 Tool: {m.toolName}
              </div>
            )}
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Box & Action Buttons */}
      <div style={{ display: 'flex', gap: '6px' }}>
        <textarea
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask TrueForge (Enter to send, Shift+Enter for newline)..."
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
