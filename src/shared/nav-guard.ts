// The guard for navigation in guide mode: given what a window says about the control at a point, may the app open,
// switch or scroll it for the person? Pure: facts in, a decision out, so every rule is tried without a window.
//
// The rule is a short allow-list with proof, and everything else is left to the person (the overlay points, they click):
//   - a TAB (control type tab item, not selected yet) may be selected;
//   - a MENU ITEM that opens a submenu (collapsed, expandable) may be opened; a menu item that runs a command may not;
//   - a SCROLL area may be scrolled a page at a time, never a control that holds a value.
// Links, and every browser window (Chromium, Electron, Firefox), are left out for now: reading a browser's accessibility
// tree turns accessibility on for the whole browser, which costs it CPU until it is restarted, and following a link
// is a judgement call that waits for the owner. Buttons, check boxes, radio buttons, toggles, anything editable, a password, a field, a list that picks an option,
// a dialog that asks for a decision, and the windows of password managers, banks and payment pages are never acted on.
// Words only ever take permission away (see VETO): they are a second net, not the reason a Save button is safe (it is
// not on the list at all).

export type NavKind = 'tab' | 'open' | 'scroll';
export type NavDir = 'down' | 'up' | 'left' | 'right';
export type NavIntent = { kind: NavKind; dir?: NavDir };

/** What the window says about the control under a point (see main/nav-script.ts: read-only, nothing from the model reaches it). */
export type NavFacts = {
  ok: true;
  /** Control type, lower case: button, tabitem, menuitem, hyperlink, edit ... */
  ct: string;
  enabled: boolean;
  offscreen: boolean;
  password: boolean;
  /** The window's process runs elevated, or its level could not be read. The helper never answers for such a window; this is a second net, and a missing answer counts as elevated. */
  elevated: boolean;
  name: string;
  autoId: string;
  help: string;
  /** The window that holds it: its title and process, and the nearest dialog-like ancestor's title. */
  win: string;
  proc: string;
  dlg: string;
  invoke: boolean;
  /** The ExpandCollapse state: collapsed, expanded, leaf, partial, or empty when the control has no such pattern. */
  expand: '' | 'collapsed' | 'expanded' | 'leaf' | 'partial';
  /** null: the control has no selection pattern. */
  selected: boolean | null;
  toggle: boolean;
  valuePattern: boolean;
  valueReadOnly: boolean;
  range: boolean;
  /** The nearest scrollable ancestor (or the control itself), and which ways it can go. */
  scroll: { v: boolean; h: boolean; canUp: boolean; canDown: boolean; canLeft: boolean; canRight: boolean } | null;
};
export type NavFactsError = { ok: false; why: string };

export type NavDecision =
  | { verdict: 'do'; verb: 'select' | 'expand' | 'scroll'; /** What it is, for the words said before ("tab", "menu", "page"). */ what: string }
  | { verdict: 'show' | 'refuse'; why: string };

/** Words (whole words, in a name, id or help text) that turn "do it" into "show it". Kept short; the structure is what makes things safe. */
export const VETO: readonly string[] = [
  'save', 'apply', 'delete', 'remove', 'erase', 'buy', 'purchase', 'pay', 'payment', 'checkout', 'order', 'submit', 'send', 'confirm', 'ok', 'yes',
  'install', 'uninstall', 'allow', 'grant', 'authorize', 'authorise', 'sign out', 'signout', 'log out', 'logout', 'unsubscribe', 'reset', 'format',
  'publish', 'post', 'share', 'transfer', 'cancel subscription', 'subscribe', 'accept', 'agree', 'enable', 'disable', 'activate', 'deactivate', 'upgrade', 'download',
  // a few other languages: the most common words for the same
  'guardar', 'eliminar', 'borrar', 'comprar', 'pagar', 'enviar', 'aceptar', 'supprimer', 'enregistrer', 'acheter', 'payer', 'envoyer', 'speichern', 'löschen', 'kaufen', 'bezahlen', 'senden', 'salvar', 'excluir', 'apagar', 'cancelar suscripción',
];

const vetoRe = new RegExp(`(^|[^\\p{L}\\p{N}])(?:${VETO.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s_-]*')).join('|')})(?:s|es|ed|ing)?(?=$|[^\\p{L}\\p{N}])`, 'iu');

