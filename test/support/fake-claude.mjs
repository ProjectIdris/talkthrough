// A stand-in for `claude -p --input-format stream-json`, for testing the model adapter.
// FAKE_MODE: ok (default) | tools (init lists a shell tool) | tooluse (the model calls a tool) | retry (the whole answer
// streams and its call ends, then, as the real tool does when the schema is not met to the letter, it asks again and
// streams the answer twice more, ending only after that, with the figures of all three calls)
// FAKE_SPLIT=1: a question that asks for step 1 only is answered with one step, one that gives step 1 and asks for the rest with two more
// FAKE_CHAIN=1: one step to a call: the call that asks for step 1 and a plan answers step 'S1' with the plan ['Two', 'Three'] and done false, the one that
// asks for step N answers 'SN' with done true when N is 3 (FAKE_CHAIN=fail3: the call for step 3 ends in an error; FAKE_CHAIN=short: step 1 says done).
// steps (FAKE_REST=fail: that second call ends in an error; FAKE_REST=slow: it takes 600 ms to start; FAKE_REST=die: its process exits).
import { createInterface } from 'node:readline';

const mode = process.env.FAKE_MODE ?? 'ok';
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const whole = [
  { say: 'First.', actions: [{ op: 'box', id: 'a', x: 1, y: 2, w: 3, h: 4, color: 'red' }] },
  { say: 'Second.', actions: [] },
];
let answer = JSON.stringify({ steps: whole, escalate: process.env.FAKE_ESCALATE ?? null });

createInterface({ input: process.stdin }).once('line', (line) => {
  const asked = line.includes('Write only step 1 now') ? 'first' : line.includes('Step 1 of this answer is already drawn') ? 'rest' : 'whole';
  const chain = line.match(/Write step (\d+) only/);
  if (process.env.FAKE_CHAIN) {
    const n = chain ? Number(chain[1]) : 1;
    if (process.env.FAKE_CHAIN === 'fail3' && n === 3) {
      send({ type: 'system', subtype: 'init', tools: ['StructuredOutput'], mcp_servers: [], slash_commands: [] });
      send({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'step three broke' });
      return;
    }
    const extra = process.env.FAKE_CHAIN === 'extra' ? [{ say: 'Unasked.', actions: [] }] : [];
    answer = JSON.stringify({ steps: [{ say: 'S' + n + '.', actions: [] }, ...extra], plan: n === 1 ? (process.env.FAKE_CHAIN === 'short' ? null : ['Two', 'Three']) : null, done: process.env.FAKE_CHAIN === 'short' ? true : n >= 3, escalate: null });
  }
  if (process.env.FAKE_SPLIT && asked === 'first') answer = JSON.stringify({ steps: [whole[0]], escalate: null });
  if (process.env.FAKE_SPLIT && asked === 'rest') {
    answer = JSON.stringify({ steps: [{ say: 'Third.', actions: [] }, { say: 'Fourth.', actions: [] }], escalate: null });
    if (process.env.FAKE_REST === 'die') process.exit(3);
    if (process.env.FAKE_REST === 'fail') {
      send({ type: 'system', subtype: 'init', tools: ['StructuredOutput'], mcp_servers: [], slash_commands: [] });
      send({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'the second call broke' });
      return;
    }
  }
  begin(asked === 'rest' && process.env.FAKE_REST === 'slow' ? 600 : 0);
});

function begin(delay) {
  setTimeout(go, delay);
}

function go() {
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
}
