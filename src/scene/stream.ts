// Pulls finished steps out of a scene as its JSON text streams in, so the first step can be
// drawn and spoken while the model is still writing the rest. A caller that wants more can also be
// told of a step's `say` text the moment its string closes, and of each action the moment its object
// closes, before the step itself is complete (see `onPiece`).

const MAX_STEP_CHARS = 200_000;
const MAX_KEY_CHARS = 64;
const MAX_ESCALATE_RAW = 2000;
const MAX_SAY_RAW = 4000;

/**
 * A part of a step that has arrived whole. Raw and unvalidated. The step's say and actions come as they
 * close, and the step itself, complete, follows them: it is the boundary of the step.
 */
export type StepPiece = { type: 'say'; say: string } | { type: 'action'; action: unknown } | { type: 'step'; step: unknown };

export type StepStreamOptions = {
  /** Called, in the order they arrive, with each step's say text, each of its actions and then the step itself. push() still returns the steps. */
  onPiece?: (piece: StepPiece) => void;
};

export type StepStream = {
  /** Feed the next chunk of text; returns the steps that this chunk completed (unvalidated). */
  push(chunk: string): unknown[];
  /** The scene's top-level `escalate` text once it has arrived (unvalidated; see validateEscalate). */
  readonly escalate: string | undefined;
  /** True once the scene's closing brace has been seen. */
  readonly complete: boolean;
  /** Call when the text ends; throws if the scene was cut off. */
  end(): void;
};

/** The text of a JSON string body (escapes included), or the body as is when it is cut short. */
function unquote(raw: string): string {
  try {
    const s: unknown = JSON.parse('"' + raw + '"');
    return typeof s === 'string' ? s : raw;
  } catch {
    return raw.split('\\').join('');
  }
}

/**
 * Text before the scene's opening brace and after its closing brace is ignored (code fences,
 * chatter). Throws on mismatched brackets, on a step that is not valid JSON, and on a step
 * over 200,000 characters.
 */
export function createStepStream(options: StepStreamOptions = {}): StepStream {
  const onPiece = options.onPiece;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let keyBuf = ''; // text of the string being read directly inside the scene object
  let lastKey = '';
  let rootKey = '';
  let stepsDepth = 0; // stack depth of the steps array once found
  let elem = '';
  let inElem = false;
  let done = false;
  let expectValue = false; // between a root key's colon and the next comma
  let capture = false; // reading the root-level escalate value
  let valRaw = '';
  let escalate: string | undefined;
  // Inside a step: its keys, the say string, and the action objects of its `actions` list.
  let stepKeyBuf = '';
  let stepKey = '';
  let stepExpectValue = false;
  let saying = false;
  let sayRaw = '';
  let inAct = false;
  let act = '';
  let sawSay = false; // a step repeating its say or actions key: the first one is the one streamed
  let sawActions = false;

  function push(chunk: string): unknown[] {
    const out: unknown[] = [];
    let from = 0; // where the current step's text starts in this chunk
    let actFrom = 0; // and the current action's
    for (let i = 0; i < chunk.length && !done; i++) {
      const c = chunk[i];
      if (stack.length === 0 && !inString && c !== '{') continue; // chatter before the scene
      if (inString) {
        if (capture && valRaw.length < MAX_ESCALATE_RAW && (escaped || c !== '"')) valRaw += c;
        if (saying && sayRaw.length < MAX_SAY_RAW && (escaped || c !== '"')) sayRaw += c;
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') {
          inString = false;
          if (stack.length === 1) {
            lastKey = keyBuf;
            if (capture) escalate = unquote(valRaw);
            capture = false;
            expectValue = false;
          } else if (inElem && stack.length === stepsDepth + 1) {
            if (saying) {
              onPiece?.({ type: 'say', say: unquote(sayRaw) });
              sawSay = true;
            }
            if (!stepExpectValue) stepKey = stepKeyBuf;
            saying = false;
            stepExpectValue = false;
          }
        } else if (stack.length === 1 && keyBuf.length < MAX_KEY_CHARS) keyBuf += c;
        else if (inElem && stack.length === stepsDepth + 1 && !stepExpectValue && stepKeyBuf.length < MAX_KEY_CHARS) stepKeyBuf += c;
        continue;
      }
      if (c === '"') {
        inString = true;
        keyBuf = '';
        capture = stack.length === 1 && expectValue && rootKey === 'escalate';
        valRaw = '';
        stepKeyBuf = '';
        saying = onPiece !== undefined && !sawSay && inElem && stack.length === stepsDepth + 1 && stepExpectValue && stepKey === 'say';
        sayRaw = '';
      } else if (c === '{' || c === '[') {
        if (stack.length === 0) {
          if (c === '{') stack.push(c);
          continue;
        }
        if (stack.length === 1 && c === '[' && rootKey === 'steps' && stepsDepth === 0) stepsDepth = 2;
        if (c === '{' && stepsDepth > 0 && stack.length === stepsDepth) {
          inElem = true;
          elem = '';
          from = i;
          stepKey = '';
          stepExpectValue = false;
          sawSay = false;
          sawActions = false;
        }
        if (onPiece && c === '{' && inElem && stack.length === stepsDepth + 2 && stepKey === 'actions' && !sawActions) {
          inAct = true;
          act = '';
          actFrom = i;
        }
        stack.push(c);
      } else if (c === ':' && stack.length === 1) {
        rootKey = lastKey;
        expectValue = true;
      } else if (c === ',' && stack.length === 1) {
        expectValue = false;
      } else if (c === ':' && inElem && stack.length === stepsDepth + 1) {
        stepExpectValue = true;
      } else if (c === ',' && inElem && stack.length === stepsDepth + 1) {
        stepExpectValue = false;
      } else if (c === '}' || c === ']') {
        const open = stack.pop();
        if (open === undefined || (c === '}') !== (open === '{')) throw new Error('scene text has mismatched brackets');
        if (inAct && stack.length === stepsDepth + 2) {
          const text = act + chunk.slice(actFrom, i + 1);
          inAct = false;
          act = '';
          if (text.length > MAX_STEP_CHARS) throw new Error('scene step is too large');
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            throw new Error('scene step is not valid JSON');
          }
          onPiece?.({ type: 'action', action: parsed });
        }
        if (inElem && stack.length === stepsDepth + 1 && c === ']' && stepKey === 'actions') sawActions = true;
        if (inElem && stack.length === stepsDepth) {
          const text = elem + chunk.slice(from, i + 1);
          inElem = false;
          elem = '';
          if (text.length > MAX_STEP_CHARS) throw new Error('scene step is too large');
          let step: unknown;
          try {
            step = JSON.parse(text);
          } catch {
            throw new Error('scene step is not valid JSON');
          }
          out.push(step);
          onPiece?.({ type: 'step', step });
        } else if (stack.length === 0) {
          done = true;
        }
      }
    }
    if (inElem) {
      elem += chunk.slice(from);
      if (elem.length > MAX_STEP_CHARS) throw new Error('scene step is too large');
    }
    if (inAct) {
      act += chunk.slice(actFrom);
      if (act.length > MAX_STEP_CHARS) throw new Error('scene step is too large');
    }
    return out;
  }

  return {
    push,
    get escalate() { return escalate; },
    get complete() { return done; },
    end() {
      if (!done) throw new Error('scene text ended before the scene was complete');
    },
  };
}
