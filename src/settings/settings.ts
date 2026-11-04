// The page of the settings window. It shows the settings as the file has them now, and sends them to main to be checked and saved; it
// never decides what is valid. The API key goes to main once and is never sent back: this page only learns whether one is saved.

import { CHORD_KEYS } from '../main/chord.ts';
import { changedKeys, savedMessage, SWITCH_WARNINGS } from '../shared/settings-form.ts';
import type { Route, SettingsForm } from '../shared/settings-form.ts';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const text = (id: string): HTMLInputElement => el<HTMLInputElement>(id);
const box = (id: string): HTMLInputElement => el<HTMLInputElement>(id);
const select = (id: string): HTMLSelectElement => el<HTMLSelectElement>(id);

const hotkeyA = select('hotkeyA'), hotkeyB = select('hotkeyB');
for (const menu of [hotkeyA, hotkeyB]) {
  for (const [name, key] of Object.entries(CHORD_KEYS)) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = key.label;
    menu.append(option);
  }
}
el('warnNav').textContent = SWITCH_WARNINGS.guideNavigation;
el('warnSnap').textContent = SWITCH_WARNINGS.controlSnap;
el('warnTwoStep').textContent = SWITCH_WARNINGS.twoStepAnswer;

/** Shows only what matters for the choices made: the model of the chosen route, the key box when a route needs a key, the voice address when a server is chosen. */
function arrange(): void {
  const route = select('model').value as Route;
  for (const part of document.querySelectorAll<HTMLElement>('[data-route]')) part.classList.toggle('hide', part.dataset.route !== route);
  el('keybox').classList.toggle('hide', route !== 'openai' && select('detailRoute').value !== 'openai');
  el('detailbox').classList.toggle('hide', select('detailRoute').value === '');
  el('voicebox').classList.toggle('hide', !box('voiceServer').checked);
}

function fill(form: SettingsForm): void {
  shown = form;
  select('model').value = form.model;
  text('codexModel').value = form.codexModel;
  text('claudeModel').value = form.claudeModel;
  text('openaiModel').value = form.openaiModel;
  box('codexFast').checked = form.codexFast;
  select('detailRoute').value = form.detailRoute;
  text('detailModel').value = form.detailModel;
  const server = form.voiceServerUrl !== '';
  box('voiceServer').checked = server;
  box('voiceSystem').checked = !server;
  text('voiceServerUrl').value = form.voiceServerUrl;
  text('voiceServerVoice').value = form.voiceServerVoice;
  text('speechServerUrl').value = form.speechServerUrl;
  const [a, b] = form.hotkey.split('+');
  hotkeyA.value = a ?? '';
  hotkeyB.value = b ?? '';
  el<HTMLTextAreaElement>('captureBlocklist').value = form.captureBlocklist.join('\n');
  box('guideNavigation').checked = form.guideNavigation;
  box('controlSnap').checked = form.controlSnap;
  box('twoStepAnswer').checked = form.twoStepAnswer;
  arrange();
}

/** What the page shows now, as a form. Choosing "system voice" sends an empty address; main does the checking. */
function collect(): SettingsForm {
  const server = box('voiceServer').checked;
  return {
    model: select('model').value as Route,
    codexModel: text('codexModel').value,
    claudeModel: text('claudeModel').value,
    openaiModel: text('openaiModel').value,
    codexFast: box('codexFast').checked,
    detailRoute: select('detailRoute').value as SettingsForm['detailRoute'],
    detailModel: text('detailModel').value,
    voiceServerUrl: server ? text('voiceServerUrl').value : '',
    voiceServerVoice: server ? text('voiceServerVoice').value : '',
    speechServerUrl: text('speechServerUrl').value,
    hotkey: `${hotkeyA.value}+${hotkeyB.value}`,
    captureBlocklist: el<HTMLTextAreaElement>('captureBlocklist').value.split(/\r?\n/),
    guideNavigation: box('guideNavigation').checked,
    controlSnap: box('controlSnap').checked,
    twoStepAnswer: box('twoStepAnswer').checked,
  };
}

const messages = el('messages'), saved = el('saved');
let shown: SettingsForm | null = null;

function showMessages(list: readonly string[]): void {
  messages.replaceChildren(...list.map((m) => Object.assign(document.createElement('li'), { textContent: m })));
  messages.classList.toggle('hide', list.length === 0);
}

async function save(): Promise<void> {
  showMessages([]);
  saved.classList.add('hide');
  if (box('voiceServer').checked && text('voiceServerUrl').value.trim() === '') {
    showMessages(["Type the voice server address, or choose the system voice."]);
    return;
  }
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

for (const id of ['model', 'detailRoute']) select(id).addEventListener('change', arrange);
for (const id of ['voiceSystem', 'voiceServer']) box(id).addEventListener('change', arrange);
el('save').addEventListener('click', () => void save());
el('restart').addEventListener('click', () => window.talkthroughSettings.restart());
el('close').addEventListener('click', () => window.close());

// The API key: sent to main once, never shown again.
const stateEl = el('state'), keyEl = text('key'), keyMessage = el('keymessage');
async function refreshKey(): Promise<void> {
  const status = await window.talkthroughSettings.status();
  stateEl.textContent = !status.available
    ? 'This computer cannot encrypt a key for your account, so none can be saved.'
    : status.saved ? 'A key is saved.' : 'No key is saved.';
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

void window.talkthroughSettings.load().then((form) => {
  if (form) fill(form);
});
void refreshKey();
