import test from 'node:test';
import assert from 'node:assert/strict';
import { changedKeys, savedMessage } from '../src/shared/settings-form.ts';
import { formFromSettings } from '../src/main/settings-service.ts';
import { DEFAULT_SETTINGS } from '../src/main/settings.ts';

const base = formFromSettings(DEFAULT_SETTINGS);

test('what a save says depends on what changed: the list of windows to skip is in force at once, the rest needs a restart', () => {
  assert.deepEqual(changedKeys(base, { ...base }), []);
  assert.deepEqual(savedMessage([]), { text: 'Nothing was changed.', restart: false });
  const listOnly = changedKeys(base, { ...base, captureBlocklist: ['a bank'] });
  assert.deepEqual(listOnly, ['captureBlocklist']);
  assert.deepEqual(savedMessage(listOnly), { text: 'Saved. The list of windows to skip is in force now.', restart: false });
  const both = changedKeys(base, { ...base, captureBlocklist: [], hotkey: 'right-ctrl+right-alt' });
  assert.match(savedMessage(both).text, /in force now; restart Talkthrough for the other changes/);
  assert.equal(savedMessage(both).restart, true);
  const other = changedKeys(base, { ...base, controlSnap: true });
  assert.deepEqual(savedMessage(other), { text: 'Saved. Restart Talkthrough to use the changes.', restart: true });
});
