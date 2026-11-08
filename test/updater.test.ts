import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { createUpdater, isNewer, parseVersion, readRelease, sumFor, trayLine, viewOf, type UpdaterOptions, type UpdateStatus } from '../src/main/updater.ts';

// A fake release server on a loopback port: nothing here reaches GitHub.
type Fake = { server: Server; base: string; hits: string[]; set(over: Partial<Setup>): void; close(): Promise<void> };
type Setup = { tag: string; installer: Buffer; sums: 'good' | 'bad' | 'missing'; sizeLie: number; api: number; prerelease: boolean; draft: boolean; foreignUrl: boolean; slow: boolean };

const hex = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

async function fake(): Promise<Fake> {
  const state: Setup = { tag: 'v2.0.0', installer: Buffer.from('MZ pretend installer '.repeat(500)), sums: 'good', sizeLie: 0, api: 200, prerelease: false, draft: false, foreignUrl: false, slow: false };
  const hits: string[] = [];
  const server = createServer((req, res) => {
    const url = req.url ?? '';
    hits.push(url);
    const name = `Talkthrough-Setup-${state.tag.replace(/^v/, '')}.exe`;
    if (url === '/repos/ProjectIdris/talkthrough/releases/latest') {
      if (state.api !== 200) { res.writeHead(state.api, { 'content-type': 'application/json' }).end('{"message":"no"}'); return; }
      const downloads = state.foreignUrl ? 'http://127.0.0.1:1/elsewhere/' : `${base}/download/`;
      const assets = [{ name, size: state.installer.length + state.sizeLie, browser_download_url: `${downloads}${name}` }];
      if (state.sums !== 'missing') assets.push({ name: 'SHA256SUMS.txt', size: 100, browser_download_url: `${downloads}SHA256SUMS.txt` });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ tag_name: state.tag, draft: state.draft, prerelease: state.prerelease, html_url: 'https://github.com/ProjectIdris/talkthrough/releases/tag/' + state.tag, assets }));
      return;
    }
    if (url === '/download/SHA256SUMS.txt') {
      const h = state.sums === 'bad' ? '0'.repeat(64) : hex(state.installer);
      res.writeHead(200, { 'content-type': 'text/plain' }).end(`${h}  ${name}\n${'1'.repeat(64)}  other.zip\n`);
      return;
    }
    if (url === `/download/${name}`) {
      const body = state.installer;
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      if (state.slow) { res.write(body.subarray(0, 100)); setTimeout(() => res.end(body.subarray(100)), 150); } else res.end(body);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { server, base, hits, set: (over) => Object.assign(state, over), close: () => new Promise<void>((ok) => { server.closeAllConnections(); server.close(() => ok()); }) };
}

