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
