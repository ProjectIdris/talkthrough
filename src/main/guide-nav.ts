// The app's hands in guide mode, assembled from its parts: where on screen a point of the model's screenshot is (main knows
// the displays), what the navigator (nav.ts) finds there, and what the guard (shared/nav-guard.ts) says about it. The guide
// (guide.ts) only sees the answer: do it after saying so, or not (and why, for the log). Nothing here reads or keeps names;
// the reasons are about kinds ("a button, not a tab").

import { announcement, decideNav } from '../shared/nav-guard.ts';
import type { NavIntent } from '../shared/nav-guard.ts';
import type { GuideNavigation, GoRequest, NavPlan } from './guide.ts';
import type { NavConsent } from './nav-consent.ts';
import type { Navigator } from './nav.ts';

export type GuideNavigationDeps = {
  navigator: Navigator;
  /** The person's say-so: the first move waits for a yes, and a pause stops them all. Required: without it the app would act unasked. */
  consent: NavConsent;
  /** A point on the 0..1000 scale of a display, as a screen pixel; null when that display is not known. */
  toScreen(displayId: number, point: { x: number; y: number }): { x: number; y: number } | null;
  /** Where the pointer is, in screen pixels. */
  pointer?(): { x: number; y: number } | null;
  log(line: string): void;
};

type Handle = { point: { x: number; y: number }; intent: NavIntent; token: string };

export function createGuideNavigation(d: GuideNavigationDeps): GuideNavigation {
  return {
    async plan(go: GoRequest, displayId: number): Promise<NavPlan> {
      const point = d.toScreen(displayId, go);
      if (!point) return { verdict: 'show', why: 'that display is not known' };
      const intent: NavIntent = { kind: go.kind, ...(go.dir ? { dir: go.dir } : {}) };
      const probe = await d.navigator.probe(point, intent);
      const decision = decideNav(probe.facts, intent);
      d.log(`guide: navigation ${go.kind}: ${decision.verdict}${decision.verdict === 'do' ? '' : ` (${decision.why})`}, looked in ${probe.ms} ms`);
      if (decision.verdict !== 'do') return { verdict: decision.verdict, why: decision.why };
      const handle: Handle = { point, intent, token: probe.token };
      return { verdict: 'do', announce: announcement(go.kind, go.dir), handle };
    },
    async act(plan: NavPlan): Promise<boolean> {
      if (plan.verdict !== 'do') return false;
      const h = plan.handle as Handle;
      const r = await d.navigator.act(h.point, h.intent, h.token);
      d.log(`guide: navigation ${h.intent.kind}: ${r.acted ? 'done' : `did not act (${r.why ?? 'unknown'})`}, took ${r.ms} ms`);
      return r.acted;
    },
    consent: d.consent,
    ...(d.pointer ? { pointer: d.pointer } : {}),
  };
}
