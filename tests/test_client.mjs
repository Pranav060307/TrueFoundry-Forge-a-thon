import assert from 'node:assert';
import { TrueForgeClient } from '../src/agent/TrueForgeClient';

console.log('Testing TrueForgeClient delta merger and event handling...');

const client = new TrueForgeClient('http://localhost:8790');

// Test 1: URL normalization
assert.strictEqual(client.getBaseUrl(), 'http://localhost:8790');
client.setBaseUrl('http://localhost:8790///');
assert.strictEqual(client.getBaseUrl(), 'http://localhost:8790');

// Test 2: Delta detection
assert.strictEqual(client.isEventDelta({ type: 'model.message.delta', id: '1', thread_id: 'main', created_at: '' }), true);
assert.strictEqual(client.isEventDelta({ type: 'model.message', id: '1', thread_id: 'main', created_at: '' }), false);

// Test 3: Content delta merging
const baseEvent = {
  type: 'model.message',
  id: 'msg-01',
  thread_id: 'main',
  created_at: new Date().toISOString(),
  content: 'Hello',
};

const delta1 = {
  type: 'model.message.delta',
  id: 'msg-01',
  thread_id: 'main',
  created_at: new Date().toISOString(),
  content: ' world!',
};

client.mergeEventDelta(baseEvent, delta1);
assert.strictEqual(baseEvent.content, 'Hello world!');

// Test 4: Tool call delta merging
const baseWithTool = {
  type: 'model.message',
  id: 'msg-02',
  thread_id: 'main',
  created_at: new Date().toISOString(),
  tool_calls: [
    {
      id: 'tc-01',
      function: { name: 'workspace_read_file', arguments: '{"path":' },
    },
  ],
};

const toolDelta = {
  type: 'model.message.delta',
  id: 'msg-02',
  thread_id: 'main',
  created_at: new Date().toISOString(),
  tool_calls: [
    {
      id: 'tc-01',
      function: { name: 'workspace_read_file', arguments: ' "helpers.py"}' },
    },
  ],
};

client.mergeEventDelta(baseWithTool, toolDelta);
assert.strictEqual(baseWithTool.tool_calls[0].function.arguments, '{"path": "helpers.py"}');

console.log('All TrueForgeClient unit tests passed successfully!');
