import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, loadSettings, safeBaseUrl } from '../src/main/settings.ts';

function settingsFrom(content: string | null) {
  const dir = mkdtempSync(join(tmpdir(), 'tt-settings-'));
  const file = join(dir, 'settings.json');
  if (content !== null) writeFileSync(file, content);
  const warnings: string[] = [];
  const settings = loadSettings(file, (m) => warnings.push(m));
  rmSync(dir, { recursive: true, force: true });
  return { settings, warnings };
}

test('a missing file gives the defaults; the API route and its options are read', () => {
  assert.deepEqual(settingsFrom(null).settings, DEFAULT_SETTINGS);
  const { settings } = settingsFrom(JSON.stringify({ model: 'openai', openaiModel: 'gpt-x', openaiServiceTier: 'fast', openaiBaseUrl: 'https://example.test/v1', speechLimitMs: 1000 }));
  assert.equal(settings.model, 'openai');
  assert.equal(settings.openaiModel, 'gpt-x');
  assert.equal(settings.openaiServiceTier, 'fast');
  assert.equal(settings.openaiBaseUrl, 'https://example.test/v1');
  assert.equal(settings.speechLimitMs, 1000);
});

test('one leading UTF-8 BOM is ignored while settings and unknown keys are retained', () => {
  const { settings, warnings } = settingsFrom('\uFEFF' + JSON.stringify({ model: 'openai', effort: 'high', futureOption: { enabled: true } }));
  assert.equal(settings.model, 'openai');
  assert.equal(settings.effort, 'high');
  assert.deepEqual(warnings, []);
  const doubled = settingsFrom('\uFEFF\uFEFF' + JSON.stringify({ model: 'openai' }));
  assert.equal(doubled.settings.model, DEFAULT_SETTINGS.model, 'only one leading BOM is stripped');
  assert.equal(doubled.warnings.length, 1, 'the remaining BOM keeps the malformed-JSON warning path');
});

test('a key is only ever pointed at https or a loopback address', () => {
  assert.equal(safeBaseUrl('https://api.example.com/v1'), true);
  assert.equal(safeBaseUrl('http://127.0.0.1:8080/v1'), true);
  assert.equal(safeBaseUrl('http://localhost:1/v1'), true);
  assert.equal(safeBaseUrl('http://api.example.com/v1'), false);
  assert.equal(safeBaseUrl('ftp://127.0.0.1'), false);
  assert.equal(safeBaseUrl('not a url'), false);
  const { settings, warnings } = settingsFrom(JSON.stringify({ model: 'openai', openaiBaseUrl: 'http://api.example.com/v1' }));
  assert.equal(settings.openaiBaseUrl, undefined);
  assert.equal(warnings.length, 1);
});

test('the backend has no default; its address must be https or loopback, and its timeout stays in range', () => {
  assert.equal(settingsFrom(null).settings.backendUrl, undefined);
  const ok = settingsFrom(JSON.stringify({ backendUrl: 'http://127.0.0.1:4900/ask', backendTimeoutMs: 60000 })).settings;
  assert.equal(ok.backendUrl, 'http://127.0.0.1:4900/ask');
  assert.equal(ok.backendTimeoutMs, 60000);
  const bad = settingsFrom(JSON.stringify({ backendUrl: 'http://backend.example.com/ask', backendTimeoutMs: 10 }));
  assert.equal(bad.settings.backendUrl, undefined);
  assert.equal(bad.settings.backendTimeoutMs, undefined);
  assert.equal(bad.warnings.length, 1);
});

test('the detail pass is off unless a route is named; a model and an effort may be named too', () => {
  assert.equal(settingsFrom(null).settings.detailRoute, undefined);
  const named = settingsFrom(JSON.stringify({ detailRoute: 'claude', detailModel: 'claude-x', detailEffort: 'high' })).settings;
  assert.equal(named.detailRoute, 'claude');
  assert.equal(named.detailModel, 'claude-x');
  assert.equal(named.detailEffort, 'high');
  const bad = settingsFrom(JSON.stringify({ detailRoute: 'somewhere' }));
  assert.equal(bad.settings.detailRoute, undefined);
  assert.ok(bad.warnings.some((w) => w.includes('detailRoute')));
});

test('snapping to the real controls of a window is off until the settings turn it on', () => {
  assert.equal(settingsFrom(null).settings.controlSnap, false);
  assert.equal(settingsFrom(JSON.stringify({ controlSnap: true })).settings.controlSnap, true);
  assert.equal(settingsFrom(JSON.stringify({ controlSnap: 'yes' })).settings.controlSnap, false, 'anything but a boolean is ignored');
  assert.equal(settingsFrom(null).settings.splitAnswer, 'steps', 'one step to a call is the default (Alex, 5 Nov)');
  assert.equal(settingsFrom(JSON.stringify({ splitAnswer: 'off' })).settings.splitAnswer, 'off', 'an explicit off stays off');
  assert.equal(settingsFrom(JSON.stringify({ splitAnswer: 'steps' })).settings.splitAnswer, 'steps');
  assert.equal(settingsFrom(JSON.stringify({ splitAnswer: 'two' })).settings.splitAnswer, 'two');
  assert.equal(settingsFrom(JSON.stringify({ twoStepAnswer: true })).settings.splitAnswer, 'two', 'the older switch still means two calls');
  assert.equal(settingsFrom(JSON.stringify({ twoStepAnswer: true, splitAnswer: 'off' })).settings.splitAnswer, 'off', 'the new setting wins');
  assert.equal(settingsFrom(JSON.stringify({ twoStepAnswer: false })).settings.splitAnswer, 'off', 'an older explicit off stays off');
  assert.equal(settingsFrom(JSON.stringify({ splitAnswer: 'lots' })).settings.splitAnswer, 'steps', 'anything else is ignored, and the default stands');
});

