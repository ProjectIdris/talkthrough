// The audio devices the system lists, as the hidden page reports them and as the settings window is shown them. Pure.

import type { DeviceList } from '../shared/ipc.ts';

/** What a list is when the system cannot be asked: the default only. */
export const DEFAULT_DEVICES: DeviceList = { microphones: [{ id: '', name: 'System default' }], speakers: [{ id: '', name: 'System default' }] };

/** A device list from the page, read strictly: strings only, bounded, no repeats, the system default (id '') first. */
export function readDeviceList(input: unknown): DeviceList {
  const side = (value: unknown): DeviceList['microphones'] => {
    const out: DeviceList['microphones'] = [{ id: '', name: 'System default' }];
    if (!Array.isArray(value)) return out;
    for (const d of value.slice(0, 64)) {
      const { id, name } = (d ?? {}) as { id?: unknown; name?: unknown };
      if (typeof id === 'string' && id !== '' && id.length <= 400 && typeof name === 'string' && !out.some((o) => o.id === id)) out.push({ id, name: name.slice(0, 200) });
    }
    return out;
  };
  const raw = (input ?? {}) as { microphones?: unknown; speakers?: unknown };
  return { microphones: side(raw.microphones), speakers: side(raw.speakers) };
}
