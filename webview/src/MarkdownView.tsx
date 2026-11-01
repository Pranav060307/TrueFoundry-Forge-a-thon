import React from 'react';

interface MarkdownViewProps {
  content: string;
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({ content }) => {
  // Simple, robust zero-dependency parser for code blocks, tables, headers, and inline styles
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 1. Code Block (```)
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing ```
      elements.push(
        <div key={`code-${i}`} style={{ margin: '6px 0' }}>
          {lang && (
            <div style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase', marginBottom: '2px' }}>
              {lang}
            </div>
          )}
          <pre
            style={{
              padding: '8px',
              backgroundColor: 'var(--vscode-textCodeBlock-background, #1e1e1e)',
              borderRadius: '4px',
              fontSize: '11px',
              overflowX: 'auto',
              border: '1px solid var(--vscode-editorWidget-border, #333)',
              margin: 0,
            }}
          >
            <code>{codeLines.join('\n')}</code>
          </pre>
        </div>
      );
      continue;
    }

    // 2. Markdown Table (| header | header |)
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }

      if (tableLines.length >= 2 && tableLines[1].includes('-')) {
        const headerCells = tableLines[0]
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());

        const bodyRows = tableLines.slice(2).map((row) =>
          row
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim())
        );

        elements.push(
          <div key={`table-${i}`} style={{ overflowX: 'auto', margin: '8px 0' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '11px',
                border: '1px solid var(--vscode-panel-border, #444)',
              }}
            >
              <thead>
                <tr style={{ backgroundColor: 'var(--vscode-editor-inactiveSelectionBackground, #2a2d2e)' }}>
                  {headerCells.map((h, hIdx) => (
                    <th
                      key={hIdx}
                      style={{
                        padding: '6px 8px',
                        textAlign: 'left',
                        border: '1px solid var(--vscode-panel-border, #444)',
                        fontWeight: 'bold',
                        color: 'var(--vscode-editor-foreground, #eee)',
                      }}
                    >
                      {formatInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, rIdx) => (
                  <tr
                    key={rIdx}
                    style={{
                      backgroundColor: rIdx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.03)',
                    }}
                  >
                    {row.map((cell, cIdx) => (
                      <td
                        key={cIdx}
                        style={{
                          padding: '5px 8px',
                          border: '1px solid var(--vscode-panel-border, #444)',
                          color: 'var(--vscode-editor-foreground, #ccc)',
                        }}
                      >
                        {formatInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    // 3. Headings (#, ##, ###)
    if (line.startsWith('### ')) {
      elements.push(
        <div key={`h3-${i}`} style={{ fontWeight: 'bold', fontSize: '13px', margin: '8px 0 4px', color: '#80cbc4' }}>
          {formatInline(line.slice(4))}
        </div>
      );
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <div key={`h2-${i}`} style={{ fontWeight: 'bold', fontSize: '14px', margin: '10px 0 6px', color: '#4fc3f7' }}>
          {formatInline(line.slice(3))}
        </div>
      );
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      elements.push(
        <div key={`h1-${i}`} style={{ fontWeight: 'bold', fontSize: '15px', margin: '12px 0 8px', color: '#ffb74d' }}>
          {formatInline(line.slice(2))}
        </div>
      );
      i++;
      continue;
    }

    // 4. Bullet lists
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      elements.push(
        <div key={`li-${i}`} style={{ paddingLeft: '14px', margin: '2px 0' }}>
          • {formatInline(line.trim().slice(2))}
        </div>
      );
      i++;
      continue;
    }

    // 5. Normal line
    if (line.trim().length > 0) {
      elements.push(
        <div key={`p-${i}`} style={{ margin: '2px 0', lineHeight: '1.4' }}>
          {formatInline(line)}
        </div>
      );
    } else {
      elements.push(<div key={`sp-${i}`} style={{ height: '4px' }} />);
    }

    i++;
  }

  return <div>{elements}</div>;
};

// Inline formatter for bold, italic, code
function formatInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={match.index}
          style={{
            padding: '1px 4px',
            backgroundColor: 'rgba(255,255,255,0.1)',
            borderRadius: '3px',
            fontFamily: 'monospace',
            fontSize: '90%',
            color: '#ffcc80',
          }}
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={match.index}>{token.slice(1, -1)}</em>);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