test('the app acting for the person (guide navigation) is off until the settings turn it on', () => {
  assert.equal(settingsFrom(null).settings.guideNavigation, false);
  assert.equal(settingsFrom(JSON.stringify({ guideNavigation: true })).settings.guideNavigation, true);
  assert.equal(settingsFrom(JSON.stringify({ guideNavigation: 1 })).settings.guideNavigation, false, 'anything but a boolean is ignored');
});

test('the voice is the system voice unless a server is named; its address must be https or loopback, and its limits stay in range', () => {
  const none = settingsFrom(null).settings;
  assert.equal(none.voiceServerUrl, undefined);
  assert.deepEqual([none.voiceFirstAudioMs, none.voiceCooldownMs, none.voiceTimeoutMs], [10_000, 20_000, 30_000]);
  const ok = settingsFrom(JSON.stringify({ voiceServerUrl: 'http://127.0.0.1:4850/speak', voiceServerVoice: 'warm', voiceFirstAudioMs: 1500, voiceCooldownMs: 60000, voiceTimeoutMs: 20000 })).settings;
  assert.deepEqual([ok.voiceServerUrl, ok.voiceServerVoice, ok.voiceFirstAudioMs, ok.voiceCooldownMs, ok.voiceTimeoutMs], ['http://127.0.0.1:4850/speak', 'warm', 1500, 60000, 20000]);
  const remote = settingsFrom(JSON.stringify({ voiceServerUrl: 'http://voice.example.com/speak' }));
  assert.equal(remote.settings.voiceServerUrl, undefined, 'the words of an answer are not sent in the clear to another machine');
  assert.equal(remote.warnings.length, 1);
  assert.equal(settingsFrom(JSON.stringify({ voiceServerUrl: 'https://voice.example.com/speak' })).settings.voiceServerUrl, 'https://voice.example.com/speak');
  // A voice server is given ten seconds for its first sound unless told otherwise (Alex, 5 Nov); the limit is 30 s and the player waits as long.
  assert.equal(settingsFrom(JSON.stringify({ voiceFirstAudioMs: 12_000 })).settings.voiceFirstAudioMs, 12_000);
  const wild = settingsFrom(JSON.stringify({ voiceFirstAudioMs: 90_000, voiceCooldownMs: 5, voiceTimeoutMs: 1, voiceServerVoice: 'x'.repeat(200) })).settings;
  assert.deepEqual([wild.voiceFirstAudioMs, wild.voiceCooldownMs, wild.voiceTimeoutMs, wild.voiceServerVoice], [10_000, 20_000, 30_000, undefined]);
});

test('a second Claude model for the steps after step 1 is off unless named, and naming the same model as the first is the same as not naming one', () => {
  assert.equal(settingsFrom(JSON.stringify({ claudeModel: 'claude-haiku-5-5' })).settings.claudeLaterModel, undefined);
  assert.equal(settingsFrom(JSON.stringify({ claudeLaterModel: 'claude-sonnet-5-5' })).settings.claudeLaterModel, 'claude-sonnet-5-5');
  assert.equal(settingsFrom(JSON.stringify({ claudeModel: 'claude-sonnet-5-5', claudeLaterModel: 'claude-sonnet-5-5' })).settings.claudeLaterModel, undefined);
});

test('speech audio is sent only to https or loopback addresses configured in settings', () => {
  for (const url of ['https://speech.example.test', 'http://localhost:8001', 'http://127.0.0.1:8001', 'http://[::1]:8001']) {
    const { settings, warnings } = settingsFrom(JSON.stringify({ speechServerUrl: url }));
    assert.equal(settings.speechServerUrl, url);
    assert.deepEqual(warnings, []);
  }
  for (const url of ['http://speech.example.test', 'http://192.168.1.4:8001', 'ftp://localhost', 'not a url']) {
    const { settings, warnings } = settingsFrom(JSON.stringify({ speechServerUrl: url }));
    assert.equal(settings.speechServerUrl, undefined, url);
    assert.ok(warnings.some((warning) => warning.includes('speechServerUrl')), url);
  }
});

test('recognises canonical and mapped IPv4 loopback without admitting lookalike hosts', () => {
  for (const url of ['http://127.0.0.2:8123', 'http://127.255.255.254', 'http://127.1', 'http://0x7f000002', 'http://[::ffff:127.0.0.2]']) {
    assert.equal(safeBaseUrl(url), true, url);
    const { settings } = settingsFrom(JSON.stringify({ speechServerUrl: url }));
    assert.equal(settings.speechServerUrl, url);
  }
  for (const url of ['http://126.255.255.255','http://128.0.0.1','http://127.0.0.1.attacker.test','http://localhost.attacker.test','http://[::ffff:126.255.255.255]','http://[::ffff:128.0.0.1]']) {
    assert.equal(safeBaseUrl(url), false, url);
  }
});
