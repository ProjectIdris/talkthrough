import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSettingsService, formFromSettings } from '../src/main/settings-service.ts';
import { DEFAULT_SETTINGS, loadSettings } from '../src/main/settings.ts';
import { DEFAULT_SKIP_LIST } from '../src/main/skip-list.ts';
import type { SettingsForm } from '../src/shared/settings-form.ts';

function setup(initial?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'tt-settings-'));
  const path = join(dir, 'settings.json');
  if (initial !== undefined) writeFileSync(path, typeof initial === 'string' ? initial : JSON.stringify(initial));
  const warnings: string[] = [];
  const service = createSettingsService({ path, warn: (m) => warnings.push(m) });
  return { dir, path, service, warnings, file: () => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const withForm = (base: SettingsForm, change: Partial<SettingsForm>): SettingsForm => ({ ...base, ...change });

test('with no file the form shows the defaults, including the starting list of windows to skip, and the switches are off', () => {
  const t = setup();
  try {
    const form = t.service.read();
    assert.deepEqual(form, formFromSettings(DEFAULT_SETTINGS));
    assert.equal(form.model, 'codex');
    assert.equal(form.guideNavigation, false);
    assert.equal(form.controlSnap, false);
    assert.equal(form.splitAnswer, 'steps');
    assert.equal(form.hotkey, 'right-ctrl+right-shift');
    assert.deepEqual(form.captureBlocklist, [...DEFAULT_SKIP_LIST]);
    assert.equal(form.voiceServerUrl, '', 'the system voice');
  } finally {
    t.done();
  }
});

test('a save is read back by the settings file loader exactly as saved, and the file says only what was chosen', () => {
  const t = setup();
  try {
    const form = withForm(t.service.read(), {
      model: 'claude',
      claudeModel: 'claude-sonnet-5-5',
      detailRoute: 'codex',
      voiceServerUrl: 'http://127.0.0.1:8000/speak',
      voiceServerVoice: 'warm',
      speechServerUrl: 'http://127.0.0.1:8001',
      hotkey: 'right-ctrl+right-alt',
      captureBlocklist: ['my bank', 'Vault'],
      guideNavigation: true,
      controlSnap: true,
      splitAnswer: 'two',
    });
    const result = t.service.save(form);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.changed, true);
    const loaded = loadSettings(t.path);
    assert.deepEqual(formFromSettings(loaded), form);
    assert.deepEqual(Object.keys(t.file()).sort(), ['captureBlocklist', 'claudeModel', 'controlSnap', 'detailRoute', 'guideNavigation', 'hotkey', 'model', 'speechServerUrl', 'splitAnswer', 'voiceServerUrl', 'voiceServerVoice']);
    assert.deepEqual(readdirSync(t.dir), ['settings.json'], 'no half-written file is left');
  } finally {
    t.done();
  }
});

test('what is the default is not written; going back to the system voice, no detail pass and the starting list removes the keys again', () => {
  const t = setup();
  try {
    const base = t.service.read();
    t.service.save(withForm(base, { voiceServerUrl: 'https://voice.example/speak', detailRoute: 'claude', captureBlocklist: ['x1'] }));
    assert.ok('voiceServerUrl' in t.file() && 'captureBlocklist' in t.file());
    const back = t.service.save(base);
    assert.equal(back.ok, true);
    assert.deepEqual(t.file(), {});
    // an emptied list is a choice, and is kept as one
    t.service.save(withForm(base, { captureBlocklist: [] }));
    assert.deepEqual(t.file(), { captureBlocklist: [] });
    assert.deepEqual(t.service.read().captureBlocklist, []);
  } finally {
    t.done();
  }
});

test('the rest of the file is left as it was: other keys, and keys the window does not edit', () => {
  const t = setup({ effort: 'high', claudeCommand: 'C:/tools/claude.exe', backendUrl: 'https://backend.example', somethingNew: { a: 1 }, guideNavigation: true });
  try {
    const result = t.service.save(withForm(t.service.read(), { guideNavigation: false, model: 'openai' }));
    assert.equal(result.ok, true);
    assert.deepEqual(t.file(), { effort: 'high', claudeCommand: 'C:/tools/claude.exe', backendUrl: 'https://backend.example', somethingNew: { a: 1 }, model: 'openai' });
  } finally {
    t.done();
  }
});

test('a BOM settings file keeps nondefault and unknown values through a settings save', () => {
  const t = setup('\uFEFF' + JSON.stringify({ model: 'claude', effort: 'high', futureOption: { enabled: true }, guideNavigation: true }));
  try {
    const before = t.service.read();
    assert.equal(before.model, 'claude');
    assert.equal(before.guideNavigation, true);
    const saved = t.service.save(withForm(before, { controlSnap: true }));
    assert.equal(saved.ok, true);
    assert.deepEqual(t.file(), { model: 'claude', effort: 'high', futureOption: { enabled: true }, controlSnap: true, guideNavigation: true });
    assert.equal(t.service.read().model, 'claude');
  } finally {
    t.done();
  }
});

