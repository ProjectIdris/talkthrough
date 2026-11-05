// The page of the settings window. It shows the settings as the file has them now, and sends them to main to be checked and saved; it
// never decides what is valid. The API key goes to main once and is never sent back: this page only learns whether one is saved.

import { CHORD_KEYS, DEFAULT_HOTKEY, MAX_HOTKEY_KEYS, hotkeyWarning, keyNameOfDom, splitHotkey } from '../shared/chord-keys.ts';
import { changedKeys, DEFAULT_LOCAL_URL, KNOWN_MODELS, savedMessage, SWITCH_WARNINGS } from '../shared/settings-form.ts';
import type { Route, SettingsForm } from '../shared/settings-form.ts';
import type { AudioDevice, ToolsFound } from '../shared/ipc.ts';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const text = (id: string): HTMLInputElement => el<HTMLInputElement>(id);
const box = (id: string): HTMLInputElement => el<HTMLInputElement>(id);
const select = (id: string): HTMLSelectElement => el<HTMLSelectElement>(id);

el('warnNav').textContent = SWITCH_WARNINGS.guideNavigation;
el('warnSnap').textContent = SWITCH_WARNINGS.controlSnap;
el('warnSplit').textContent = SWITCH_WARNINGS.splitAnswer;
el('warnCaptions').textContent = SWITCH_WARNINGS.captions;
el('warnRecord').textContent = SWITCH_WARNINGS.keepRecord;

const ROUTES: Route[] = ['claude', 'codex', 'openai', 'local'];
/** The model name typed for each connector: the one box shows the chosen connector's. */
const names: Record<Route, string> = { claude: '', codex: '', openai: '', local: '' };
let tools: ToolsFound = { claude: false, codex: false, apiKey: false };
let keySaved = false;

const chosenRoute = (): Route => (document.querySelector<HTMLInputElement>('input[name=model]:checked')?.value ?? 'codex') as Route;
const setRoute = (route: Route): void => {
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name=model]')) r.checked = r.value === route;
};
let shownRoute: Route = 'codex';

/** Shows only what matters for the choices made: the chosen connector's own fields, the later-step model, the voice address, the detail model. */
function arrange(): void {
  const route = chosenRoute();
  // The model box belongs to the connector chosen: keep what was typed for the one that was shown, show the new one's.
  names[shownRoute] = text('modelName').value;
  shownRoute = route;
  text('modelName').value = names[route];
  text('modelName').placeholder = route === 'local' ? 'The model name on your server, such as gemma3:12b' : '';
  for (const tile of document.querySelectorAll<HTMLElement>('#firstTiles .opt')) tile.classList.toggle('sel', tile.dataset.route === route);
  for (const part of document.querySelectorAll<HTMLElement>('[data-for]')) part.classList.toggle('hide', part.dataset.for !== route);
  const detail = select('detailRoute').value;
  const later = select('laterRoute').value;
  el('keybox').classList.toggle('hide', route !== 'openai' && detail !== 'openai' && later !== 'openai');
  el('localbox').classList.toggle('hide', route !== 'local' && detail !== 'local' && later !== 'local');
  el('detailbox').classList.toggle('hide', detail === '');
  el('voicebox').classList.toggle('hide', select('voiceKind').value !== 'server');
  el('recordbox').classList.toggle('hide', !box('keepRecord').checked);
  const laterOn = later !== '';
  el('laterModelRow').classList.toggle('hide', !laterOn);
  el('laterHint').textContent = laterOn ? 'The first step is written by the model above; the steps after it by this one, one step to a call.' : 'One model writes every step.';
  const laterRoute = (later === 'same' ? route : later) as Route;
  el('laterModelHint').textContent = later === 'same' ? 'Another model on the same connector, such as a stronger one for the longer steps.' : laterOn ? `Empty: ${prettyRouteModel(laterRoute) || 'that connector\'s own model'}.` : '';
  el('splitRow').classList.toggle('hide', route !== 'claude' || laterOn);
  el('firstModelHint').textContent = route === 'openai' ? 'The model your key may use.' : route === 'local' ? 'Must take pictures (a vision model).' : route === 'claude' ? 'For example claude-sonnet-5-5.' : '';
  pick('modelName', route);
  pick('laterModel', later === '' ? '' : ((later === 'same' ? route : later) as Route));
  pick('detailModel', detail === '' ? '' : (detail as Route));
  renderChips();
}

