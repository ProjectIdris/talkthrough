import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DEFAULT_SETTINGS, settingsFromRaw } from '../src/main/settings.ts';
import { createSettingsService, formFromSettings } from '../src/main/settings-service.ts';

test('update checks are on by default, a setting turns them off, and the file only says so when they are off', () => {
  assert.equal(DEFAULT_SETTINGS.checkForUpdates, true);
  assert.equal(settingsFromRaw({}).checkForUpdates, true);
  assert.equal(settingsFromRaw({ checkForUpdates: false }).checkForUpdates, false);
  assert.equal(settingsFromRaw({ checkForUpdates: 'no' }).checkForUpdates, true, 'a word is not a switch');
  const dir = mkdtempSync(join(tmpdir(), 'tt-updates-'));
  try {
    const file = join(dir, 'settings.json');
    const service = createSettingsService({ path: file });
    const form = service.read();
    assert.equal(form.checkForUpdates, true);
    const off = service.save({ ...form, checkForUpdates: false });
    assert.ok(off.ok);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).checkForUpdates, false);
    assert.equal(formFromSettings(settingsFromRaw(JSON.parse(readFileSync(file, 'utf8')))).checkForUpdates, false);
    const on = service.save({ ...form, checkForUpdates: true });
    assert.ok(on.ok);
    assert.equal('checkForUpdates' in JSON.parse(readFileSync(file, 'utf8')), false, 'on is the default and is not written');
    const refused = service.save({ ...form, checkForUpdates: 'yes' } as unknown as typeof form);
    assert.equal(refused.ok, false);
    writeFileSync(file, '{}');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
