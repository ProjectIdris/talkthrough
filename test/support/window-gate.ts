// Tests that open a window of their own (a form, an Electron page) take the screen and the focus, so a whole-suite run must never start them while
// someone is at the machine. They run only when asked:
//   EXPLAINER_OPEN_WINDOWS=1 node --test test/main-nav.test.ts test/main-uia.test.ts     (or EXPLAINER_REAL_INPUT=1, the switch for the real-input set)
// `windowsHeld` is a test's `skip` value: false when they may run, else the words the runner prints.

const asked = process.env.EXPLAINER_OPEN_WINDOWS === '1' || process.env.EXPLAINER_REAL_INPUT === '1';

export const windowsHeld: string | false = process.platform !== 'win32'
  ? 'Windows only'
  : asked ? false : 'held: opens a window; set EXPLAINER_OPEN_WINDOWS=1 (or EXPLAINER_REAL_INPUT=1) when nobody is at the machine';