/**
 * A model box that lists the models its connector is known to offer, with "Other" to type any other name. The text box stays the value the form reads: choosing from the
 * list fills it, and it shows only for "Other". A local model, or no connector yet, is free text alone.
 */
const OTHER = '__other';
function pick(inputId: string, route: Route | ''): void {
  const input = text(inputId);
  const known = route === '' ? [] : KNOWN_MODELS[route];
  const id = `${inputId}Pick`;
  let menu = document.getElementById(id) as HTMLSelectElement | null;
  if (known.length === 0) {
    menu?.classList.add('hide');
    input.classList.remove('hide');
    input.parentElement?.classList.remove('col');
    return;
  }
  if (!menu) {
    menu = Object.assign(document.createElement('select'), { id });
    menu.setAttribute('aria-label', 'Model');
    menu.addEventListener('change', () => {
      const m = menu as HTMLSelectElement;
      if (m.value === OTHER) {
        input.classList.remove('hide');
        input.value = '';
        input.focus();
      } else {
        input.value = m.value;
        input.classList.add('hide');
      }
    });
    input.before(menu);
  }
  menu.classList.remove('hide');
  menu.replaceChildren(
    new Option('Default', ''),
    ...known.map((name) => new Option(name, name)),
    new Option('Other (type a name)', OTHER),
  );
  const value = input.value.trim();
  const listed = value === '' || known.includes(value);
  menu.value = listed ? value : OTHER;
  input.classList.toggle('hide', listed);
  input.parentElement?.classList.add('col');
}

function prettyRouteModel(route: Route): string {
  return route === shownRoute ? text('modelName').value : names[route];
}

function renderChips(): void {
  const chips: Record<Route, [string, 'ok' | 'warn' | '']> = {
    claude: tools.claude ? ['found', 'ok'] : ['not found', 'warn'],
    codex: tools.codex ? ['found', 'ok'] : ['not found', 'warn'],
    openai: keySaved ? ['key saved', 'ok'] : ['no key yet', ''],
    // An empty address, or Ollama's own, is the default one; only another address is one the person set.
    local: ['', DEFAULT_LOCAL_URL].includes(text('localBaseUrl').value.trim()) ? ['default address', ''] : ['address set', 'ok'],
  };
  for (const chip of document.querySelectorAll<HTMLElement>('[data-chip]')) {
    const [word, kind] = chips[chip.dataset.chip as Route];
    chip.textContent = word;
    chip.className = `chip ${kind}`.trim();
  }
}

// ---- The keys: one key, or a chord, recorded by pressing them ----------------------------------------------------------------------------
let hotkey = DEFAULT_HOTKEY;
let recording = false;

function showKeys(names: readonly string[], live = false): void {
  const holder = el('keysShown');
  holder.replaceChildren();
  names.forEach((name, i) => {
    if (i > 0) holder.append(Object.assign(document.createElement('span'), { className: 'muted', textContent: '+' }));
    holder.append(Object.assign(document.createElement('span'), { className: `kc${live ? ' recording' : ''}`, textContent: CHORD_KEYS[name]?.label ?? name }));
  });
  if (live && names.length === 0) holder.append(Object.assign(document.createElement('span'), { className: 'kc recording', textContent: 'Press the keys…' }));
}
function showHotkey(): void {
  const parts = splitHotkey(hotkey);
  showKeys(parts?.names ?? []);
  const warning = parts ? hotkeyWarning(parts.names) : null;
  el('keysWarn').textContent = warning ?? '';
  el('keysWarn').classList.toggle('hide', warning === null);
  el('keysError').classList.add('hide');
}

