import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Model, ModelOutput } from '../src/adapters/model.ts';
import { ModelError } from '../src/adapters/model.ts';
import { createFallbackVoice } from '../src/adapters/fallback-voice.ts';
import { createQuestionRecord, folderName, pruneRecord, RECORD_KEEP, recordDir } from '../src/main/record.ts';
import { observeModel } from '../src/main/record-model.ts';
import { DEFAULT_SETTINGS, settingsFromRaw } from '../src/main/settings.ts';
import { createSettingsService, formFromSettings } from '../src/main/settings-service.ts';

const scratch = (): string => mkdtempSync(join(tmpdir(), 'tt-record-'));
const read = (...p: string[]): string => readFileSync(join(...p), 'utf8');
const stamp = (n: number): Date => new Date(2026, 10, 5, 10, 0, 0 + n);

test('a question gets its own dated folder holding what was sent, heard, called, drawn, repaired, spoken and broken', () => {
  const dir = scratch();
  try {
    const rec = createQuestionRecord({ dir, now: () => stamp(0) });
    rec.begin('question');
    const folder = rec.folder()!;
    assert.equal(folder, join(dir, folderName(stamp(0))));
    rec.transcript('what is this', 'whisper 0.40 s');
    rec.picture('screenshot-sent', { mime: 'image/png', base64: Buffer.from('PNGDATA').toString('base64') });
    rec.picture('crop-1-picture', { mime: 'image/jpeg', base64: Buffer.from('JPG').toString('base64') });
    rec.strokes([[[10, 20], [30, 40]]]);
    rec.message({ kind: 'step-open', say: 'First.' });
    rec.message({ kind: 'action', action: { op: 'box', id: 'a' } });
    rec.message({ kind: 'step-close' });
    rec.message({ kind: 'step', step: { say: 'Second.', actions: [] } });
    rec.issues(2, [{ path: 'steps[1].actions[0]', message: 'dropped: unknown id' }, { path: 'steps[1].actions[1]', message: 'size clamped' }, { path: 'a', message: 'b' }, { path: 'c', message: 'the fourth note, which the log line leaves out' }]);
    rec.voice('voice: the shared voice gave no sound (503); speaking with the system voice for 20 s');
    rec.error('model: unavailable: not signed in');
    rec.line('chord released');
    rec.report({ model: 'claude-haiku-5-5', question: 'what is this', steps: 2, firstWordMs: 2800 });

    assert.equal(read(folder, 'transcript.txt'), 'what is this\n');
    assert.equal(readFileSync(join(folder, 'screenshot-sent.png')).toString(), 'PNGDATA');
    assert.equal(readFileSync(join(folder, 'crop-1-picture.jpg')).toString(), 'JPG');
    assert.deepEqual(JSON.parse(read(folder, 'pen-strokes.json')).strokes, [[[10, 20], [30, 40]]]);
    const steps = JSON.parse(read(folder, 'steps.json')) as Array<{ say: string; actions: unknown[] }>;
    assert.deepEqual(steps.map((s) => [s.say, s.actions.length]), [['First.', 1], ['Second.', 0]]);
    assert.match(read(folder, 'repairs.txt'), /the fourth note, which the log line leaves out/);
    assert.match(read(folder, 'voice.txt'), /503/);
    assert.match(read(folder, 'errors.txt'), /not signed in/);
    assert.match(read(folder, 'log.txt'), /chord released/);
    const report = JSON.parse(read(folder, 'report.json'));
    assert.equal(report.question, 'what is this');
    assert.equal(report.firstWordMs, 2800);
    assert.equal(report.speech, 'whisper 0.40 s');
    assert.equal(report.kind, 'question');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the lines from the chord down to the question's start (the window shown, the pen, the capture) are in the first question's log, once, and not in the next one's", () => {
  const dir = scratch();
  try {
    let n = 0;
    const rec = createQuestionRecord({ dir, now: () => stamp(n++) });
    const press = 'window mouse: display 1 takes clicks (the pen went on: the pen is on); since the last line 0 presses and 0 moves reached its page';
    rec.line('settings file: x');
    rec.line('chord pressed');
    rec.line(press);
    rec.line('pen: on for display 1 (press 1)');
    rec.line('chord released');
    assert.deepEqual(readdirSync(dir), [], 'nothing is written before a question begins');
    rec.begin('question');
    const first = rec.folder()!;
    rec.line('key hook: during this answer keys 0, mouse 2, moves 0');
    const lines = (folder: string): string[] => read(folder, 'log.txt').trim().split('\n').map((l) => l.slice(13));
    assert.deepEqual(lines(first), ['chord pressed', press, 'pen: on for display 1 (press 1)', 'chord released', 'key hook: during this answer keys 0, mouse 2, moves 0'], 'from the chord on, nothing before it');
    rec.line('chord pressed');
    rec.line('pen: on for display 1 (press 2)');
    rec.begin('question');
    assert.deepEqual(lines(rec.folder()!), ['chord pressed', 'pen: on for display 1 (press 2)'], "only its own lines, not the first question's");
    rec.begin('detail');
    assert.equal(existsSync(join(rec.folder()!, 'log.txt')), false, 'a detail pass after no chord gets no old lines');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nothing is written before a question begins, and two questions in one second get two folders', () => {
  const dir = scratch();
  try {
    const rec = createQuestionRecord({ dir, now: () => stamp(0) });
    rec.line('ready');
    rec.transcript('early', undefined);
    assert.equal(existsSync(dir) ? readdirSync(dir).length : 0, 0);
    rec.begin('question');
    rec.begin('question');
    assert.equal(readdirSync(dir).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(`only the newest ${RECORD_KEEP} question folders are kept, and nothing else in the folder is ever deleted`, () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, 'notes.txt'), 'mine');
    mkdirSync(join(dir, 'my-pictures'));
    let n = 0;
    const rec = createQuestionRecord({ dir, now: () => stamp(n++) });
    for (let i = 0; i < RECORD_KEEP + 5; i++) rec.begin('question');
    const kept = readdirSync(dir).filter((name) => /^\d{4}-/.test(name)).sort();
    assert.equal(kept.length, RECORD_KEEP);
    assert.equal(kept[0], folderName(stamp(5)), 'the five oldest went');
    assert.equal(kept.at(-1), folderName(stamp(RECORD_KEEP + 4)), 'the newest stayed');
    assert.ok(existsSync(join(dir, 'notes.txt')) && existsSync(join(dir, 'my-pictures')), 'files and folders that are not a question\'s are left alone');
    assert.equal(pruneRecord(dir, RECORD_KEEP), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('record retention keeps the latest questions after repeated clock rollback and restart', () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, 'notes.txt'), 'keep this');
    mkdirSync(join(dir, 'my-pictures'));
    const warnings: string[] = [];
    const folders: string[] = [];
    for (let n = 0; n < 5; n++) {
      // Reopening the record simulates restarting the app after the clock moved back.
      const rec = createQuestionRecord({ dir, keep: 3, now: () => stamp(10 - n), warn: (m) => warnings.push(m) });
      rec.begin('question');
      const folder = rec.folder()!;
      folders.push(folder);
      rec.transcript(`Question ${n}`);
      rec.report({ steps: 1, recordOrder: 0 }); // report updates must not replace the assigned order
      assert.equal(read(folder, 'transcript.txt'), `Question ${n}\n`, 'the active folder survives cleanup');
    }
    assert.deepEqual(folders.map((folder) => existsSync(folder)), [false, false, true, true, true]);
    assert.deepEqual(warnings, []);
    assert.equal(read(dir, 'notes.txt'), 'keep this');
    assert.ok(existsSync(join(dir, 'my-pictures')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('same-second records keep the latest questions when names are reused after pruning', () => {
  const dir = scratch();
  try {
    const rec = createQuestionRecord({ dir, now: () => stamp(0) });
    for (let n = 0; n < RECORD_KEEP + 2; n++) {
      rec.begin('question');
      rec.transcript(`Question ${n}`);
    }
    const saved = readdirSync(dir).map((name) => read(dir, name, 'transcript.txt').trim()).sort();
    const wanted = Array.from({ length: RECORD_KEEP }, (_, n) => `Question ${n + 2}`).sort();
    assert.deepEqual(saved, wanted);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy same-second folders are pruned by numeric suffix', () => {
  const dir = scratch();
  try {
    const base = folderName(stamp(0));
    for (let n = 1; n <= 12; n++) mkdirSync(join(dir, n === 1 ? base : `${base}-${n}`));
    assert.equal(pruneRecord(dir, 3), 9);
    assert.deepEqual(readdirSync(dir).sort(), [`${base}-10`, `${base}-11`, `${base}-12`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing or invalid ordering metadata falls back to legacy names without blocking retention', () => {
  const dir = scratch();
  try {
    const reports = [undefined, '{ broken', '{}', '{"recordOrder":-1}', '{"recordOrder":1.5}', '{"recordOrder":"20"}'];
    for (let n = 0; n < reports.length; n++) {
      const folder = join(dir, folderName(stamp(n)));
      mkdirSync(folder);
      if (reports[n] !== undefined) writeFileSync(join(folder, 'report.json'), reports[n]!);
    }
    const unrelated = folderName(stamp(20));
    writeFileSync(join(dir, unrelated), 'a matching name is not enough: this is a file');
    const rec = createQuestionRecord({ dir, keep: 2, now: () => stamp(-1) });
    rec.begin('question');
    rec.transcript('Newest');
    assert.equal(read(rec.folder()!, 'transcript.txt'), 'Newest\n');
    assert.deepEqual(readdirSync(dir).sort(), [folderName(stamp(-1)), folderName(stamp(5)), unrelated].sort());
    assert.equal(read(dir, unrelated), 'a matching name is not enough: this is a file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an exhausted record order does not overflow or prune existing records', () => {
  const dir = scratch();
  try {
    const folder = join(dir, folderName(stamp(0)));
    mkdirSync(folder);
    const original = JSON.stringify({ recordOrder: Number.MAX_SAFE_INTEGER });
    writeFileSync(join(folder, 'report.json'), original);
    const warnings: string[] = [];
    const rec = createQuestionRecord({ dir, keep: 1, now: () => stamp(1), warn: (m) => warnings.push(m) });
    rec.begin('question');
    rec.begin('question');
    assert.equal(rec.folder(), undefined);
    assert.equal(warnings.length, 1, 'recording failure is nonfatal and warned once');
    assert.deepEqual(readdirSync(dir), [folderName(stamp(0))]);
    assert.equal(read(folder, 'report.json'), original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unreadable record inventory does not allocate a stale order or prune existing records', () => {
  const dir = scratch();
  try {
    let n = 0;
    const warnings: string[] = [];
    const rec = createQuestionRecord({ dir, keep: 2, now: () => stamp(n++), warn: (m) => warnings.push(m) });
    rec.begin('question'); rec.transcript('First');
    rec.begin('question'); rec.transcript('Second');
    const broken = join(dir, folderName(stamp(20)));
    symlinkSync(join(dir, 'missing-target'), broken, 'junction');
    rec.begin('question');
    assert.equal(rec.folder(), undefined, 'unknown existing order must not be treated as an empty record');
    assert.equal(warnings.length, 1);
    assert.equal(read(dir, folderName(stamp(0)), 'transcript.txt'), 'First\n');
    assert.equal(read(dir, folderName(stamp(1)), 'transcript.txt'), 'Second\n');
    rmSync(broken);
    rec.begin('question'); rec.transcript('Third');
    const saved = readdirSync(dir).map((name) => read(dir, name, 'transcript.txt').trim()).sort();
    assert.deepEqual(saved, ['Second', 'Third'], 'recording and retention resume after the inventory is readable');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a record that cannot be written never reaches the question, and says so once', () => {
  const dir = scratch();
  try {
    const blocked = join(dir, 'a-file');
    writeFileSync(blocked, 'x');
    const warned: string[] = [];
    const rec = createQuestionRecord({ dir: join(blocked, 'inside'), warn: (m) => warned.push(m) });
    rec.begin('question');
    rec.transcript('hello', undefined);
    rec.begin('question');
    rec.error('boom');
    assert.equal(warned.length, 1);
    assert.match(warned[0]!, /could not be written/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a model call goes into the record with its model, timings, raw text and usage, and a failed one with its error', async () => {
  const dir = scratch();
  try {
    const rec = createQuestionRecord({ dir, now: () => stamp(0) });
    rec.begin('question');
    const good: Model = {
      id: 'fake-model',
      async *ask(req): AsyncGenerator<ModelOutput> {
        yield { type: 'say', say: 'Hi.' };
        yield { type: 'step', step: { say: 'Hi.', actions: [] } };
        req.onRaw?.('{"steps":[]}');
        yield { type: 'usage', usage: { input: 10, cached: 4, output: 3 } };
      },
    };
    const seen: string[] = [];
    const said: string[] = [];
    for await (const out of observeModel(good, { record: rec, log: (l) => said.push(l) }, 'quick answer').ask({ question: 'q', screenshot: { mime: 'image/png', base64: 'AA', width: 1, height: 1 }, thread: [], schema: {}, stage: { part: 'next', n: 3, shown: [], plan: [] }, onRaw: (t) => seen.push(t) })) void out;
    assert.deepEqual(seen, ['{"steps":[]}'], 'the wrapped call still hands its raw text on');
    assert.match(said.join('\n'), /model call 1: fake-model \(quick answer, next 3\) first output \d+ ms, ended \d+ ms/, 'the log names the model on every call');
    const bad: Model = { id: 'bad-model', async *ask(): AsyncGenerator<ModelOutput> { throw new ModelError('auth', 'sign in again'); } };
    await assert.rejects(async () => { for await (const out of observeModel(bad, { record: rec, log: () => undefined }, 'detail pass').ask({ question: 'q', screenshot: { mime: 'image/png', base64: 'AA', width: 1, height: 1 }, thread: [], schema: {} })) void out; });
    const folder = rec.folder()!;
    const one = JSON.parse(read(folder, 'call-1.json'));
    assert.equal(one.model, 'fake-model');
    assert.equal(one.role, 'quick answer');
    assert.equal(one.stage, 'next 3');
    assert.deepEqual(one.outputs, { steps: 1, says: 1, actions: 0, escalate: false });
    assert.deepEqual(one.usage, { input: 10, cached: 4, output: 3 });
    assert.equal(typeof one.firstOutputMs, 'number');
    assert.equal(typeof one.endMs, 'number');
    assert.equal(read(folder, 'call-1-raw.txt'), '{"steps":[]}');
    const two = JSON.parse(read(folder, 'call-2.json'));
    assert.equal(two.role, 'detail pass');
    assert.match(two.error, /auth: sign in again/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the voice says which voice spoke each step and why the system voice took over', async () => {
  const lines: string[] = [];
  let now = 0;
  const clock = { now: () => now, after: (_ms: number, _run: () => void) => () => undefined };
  const handle = () => ({ finished: new Promise<never>(() => undefined), cancel: () => undefined });
  const fine = createFallbackVoice({ primary: { id: 'shared', speak: (_t, l) => { l?.start?.({}); return handle(); }, cancel: () => undefined }, fallback: { id: 'system', speak: () => handle(), cancel: () => undefined }, firstAudioMs: 1000, clock, log: (l) => lines.push(l) });
  fine.speak('Hello.', {});
  assert.deepEqual(lines, ['voice: this step is spoken with shared']);
  lines.length = 0;
  const down = createFallbackVoice({ primary: { id: 'shared', speak: (_t, l) => { l?.end?.({ reason: 'error', error: 'the voice server answered 503' }); return handle(); }, cancel: () => undefined }, fallback: { id: 'system', speak: () => handle(), cancel: () => undefined }, firstAudioMs: 1000, cooldownMs: 20_000, clock, log: (l) => lines.push(l) });
  down.speak('First.', {});
  now = 5000;
  down.speak('Second.', {});
  assert.match(lines[0]!, /shared gave no sound \(the voice server answered 503\); speaking with system/);
  assert.match(lines[1]!, /this step is spoken with system \(shared is being left alone after: the voice server answered 503\)/);
});

test('the record is off by default, a folder must be a full path, and the setting and its folder go through the settings window', () => {
  assert.equal(DEFAULT_SETTINGS.keepRecord, false);
  assert.equal(settingsFromRaw({}).keepRecord, false);
  assert.equal(settingsFromRaw({}).recordFolder, undefined);
  const warnings: string[] = [];
  const bad = settingsFromRaw({ keepRecord: true, recordFolder: 'questions' }, (m) => warnings.push(m));
  assert.equal(bad.keepRecord, true);
  assert.equal(bad.recordFolder, undefined);
  assert.match(warnings.join(' '), /recordFolder must be a full folder path/);
  const dir = scratch();
  try {
    const file = join(dir, 'settings.json');
    const service = createSettingsService({ path: file });
    const form = service.read();
    assert.equal(form.keepRecord, false);
    assert.equal(form.recordFolder, '');
    const folder = join(dir, 'record');
    const saved = service.save({ ...form, keepRecord: true, recordFolder: folder });
    assert.ok(saved.ok);
    const raw = JSON.parse(read(file));
    assert.equal(raw.keepRecord, true);
    assert.equal(raw.recordFolder, folder);
    assert.deepEqual(formFromSettings(settingsFromRaw(raw)).recordFolder, folder);
    const refused = service.save({ ...form, keepRecord: true, recordFolder: 'questions' });
    assert.equal(refused.ok, false);
    const off = service.save({ ...form, keepRecord: false, recordFolder: '' });
    assert.ok(off.ok);
    assert.equal('keepRecord' in JSON.parse(read(file)), false, 'off is the default and is not written');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(recordDir(undefined, join('x', 'data')), join('x', 'data', 'questions'));
  assert.equal(recordDir('  ', 'data'), join('data', 'questions'));
  assert.equal(recordDir('C:\\keep\\here', 'data'), 'C:\\keep\\here');
});

test('a folder that cannot be made leaves no question open: nothing goes into the previous question\'s folder', () => {
  const dir = scratch();
  try {
    const parent = join(dir, 'record');
    const rec = createQuestionRecord({ dir: parent, now: () => stamp(0), warn: () => undefined });
    rec.begin('question');
    const first = rec.folder();
    assert.ok(first);
    rmSync(parent, { recursive: true, force: true });
    writeFileSync(parent, 'a file where the folder was');
    rec.begin('question');
    assert.equal(rec.folder(), undefined, 'no folder is open for the new question');
    rec.transcript('lost, but not misplaced', undefined);
    assert.equal(existsSync(join(first!, 'transcript.txt')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
