// Navigation for guide mode: look at what is under a screen point (probe), and, if the guard allows it and the person
// has not stopped it, open that tab, open that menu or scroll that area (act). Windows only, through the helper
// (ps-helper.ts, nav-script.ts), behind this adapter: elsewhere there is no navigator and the overlay simply points. A
// browser window is never looked into (see ps-prelude.ts). Nothing from the model reaches the script but a point and one
// of three words; what the window says about its controls (names) is read for the guard and kept in this process only,
// never logged.

import { createHelper } from './ps-helper.ts';
import type { Helper } from './ps-helper.ts';
import type { NavDir, NavFacts, NavFactsError, NavIntent } from '../shared/nav-guard.ts';

export type NavProbe = { facts: NavFacts | NavFactsError; /** What the control was, to be sure it is the same one when acting. */ token: string; ms: number };
export type NavAct = { acted: boolean; why?: string; ms: number };

export type Navigator = {
  /** Looks at the control at a screen point (physical pixels) and says what it is. Changes nothing. */
  probe(point: { x: number; y: number }, intent: NavIntent, signal?: AbortSignal): Promise<NavProbe>;
  /** Looks again, requires the same control, and does the one thing asked. */
  act(point: { x: number; y: number }, intent: NavIntent, token: string, signal?: AbortSignal): Promise<NavAct>;
};

export type NavigatorOptions = {
  timeoutMs?: number;
  /** Act in this window and not the one in front: for checks on a window of their own. */
  hwnd?: number;
  /** The helper to ask (shared with the reader); by default the navigator starts its own. */
  helper?: Helper;
};

const KINDS = new Set(['tab', 'open', 'scroll']);
const DIRS = new Set(['down', 'up', 'left', 'right']);
const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.slice(0, max) : '');

/** Reads what the helper answered; anything that is not exactly what it gives is "no facts". */
export function parseFacts(j: Record<string, unknown> | null): { facts: NavFacts | NavFactsError; token: string } {
  const bad = (why: string) => ({ facts: { ok: false as const, why }, token: '' });
  if (!j) return bad('the window would not say');
  if (j.ok !== true) return bad(str(j.why, 80) || 'the window would not say');
  const expand = j.expand === 'collapsed' || j.expand === 'expanded' || j.expand === 'leaf' || j.expand === 'partial' ? j.expand : '';
  const s = j.scroll;
  const scroll = typeof s === 'object' && s !== null && !Array.isArray(s)
    ? (() => { const o = s as Record<string, unknown>; return { v: o.v === true, h: o.h === true, canUp: o.canUp === true, canDown: o.canDown === true, canLeft: o.canLeft === true, canRight: o.canRight === true }; })()
    : null;
  return {
    token: str(j.token, 2000),
    facts: {
      ok: true, ct: str(j.ct, 40).toLowerCase(), enabled: j.enabled === true, offscreen: j.offscreen === true, password: j.password === true,
      name: str(j.name), autoId: str(j.autoId), help: str(j.help), win: str(j.win), proc: str(j.proc, 80), dlg: str(j.dlg),
      invoke: j.invoke === true, expand, selected: typeof j.selected === 'boolean' ? j.selected : null,
      toggle: j.toggle === true, valuePattern: j.valuePattern === true, valueReadOnly: j.valueReadOnly !== false, range: j.range === true, scroll,
    },
  };
}

const whole = (n: number): string | undefined => (Number.isFinite(n) && Math.abs(n) < 100_000 ? String(Math.round(n)) : undefined);

function request(mode: 'probe' | 'act', point: { x: number; y: number }, intent: NavIntent, hwnd: number | undefined, token?: string): Record<string, unknown> | undefined {
  const x = whole(point.x), y = whole(point.y);
  if (x === undefined || y === undefined || !KINDS.has(intent.kind) || (intent.dir !== undefined && !DIRS.has(intent.dir))) return undefined;
  return {
    op: 'nav', mode, x: Number(x), y: Number(y), kind: intent.kind, dir: (intent.dir as NavDir | undefined) ?? '',
    hwnd: hwnd !== undefined && Number.isSafeInteger(hwnd) && hwnd > 0 ? hwnd : 0,
    ...(token !== undefined ? { token } : {}),
  };
}

/** The navigator for this system: only Windows has one. */
export function createNavigator(options: NavigatorOptions = {}): Navigator | undefined {
  const helper = options.helper ?? createHelper();
  if (!helper) return undefined;
  const timeoutMs = options.timeoutMs ?? 6000;
  const opts = (signal?: AbortSignal) => ({ timeoutMs, ...(signal ? { signal } : {}) });
  return {
    async probe(point, intent, signal) {
      const req = request('probe', point, intent, options.hwnd);
      if (!req) return { facts: { ok: false, why: 'not a place on screen' }, token: '', ms: 0 };
      const r = await helper.request(req, opts(signal));
      if (r.why) return { facts: { ok: false, why: r.why }, token: '', ms: r.ms };
      return { ...parseFacts(r.body), ms: r.ms };
    },
    async act(point, intent, token, signal) {
      const req = token ? request('act', point, intent, options.hwnd, token) : undefined;
      if (!req) return { acted: false, why: 'nothing to act on', ms: 0 };
      const r = await helper.request(req, opts(signal));
      if (r.why || !r.body) return { acted: false, why: r.why ?? 'the window would not say', ms: r.ms };
      return r.body.ok === true && r.body.acted === true ? { acted: true, ms: r.ms } : { acted: false, why: str(r.body.why, 80) || 'did not act', ms: r.ms };
    },
  };
}