const held: string[] = [];
function stopRecording(): void {
  recording = false;
  held.length = 0;
  el('keysChange').textContent = 'Change';
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('keyup', onKeyUp, true);
  showHotkey();
}
function onKeyDown(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopPropagation();
  if (e.code === 'Escape') return stopRecording();
  const name = keyNameOfDom(e.code);
  if (!name) {
    el('keysError').textContent = 'That key cannot be used (Escape cancels a question, and the Windows key opens the Start menu).';
    el('keysError').classList.remove('hide');
    return;
  }
  el('keysError').classList.add('hide');
  if (!held.includes(name) && held.length < MAX_HOTKEY_KEYS) held.push(name);
  showKeys(held, true);
  pressedMost = Math.max(pressedMost, held.length);
  everPressed = [...new Set([...everPressed, ...held])].slice(0, MAX_HOTKEY_KEYS);
}
let pressedMost = 0;
let everPressed: string[] = [];
function onKeyUp(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopPropagation();
  // The first key let go ends the recording: whatever was held together is the hotkey.
  if (everPressed.length === 0) return;
  hotkey = everPressed.join('+');
  everPressed = [];
  pressedMost = 0;
  stopRecording();
}
el('keysChange').addEventListener('click', () => {
  if (recording) return stopRecording();
  recording = true;
  everPressed = [];
  pressedMost = 0;
  held.length = 0;
  el('keysChange').textContent = 'Cancel';
  showKeys([], true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
});
el('keysReset').addEventListener('click', () => {
  if (recording) stopRecording();
  hotkey = DEFAULT_HOTKEY;
  showHotkey();
});

// ---- The form ---------------------------------------------------------------------------------------------------------------------------

function deviceMenu(menu: HTMLSelectElement, list: AudioDevice[], chosen: string, chosenName: string, hint: HTMLElement, plain: string): void {
  menu.replaceChildren(...list.map((d) => new Option(d.name, d.id)));
  if (chosen && !list.some((d) => d.id === chosen)) {
    menu.append(new Option(`${chosenName || 'The device you chose'} (not available)`, chosen));
    hint.textContent = 'This one is not connected now, so the system default is used until it is.';
    hint.classList.add('warn');
  } else {
    hint.textContent = plain;
    hint.classList.remove('warn');
  }
  menu.value = chosen;
}

let devicesShown: { mic: string; micName: string; speaker: string; speakerName: string } = { mic: '', micName: '', speaker: '', speakerName: '' };
async function fillDevices(): Promise<void> {
  const list = await window.talkthroughSettings.devices().catch(() => null);
  const mics = list?.microphones.length ? list.microphones : [{ id: '', name: 'System default' }];
  const speakers = list?.speakers.length ? list.speakers : [{ id: '', name: 'System default' }];
  deviceMenu(select('microphone'), mics, devicesShown.mic, devicesShown.micName, el('micHint'), 'Where your question is recorded.');
  deviceMenu(select('speaker'), speakers, devicesShown.speaker, devicesShown.speakerName, el('speakerHint'), 'Every voice plays here, the system voice too.');
}

let shown: SettingsForm | null = null;

function fill(form: SettingsForm): void {
  shown = form;
  names.claude = form.claudeModel;
  names.codex = form.codexModel;
  names.openai = form.openaiModel;
  names.local = form.localModel;
  shownRoute = form.model;
  setRoute(form.model);
  text('modelName').value = names[form.model];
  box('codexFast').checked = form.codexFast;
  text('localBaseUrl').value = form.localBaseUrl;
  select('laterRoute').value = form.laterRoute !== '' ? form.laterRoute : form.laterModel !== '' ? 'same' : '';
  text('laterModel').value = form.laterModel;
  select('detailRoute').value = form.detailRoute;
  text('detailModel').value = form.detailModel;
  select('voiceKind').value = form.voiceServerUrl !== '' ? 'server' : 'system';
  text('voiceServerUrl').value = form.voiceServerUrl;
  text('voiceServerVoice').value = form.voiceServerVoice;
  text('speechServerUrl').value = form.speechServerUrl;
  hotkey = form.hotkey;
  showHotkey();
  el<HTMLTextAreaElement>('captureBlocklist').value = form.captureBlocklist.join('\n');
  box('guideNavigation').checked = form.guideNavigation;
  box('controlSnap').checked = form.controlSnap;
  select('splitAnswer').value = form.splitAnswer;
  select('captions').value = form.captions;
  box('keepRecord').checked = form.keepRecord;
  text('recordFolder').value = form.recordFolder;
  devicesShown = { mic: form.microphone, micName: form.microphoneName, speaker: form.speaker, speakerName: form.speakerName };
  void fillDevices();
  arrange();
}

const menuText = (menu: HTMLSelectElement): string => menu.selectedOptions[0]?.textContent?.replace(/ \(not available\)$/, '') ?? '';

/** What the page shows now, as a form. Choosing "system voice" sends an empty address; main does the checking. */
function collect(): SettingsForm {
  const route = chosenRoute();
  names[route] = text('modelName').value;
  const server = select('voiceKind').value === 'server';
  const later = select('laterRoute').value;
  const mic = select('microphone').value, speaker = select('speaker').value;
  return {
    model: route,
    codexModel: names.codex,
    claudeModel: names.claude,
    openaiModel: names.openai,
    localModel: names.local,
    localBaseUrl: text('localBaseUrl').value,
    codexFast: box('codexFast').checked,
    laterRoute: later === '' || later === 'same' ? '' : (later as Route),
    laterModel: later === '' ? '' : text('laterModel').value,
    microphone: mic,
    microphoneName: mic === '' ? '' : menuText(select('microphone')),
    speaker,
    speakerName: speaker === '' ? '' : menuText(select('speaker')),
    detailRoute: select('detailRoute').value as SettingsForm['detailRoute'],
    detailModel: text('detailModel').value,
    voiceServerUrl: server ? text('voiceServerUrl').value : '',
    voiceServerVoice: server ? text('voiceServerVoice').value : '',
    speechServerUrl: text('speechServerUrl').value,
    hotkey,
    captureBlocklist: el<HTMLTextAreaElement>('captureBlocklist').value.split(/\r?\n/),
    guideNavigation: box('guideNavigation').checked,
    controlSnap: box('controlSnap').checked,
    splitAnswer: select('splitAnswer').value as SettingsForm['splitAnswer'],
    captions: select('captions').value as SettingsForm['captions'],
    keepRecord: box('keepRecord').checked,
    recordFolder: text('recordFolder').value,
  };
}

const messages = el('messages'), saved = el('saved');

function showMessages(list: readonly string[]): void {
  messages.replaceChildren(...list.map((m) => Object.assign(document.createElement('li'), { textContent: m })));
  messages.classList.toggle('hide', list.length === 0);
}

async function save(): Promise<void> {
  showMessages([]);
  saved.classList.add('hide');
  if (select('voiceKind').value === 'server' && text('voiceServerUrl').value.trim() === '') {
    showMessages(['Type the voice server address, or choose the system voice.']);
    return;
  }
  if (recording) stopRecording();
  const result = await window.talkthroughSettings.store(collect());
  if (!result.ok) {
    showMessages(result.messages);
    return;
  }
  const said = savedMessage(shown ? changedKeys(shown, result.form) : result.changed ? ['model'] : []);
  fill(result.form);
  saved.textContent = said.text;
  saved.classList.remove('hide');
  el('restart').classList.toggle('hide', !said.restart);
}

for (const radio of document.querySelectorAll('input[name=model]')) radio.addEventListener('change', arrange);
for (const id of ['detailRoute', 'laterRoute', 'voiceKind']) select(id).addEventListener('change', arrange);
text('localBaseUrl').addEventListener('input', renderChips);
box('keepRecord').addEventListener('change', arrange);
el('save').addEventListener('click', () => void save());
el('restart').addEventListener('click', () => window.talkthroughSettings.restart());
el('close').addEventListener('click', () => window.close());

// The local model: is the server there, does it list the model, does it take a picture.
el('localTest').addEventListener('click', async () => {
  const result = el('localResult');
  result.className = 'hint';
  result.textContent = 'Testing…';
  (el('localTest') as HTMLButtonElement).disabled = true;
  const model = chosenRoute() === 'local' ? text('modelName').value : select('laterRoute').value === 'local' ? text('laterModel').value : names.local;
  const answer = await window.talkthroughSettings.testLocal(text('localBaseUrl').value, model || names.local).catch(() => ({ ok: false, message: 'The test could not be run.' }));
  result.textContent = answer.message;
  result.className = `hint ${answer.ok ? 'ok' : 'err'}`;
  (el('localTest') as HTMLButtonElement).disabled = false;
});

// The API key: sent to main once, never shown again.
const stateEl = el('state'), keyEl = text('key'), keyMessage = el('keymessage');
async function refreshKey(): Promise<void> {
  const status = await window.talkthroughSettings.status();
  keySaved = status.saved;
  stateEl.textContent = !status.available
    ? 'This computer cannot encrypt a key for your account, so none can be saved.'
    : status.saved ? 'A key is saved.' : 'No key is saved.';
  renderChips();
}
el('savekey').addEventListener('click', async () => {
  keyMessage.textContent = '';
  const result = await window.talkthroughSettings.save(keyEl.value);
  keyEl.value = ''; // the page never keeps the key
  keyMessage.textContent = result.ok ? '' : result.message;
  await refreshKey();
});
el('removekey').addEventListener('click', async () => {
  keyMessage.textContent = '';
  await window.talkthroughSettings.clear();
  await refreshKey();
});

// Hearing: what hears a question now, and the one-click offer of better hearing (nothing is downloaded until the button is pressed).
const mb = (bytes: number): string => `${Math.round(bytes / 1_000_000)} MB`;
const NAMES: Record<string, string> = { server: 'your speech server', 'whisper-cpp': 'whisper.cpp', 'windows-speech': 'Windows speech' };
async function refreshHearing(): Promise<void> {
  const info = await window.talkthroughSettings.speech();
  if (!info) return;
  const first = info.order[0];
  el('hearNow').textContent = first === undefined ? 'Nothing yet' : NAMES[first] ?? first;
  el('hearDot').className = `dot ${first === undefined ? 'err' : 'ok'}`;
  el('hearHint').textContent = first === undefined
    ? 'Nothing is set up to hear you yet. Download clearer hearing below, or give your own speech server.'
    : info.order.length > 1 ? `If it cannot, ${info.order.slice(1).map((o) => NAMES[o] ?? o).join(', then ')} takes over.` : 'It runs on this computer.';
  const installed = info.whisper.installed;
  el('hearOffer').classList.toggle('hide', installed);
  el('hearRemoveRow').classList.toggle('hide', !installed);
  const modelMenu = select('hearModel');
  if (modelMenu.options.length === 0) for (const m of info.offer.models) modelMenu.append(new Option(m.label, m.name, false, m.name === 'base.en'));
  const chosen = info.offer.models.find((m) => m.name === modelMenu.value) ?? info.offer.models[0];
  el('hearOfferText').textContent = `More exact than the recogniser Windows has, and it runs on this computer. This downloads the program (${mb(info.offer.program.bytes)} from ${info.offer.program.from}) and the model you pick (${chosen ? `${mb(chosen.bytes)} from ${chosen.from}` : ''}), both published by the whisper.cpp project. Both are checked against known sizes and fingerprints and kept in Talkthrough's own folder. Nothing is sent anywhere when you ask a question.`;
}
select('hearModel').addEventListener('change', () => void refreshHearing());
const bar = el<HTMLProgressElement>('hearBar');
window.talkthroughSettings.onSpeechProgress((p) => {
  el('hearProgressRow').classList.remove('hide');
  bar.value = p.total > 0 ? p.received / p.total : 0;
  el('hearMessage').textContent = p.step === 'program' ? 'Downloading the program…' : p.step === 'unpack' ? 'Unpacking…' : 'Downloading the model…';
});
el('hearGet').addEventListener('click', async () => {
  el('hearGet').classList.add('hide');
  el('hearStop').classList.remove('hide');
  el('hearProgressRow').classList.remove('hide');
  el('hearMessage').textContent = 'Starting…';
  const result = await window.talkthroughSettings.installSpeech(select('hearModel').value);
  el('hearStop').classList.add('hide');
  el('hearGet').classList.remove('hide');
  if (result.ok) el('hearProgressRow').classList.add('hide');
  else el('hearMessage').textContent = result.message;
  await refreshHearing();
});
el('hearStop').addEventListener('click', () => window.talkthroughSettings.cancelSpeech());
el('hearRemove').addEventListener('click', async () => {
  await window.talkthroughSettings.removeSpeech();
  await refreshHearing();
});

// Main can ask for a section to be shown (the Hearing section, from "Set up hearing" on the screen).
window.talkthroughSettings.onFocus((section) => {
  const card = document.getElementById(`section${section.charAt(0).toUpperCase()}${section.slice(1)}`);
  if (!card) return;
  card.scrollIntoView({ block: 'start', behavior: 'smooth' });
  card.classList.remove('flash');
  void card.offsetWidth;
  card.classList.add('flash');
});

void window.talkthroughSettings.load().then((form) => {
  if (form) fill(form);
});
void window.talkthroughSettings.tools().then((t) => {
  tools = t;
  renderChips();
}, () => undefined);
void refreshKey();
void refreshHearing();
