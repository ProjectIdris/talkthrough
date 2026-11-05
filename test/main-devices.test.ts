import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_DEVICES, readDeviceList } from '../src/main/devices.ts';

test('a device list from the page starts with the system default and keeps only well-formed, distinct devices', () => {
  const list = readDeviceList({
    microphones: [{ id: 'a1', name: 'Headset' }, { id: 'a1', name: 'Headset again' }, { id: '', name: 'sneaky default' }, { id: 5, name: 'bad' }, null, { id: 'b2', name: 7 }, { id: 'c3', name: 'Desk mic' }],
    speakers: 'not a list',
  });
  assert.deepEqual(list.microphones, [{ id: '', name: 'System default' }, { id: 'a1', name: 'Headset' }, { id: 'c3', name: 'Desk mic' }]);
  assert.deepEqual(list.speakers, DEFAULT_DEVICES.speakers);
  assert.deepEqual(readDeviceList(undefined), DEFAULT_DEVICES);
  assert.equal(readDeviceList({ microphones: Array.from({ length: 200 }, (_, i) => ({ id: 'd' + i, name: 'n' })) }).microphones.length, 65, 'bounded');
});
