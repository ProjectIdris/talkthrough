// A stand-in for `codex app-server`, speaking just enough of its JSON-RPC to test the model adapter.
// FAKE_MODE: ok (default) | tool (reports a command item) | approval (asks the client for approval)
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
let threads = 0;
const fast = process.argv.some((a) => a.includes('service_tier'));

createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') return send({ id: m.id, result: { userAgent: 'fake' } });
  if (m.method === 'thread/start') {
    const id = `t${++threads}`;
    return send({ id: m.id, result: { thread: { id }, model: m.params.model, serviceTier: fast ? 'priority' : 'default', sandbox: m.params.sandbox, approvalPolicy: m.params.approvalPolicy, cwd: m.params.cwd } });
  }
  if (m.method === 'turn/interrupt' || m.method === 'thread/unsubscribe') return send({ id: m.id, result: {} });
  if (m.method === 'turn/start') {
    const threadId = m.params.threadId;
    const turn = { id: `turn-${threadId}` };
    send({ id: m.id, result: { turn } });
    send({ method: 'turn/started', params: { threadId, turn } });
    if (mode === 'tool') {
      send({ method: 'item/started', params: { threadId, turnId: turn.id, item: { type: 'commandExecution', id: 'c1' } } });
      return;
    }
    if (mode === 'approval') {
      send({ id: 900, method: 'item/commandExecution/requestApproval', params: { threadId, turnId: turn.id } });
      return;
    }
    send({ method: 'item/started', params: { threadId, turnId: turn.id, item: { type: 'agentMessage', id: 'm1' } } });
    let i = 0;
    const chunk = 17;
    const timer = setInterval(() => {
      if (i >= answer.length) {
        clearInterval(timer);
        send({ method: 'turn/completed', params: { threadId, turn: { ...turn, status: 'completed' } } });
        return;
      }
      send({ method: 'item/agentMessage/delta', params: { threadId, turnId: turn.id, itemId: 'm1', delta: answer.slice(i, i + chunk) } });
      i += chunk;
    }, 5);
  }
});
