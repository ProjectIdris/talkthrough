// The first-run window: three steps (what holding the keys does, how a question is heard, where answers come from), then the app is ready. It reads the
// settings and the tools found, and changes only what the person chooses; every choice can be changed later in Settings. Nothing is downloaded
// until the Download button is pressed, and the API key goes to main once and is never shown again.

import { CHORD_KEYS, splitHotkey } from '../shared/chord-keys.ts';
import { modelLine } from '../main/model-plan.ts';
import type { FirstRunInfo, ToolsFound } from '../shared/ipc.ts';
import { DEFAULT_LOCAL_URL } from '../shared/settings-form.ts';
import type { Route, SettingsForm } from '../shared/settings-form.ts';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const api = window.talkthroughSettings;

let info: FirstRunInfo;
let tools: ToolsFound;
let form: SettingsForm;

function step(n: number): void {
  for (const s of document.querySelectorAll<HTMLElement>('.step')) s.classList.toggle('on', s.id === `step${n}`);
  document.querySelectorAll('.dots span').forEach((d, i) => d.classList.toggle('on', i === n - 1));
}

// ---- 1: the keys ------------------------------------------------------------------------------------------------------------------------
function showKeys(): void {
  const parts = splitHotkey(form.hotkey) ?? splitHotkey('right-ctrl+right-shift')!;
  const holder = el('keysShown');
  holder.replaceChildren();
  parts.names.forEach((name, i) => {
    if (i > 0) holder.append(Object.assign(document.createElement('span'), { className: 'muted plus', textContent: '+' }));
    holder.append(Object.assign(document.createElement('span'), { className: 'key', textContent: CHORD_KEYS[name]?.label ?? name }));
  });
  const many = parts.names.length > 1;
  el('keysNote').textContent = many
    ? `Nothing is recorded until you hold ${parts.names.length === 2 ? 'both' : 'all'} keys.${CHORD_KEYS[parts.names[0]!]?.modifier ? ` Holding ${CHORD_KEYS[parts.names[0]!]!.label} alone only gets the microphone ready.` : ''} You can change the keys in Settings.`
    : 'Nothing is recorded until you hold the key. You can change it in Settings.';
  el('keysSay').textContent = parts.label;
}

// ---- 2: hearing -------------------------------------------------------------------------------------------------------------------------
const mb = (bytes: number): string => `${Math.round(bytes / 1_000_000)} MB`;
let model = 'base.en';
async function refreshEar(): Promise<void> {
  const s = await api.speech();
  if (!s) return;
  el('winChip').textContent = s.windows ? 'ready now' : 'not on this computer';
  el('winChip').className = `chip ${s.windows ? 'ok' : 'warn'}`;
  const chosen = s.offer.models.find((m) => m.name === model) ?? s.offer.models[0];
  const total = s.offer.program.bytes + (chosen?.bytes ?? 0);
  el('whisperText').textContent = s.whisper.installed
    ? 'Installed. It runs on this computer.'
    : `Runs on this computer and hears more exactly. This downloads whisper.cpp (${mb(s.offer.program.bytes)} from ${s.offer.program.from}) and a model (${chosen ? `${mb(chosen.bytes)} from ${chosen.from}` : ''}), about ${mb(total)} in all, both published by the whisper.cpp project. Both are checked against fixed fingerprints, and you can remove them in Settings.`;
  el('whisperChip').textContent = s.whisper.installed ? 'installed' : 'optional download';
  el('whisperChip').className = `chip ${s.whisper.installed ? 'ok' : ''}`.trim();
  el('whisperGet').classList.toggle('hide', s.whisper.installed);
}
function pickEar(): void {
  const whisper = document.querySelector<HTMLInputElement>('input[name=ear]:checked')?.value === 'whisper';
  el('optWindows').classList.toggle('sel', !whisper);
  el('optWhisper').classList.toggle('sel', whisper);
  el('whisperBody').classList.toggle('hide', !whisper);
}
for (const radio of document.querySelectorAll('input[name=ear]')) radio.addEventListener('change', pickEar);
const bar = el<HTMLProgressElement>('whisperBar');
api.onSpeechProgress((p) => {
  bar.classList.remove('hide');
  bar.value = p.total > 0 ? p.received / p.total : 0;
  el('whisperMsg').textContent = p.step === 'program' ? 'Downloading the program…' : p.step === 'unpack' ? 'Unpacking…' : 'Downloading the model…';
});
el('whisperGet').addEventListener('click', async () => {
  el('whisperGet').classList.add('hide');
  el('whisperStop').classList.remove('hide');
  el('whisperMsg').textContent = 'Starting…';
  const result = await api.installSpeech(model);
  el('whisperStop').classList.add('hide');
  bar.classList.add('hide');
  el('whisperMsg').textContent = result.ok ? '' : result.message;
  await refreshEar();
});
el('whisperStop').addEventListener('click', () => api.cancelSpeech());

