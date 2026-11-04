// A stand-in for `claude -p --input-format stream-json`, for testing the model adapter.
// FAKE_MODE: ok (default) | tools (init lists a shell tool) | tooluse (the model calls a tool) | retry (the whole answer
// streams and its call ends, then, as the real tool does when the schema is not met to the letter, it asks again and
// streams the answer twice more, ending only after that, with the figures of all three calls)
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
  if (mode === 'retry') send({ type: 'stream_event', event: { type: 'message_start', message: { usage: { input_tokens: 2, cache_creation_input_tokens: 300, cache_read_input_tokens: 9000, output_tokens: 3 } } } });
  send({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'StructuredOutput' } } });
  let i = 0;
  const chunk = 19;
  const timer = setInterval(() => {
    if (i >= answer.length) {
      clearInterval(timer);
      if (mode === 'retry') {
        send({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 2, cache_creation_input_tokens: 300, cache_read_input_tokens: 9000, output_tokens: 80 } } });
        setTimeout(() => {
          send({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: answer } } });
          send({ type: 'result', subtype: 'success', is_error: false, result: '', num_turns: 4, usage: { input_tokens: 6, cache_read_input_tokens: 27000, cache_creation_input_tokens: 900, output_tokens: 240 } });
        }, 1500);
        return;
      }
      send({ type: 'result', subtype: 'success', is_error: false, result: '', ...(process.env.FAKE_USAGE ? { usage: { input_tokens: 12, cache_read_input_tokens: 9000, cache_creation_input_tokens: 300, output_tokens: 80 } } : {}) });
      return;
    }
    send({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: answer.slice(i, i + chunk) } } });
    i += chunk;
  }, 5);
});
