import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { createQuestionRecord, folderName } from '../src/main/record.ts';

const stamp = (seconds: number): Date => new Date(2026, 10, 5, 10, 0, seconds);
const read = (...parts: string[]): string => fs.readFileSync(join(...parts), 'utf8');
const pendingIn = (path: unknown, dir: string): boolean => typeof path === 'string' && dirname(path) === dir && basename(path).startsWith('.pending-question-');
const pendingFolders = (dir: string): string[] => fs.readdirSync(dir).map((name) => join(dir, name)).filter((path) => pendingIn(path, dir));

/** Process-local fault, restored before the next test; every target is a newly owned temp folder. */
function failReport(folder: string, run: () => void, partial: boolean | 'complete' = false): void {
  const original = fs.writeFileSync;
  fs.writeFileSync = (file, data, options) => {
    if (file === join(folder, 'report.json') || (typeof file === 'string' && basename(file) === 'report.json' && pendingIn(dirname(file), dirname(folder)))) {
      if (partial === 'complete') original(file, data, options);
      else if (partial) original(file, '{"recordOrder":');
      throw new Error('synthetic initial report failure');
    }
    return original(file, data, options);
  };
  syncBuiltinESMExports();
  try { run(); } finally { fs.writeFileSync = original; syncBuiltinESMExports(); }
}

