// A stand-in for `claude -p --input-format stream-json`, for testing the model adapter.
// FAKE_MODE: ok (default) | tools (init lists a shell tool) | tooluse (the model calls a tool)
import { createInterface } from 'node:readline';

const mode = process.env.FAKE_MODE ?? 'ok';
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const answer = JSON.stringify({
  steps: [
    { say: 'First.', actions: [{ op: 'box', id: 'a', x: 1, y: 2, w: 3, h: 4, color: 'red' }] },
    { say: 'Second.', actions: [] },
  ],
  escalate: process.env.FAKE_ESCALATE ?? null,
});

createInterface({ input: process.stdin }).once('line', () => {
  send({ type: 'system', subtype: 'init', tools: mode === 'tools' ? ['StructuredOutput', 'Bash'] : ['StructuredOutput'], mcp_servers: [], slash_commands: [] });
  if (mode === 'tools') return;
  if (mode === 'tooluse') {
    send({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Bash' } } });
    return;
  }
  send({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'StructuredOutput' } } });
  let i = 0;
  const chunk = 19;
  const timer = setInterval(() => {
    if (i >= answer.length) {
      clearInterval(timer);
      send({ type: 'result', subtype: 'success', is_error: false, result: '' });
      return;
    }
    send({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: answer.slice(i, i + chunk) } } });
    i += chunk;
  }, 5);
});
