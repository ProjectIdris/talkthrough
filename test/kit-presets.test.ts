import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate, inner, BASE } from '../src/scene/kit-expr.ts';
import { kitParts, KIT_PRESETS, rowAnchors, rowScope, settingN } from '../src/scene/kit-presets.ts';
import type { KitRow } from '../src/scene/kit-presets.ts';
import { crankThrow, normalSize, pistonPinDrop, resolvePartGeometry, rodEnds } from '../src/scene/part-geometry.ts';
import { PARTS } from '../src/scene/spec.ts';
import { DETAIL } from '../src/overlay/geometry.ts';
import { buildPart } from '../src/overlay/parts.ts';
import type { AddPart, Vec3 } from '../src/scene/types.ts';

// The kit is a table of rows (src/scene/kit-presets.ts) read by general generators. The exact shapes every row builds are held by kit-parts-golden.test.ts;
// this is the formula language, the shape of the rows, and that a part can be added as a row alone.

const scope = (extra: Record<string, unknown> = {}) => Object.assign(inner(BASE), extra);

test('formulas: arithmetic, precedence, comparison, ternary, strings and the few functions', () => {
  const s = scope({ a: 3, b: 4, name: 'cutaway' });
  assert.equal(evaluate('1 + 2 * 3', s), 7);
  assert.equal(evaluate('(1 + 2) * 3', s), 9);
  assert.equal(evaluate('-a * 2', s), -6);
  assert.equal(evaluate('10 / 4 / 5', s), 0.5, 'left to right');
  assert.equal(evaluate('7 % 4', s), 3);
  assert.equal(evaluate('a < b && b >= 4 || false', s), true);
  assert.equal(evaluate('!(a == 3)', s), false);
  assert.equal(evaluate("name == 'cutaway' ? a : b", s), 3);
  assert.equal(evaluate('a > b ? 1 : b > a ? 2 : 3', s), 2, 'a ternary chains to the right');
  assert.equal(evaluate("'pin' + (a > 1 ? a : '')", s), 'pin3');
  assert.equal(evaluate('min(a, b, 2) + max(a, b) + abs(-1) + floor(2.7) + sqrt(16)', s), 2 + 4 + 1 + 2 + 4);
  assert.ok(Math.abs((evaluate('cos(pi) + sin(pi/2) + atan2(1, 1) * 4 / pi', s) as number) - 1) < 1e-12);
  assert.equal(evaluate('90 * deg', s), Math.PI / 2);
  assert.equal(evaluate(4, s), 4, 'a number in a row is itself');
  assert.equal(evaluate(true, s), true);
});

test('formulas read only numbers, names and a short list of functions; nothing else runs', () => {
  const s = scope({ a: 1 });
  for (const bad of ['a.b', 'a[0]', 'constructor', 'toString()', 'alert(1)', 'a = 2', 'process', '1 +', '(1', 'a ? 1', '"open']) {
    assert.throws(() => evaluate(bad, s), Error, bad);
  }
  assert.throws(() => evaluate('nope + 1', s), /nope is not known here/);
  assert.throws(() => evaluate('hypot(3, 4)', s), /unknown function hypot/);
  // names set in an inner scope shadow, and leave the outer scope as it was
  const in2 = inner(s);
  in2.a = 5;
  assert.equal(evaluate('a', in2), 5);
  assert.equal(evaluate('a', s), 1);
});

test('the table holds the thirteen first mechanism parts and the twelve added as rows, each a part the scene language names, and every row evaluates', () => {
  assert.deepEqual(kitParts(), ['cylinder-block', 'piston', 'connecting-rod', 'crankshaft', 'valve', 'camshaft', 'spark-plug', 'gear', 'spring', 'bearing', 'pipe', 'elbow', 'housing',
    'pulley', 'sprocket', 'bevel-gear', 'rack', 'shaft', 'frame-plate', 'turbine', 'coil', 'magnet', 'ramp', 'fulcrum', 'bolt']);
  for (const part of kitParts()) assert.ok(PARTS.includes(part as never), part);
  for (const part of kitParts()) {
    for (const size of [[1, 1, 1], [2, 3, 2.5], [4, 1, 0.5]] as Vec3[]) {
      const { size: fitted, anchors } = resolvePartGeometry({ part, size } as AddPart);
      assert.ok(fitted.every((v) => Number.isFinite(v) && v > 0), `${part} ${size}`);
      for (const [name, at] of Object.entries(anchors)) assert.ok(at.every(Number.isFinite), `${part}.${name}`);
      assert.ok(anchors.origin, `${part} has an origin`);
      assert.deepEqual(normalSize(part, fitted), fitted, `${part} fits itself`);
    }
  }
});