for (const partial of [false, true]) {
  test(`a failed initial ${partial ? 'partial ' : ''}report never admits a record before rollback and restart`, () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'tt-record-admission-'));
    try {
      const first = createQuestionRecord({ dir, keep: 2, now: () => stamp(10) });
      first.begin('question'); first.transcript('First accepted question');
      const firstFolder = first.folder()!;
      const failedFolder = join(dir, folderName(stamp(1)));
      const warnings: string[] = [];
      const failed = createQuestionRecord({ dir, keep: 2, now: () => stamp(1), warn: (s) => warnings.push(s) });
      failReport(failedFolder, () => {
        assert.doesNotThrow(() => failed.begin('question'));
        assert.equal(failed.folder(), undefined, 'metadata failure must not expose an active record');
        failed.transcript('This must not be recorded');
      }, partial);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /questions go on as usual/);
      assert.equal(fs.existsSync(failedFolder), false, 'never publish the failed admission');
      assert.deepEqual(pendingFolders(dir), [], 'discard only its newly created staging folder');
      assert.equal(read(firstFolder, 'transcript.txt'), 'First accepted question\n');

      const restarted = createQuestionRecord({ dir, keep: 2, now: () => stamp(2) });
      restarted.begin('question'); restarted.transcript('Second accepted question');
      assert.deepEqual(fs.readdirSync(dir).sort(), [folderName(stamp(2)), folderName(stamp(10))].sort());
      assert.equal(read(firstFolder, 'transcript.txt'), 'First accepted question\n');
      assert.equal(read(restarted.folder()!, 'transcript.txt'), 'Second accepted question\n');
      assert.equal(JSON.parse(read(restarted.folder()!, 'report.json')).recordOrder, 2);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test('failed admission cannot prune prior records, keep the old folder active or accept subsequent payloads', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tt-record-admission-'));
  try {
    let seconds = 10;
    const warnings: string[] = [];
    const rec = createQuestionRecord({ dir, keep: 2, now: () => stamp(seconds), warn: (s) => warnings.push(s) });
    rec.begin('question'); rec.transcript('First'); const first = rec.folder()!;
    seconds = 11;
    rec.begin('question'); rec.transcript('Second'); const second = rec.folder()!;
    const snapshots = new Map([first, second].map((folder) => [folder, fs.readdirSync(folder).map((name) => [name, read(folder, name)])]));
    seconds = 1;
    const failedFolder = join(dir, folderName(stamp(seconds)));
    failReport(failedFolder, () => {
      rec.begin('question');
      rec.begin('detail');
      assert.equal(rec.folder(), undefined);
      assert.equal(rec.nextCall(), 0);
      rec.transcript('Do not append to the old question');
      rec.picture('synthetic', { mime: 'image/png', base64: Buffer.from('fixture').toString('base64') });
      rec.line('log'); rec.voice('voice'); rec.error('error');
      rec.strokes([[[1, 2], [3, 4]]]);
      rec.issues(1, [{ path: 'a', message: 'synthetic issue' }]);
      rec.message({ kind: 'step', step: { say: 'Synthetic', actions: [] } });
      rec.report({ question: 'Do not record' });
    }, true);
    assert.equal(warnings.length, 1, 'repeat failures warn once');
    assert.equal(fs.existsSync(failedFolder), false);
    for (const folder of [first, second]) {
      assert.deepEqual(fs.readdirSync(folder).map((name) => [name, read(folder, name)]), snapshots.get(folder), 'no old record was pruned or modified');
    }

    seconds = 2;
    rec.begin('question'); rec.transcript('Third');
    assert.equal(JSON.parse(read(rec.folder()!, 'report.json')).recordOrder, 3);
    assert.equal(fs.existsSync(first), false, 'normal retention resumes only after successful admission');
    assert.equal(read(second, 'transcript.txt'), 'Second\n');
    assert.equal(read(rec.folder()!, 'transcript.txt'), 'Third\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('failed admission remains inactive and skips pruning when failed-folder cleanup also fails', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tt-record-admission-'));
  const originalRemove = fs.rmSync;
  try {
    const first = createQuestionRecord({ dir, keep: 1, now: () => stamp(10) });
    first.begin('question'); first.transcript('Keep this accepted record');
    const failedFolder = join(dir, folderName(stamp(1)));
    const warnings: string[] = [];
    const failed = createQuestionRecord({ dir, keep: 1, now: () => stamp(1), warn: (s) => warnings.push(s) });
    fs.rmSync = (path, options) => {
      if (path === failedFolder || pendingIn(path, dir)) throw new Error('synthetic cleanup failure');
      return originalRemove(path, options);
    };
    syncBuiltinESMExports();
    failReport(failedFolder, () => failed.begin('question'), true);
    assert.equal(failed.folder(), undefined);
    assert.equal(failed.nextCall(), 0);
    failed.transcript('Not admitted'); failed.report({ question: 'Not admitted' }); failed.line('Not admitted');
    assert.equal(read(first.folder()!, 'transcript.txt'), 'Keep this accepted record\n');
    const [pending] = pendingFolders(dir);
    assert.ok(pending);
    assert.deepEqual(fs.readdirSync(pending), ['report.json']);
    assert.equal(read(pending, 'report.json'), '{"recordOrder":');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /synthetic initial report failure/);
    assert.doesNotMatch(warnings[0]!, /synthetic cleanup failure/);
  } finally {
    fs.rmSync = originalRemove; syncBuiltinESMExports();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


for (const legacy of [false, true]) {
  test(`a complete failed metadata write cannot displace a ${legacy ? 'legacy' : 'numbered'} record after failed cleanup and restart`, () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tt-record-admission-'));
  const originalRemove = fs.rmSync;
  try {
    const first = createQuestionRecord({ dir, keep: 2, now: () => stamp(10) });
    let firstFolder: string;
    if (legacy) {
      firstFolder = join(dir, folderName(stamp(10)));
      fs.mkdirSync(firstFolder); fs.writeFileSync(join(firstFolder, 'transcript.txt'), 'First accepted\n');
    } else {
      first.begin('question'); first.transcript('First accepted'); firstFolder = first.folder()!;
    }
    const failedFolder = join(dir, folderName(stamp(1)));
    const failed = createQuestionRecord({ dir, keep: 2, now: () => stamp(1) });
    fs.rmSync = (path, options) => {
      if (path === failedFolder || pendingIn(path, dir)) throw new Error('synthetic cleanup failure');
      return originalRemove(path, options);
    };
    syncBuiltinESMExports();
    failReport(failedFolder, () => failed.begin('question'), 'complete');
    assert.equal(failed.folder(), undefined);
    failed.transcript('Not accepted');
    assert.equal(fs.existsSync(join(failedFolder, 'transcript.txt')), false);
    fs.rmSync = originalRemove; syncBuiltinESMExports();

    const restarted = createQuestionRecord({ dir, keep: 2, now: () => stamp(2) });
    restarted.begin('question'); restarted.transcript('Second accepted');
    assert.equal(fs.existsSync(firstFolder), true, 'unadmitted metadata cannot displace an accepted record after restart');
    assert.equal(read(firstFolder, 'transcript.txt'), 'First accepted\n');
    assert.equal(read(restarted.folder()!, 'transcript.txt'), 'Second accepted\n');
    assert.equal(JSON.parse(read(restarted.folder()!, 'report.json')).recordOrder, legacy ? 1 : 2);
    assert.equal(fs.existsSync(failedFolder), false);
    assert.equal(pendingFolders(dir).length, 1, 'failed cleanup residue stays outside retention');
  } finally {
    fs.rmSync = originalRemove; syncBuiltinESMExports();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
}

test('failed publication of complete initial metadata does not admit or prune a question', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tt-record-admission-'));
  const originalRename = fs.renameSync;
  try {
    let seconds = 10;
    const warnings: string[] = [];
    const rec = createQuestionRecord({ dir, keep: 1, now: () => stamp(seconds), warn: (s) => warnings.push(s) });
    rec.begin('question'); rec.transcript('Keep until publication succeeds'); const first = rec.folder()!;
    seconds = 1;
    const destination = join(dir, folderName(stamp(seconds)));
    let attempted = 0;
    fs.renameSync = (from, to) => {
      if (pendingIn(from, dir) && to === destination) {
        attempted++;
        assert.equal(JSON.parse(read(String(from), 'report.json')).recordOrder, 2);
        throw new Error('synthetic publication failure');
      }
      return originalRename(from, to);
    };
    syncBuiltinESMExports();
    assert.doesNotThrow(() => rec.begin('question'));
    assert.equal(attempted, 1);
    assert.equal(rec.folder(), undefined);
    rec.transcript('Not published');
    assert.equal(read(first, 'transcript.txt'), 'Keep until publication succeeds\n');
    assert.equal(fs.existsSync(destination), false);
    assert.deepEqual(pendingFolders(dir), []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /synthetic publication failure/);
    fs.renameSync = originalRename; syncBuiltinESMExports();
    rec.begin('question'); rec.transcript('Published');
    assert.equal(rec.folder(), destination);
    assert.equal(fs.existsSync(first), false);
    assert.equal(read(destination, 'transcript.txt'), 'Published\n');
  } finally {
    fs.renameSync = originalRename; syncBuiltinESMExports();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
