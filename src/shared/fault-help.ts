// The words for the things that go wrong the first time: no Claude Code or Codex, not signed in, no microphone, a voice server that is not there.
// One place, so the notice on the screen, the first-run window and the docs say the same thing, and each says what to do next. The fault codes and
// messages come from the adapters (they are plain text: "the claude command was not found", "claude stopped before answering: ..."); this reads them.

export type FaultTool = 'claude' | 'codex' | 'local' | 'api' | 'other';

/**
 * Which connector a model fault came from: the model's own id when it names one (`codex:...`, `openai:...`, `local:...`, or a Claude model name),
 * else the adapter's words. Two connectors joined (`a+b`) cannot say which failed, so the words decide.
 */
export function toolOf(message: string, label = ''): FaultTool {
  const id = label.toLowerCase();
  if (id !== '' && !id.includes('+')) {
    if (id.startsWith('codex')) return 'codex';
    if (id.startsWith('openai')) return 'api';
    if (id.startsWith('local')) return 'local';
    if (id.includes('claude')) return 'claude';
  }
  const m = message.toLowerCase();
  if (/\bclaude\b/.test(m)) return 'claude';
  if (/\bcodex\b/.test(m)) return 'codex';
  if (m.includes('local model server')) return 'local';
  if (/\bapi\b/.test(m)) return 'api';
  return 'other';
}

const NAME: Record<'claude' | 'codex', string> = { claude: 'Claude Code', codex: 'Codex' };
/** What to type in a terminal to sign in, for each tool. */
export const SIGN_IN_COMMAND: Record<'claude' | 'codex', string> = { claude: 'claude', codex: 'codex login' };

/** The one sentence a model fault is shown as. `code` is the ModelError code; `message` is its text and `label` the model's id (either says which tool it was). */
export function modelFault(code: string, message: string, label = ''): string {
  const tool = toolOf(message, label);
  const m = message.toLowerCase();
  if (code === 'unavailable' && (tool === 'claude' || tool === 'codex')) {
    const name = NAME[tool];
    if (m.includes('command was not found')) return `${name} isn't installed, or Talkthrough can't find it. Install it, or choose another way to answer in Settings.`;
    if (m.includes('could not start')) return `${name} is there but would not start. Check that \`${tool}\` runs in a terminal, or give its full path in Settings.`;
    return `${name} stopped before it answered. Open a terminal and run \`${SIGN_IN_COMMAND[tool]}\` to check it is working and signed in.`;
  }
  if (code === 'auth' && (tool === 'claude' || tool === 'codex')) return `${NAME[tool]} isn't signed in. Open a terminal, run \`${SIGN_IN_COMMAND[tool]}\`, sign in, then ask again.`;
  if (code === 'auth' && tool === 'api') return "The API didn't accept the key. Check the key, and the account's billing, in Settings.";
  if (code === 'unavailable' && tool === 'local') return "I couldn't reach the local model server. Is it running, with the model loaded? Settings can test it.";
  if (code === 'unavailable' && tool === 'api') return "I couldn't reach the API. Check the internet connection.";
  switch (code) {
    case 'unavailable': return "I couldn't reach the model. Is it installed and signed in?";
    case 'auth': return 'The model needs you to sign in again.';
    case 'rate-limited': return "The model's usage limit has been reached for now.";
    case 'refused': return 'I stopped: the model tried to do something it is not allowed to.';
    case 'bad-output': return "The model's answer was garbled. Try again?";
    default: return 'Something went wrong while I was thinking. Try again?';
  }
}

/** The one sentence a failed microphone is shown as, read from what the browser engine said when it could not open it. */
export function microphoneFault(message: string): string {
  const m = message.toLowerCase();
  if (/permission|denied|not ?allowed/.test(m)) return 'Windows is not letting Talkthrough use the microphone. In Windows Settings, Privacy and security, Microphone, allow desktop apps.';
  if (/not ?found|no (audio|microphone|device)|requested device/.test(m)) return 'No microphone was found. Plug one in, or choose one in Settings.';
  if (/could not start|not ?readable|in use|busy/.test(m)) return 'The microphone could not be opened; another app may be using it. Close that app, or choose another microphone in Settings.';
  return "I couldn't use the microphone. Check that it is connected and allowed in Windows, or choose another in Settings.";
}

/** Said once when a voice server the person set up is not answering and the system voice speaks instead. */
export const VOICE_SERVER_DOWN = "The voice server isn't answering, so the system voice is speaking. Check that it is running, and its address in Settings.";

/** First-run and Settings: what to do for a connector, whether or not it was found. */
export const ROUTE_HELP: Record<'claude' | 'codex', { missing: string; signIn: string }> = {
  claude: {
    missing: "Claude Code wasn't found on this computer. Install it, then reopen this window. If it is installed somewhere unusual, give its full path in the settings file (claudeCommand).",
    signIn: 'Open a terminal, run `claude` once and sign in if it asks. Talkthrough never sees your sign-in.',
  },
  codex: {
    missing: "Codex wasn't found on this computer. Install the Codex command-line tool, then reopen this window. If it is installed somewhere unusual, give its full path in the settings file (codexCommand).",
    signIn: 'Open a terminal, run `codex login` and sign in if it asks. Talkthrough never sees your sign-in.',
  },
};

/** The help line for a chosen connector, or '' when it needs none (an API key or a local model have their own boxes). */
export function routeHelp(route: string, found: boolean): string {
  if (route !== 'claude' && route !== 'codex') return '';
  const help = ROUTE_HELP[route];
  return found ? help.signIn : `${help.missing} ${help.signIn}`;
}