test('settings: the count a row takes is its default, held between its limits', () => {
  const gear = KIT_PRESETS.gear!;
  assert.equal(settingN(gear, undefined), 16);
  assert.equal(settingN(gear, 2), 6);
  assert.equal(settingN(gear, 500), 120);
  assert.equal(settingN(KIT_PRESETS.crankshaft!, 12), 8);
  assert.equal(settingN(KIT_PRESETS['cylinder-block']!, undefined), 6, 'fins: a default and no limit');
  assert.equal(settingN(KIT_PRESETS['cylinder-block']!, 40), 40);
  assert.equal(settingN(KIT_PRESETS.piston!, undefined), 0, 'a part with no count has none');
});

test('the crank throw, the rod ends and the pin drop are the rows\' own values', () => {
  assert.equal(crankThrow([4, 6, 2]), 4 * 0.3);
  assert.equal(crankThrow([6, 4, 2]), 4 * 0.3, 'the smaller of x and y');
  const ends = rodEnds([0.8, 4, 0.5]);
  assert.equal(ends.big, -2 + 0.4);
  assert.equal(ends.small, 2 - 0.8 * 0.3);
  assert.equal(ends.length, ends.small - ends.big);
  assert.deepEqual(rodEnds([4, 0.8, 0.5]), ends, 'written on its side, the rod stands up first');
  assert.equal(pistonPinDrop([2, 3, 2]), 3 * 0.1);
  // the anchors name the same numbers
  assert.deepEqual(resolvePartGeometry({ part: 'connecting-rod', size: [0.8, 4, 0.5] } as AddPart).anchors['big-end'], [0, ends.big, 0]);
  assert.deepEqual(resolvePartGeometry({ part: 'crankshaft', size: [4, 4, 2], n: 1 } as AddPart).anchors.throw, [0, crankThrow([4, 4, 2]), 0]);
});

test('a new part is a row: nothing else is written to draw it, place it or give it points', () => {
  const washer: KitRow = {
    fit: ['discAboutZ'],
    settings: { n: { default: 3, min: 1, max: 5 } },
    values: [['ro', 'sx/2'], ['gap', 'ro*0.1']],
    anchors: [{ name: 'axis', at: [0, 0, 'sz/2'] }, { for: { as: 'i', count: 'n' }, name: 'notch', suffix: 'i + 1', at: ['ro', 0, 0] }],
    features: [
      { kind: 'slab', surface: 'metal', tint: true, edges: true, outline: { ring: ['ro', 'ro*0.5'] }, depth: 'sz', bevel: 'sz*0.1' },
      { kind: 'sphere', for: { as: 'i', count: 'n' }, let: [['a', 'i/n*pi*2']], surface: 'metal', color: 'steel', r: 'gap', across: 8, down: 6, pos: ['cos(a)*ro*0.75', 'sin(a)*ro*0.75', 0] },
      { kind: 'bolts', surface: 'metal', r: 'gap', h: 'gap*2', axis: 'z', at: [{ for: { as: 'i', in: [-1, 1] }, p: ['i*ro', 0, 'sz/2'] }] },
    ],
  };
  const table = KIT_PRESETS as Record<string, KitRow>;
  table.washer = washer;
  try {
    const def = { op: 'add', shape: 'part', id: 'w', part: 'washer', size: [0.4, 3, 3], n: 9 } as unknown as AddPart;
    const geometry = resolvePartGeometry(def);
    assert.deepEqual(geometry.size, [3, 3, 0.4], 'the row\'s fit turned it into a disc about z');
    assert.deepEqual(Object.keys(geometry.anchors), ['origin', 'axis', 'notch1', 'notch2', 'notch3', 'notch4', 'notch5'], 'n held to the row\'s limit');
    const built = buildPart(def, DETAIL.mid);
    assert.deepEqual(Object.keys(built.anchors), Object.keys(geometry.anchors));
    // a ring, five balls and one instanced draw of two bolts
    assert.equal(built.pieces.length, 1 + 5 + 1);
    assert.equal(built.pieces.filter((p) => p.surface === 'metal' && p.color !== undefined).length, 6);
    const rowsAnchors = rowAnchors(washer, rowScope(washer, [3, 3, 0.4], 2, undefined));
    assert.deepEqual(Object.keys(rowsAnchors), ['axis', 'notch1', 'notch2']);
  } finally {
    delete table.washer;
  }
});