test('a value the checks refuse is not saved: the file is untouched and the reason is in plain words', () => {
  const t = setup({ model: 'claude' });
  try {
    const before = readFileSync(t.path, 'utf8');
    const base = t.service.read();
    const cases: Array<[Partial<SettingsForm>, RegExp]> = [
      [{ voiceServerUrl: 'http://example.com/speak' }, /voice server address must start with https/],
      [{ hotkey: 'right-ctrl+right-ctrl' }, /one key, or up to four different keys/],
      [{ hotkey: 'right-ctrl+escape' }, /one key, or up to four different keys/],
      [{ localBaseUrl: 'http://192.168.1.9:11434/v1' }, /on this computer/],
      [{ captureBlocklist: ['ok', 'x'] }, /"x" is too short/],
    ];
    for (const [change, why] of cases) {
      const result = t.service.save(withForm(base, change));
      assert.equal(result.ok, false, JSON.stringify(change));
      assert.ok(!result.ok && result.messages.some((m) => why.test(m)), `${JSON.stringify(change)}: ${!result.ok && result.messages.join(' | ')}`);
      assert.equal(readFileSync(t.path, 'utf8'), before, 'untouched');
    }
    const tooLong = t.service.save(withForm(base, { voiceServerVoice: 'v'.repeat(81) }));
    assert.equal(tooLong.ok, false, 'a value the loader would quietly drop is refused, not saved as something else');
    assert.equal(readFileSync(t.path, 'utf8'), before);
  } finally {
    t.done();
  }
});

test('a form that is not a form, or lacks a field, or has one of the wrong kind, is refused', () => {
  const t = setup();
  try {
    const base = t.service.read();
    for (const bad of [null, 'text', [], { ...base, model: undefined }, { ...base, codexFast: 'yes' }, { ...base, captureBlocklist: 'one' }, { ...base, captureBlocklist: [1] }]) {
      const result = t.service.save(bad);
      assert.equal(result.ok, false, JSON.stringify(bad));
    }
    assert.equal(existsSync(t.path), false, 'nothing was written');
  } finally {
    t.done();
  }
});

test('a complaint the file already had is not this save\'s to fix; a new one is', () => {
  const t = setup({ backendUrl: 'http://example.com' });
  try {
    const base = t.service.read();
    const fine = t.service.save(withForm(base, { codexFast: true }));
    assert.equal(fine.ok, true, 'the old bad backend address does not stop an unrelated save');
    assert.equal(t.file().backendUrl, 'http://example.com', 'and it is left as it was');
    const worse = t.service.save(withForm(base, { codexFast: true, voiceServerUrl: 'http://example.com' }));
    assert.equal(worse.ok, false);
  } finally {
    t.done();
  }
});

test('a settings file that cannot be read is kept aside before it is replaced', () => {
  const t = setup('{ not json');
  try {
    const result = t.service.save(withForm(t.service.read(), { codexFast: true }));
    assert.equal(result.ok, true);
    assert.equal(readFileSync(`${t.path}.unreadable`, 'utf8'), '{ not json');
    assert.deepEqual(t.file(), { codexFast: true });
  } finally {
    t.done();
  }
});

test('saving what is already saved says nothing changed', () => {
  const t = setup({ model: 'claude' });
  try {
    const again = t.service.save(t.service.read());
    assert.equal(again.ok && again.changed, false);
  } finally {
    t.done();
  }
});

test('a save that cannot be finished (the rename fails) says so and leaves no half-written file behind', () => {
  const t = setup();
  try {
    mkdirSync(t.path); // the settings file's place is taken by a folder, so the final rename cannot succeed
    const result = t.service.save(withForm(t.service.read(), { codexFast: true }));
    assert.equal(result.ok, false);
    assert.ok(!result.ok && /could not be written/.test(result.messages.join(' ')));
    assert.deepEqual(readdirSync(t.dir), ['settings.json'], 'no .saving file left');
  } finally {
    t.done();
  }
});

test('an older file with twoStepAnswer: true shows as "two calls", and saving a choice replaces the old key (turning it off really turns it off)', () => {
  const t = setup({ twoStepAnswer: true, model: 'claude' });
  try {
    const form = t.service.read();
    assert.equal(form.splitAnswer, 'two');
    const off = t.service.save({ ...form, splitAnswer: 'off' });
    assert.equal(off.ok, true);
    assert.equal('twoStepAnswer' in t.file(), false, 'the old key is gone');
    assert.equal(loadSettings(t.path).splitAnswer, 'off', 'and the loader does not read it back as on');
    assert.equal(t.file().splitAnswer, 'off', 'off is written, since it is no longer the default');
    const steps = t.service.save({ ...form, splitAnswer: 'steps' });
    assert.equal(steps.ok, true);
    assert.equal(loadSettings(t.path).splitAnswer, 'steps');
    assert.equal('splitAnswer' in t.file(), false, 'the default is not written');
  } finally {
    t.done();
  }
});

