import { createParser, ParsedEvent, ReconnectInterval } from 'eventsource-parser';

export interface TurnInputItem {
  type: 'user.message' | 'user.tool_approval' | 'user.tool_response';
  content?: string | Array<{ type: string; text?: string; name?: string; data?: string }>;
  thread_id?: string | null;
  tool_call_id?: string;
  approval?: { status: 'allow' | 'deny'; reason?: string };
}

export interface TrueForgeEvent {
  type: string;
  id: string;
  thread_id: string | null;
  created_at: string;
  content?: string;
  turn_id?: string;
  previous_turn_id?: string | null;
  state?: {
    status: 'running' | 'done' | 'cancelled' | 'error';
    output?: { type: string; content?: string } | null;
    required_actions?: any[];
    reason?: string;
    message?: string;
    completed_at?: string;
  };
  tool_calls?: Array<{
    id: string;
    source_event_id?: string;
    function?: { name: string; arguments: string };
    tool_info?: { name: string; type: string };
  }>;
  [key: string]: any;
}

export class TrueForgeClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:8790') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  /**
   * Health check on TrueForge server.
   */
  public async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/sessions`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(2000),
      });
      return res.status < 500;
    } catch {
      return false;
    }
  }

  /**
   * Creates a new session on TrueForge.
   */
  public async createSession(agent: { name?: string; spec?: any }): Promise<{ id: string; [key: string]: any }> {
    const payload = agent.name ? { agent: { name: agent.name } } : { agent: { spec: agent.spec } };
    const url = `${this.baseUrl}/api/v1/sessions`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to create TrueForge session (${res.status}): ${errText}`);
    }

    const json = (await res.json()) as { data?: { id: string }; id?: string };
    const sessionData = json.data ?? json;
    if (!sessionData.id) {
      throw new Error(`Invalid session creation response: ${JSON.stringify(json)}`);
    }
    return sessionData as { id: string };
  }

  /**
   * Starts a streaming turn in an existing session.
   */
  public async createTurnStream(
    sessionId: string,
    input: TurnInputItem[],
    onEvent: (event: TrueForgeEvent) => void,
    abortSignal?: AbortSignal
  ): Promise<TrueForgeEvent> {
    const url = `${this.baseUrl}/api/v1/sessions/${sessionId}/turns`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ input, stream: true }),
      signal: abortSignal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to start turn on session ${sessionId} (${res.status}): ${errText}`);
    }

    if (!res.body) {
      throw new Error(`TrueForge SSE stream response has no body.`);
    }

    let finalEvent: TrueForgeEvent | undefined;
    const eventsIndex = new Map<string, TrueForgeEvent>();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    const parser = createParser((parsed: ParsedEvent | ReconnectInterval) => {
      if (parsed.type === 'event') {
        try {
          const event: TrueForgeEvent = JSON.parse(parsed.data);

          if (this.isEventDelta(event)) {
            const base = eventsIndex.get(event.id);
            if (base) {
              this.mergeEventDelta(base, event);
            }
          } else {
            eventsIndex.set(event.id, event);
          }

          if (event.type === 'turn.done') {
            finalEvent = event;
          }

          onEvent(event);
        } catch (e) {
          console.warn('[TrueForgeClient] Failed to parse SSE event JSON:', parsed.data, e);
        }
      }
    });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
    } finally {
      reader.releaseLock();
    }

    if (!finalEvent) {
      finalEvent = {
        type: 'turn.done',
        id: 'fallback-done',
        thread_id: null,
        created_at: new Date().toISOString(),
        state: { status: 'done' },
      };
    }

    return finalEvent;
  }

  /**
   * Cancels a running turn or session.
   */
  public async cancelSession(sessionId: string): Promise<void> {
    const url = `${this.baseUrl}/api/v1/sessions/${sessionId}/cancel`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok && res.status !== 404) {
      const err = await res.text();
      throw new Error(`Failed to cancel session ${sessionId}: ${err}`);
    }
  }

  public isEventDelta(event: TrueForgeEvent): boolean {
    return event.type.endsWith('.delta');
  }

  public mergeEventDelta(base: TrueForgeEvent, delta: TrueForgeEvent): void {
    if (delta.content) {
      base.content = (base.content || '') + delta.content;
    }
    if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
      if (!base.tool_calls) base.tool_calls = [];
      for (const tc of delta.tool_calls) {
        const existing = base.tool_calls.find((x) => x.id === tc.id);
        if (existing) {
          if (tc.function?.arguments) {
            existing.function = existing.function || { name: '', arguments: '' };
            existing.function.arguments = (existing.function.arguments || '') + tc.function.arguments;
          }
        } else {
          base.tool_calls.push(tc);
        }
      }
    }
  }
}
