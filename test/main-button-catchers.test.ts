import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CATCHER_WINDOW_OPTIONS, catcherHtml, createButtonCatchers, pressOf, PRESS_SCHEME, validRects } from '../src/main/button-catchers.ts';
import type { ButtonId, ButtonRect, CatcherWindow } from '../src/main/button-catchers.ts';
import type { Rect } from '../src/main/consent-card.ts';

const R = (id: ButtonId, x: number, y: number, w = 80, h = 26): ButtonRect => ({ id, x, y, w, h });

function rig() {
  const windows = new Map<ButtonId, { shown: Rect[]; hides: number; destroyed: number; press: () => void }>();
  const pressed: ButtonId[] = [];
  let made = 0;
  const catchers = createButtonCatchers({
    makeWindow: (id) => {
      made++;
      const rec = { shown: [] as Rect[], hides: 0, destroyed: 0, press: () => undefined as void };
      windows.set(id, rec);
      const win: CatcherWindow = {
        show: (_html, bounds) => void rec.shown.push(bounds),
        hide: () => void rec.hides++,
        destroy: () => void rec.destroyed++,
        onPress: (l) => void (rec.press = l),
      };
      return win;
    },
    onPress: (id) => void pressed.push(id),
  });
  return { catchers, windows, pressed, get made() { return made; } };
}

test('the page report is read strictly: only the known buttons, once each, with sane rectangles', () => {
  assert.deepEqual(validRects([R('explode', 10, 20), R('cut', 10, 60)]), [R('explode', 10, 20), R('cut', 10, 60)]);
  assert.deepEqual(validRects('nope'), []);
  assert.deepEqual(validRects([R('explode', 1, 1), R('explode', 5, 5)]).length, 1, 'once each');
  for (const bad of [{ id: 'close-everything', x: 1, y: 1, w: 50, h: 20 }, { id: 'cut', x: NaN, y: 1, w: 50, h: 20 }, { id: 'cut', x: 1, y: 1, w: 0, h: 20 }, { id: 'cut', x: 1, y: 1, w: 5000, h: 20 }, { id: 'cut', x: 1, y: -9999, w: 50, h: 20 }, { id: 'cut', x: '1', y: 1, w: 50, h: 20 }, null, 7]) {
    assert.deepEqual(validRects([bad]), [], JSON.stringify(bad));
  }
  assert.ok(validRects(Array.from({ length: 100 }, () => R('cut', 1, 1))).length <= 1);
});

test('a press address names a button; any other address names nothing', () => {
  assert.equal(pressOf(`${PRESS_SCHEME}//explode`), 'explode');
  assert.equal(pressOf(`${PRESS_SCHEME}//detail/`), 'detail');
  for (const other of ['', 'https://example.com', `${PRESS_SCHEME}//format-disk`, `${PRESS_SCHEME}explode`, 'tt-answer://yes']) assert.equal(pressOf(other), null, other);
  assert.ok(catcherHtml('cut').includes(`href="${PRESS_SCHEME}//cut"`));
  assert.ok(!/<script/i.test(catcherHtml('cut')));
});

test('a catcher lies exactly over its button, in screen pixels of the display the page is on, and nowhere else', () => {
  const r = rig();
  r.catchers.update([R('explode', 100, 200, 74, 26), R('cut', 120, 232, 54, 26)], { x: 1920, y: 0 }, true);
  assert.deepEqual(r.windows.get('explode')!.shown, [{ x: 2020, y: 200, width: 74, height: 26 }]);
  assert.deepEqual(r.windows.get('cut')!.shown, [{ x: 2040, y: 232, width: 54, height: 26 }]);
  assert.equal(r.windows.size, 2, 'no window for a button that is not there');
});

test('nothing is made when there are no buttons: the overlay is click-through everywhere', () => {
  const r = rig();
  r.catchers.update([], { x: 0, y: 0 }, true);
  assert.equal(r.made, 0);
});

test('a button that stays put is not touched again; one that moves is moved; one that goes is put away; windows are reused', () => {
  const r = rig();
  r.catchers.update([R('explode', 100, 200), R('cut', 100, 240)], { x: 0, y: 0 }, true);
  r.catchers.update([R('explode', 100, 200), R('cut', 100, 240)], { x: 0, y: 0 }, true);
  assert.equal(r.windows.get('explode')!.shown.length, 1, 'same place: nothing to do');
  r.catchers.update([R('explode', 140, 200), R('cut', 100, 240)], { x: 0, y: 0 }, true);
  assert.equal(r.windows.get('explode')!.shown.length, 2);
  assert.equal(r.windows.get('cut')!.shown.length, 1);
  r.catchers.update([R('explode', 140, 200)], { x: 0, y: 0 }, true);
  assert.equal(r.windows.get('cut')!.hides, 1, 'its button is gone: the catcher goes');
  r.catchers.update([R('explode', 140, 200), R('cut', 100, 240)], { x: 0, y: 0 }, true);
  assert.equal(r.made, 2, 'the same window comes back');
  assert.equal(r.windows.get('cut')!.shown.length, 2);
});

test('while the pen is on (not enabled) every catcher is put away so strokes are not caught, and they return where they were', () => {
  const r = rig();
  r.catchers.update([R('explode', 100, 200), R('detail', 10, 200)], { x: 0, y: 0 }, true);
  r.catchers.update([R('explode', 100, 200), R('detail', 10, 200)], { x: 0, y: 0 }, false);
  assert.equal(r.windows.get('explode')!.hides, 1);
  assert.equal(r.windows.get('detail')!.hides, 1);
  r.catchers.update([R('explode', 100, 200), R('detail', 10, 200)], { x: 0, y: 0 }, false);
  assert.equal(r.windows.get('explode')!.hides, 1, 'put away once');
  r.catchers.update([R('explode', 100, 200), R('detail', 10, 200)], { x: 0, y: 0 }, true);
  assert.equal(r.windows.get('explode')!.shown.length, 2, 'shown again');
});

test('a press on a catcher comes out as that button, and disposing destroys the windows', () => {
  const r = rig();
  r.catchers.update([R('offer', 1, 1), R('detail', 100, 1)], { x: 0, y: 0 }, true);
  r.windows.get('detail')!.press();
  r.windows.get('offer')!.press();
  assert.deepEqual(r.pressed, ['detail', 'offer']);
  r.catchers.dispose();
  assert.equal(r.windows.get('offer')!.destroyed, 1);
  assert.equal(r.windows.get('detail')!.destroyed, 1);
});

test('the catcher window takes a click with no move before it, and the overlay itself is still click-through', () => {
  assert.equal(CATCHER_WINDOW_OPTIONS.focusable, false);
  assert.equal(CATCHER_WINDOW_OPTIONS.alwaysOnTop, true);
  const catcher = readFileSync(new URL('../src/main/button-window.ts', import.meta.url), 'utf8');
  assert.ok(!/setIgnoreMouseEvents\s*\(/.test(catcher), 'a catcher must not be made click-through');
  assert.ok(/javascript:\s*false/.test(catcher) && !/preload/.test(catcher.replace(/\/\/.*$/gm, '')), 'no script, no preload');
  const overlay = readFileSync(new URL('../src/main/overlay-windows.ts', import.meta.url), 'utf8');
  assert.ok(/window\.setIgnoreMouseEvents\(true, \{ forward: true \}\)/.test(overlay), 'the overlay window still starts click-through');
  assert.ok(/ignoreMouse\(overlay\.pageWantsClicks, overlay\.pen\)/.test(overlay), 'and still decides by the page and the pen');
});
