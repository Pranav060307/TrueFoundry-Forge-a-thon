import assert from 'node:assert';
import { ModelFailoverManager } from '../extension/src/failoverManager';

console.log('Running Task C Verification Suite (Resilience & Transparent Model Failover)...\n');

// Mock TrueForgeClient simulating primary model failure and secondary model success
class MockTrueForgeClient {
  constructor() {
    this.sessionsCreated = [];
    this.turnsExecuted = [];
  }

  async createSession(agent) {
    this.sessionsCreated.push(agent);
    const modelName = agent.spec?.model?.name || '';

    // If primary model has invalid/broken configuration, fail session creation or fail turn
    if (modelName.includes('invalid') || modelName.includes('broken')) {
      throw new Error(`401 Unauthorized: Invalid API key or unreachable provider for '${modelName}'`);
    }

    return { id: `session-${Date.now()}-${this.sessionsCreated.length}` };
  }

  async createTurnStream(sessionId, input, onEvent, abortSignal) {
    this.turnsExecuted.push({ sessionId, input });

    // Stream sample tokens from the healthy fallback model
    onEvent({
      type: 'model.message.delta',
      id: 'msg-01',
      thread_id: 'main',
      created_at: new Date().toISOString(),
      content: 'Hello from fallback model! Executing Task A edit.',
    });

    onEvent({
      type: 'model.message',
      id: 'msg-01',
      thread_id: 'main',
      created_at: new Date().toISOString(),
      tool_calls: [
        {
          id: 'tc-01',
          function: {
            name: 'propose_write',
            arguments: JSON.stringify({
              path: 'src/flask/helpers.py',
              reason: 'Task A edit via fallback model',
            }),
          },
        },
      ],
    });

    return {
      type: 'turn.done',
      id: 'done-01',
      thread_id: null,
      created_at: new Date().toISOString(),
      state: { status: 'done' },
    };
  }
}

async function runTaskCTests() {
  // ---------------------------------------------------------------------------
  // Test 1: Primary Model Fails -> Transparently Fall Back to Secondary
  // ---------------------------------------------------------------------------
  console.log('Test 1: Primary model failure transparently routes to secondary fallback');
  {
    const mockClient = new MockTrueForgeClient();
    const config = {
      server: { port: 8790, baseUrl: 'http://localhost:8790', networkPolicyEnabled: false },
      models: {
        primary: {
          provider: 'anthropic',
          modelId: 'anthropic/invalid-broken-endpoint',
        },
        fallback: {
          provider: 'openai',
          modelId: 'openai/gpt-4o-healthy',
        },
      },
      mcpServer: { name: 'vscode-tools', port: 4545, url: 'http://127.0.0.1:4545/mcp' },
      agent: {
        name: 'trueforge-coding-agent',
        description: 'VS Code coding agent',
        iterationLimit: 50,
        contextCompactionTokens: 50000,
      },
    };

    const manager = new ModelFailoverManager(mockClient, config);

    let noticeReceived = '';
    let fallbackModelReceived = '';
    const streamedTokens = [];

    const result = await manager.executeTurnWithFallback(
      'Perform Task A inline edit',
      [{ type: 'user.message', content: 'Treat off and n as false' }],
      (event) => {
        if (event.type === 'model.message.delta' && event.content) {
          streamedTokens.push(event.content);
        }
      },
      (notice, fallbackModel) => {
        noticeReceived = notice;
        fallbackModelReceived = fallbackModel;
      }
    );

    console.log(`  Failover Notice: ${noticeReceived}`);
    console.log(`  Model Used: ${result.modelUsed}`);
    console.log(`  Failed Over: ${result.failedOver}`);
    console.log(`  Streamed Tokens: "${streamedTokens.join('')}"`);

    assert.strictEqual(result.failedOver, true, 'Failover must be marked as true');
    assert.strictEqual(result.modelUsed, 'openai/gpt-4o-healthy', 'Model used must be the fallback model');
    assert.strictEqual(fallbackModelReceived, 'openai/gpt-4o-healthy');
    assert.ok(noticeReceived.includes('Primary model'), 'Notice must explain primary failure');
    assert.ok(streamedTokens.length > 0, 'Tokens must stream successfully from the fallback model');
    assert.strictEqual(result.finalEvent.state?.status, 'done', 'Final event status must be done');
    console.log('  ✓ Transparent failover executed cleanly with zero user intervention.');
  }

  // ---------------------------------------------------------------------------
  // Test 2: Primary Model Healthy -> No Failover
  // ---------------------------------------------------------------------------
  console.log('\nTest 2: Primary model healthy routes directly without failover');
  {
    const mockClient = new MockTrueForgeClient();
    const config = {
      server: { port: 8790, baseUrl: 'http://localhost:8790', networkPolicyEnabled: false },
      models: {
        primary: {
          provider: 'anthropic',
          modelId: 'anthropic/claude-sonnet-healthy',
        },
        fallback: {
          provider: 'openai',
          modelId: 'openai/gpt-4o',
        },
      },
      mcpServer: { name: 'vscode-tools', port: 4545, url: 'http://127.0.0.1:4545/mcp' },
      agent: {
        name: 'trueforge-coding-agent',
        description: 'VS Code coding agent',
        iterationLimit: 50,
        contextCompactionTokens: 50000,
      },
    };

    const manager = new ModelFailoverManager(mockClient, config);

    let noticeFired = false;
    const result = await manager.executeTurnWithFallback(
      'Normal request',
      [{ type: 'user.message', content: 'hello' }],
      () => {},
      () => { noticeFired = true; }
    );

    assert.strictEqual(result.failedOver, false, 'No failover when primary is healthy');
    assert.strictEqual(result.modelUsed, 'anthropic/claude-sonnet-healthy');
    assert.strictEqual(noticeFired, false, 'No failover notice when primary succeeds');
    console.log('  ✓ Primary model used directly when healthy.');
  }

  console.log('\nTask C (Resilience & Auto Fallback) verified successfully! 🚀\n');
}

runTaskCTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