const dirs: string[] = [];
const servers: Fake[] = [];
after(async () => {
  for (const s of servers) await s.close();
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function rig(over: Partial<UpdaterOptions> = {}, current = '1.0.0') {
  const f = await fake();
  servers.push(f);
  const dir = await mkdtemp(join(tmpdir(), 'tt-updater-'));
  dirs.push(dir);
  const ran: string[] = [];
  const seen: UpdateStatus[] = [];
  let quits = 0;
  const updater = createUpdater({
    current, dir: join(dir, 'updates'), enabled: () => true, busy: () => false,
    runInstaller: (file) => { ran.push(file); }, quit: () => { quits++; },
    onChange: (s) => seen.push(s),
    api: `${f.base}/repos/ProjectIdris/talkthrough/releases/latest`, downloads: `${f.base}/download/`, allowInsecure: true, timeoutMs: 3000,
    ...over,
  });
  return { f, dir, updater, ran, seen, quits: () => quits };
}

describe('versions and checksum lines', () => {
  it('reads plain versions and orders them', () => {
    assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
    assert.equal(parseVersion('1.2'), null);
    assert.equal(parseVersion('1.2.3-beta.1'), null);
    assert.equal(parseVersion('latest'), null);
    assert.equal(isNewer('1.0.1', '1.0.0'), true);
    assert.equal(isNewer('v1.10.0', '1.9.9'), true);
    assert.equal(isNewer('1.0.0', '1.0.0'), false);
    assert.equal(isNewer('0.9.9', '1.0.0'), false);
    assert.equal(isNewer('2.0.0-rc1', '1.0.0'), false);
  });
  it('finds the line for the installer by exact name only', () => {
    const h = 'a'.repeat(64), g = 'B'.repeat(64);
    const text = `${h}  Talkthrough-Setup-2.0.0.exe.blockmap\r\n${g} *Talkthrough-Setup-2.0.0.exe\r\n`;
    assert.equal(sumFor(text, 'Talkthrough-Setup-2.0.0.exe'), 'b'.repeat(64));
    assert.equal(sumFor(text, 'Talkthrough-Setup-2.0.1.exe'), undefined);
    assert.equal(sumFor('short  Talkthrough-Setup-2.0.0.exe', 'Talkthrough-Setup-2.0.0.exe'), undefined);
  });
  it('accepts only a release whose installer and checksum file come from the release address', () => {
    const base = 'https://github.com/ProjectIdris/talkthrough/releases/download/';
    const good = { tag_name: 'v1.2.0', assets: [
      { name: 'Talkthrough-Setup-1.2.0.exe', size: 10, browser_download_url: `${base}v1.2.0/Talkthrough-Setup-1.2.0.exe` },
      { name: 'SHA256SUMS.txt', size: 10, browser_download_url: `${base}v1.2.0/SHA256SUMS.txt` }] };
    assert.equal(readRelease(good, base)?.installer, 'Talkthrough-Setup-1.2.0.exe');
    assert.equal(readRelease({ ...good, prerelease: true }, base), null);
    assert.equal(readRelease({ ...good, tag_name: 'v1.3.0' }, base), null, 'the installer name must carry the tag version');
    assert.equal(readRelease({ ...good, assets: [{ ...good.assets[0]!, browser_download_url: 'https://example.com/x.exe' }, good.assets[1]] }, base), null);
    assert.equal(readRelease({ ...good, assets: [good.assets[0]] }, base), null, 'no checksum file, no update');
  });
});

describe('the release checksum file', () => {
  it('is written in the form the updater reads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tt-sums-'));
    dirs.push(dir);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'Talkthrough-Setup-3.1.4.exe'), 'bytes of an installer');
    // @ts-expect-error a plain script, no declaration file
    const { writeSums } = await import('../scripts/release-sums.mjs');
    const { file, hash } = writeSums(dir, 'Talkthrough-Setup-3.1.4.exe');
    assert.equal(hash, hex(Buffer.from('bytes of an installer')));
    assert.equal(sumFor(await readFile(file, 'utf8'), 'Talkthrough-Setup-3.1.4.exe'), hash);
  });
});

