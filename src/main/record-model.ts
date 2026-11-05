// A model wrapped so each call it makes goes into the record of the question: which model, when it began, how long to its first output and
// to its end, what it wrote (raw), what it cost, and how it ended. The wrapped model answers exactly as before.

import type { Model, ModelOutput, ModelRequest } from '../adapters/model.ts';
import type { QuestionRecord, RecordedCall } from './record.ts';

const stageOf = (stage: ModelRequest['stage']): string | undefined => (stage ? (stage.part === 'next' ? `next ${stage.n}` : stage.part) : undefined);

export function recordModel(inner: Model, record: QuestionRecord, role: string): Model {
  return {
    id: inner.id,
    ...(inner.warm ? { warm: () => inner.warm!() } : {}),
    ...(inner.prime ? { prime: () => inner.prime!() } : {}),
    ...(inner.unprime ? { unprime: () => inner.unprime!() } : {}),
    ...(inner.close ? { close: () => inner.close!() } : {}),
    async *ask(request: ModelRequest): AsyncGenerator<ModelOutput> {
      const n = record.nextCall();
      const began = Date.now();
      const stage = stageOf(request.stage);
      const call: RecordedCall = { n, model: inner.id, role, ...(stage ? { stage } : {}), startedAt: new Date(began).toISOString(), outputs: { steps: 0, says: 0, actions: 0, escalate: false } };
      let raw: string | undefined;
      try {
        for await (const out of inner.ask({ ...request, onRaw: (text: string) => { raw = text; request.onRaw?.(text); } })) {
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
        if (n > 0) record.call(call, raw);
      }
    },
  };
}
