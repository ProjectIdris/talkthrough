// Pulls finished steps out of a scene as its JSON text streams in, so the first step can be
// drawn and spoken while the model is still writing the rest.

const MAX_STEP_CHARS = 200_000;
const MAX_KEY_CHARS = 64;
const MAX_ESCALATE_RAW = 2000;

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
export function createStepStream(): StepStream {
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

  function push(chunk: string): unknown[] {
    const out: unknown[] = [];
    let from = 0; // where the current step's text starts in this chunk
    for (let i = 0; i < chunk.length && !done; i++) {
      const c = chunk[i];
      if (stack.length === 0 && !inString && c !== '{') continue; // chatter before the scene
      if (inString) {
        if (capture && valRaw.length < MAX_ESCALATE_RAW && (escaped || c !== '"')) valRaw += c;
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') {
          inString = false;
          if (stack.length === 1) {
            lastKey = keyBuf;
            if (capture) escalate = unquote(valRaw);
            capture = false;
            expectValue = false;
          }
        } else if (stack.length === 1 && keyBuf.length < MAX_KEY_CHARS) keyBuf += c;
        continue;
      }
      if (c === '"') {
        inString = true;
        keyBuf = '';
        capture = stack.length === 1 && expectValue && rootKey === 'escalate';
        valRaw = '';
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
        }
        stack.push(c);
      } else if (c === ':' && stack.length === 1) {
        rootKey = lastKey;
        expectValue = true;
      } else if (c === ',' && stack.length === 1) {
        expectValue = false;
      } else if (c === '}' || c === ']') {
        const open = stack.pop();
        if (open === undefined || (c === '}') !== (open === '{')) throw new Error('scene text has mismatched brackets');
        if (inElem && stack.length === stepsDepth) {
          const text = elem + chunk.slice(from, i + 1);
          inElem = false;
          elem = '';
          if (text.length > MAX_STEP_CHARS) throw new Error('scene step is too large');
          try {
            out.push(JSON.parse(text));
          } catch {
            throw new Error('scene step is not valid JSON');
          }
        } else if (stack.length === 0) {
          done = true;
        }
      }
    }
    if (inElem) {
      elem += chunk.slice(from);
      if (elem.length > MAX_STEP_CHARS) throw new Error('scene step is too large');
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