describe('checking', () => {
  it('says a newer release is there, and only says it', async () => {
    const { updater, f, ran, quits } = await rig();
    const s = await updater.check();
    assert.equal(s.kind, 'available');
    assert.equal(s.kind === 'available' && s.release.version, '2.0.0');
    assert.equal(f.hits.length, 1, 'one request, no download');
    assert.deepEqual(ran, []);
    assert.equal(quits(), 0);
  });
  it('stays idle when the release is the same, older, a pre-release or a draft', async () => {
    for (const set of [{ tag: 'v1.0.0' }, { tag: 'v0.9.0' }, { prerelease: true }, { draft: true }, { sums: 'missing' as const }]) {
      const { updater, f } = await rig();
      f.set(set);
      assert.equal((await updater.check()).kind, 'idle', JSON.stringify(set));
    }
  });
  it('fails quietly when the server is gone, rate limits, answers an error, or sends rubbish', async () => {
    const { updater, f } = await rig();
    for (const api of [403, 429, 500, 404]) {
      f.set({ api });
      assert.equal((await updater.check()).kind, 'idle', `status ${api}`);
    }
    await f.close();
    assert.equal((await updater.check()).kind, 'idle', 'refused connection');
    const noServer = await rig({ fetch: async () => new Response('<html>not json</html>') });
    assert.equal((await noServer.updater.check()).kind, 'idle');
  });
  it('keeps an offered update when a later check fails', async () => {
    const { updater, f } = await rig();
    assert.equal((await updater.check()).kind, 'available');
    f.set({ api: 429 });
    assert.equal((await updater.check()).kind, 'available');
  });
  it('makes no request when checks are off or an answer is under way, until the person asks', async () => {
    let on = false;
    const { updater, f } = await rig({ enabled: () => on });
    assert.equal((await updater.check()).kind, 'idle');
    assert.equal(f.hits.length, 0, 'off: no request');
    assert.equal((await updater.check(true)).kind, 'available', 'a person asking checks even when automatic checks are off');
    on = true;
    let busy = true;
    const b = await rig({ busy: () => busy, busyRetryMs: 30 });
    assert.equal((await b.updater.check()).kind, 'idle');
    assert.equal(b.f.hits.length, 0, 'busy: no request');
    busy = false;
    await new Promise((ok) => setTimeout(ok, 150));
    assert.equal(b.updater.status().kind, 'available', 'the check is retried when the answer is over');
    b.updater.stop();
  });
  it('refuses a plain http address outside tests', async () => {
    const { updater, f } = await rig({ allowInsecure: false });
    assert.equal((await updater.check()).kind, 'idle');
    assert.equal(f.hits.length, 0);
  });
  it('clears an installer left by an earlier update when it starts', async () => {
    const { updater, dir } = await rig({ startDelayMs: 60_000 });
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(dir, 'updates'), { recursive: true });
    await writeFile(join(dir, 'updates', 'Talkthrough-Setup-1.0.0.exe'), 'old');
    updater.start();
    await new Promise((ok) => setTimeout(ok, 60));
    updater.stop();
    assert.deepEqual((await readdir(dir)).includes('updates'), false);
  });
  it('checks on start and then on its interval, and stops when told', async () => {
    const { updater, f } = await rig({ startDelayMs: 10, intervalMs: 60 });
    updater.start();
    await new Promise((ok) => setTimeout(ok, 250));
    updater.stop();
    await new Promise((ok) => setTimeout(ok, 40));
    const n = f.hits.length;
    assert.ok(n >= 2, `expected at least two checks, saw ${n}`);
    await new Promise((ok) => setTimeout(ok, 150));
    assert.equal(f.hits.length, n, 'no checks after stop');
  });
});