/** True when the text reads like an act that changes something. */
export function vetoed(text: string): boolean {
  return text.length > 0 && vetoRe.test(text);
}

/** Dialogs that ask for a decision, and windows the app never acts in. */
const DECISION_DIALOG = /\b(confirm|delete|remove|uninstall|purchase|payment|permission|do you want|are you sure|user account control|unsaved|save changes|overwrite|replace)/i;
const BLOCKED_WINDOW = /\b(1password|bitwarden|lastpass|keepass|dashlane|nordpass|password manager|bank|banking|paypal|wallet|checkout|payment|credit card|billing|admin console|administrator)\b/i;
const BLOCKED_PROCESS = /^(1password|bitwarden|lastpass|keepass|keepassxc|dashlane|nordpass|credwiz|consent|logonui|winlogon)/i;

/** Control types that hold a value, a choice or a setting: never acted on, whatever the model asks. */
const VALUE_TYPES: ReadonlySet<string> = new Set(['edit', 'combobox', 'slider', 'spinner', 'checkbox', 'radiobutton']);

export function decideNav(facts: NavFacts | NavFactsError, intent: NavIntent): NavDecision {
  if (!facts.ok) return { verdict: 'show', why: facts.why };
  const f = facts;
  // Never, whatever the model says.
  if (f.elevated) return { verdict: 'refuse', why: 'an elevated window' };
  if (f.password) return { verdict: 'refuse', why: 'a password field' };
  if (f.toggle || f.range) return { verdict: 'refuse', why: 'a switch or a value' };
  if (VALUE_TYPES.has(f.ct) || (f.valuePattern && !f.valueReadOnly)) return { verdict: 'refuse', why: `a ${f.ct} holds a value` };
  if (BLOCKED_PROCESS.test(f.proc) || BLOCKED_WINDOW.test(f.win) || BLOCKED_WINDOW.test(f.dlg)) return { verdict: 'refuse', why: 'a window that is never acted in' };
  if (DECISION_DIALOG.test(f.win) || DECISION_DIALOG.test(f.dlg)) return { verdict: 'refuse', why: 'a dialog that asks for a decision' };
  if (!f.enabled) return { verdict: 'show', why: 'not enabled' };
  if (f.offscreen) return { verdict: 'show', why: 'not on screen' };
  // Words only lower the result.
  if (intent.kind !== 'scroll' && [f.name, f.autoId, f.help].some(vetoed)) return { verdict: 'show', why: 'its name reads like an act' };

  switch (intent.kind) {
    case 'tab':
      if (f.ct !== 'tabitem') return { verdict: 'show', why: `a ${f.ct}, not a tab` };
      if (f.selected !== false) return { verdict: 'show', why: f.selected ? 'the tab is already open' : 'the tab cannot be selected from here' };
      return { verdict: 'do', verb: 'select', what: 'tab' };
    case 'open':
      if (f.ct !== 'menuitem') return { verdict: 'show', why: `a ${f.ct}, not a menu` };
      if (f.expand !== 'collapsed') return { verdict: 'show', why: f.expand === 'leaf' || f.expand === '' ? 'the menu item runs a command' : 'the menu is already open' };
      return { verdict: 'do', verb: 'expand', what: 'menu' };
    case 'scroll': {
      const s = f.scroll;
      if (!s) return { verdict: 'show', why: 'nothing here scrolls' };
      const dir = intent.dir ?? 'down';
      const can = dir === 'down' ? s.canDown : dir === 'up' ? s.canUp : dir === 'left' ? s.canLeft : s.canRight;
      if (!can) return { verdict: 'show', why: `it cannot scroll ${dir}` };
      return { verdict: 'do', verb: 'scroll', what: 'page' };
    }
  }
}

/** What the app says aloud before it acts, so the person can stop it. */
export function announcement(kind: NavKind, dir?: NavDir): string {
  switch (kind) {
    case 'tab': return "I'll open that tab for you.";
    case 'open': return "I'll open that menu for you.";
    case 'scroll': return `I'll scroll ${dir ?? 'down'} for you.`;
  }
}
