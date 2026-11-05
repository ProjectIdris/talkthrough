// Which model writes which part of an answer: step 1 by one route and model, the steps after it by the same or by another. Pure: main.ts builds the
// models from this, the settings checks keep the later-step fields tidy with it, and the first-run window describes it in words.

import type { Route, SplitMode } from '../shared/settings-form.ts';

export type StepModel = { route: Route; name: string };

/** The fields of the settings the plan is made from. */
export type PlanInput = {
  model: Route;
  codexModel: string;
  claudeModel: string;
  openaiModel: string;
  localModel: string;
  laterRoute?: Route | '' | undefined;
  laterModel?: string | undefined;
  splitAnswer?: SplitMode;
};

export const ROUTE_NAMES: Record<Route, string> = { claude: 'Claude Code', codex: 'Codex', openai: 'an API key', local: 'a local model' };

/** The model name each route uses for the quick answers. */
export function modelNameOf(s: Pick<PlanInput, 'codexModel' | 'claudeModel' | 'openaiModel' | 'localModel'>, route: Route): string {
  return route === 'claude' ? s.claudeModel : route === 'openai' ? s.openaiModel : route === 'local' ? s.localModel : s.codexModel;
}

/**
 * Keeps the later-step fields tidy: a later route that is the first's is "the same" (empty), and a later model that is the first's own, on its
 * own route, is no different at all (both empty). Returns the fields to keep.
 */
export function normaliseLater(s: PlanInput): { laterRoute: '' | Route; laterModel: string } {
  const route = s.laterRoute && s.laterRoute !== s.model ? s.laterRoute : '';
  const name = (s.laterModel ?? '').trim();
  const effectiveRoute = route || s.model;
  const effectiveName = name || modelNameOf(s, effectiveRoute);
  if (effectiveRoute === s.model && effectiveName === modelNameOf(s, s.model)) return { laterRoute: '', laterModel: '' };
  return { laterRoute: route, laterModel: name };
}

export type StepPlan = {
  first: StepModel;
  /** The model for the steps after step 1; null when it is the same one. */
  later: StepModel | null;
  /**
   * How the answer is written: 'steps' (one step to a call) when a different model writes the later steps, whatever route; on the Claude route
   * otherwise as the setting says; 'off' on the other routes (one call).
   */
  split: SplitMode;
};

export function stepPlan(s: PlanInput): StepPlan {
  const first: StepModel = { route: s.model, name: modelNameOf(s, s.model) };
  const l = normaliseLater(s);
  const later: StepModel | null = l.laterRoute === '' && l.laterModel === '' ? null : { route: l.laterRoute || s.model, name: l.laterModel || modelNameOf(s, l.laterRoute || s.model) };
  return { first, later, split: later ? 'steps' : s.model === 'claude' ? s.splitAnswer ?? 'steps' : 'off' };
}

/** "claude-sonnet-5-5" -> "Sonnet 5.5"; a name that is not one of those is shown as it is. */
export function prettyModel(name: string): string {
  const m = /^claude-(haiku|sonnet|opus|fable)-(\d+)-(\d+)$/.exec(name);
  return m ? `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}.${m[3]}` : name;
}

/** What the settings hold, in a sentence: "Claude Code: Sonnet 5.5 for every step." or "Claude Code: Haiku 5.5 for the first step, Sonnet 5.5 for the rest." */
export function modelLine(s: PlanInput): string {
  const p = stepPlan(s);
  const one = (m: StepModel): string => `${m.name ? prettyModel(m.name) : 'its own model'}`;
  const who = (m: StepModel): string => `${ROUTE_NAMES[m.route][0]!.toUpperCase()}${ROUTE_NAMES[m.route].slice(1)}`;
  if (!p.later) return `${who(p.first)}: ${one(p.first)} for every step.`;
  if (p.later.route === p.first.route) return `${who(p.first)}: ${one(p.first)} for the first step, ${one(p.later)} for the rest.`;
  return `${who(p.first)} (${one(p.first)}) for the first step, ${ROUTE_NAMES[p.later.route]} (${one(p.later)}) for the rest.`;
}
