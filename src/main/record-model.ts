// A model wrapped so each call it makes is told in the log (which model, how long to its first output and to its end) and, when the record of
// questions is on, goes into it with what it wrote (raw), what it cost and how it ended. A step written by one model and the next by another can be
// told apart. The wrapped model answers exactly as before.

import type { Model, ModelOutput, ModelRequest } from '../adapters/model.ts';
import type { QuestionRecord, RecordedCall } from './record.ts';

const stageOf = (stage: ModelRequest['stage']): string | undefined => (stage ? (stage.part === 'next' ? `next ${stage.n}` : stage.part) : undefined);

export function observeModel(inner: Model, options: { record?: QuestionRecord; log: (line: string) => void }, role: string): Model {
  const { record, log } = options;
  return {
    id: inner.id,
    ...(inner.warm ? { warm: () => inner.warm!() } : {}),
    ...(inner.prime ? { prime: () => inner.prime!() } : {}),
    ...(inner.unprime ? { unprime: () => inner.unprime!() } : {}),
    ...(inner.close ? { close: () => inner.close!() } : {}),
    async *ask(request: ModelRequest): AsyncGenerator<ModelOutput> {
      const n = record ? record.nextCall() : 0;
      const began = Date.now();
      const stage = stageOf(request.stage);
      const call: RecordedCall = { n, model: inner.id, role, ...(stage ? { stage } : {}), startedAt: new Date(began).toISOString(), outputs: { steps: 0, says: 0, actions: 0, escalate: false } };
      let raw: string | undefined;
      try {
        for await (const out of inner.ask(record ? { ...request, onRaw: (text: string) => { raw = text; request.onRaw?.(text); } } : request)) {
          call.firstOutputMs ??= Date.now() - began;
          if (out.type === 'step') call.outputs.steps++;
          else if (out.type === 'say') call.outputs.says++;
          else if (out.type === 'action') call.outputs.actions++;
          else if (out.type === 'escalate') call.outputs.escalate = true;
          else if (out.type === 'usage') call.usage = out.usage;
          yield out;
        }
      } catch (error) {
        call.error = `${(error as { code?: string }).code ? `${(error as { code: string }).code}: ` : ''}${error instanceof Error ? error.message : String(error)}`;
        throw error;
      } finally {
        call.endMs = Date.now() - began;
        log(`model call${n > 0 ? ` ${n}` : ''}: ${inner.id} (${role}${stage ? `, ${stage}` : ''}) first output ${call.firstOutputMs ?? '-'} ms, ended ${call.endMs} ms${call.error ? `, failed: ${call.error}` : ''}`);
        if (record && n > 0) record.call(call, raw);
      }
    },
  };
}
