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
