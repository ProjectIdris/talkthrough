// A stand-in for the PowerShell helper's child, so the client (ps-helper.ts) and its callers can be tried without
// starting anything: it answers requests as the test says, never, late, or with garbage.

import type { HelperChild } from '../../src/main/ps-helper.ts';

export type FakeChild = HelperChild & {
  /** Every request line it was given, parsed. */
  requests: Array<Record<string, unknown>>;
  killed: number;
  /** Says something on its output, as the real one would. */
  say(text: string): void;
  /** The child ends by itself. */
  die(): void;
};

/** `answer` gets each request and returns the body to send back (the id is added), or undefined to say nothing. */
export function fakeChild(answer: (request: Record<string, unknown>) => Record<string, unknown> | undefined): FakeChild {
  let data: (chunk: string) => void = () => undefined;
  let exit: () => void = () => undefined;
  const child: FakeChild = {
    requests: [],
    killed: 0,
    write(line) {
      const request = JSON.parse(line) as Record<string, unknown>;
      child.requests.push(request);
      const body = answer(request);
      if (body) setImmediate(() => data(`${JSON.stringify({ ...body, id: request.id })}\r\n`));
    },
    onData: (listener) => { data = listener; },
    onExit: (listener) => { exit = listener; },
    kill() { child.killed++; },
    say: (text) => data(text),
    die: () => exit(),
  };
  return child;
}
