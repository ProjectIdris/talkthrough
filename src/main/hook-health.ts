import { monitorEventLoopDelay } from 'node:perf_hooks';

// The key hook's health, and the care that keeps it alive.
//
// Windows removes a global hook without a word when it stops answering in time, and the hook then simply goes quiet: the hotkey and the
// circling do nothing until the app is restarted. So the hook's events are counted (how many, never which key and never where the
// pointer was), a line says what the hook delivered during each answer, and the hook is started again (its listeners stay) when an
// answer ends and whenever the system says the person is using the keyboard or mouse while the hook has heard nothing.

/** What an event is, by libuiohook's number for it; null for any other. */
export function kindOfEvent(type: number): 'key' | 'mouse' | 'move' | null {
  if (type === 4 || type === 5) return 'key';
  if (type === 6 || type === 7 || type === 8 || type === 11) return 'mouse';
  if (type === 9) return 'move';
  return null;
}

type Counts = { keys: number; mouse: number; moves: number };

/** The longest wait the main thread's own timer had since the last lap, in ms: a stall of the main thread shows here. */
export function createStallMeter(): { lap(): { lapMs: number; maxMs: number }; stop(): void } {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  let longest = 0;
  return {
    lap() {
      const lapMs = Math.round(histogram.max / 1e6);
      histogram.reset();
      longest = Math.max(longest, lapMs);
      return { lapMs, maxMs: longest };
    },
    stop: () => histogram.disable(),
  };
}

export type HookCareOptions = {
  now(): number;
  /** Stops the hook and starts it again with its listeners kept; throws when it could not start. */
  restart(): void;
  /** True while no key of the chord is down: the only moment the hook may be restarted. */
  quiet(): boolean;
  /** Seconds since the person last used the keyboard or mouse anywhere in the system. */
  idleSeconds(): number;
  /** The main thread's longest stall (ms) since the last call, and the longest since the start. */
  stall?(): { lapMs: number; maxMs: number };
  log(line: string): void;
  /** How far the system's last input may be ahead of the hook's last event before the hook is taken as silent (ms). */
  slackMs?: number;
  /** The least time between two restarts the watchdog starts (ms); doubles while a restart brings no event, up to maxGapMs. */
  minGapMs?: number;
  maxGapMs?: number;
  /** How long a chord key may stay down with no event from the hook at all before it counts as released (ms): auto-repeat and the pointer keep a held key's hook busy, so only a dead hook is this quiet. */
  staleMs?: number;
};

export type HookCare = {
  /** One event came from the hook (only its kind). */
  note(kind: 'key' | 'mouse' | 'move'): void;
  /** An answer ended: say what the hook delivered during it, then restart the hook. */
  answerEnded(): void;
  /** The watchdog: restarts the hook when the system's input has gone unheard, and retries a restart that had to wait. */
  check(): void;
  /** Restarts the hook now (or as soon as no key of the chord is down). True when it did. */
  rearm(reason: string): boolean;
  totals(): Counts;
};

export function createHookCare(o: HookCareOptions): HookCare {
  const slackMs = o.slackMs ?? 5000;
  const minGapMs = o.minGapMs ?? 30_000;
  const maxGapMs = o.maxGapMs ?? 600_000;
  const staleMs = o.staleMs ?? 30_000;
  const total: Counts = { keys: 0, mouse: 0, moves: 0 };
  let lap: Counts = { keys: 0, mouse: 0, moves: 0 };
  let lastEventAt = o.now();
  let waiting: string | null = null;
  let gapMs = minGapMs;
  let lastWatchdogAt = -Infinity;
  let heardSince = true;
  let failGapMs = minGapMs;
  let retryAt = 0;

  const note: HookCare['note'] = (kind) => {
    const field = kind === 'key' ? 'keys' : kind === 'mouse' ? 'mouse' : 'moves';
    total[field]++;
    lap[field]++;
    lastEventAt = o.now();
    if (!heardSince) {
      heardSince = true;
      gapMs = minGapMs;
    }
  };

  const say = (c: Counts): string => `keys ${c.keys}, mouse ${c.mouse}, moves ${c.moves}`;

  const rearm: HookCare['rearm'] = (reason) => {
    const began = o.now();
    // A key of the chord down with the hook silent for this long is a key whose release was never heard (the hook died in between): the restart clears it, rather than wait for it for ever.
    const stale = !o.quiet() && began - lastEventAt > staleMs;
    if (!stale && !o.quiet()) {
      waiting = reason;
      return false;
    }
    try {
      o.restart();
    } catch (error) {
      waiting = reason;
      retryAt = began + failGapMs;
      failGapMs = Math.min(failGapMs * 2, maxGapMs);
      o.log(`key hook: restart failed (${reason}): ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    waiting = null;
    failGapMs = minGapMs;
    retryAt = 0;
    lastEventAt = o.now();
    o.log(`key hook: restarted (${reason}${stale ? '; a chord key down with no event for a long while was counted as released' : ''}) in ${o.now() - began} ms`);
    return true;
  };

  return {
    note,
    totals: () => ({ ...total }),
    rearm,
    answerEnded() {
      const stall = o.stall?.();
      const mine = lap;
      lap = { keys: 0, mouse: 0, moves: 0 };
      o.log(`key hook: during this answer ${say(mine)}; since start ${say(total)}${stall ? `; longest main-thread stall ${stall.lapMs} ms this answer, ${stall.maxMs} ms since start` : ''}`);
      rearm('an answer ended');
    },
    check() {
      if (waiting) {
        if (o.now() >= retryAt) rearm(waiting);
        return;
      }
      const now = o.now();
      const lastInputAt = now - o.idleSeconds() * 1000;
      if (lastInputAt - lastEventAt <= slackMs) return;
      if (now - lastWatchdogAt < gapMs) return;
      lastWatchdogAt = now;
      gapMs = Math.min(gapMs * 2, maxGapMs);
      heardSince = false;
      rearm('the system has had input the hook did not hear');
    },
  };
}