test('a saved "off" stays off: it is written to the file, and a fresh start with no other setting reads it back as off (not as the default)', () => {
  const t = setup();
  try {
    const form = t.service.read();
    assert.equal(form.splitAnswer, 'steps');
    assert.equal(t.service.save({ ...form, splitAnswer: 'off' }).ok, true);
    assert.equal(t.file().splitAnswer, 'off');
    assert.equal(loadSettings(t.path).splitAnswer, 'off');
    assert.equal(t.service.read().splitAnswer, 'off', 'the window shows it as off');
  } finally {
    t.done();
  }
});

test('captions: both is the default and is not written; text and voice are written and read back; a word that is not a choice is refused in the form and warned about in the file', () => {
  const t = setup();
  try {
    const form = t.service.read();
    assert.equal(form.captions, 'both');
    const text = t.service.save({ ...form, captions: 'text' });
    assert.equal(text.ok, true);
    assert.equal(t.file().captions, 'text');
    assert.equal(loadSettings(t.path).captions, 'text');
    const voice = t.service.save({ ...form, captions: 'voice' });
    assert.equal(voice.ok, true);
    assert.equal(loadSettings(t.path).captions, 'voice');
    const both = t.service.save({ ...form, captions: 'both' });
    assert.equal(both.ok, true);
    assert.equal('captions' in t.file(), false, 'the default is not written');
    const bad = t.service.save({ ...form, captions: 'off' as unknown as SettingsForm['captions'] });
    assert.equal(bad.ok, false);
    const warnings: string[] = [];
    writeFileSync(t.path, JSON.stringify({ captions: 'loud' }));
    assert.equal(loadSettings(t.path, (m) => warnings.push(m)).captions, 'both', 'a bad word in the file falls back to both');
    assert.equal(warnings.length, 1);
  } finally {
    t.done();
  }
});

test('the later steps are their own choice: a different model or route is kept, the same one is not, and the older claudeLaterModel is read as one', () => {
  const t = setup({ model: 'claude', claudeModel: 'claude-haiku-5-5', claudeLaterModel: 'claude-sonnet-5-5' });
  try {
    const form = t.service.read();
    assert.deepEqual([form.laterRoute, form.laterModel], ['', 'claude-sonnet-5-5'], 'the older field shows as the new one');
    const sameAsFirst = t.service.save(withForm(form, { laterRoute: 'claude', laterModel: 'claude-haiku-5-5' }));
    assert.equal(sameAsFirst.ok && sameAsFirst.form.laterModel, '', 'a later model that is the first one is no different');
    assert.equal(t.file().claudeLaterModel, undefined, 'the older field is gone once the form is saved');
    const other = t.service.save(withForm(form, { laterRoute: 'codex', laterModel: '' }));
    assert.equal(other.ok, true);
    assert.deepEqual([t.file().laterRoute, t.file().laterModel], ['codex', undefined], 'a route alone: that route\'s own model');
    const loaded = loadSettings(t.path);
    assert.deepEqual([loaded.laterRoute, loaded.laterModel], ['codex', undefined]);
  } finally {
    t.done();
  }
});

test('a local model is a route of its own: a name and an address on this computer, kept in the file and read back', () => {
  const t = setup();
  try {
    const base = t.service.read();
    assert.deepEqual([base.localModel, base.localBaseUrl], ['', '']);
    const saved = t.service.save(withForm(base, { model: 'local', localModel: 'gemma3:12b', localBaseUrl: 'http://127.0.0.1:11434/v1' }));
    assert.equal(saved.ok, true);
    const loaded = loadSettings(t.path);
    assert.deepEqual([loaded.model, loaded.localModel, loaded.localBaseUrl], ['local', 'gemma3:12b', 'http://127.0.0.1:11434/v1']);
    assert.equal(t.service.save(withForm(base, { localBaseUrl: 'https://example.com/v1' })).ok, false, 'an address off this computer is refused');
  } finally {
    t.done();
  }
});

test('one key is a hotkey, and the microphone and speaker are kept with their names', () => {
  const t = setup();
  try {
    const base = t.service.read();
    const saved = t.service.save(withForm(base, { hotkey: 'f13', microphone: 'abc123', microphoneName: 'Headset (USB)', speaker: 'def456', speakerName: 'Speakers' }));
    assert.equal(saved.ok, true);
    const loaded = loadSettings(t.path);
    assert.deepEqual([loaded.hotkey, loaded.microphone, loaded.microphoneName, loaded.speaker, loaded.speakerName], ['f13', 'abc123', 'Headset (USB)', 'def456', 'Speakers']);
    const back = t.service.save(withForm(saved.ok ? saved.form : base, { microphone: '', microphoneName: '' }));
    assert.equal(back.ok, true);
    assert.equal(t.file().microphone, undefined, 'the default is not written');
  } finally {
    t.done();
  }
});
