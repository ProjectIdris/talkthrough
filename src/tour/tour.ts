import type { TourState } from '../shared/visual-tour.ts';
const api = window.talkthroughTour;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let built = false;
function show(state: TourState): void {
  if (!built) {
    element('examples').replaceChildren(...state.examples.map(example => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'example';
      button.dataset.example = example.id;
      const title = document.createElement('strong');
      title.textContent = example.title;
      const description = document.createElement('span');
      description.textContent = example.description;
      button.append(title, description);
      button.addEventListener('click', () => api.command({ kind: 'select', id: example.id }));
      return button;
    }));
    built = true;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-example]')) {
    button.setAttribute('aria-pressed', String(button.dataset.example === state.selected));
    button.disabled = state.busy;
  }
  element('step').textContent = state.steps ? `Step ${state.step + 1} of ${state.steps}` : 'Example unavailable';
  element('say').textContent = state.say;
  element<HTMLButtonElement>('back').disabled = state.busy || state.step <= 0 || !state.steps;
  element<HTMLButtonElement>('next').disabled = state.busy || state.step >= state.steps - 1 || !state.steps;
  element<HTMLButtonElement>('restart').disabled = state.busy || !state.steps;
  element('status').textContent = state.error ?? (state.busy ? 'Drawing this step…' : 'Built-in example. Live answers depend on your model.');
  element('status').classList.toggle('error', Boolean(state.error));
}
for (const kind of ['back', 'next', 'restart'] as const) element(kind).addEventListener('click', () => api.command({ kind }));
api.onState(show);
void api.state().then(state => { if (state) show(state); }).catch(() => { element('status').textContent = 'The explorer could not start. Close and reopen it to try again.'; });