el('micTest').addEventListener('click', async () => {
  const button = el<HTMLButtonElement>('micTest');
  button.disabled = true;
  el('heard').textContent = 'Listening for three seconds…';
  el('meter').replaceChildren();
  const result = await api.micTest();
  button.disabled = false;
  if (!result.ok) {
    el('heard').textContent = result.message;
    return;
  }
  const meter = el('meter');
  meter.replaceChildren(...result.levels.map((l) => Object.assign(document.createElement('i'), { style: `height:${Math.max(3, Math.round(l * 28))}px` })));
  const loud = Math.max(0, ...result.levels) > 0.04;
  el('heard').textContent = result.heard ? `I heard: “${result.heard}”` : loud ? 'The microphone works, but I could not make out words. Try again closer.' : 'I heard nothing. Check the microphone, or choose another in Settings.';
});
el('visualTour').addEventListener('click', () => api.openVisualTour());
el('next1').addEventListener('click', () => step(2));
el('back2').addEventListener('click', () => step(1));
el('next2').addEventListener('click', () => step(3));

// ---- 3: where answers come from ---------------------------------------------------------------------------------------------------------
const chosenRoute = (): Route => (document.querySelector<HTMLInputElement>('input[name=route]:checked')?.value ?? 'codex') as Route;
const localUrl = (): string => el<HTMLInputElement>('localBaseUrl').value.trim();
const localName = (): string => el<HTMLInputElement>('localModel').value.trim();

function renderRoutes(): void {
  const route = chosenRoute();
  const chips: Record<Route, [string, string]> = {
    claude: tools.claude ? ['found on this computer', 'ok'] : ['not found', 'warn'],
    codex: tools.codex ? ['found on this computer', 'ok'] : ['not found', 'warn'],
    openai: tools.apiKey ? ['key saved', 'ok'] : ['no key yet', ''],
    // Ollama's own address is used when none is set; "address set" is only for one the person typed.
    local: !localName() ? ['set up below', ''] : ['', DEFAULT_LOCAL_URL].includes(localUrl()) ? ['default address', ''] : ['address set', 'ok'],
  };
  for (const chip of document.querySelectorAll<HTMLElement>('[data-chip]')) {
    const [word, kind] = chips[chip.dataset.chip as Route];
    chip.textContent = word;
    chip.className = `chip ${kind}`.trim();
  }
  for (const opt of document.querySelectorAll<HTMLElement>('#routes .opt')) opt.classList.toggle('sel', opt.dataset.route === route);
  for (const body of document.querySelectorAll<HTMLElement>('[data-body]')) body.classList.toggle('hide', body.dataset.body !== route);
  // What answers will use, as the settings hold it (with this route in place of the saved one).
  el('modelLine').textContent = modelLine({
    model: route,
    codexModel: form.codexModel,
    claudeModel: form.claudeModel,
    openaiModel: form.openaiModel,
    localModel: localName() || form.localModel,
    laterRoute: form.laterRoute,
    laterModel: form.laterModel,
  });
}
for (const radio of document.querySelectorAll('input[name=route]')) radio.addEventListener('change', renderRoutes);
for (const id of ['localBaseUrl', 'localModel']) el(id).addEventListener('input', renderRoutes);

el('savekey').addEventListener('click', async () => {
  const input = el<HTMLInputElement>('key');
  const result = await api.save(input.value);
  input.value = ''; // the page never keeps the key
  el('keymessage').textContent = result.ok ? 'Saved.' : result.message;
  tools = await api.tools();
  renderRoutes();
});
el('localTest').addEventListener('click', async () => {
  el('localResult').textContent = 'Testing…';
  const answer = await api.testLocal(localUrl() || 'http://127.0.0.1:11434/v1', localName()).catch(() => ({ ok: false, message: 'The test could not be run.' }));
  el('localResult').textContent = answer.message;
  el('localResult').className = `hint ${answer.ok ? 'ok' : 'err'}`;
});
el('back3').addEventListener('click', () => step(2));
el('finish').addEventListener('click', async () => {
  const route = chosenRoute();
  const error = el('stepError');
  error.textContent = '';
  if (route === 'openai' && !tools.apiKey) return void (error.textContent = 'Paste a key and press Save key, or choose another.');
  if (route === 'local' && !localName()) return void (error.textContent = 'Type the name of the model on your server, or choose another.');
  const next: SettingsForm = { ...form, model: route, ...(route === 'local' || localName() ? { localModel: localName() || form.localModel } : {}), ...(localUrl() ? { localBaseUrl: localUrl() } : {}) };
  const result = await api.store(next);
  if (!result.ok) return void (error.textContent = result.messages.join(' '));
  api.firstRunDone(result.changed);
});

// ---- start ------------------------------------------------------------------------------------------------------------------------------
void api.firstRun().then(async (got) => {
  if (!got) return void window.close();
  info = got;
  tools = got.tools;
  form = got.form;
  showKeys();
  el<HTMLInputElement>('localBaseUrl').value = form.localBaseUrl;
  el<HTMLInputElement>('localModel').value = form.localModel;
  // The route the settings hold, if its tool is there; else the first tool found; else what the settings hold.
  const found: Record<Route, boolean> = { claude: tools.claude, codex: tools.codex, openai: tools.apiKey, local: form.localBaseUrl !== '' && form.localModel !== '' };
  const start: Route = found[form.model] ? form.model : (['claude', 'codex', 'openai', 'local'] as Route[]).find((r) => found[r]) ?? form.model;
  const radio = document.querySelector<HTMLInputElement>(`input[name=route][value=${start}]`);
  if (radio) radio.checked = true;
  renderRoutes();
  pickEar();
  await refreshEar();
});