describe('installing', () => {
  it('downloads, checks the installer against the release checksum, runs it and quits', async () => {
    const { updater, dir, ran, quits, seen } = await rig();
    await updater.check();
    const s = await updater.install();
    assert.equal(s.kind, 'installing');
    assert.equal(ran.length, 1);
    assert.equal(quits(), 1);
    assert.equal(hex(await readFile(ran[0]!)), hex(Buffer.from('MZ pretend installer '.repeat(500))));
    assert.equal(ran[0], join(dir, 'updates', 'Talkthrough-Setup-2.0.0.exe'));
    assert.ok(seen.some((x) => x.kind === 'downloading'));
    assert.deepEqual(await readdir(join(dir, 'updates')), ['Talkthrough-Setup-2.0.0.exe']);
  });
  it('does not run an installer that does not match its checksum, and deletes it', async () => {
    const { updater, f, dir, ran, quits } = await rig();
    f.set({ sums: 'bad' });
    await updater.check();
    const s = await updater.install();
    assert.equal(s.kind, 'failed');
    assert.match(s.kind === 'failed' ? s.message : '', /checksum/);
    assert.deepEqual(ran, []);
    assert.equal(quits(), 0);
    assert.deepEqual(await readdir(join(dir, 'updates')), []);
  });
  it('does not run an installer of the wrong size', async () => {
    const { updater, f, dir, ran } = await rig();
    f.set({ sizeLie: 5 });
    await updater.check();
    assert.equal((await updater.install()).kind, 'failed');
    assert.deepEqual(ran, []);
    assert.deepEqual(await readdir(join(dir, 'updates')), []);
    f.set({ sizeLie: -5 });
    await updater.check(true);
    assert.equal((await updater.install()).kind, 'failed', 'bigger than announced');
    assert.deepEqual(ran, []);
  });
  it('can be retried after a failure', async () => {
    const { updater, f, ran } = await rig();
    f.set({ sums: 'bad' });
    await updater.check();
    assert.equal((await updater.install()).kind, 'failed');
    f.set({ sums: 'good' });
    assert.equal((await updater.install()).kind, 'installing');
    assert.equal(ran.length, 1);
  });
  it('does nothing while a question is being asked or answered', async () => {
    let busy = false;
    const { updater, f, ran, quits } = await rig({ busy: () => busy });
    await updater.check();
    busy = true;
    const before = f.hits.length;
    const s = await updater.install();
    assert.equal(s.kind, 'failed');
    assert.equal(f.hits.length, before, 'no download');
    assert.deepEqual(ran, []);
    assert.equal(quits(), 0);
    busy = false;
    assert.equal((await updater.install()).kind, 'installing');
    assert.equal(ran.length, 1);
  });
  it('does not run it if an answer begins while it downloads', async () => {
    let busy = false;
    const { updater, f, ran, quits } = await rig({ busy: () => busy });
    f.set({ slow: true });
    await updater.check();
    const done = updater.install();
    await new Promise((ok) => setTimeout(ok, 40));
    busy = true;
    assert.equal((await done).kind, 'failed');
    assert.deepEqual(ran, []);
    assert.equal(quits(), 0);
  });
  it('offers nothing to install when nothing is offered', async () => {
    const { updater, f, ran } = await rig();
    f.set({ tag: 'v1.0.0' });
    await updater.check();
    assert.equal((await updater.install()).kind, 'idle');
    assert.deepEqual(ran, []);
    assert.equal(f.hits.length, 1);
  });
});

describe('what the tray and the settings window are told', () => {
  const release = { version: '2.0.0', tag: 'v2.0.0', page: 'https://github.com/ProjectIdris/talkthrough/releases/tag/v2.0.0', installer: 'Talkthrough-Setup-2.0.0.exe', bytes: 200, url: 'u', sumsUrl: 's' };
  it('says nothing in the tray until there is something to say, and never offers a click while it works', () => {
    assert.equal(trayLine({ kind: 'idle', current: '1.0.0' }), null);
    assert.equal(trayLine({ kind: 'checking', current: '1.0.0' }), null);
    assert.deepEqual(trayLine({ kind: 'available', current: '1.0.0', release }), { label: 'Update available: Talkthrough 2.0.0…', enabled: true });
    const downloading = trayLine({ kind: 'downloading', current: '1.0.0', release, received: 50, total: 200 });
    assert.equal(downloading?.enabled, false);
    assert.match(downloading?.label ?? '', /25%/);
    assert.equal(trayLine({ kind: 'installing', current: '1.0.0', release })?.enabled, false);
    assert.equal(trayLine({ kind: 'failed', current: '1.0.0', release, message: 'x' })?.enabled, true);
  });
  it('gives the page the version, the release page, the progress and the reason it failed', () => {
    assert.deepEqual(viewOf({ kind: 'idle', current: '1.0.0', checkedAt: 5 }), { kind: 'idle', current: '1.0.0', checkedAt: 5 });
    assert.deepEqual(viewOf({ kind: 'downloading', current: '1.0.0', release, received: 50, total: 200 }), { kind: 'downloading', current: '1.0.0', version: '2.0.0', page: release.page, received: 50, total: 200 });
    assert.equal(viewOf({ kind: 'failed', current: '1.0.0', release, message: 'no' }).message, 'no');
    assert.equal('url' in viewOf({ kind: 'available', current: '1.0.0', release }), false, 'the page is not handed the download address');
  });
});
