// Keeping Talkthrough up to date, quietly and only with the person's yes.
//
// On start and once a day the app asks GitHub for the latest release of the project. If it is newer than the running version the app says so
// (the tray and the settings window show it) and does nothing else. On the person's yes it downloads that release's installer, checks it
// against the release's SHA256SUMS.txt, runs it silently and quits so the installer can replace the app and start it again.
//
// Quiet by design: no network, a rate limit, a bad answer or a missing release leave the app exactly as it was. Nothing here runs while a
// question is being asked or answered (`busy`), a setting turns the checks off, and no new dependency is used (Node's own fetch, crypto and fs).
// Nothing is run that has not matched its published checksum, and only an installer with the expected name from the project's own release
// address is downloaded.

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { UpdateView } from '../shared/ipc.ts';

export const RELEASES_API = 'https://api.github.com/repos/ProjectIdris/talkthrough/releases/latest';
export const RELEASE_DOWNLOADS = 'https://github.com/ProjectIdris/talkthrough/releases/download/';
export const SUMS_NAME = 'SHA256SUMS.txt';
const INSTALLER_NAME = /^Talkthrough-Setup-(\d+)\.(\d+)\.(\d+)\.exe$/;
/** Larger than any installer we ship by a wide margin; a download past this is not ours. */
const MAX_INSTALLER_BYTES = 600 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export type Release = { version: string; tag: string; page: string; installer: string; bytes: number; url: string; sumsUrl: string };

export type UpdateStatus =
  | { kind: 'idle'; current: string; checkedAt?: number }
  | { kind: 'checking'; current: string }
  | { kind: 'available'; current: string; release: Release }
  | { kind: 'downloading'; current: string; release: Release; received: number; total: number }
  | { kind: 'installing'; current: string; release: Release }
  | { kind: 'failed'; current: string; release: Release; message: string };

export class UpdateError extends Error {
  readonly code: 'offline' | 'rate-limited' | 'bad-release' | 'wrong-file' | 'busy' | 'aborted';
  constructor(code: UpdateError['code'], message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UpdateError';
    this.code = code;
  }
}

export type UpdaterOptions = {
  /** The version that is running. */
  current: string;
  /** Where downloads are kept (inside the app's data folder). */
  dir: string;
  /** The setting: false turns the automatic checks off. Read at each check, so a change applies at once. */
  enabled(): boolean;
  /** True while a question is being asked, answered or walked through. Nothing is checked, downloaded or run then. */
  busy(): boolean;
  /** Runs the downloaded installer, silent, apart from this process. */
  runInstaller(file: string): void;
  /** Quits the app so the installer can replace it. */
  quit(): void;
  onChange?(status: UpdateStatus): void;
  /** Tests point these at a local fake release server. */
  api?: string;
  /** The address prefix downloads must start with. */
  downloads?: string;
  fetch?: typeof fetch;
  /** Tests only: allow plain http (a loopback server). */
  allowInsecure?: boolean;
  startDelayMs?: number;
  intervalMs?: number;
  busyRetryMs?: number;
  timeoutMs?: number;
  now?(): number;
};

/** `1.2.3`, or `v1.2.3`, as three numbers; anything else (a pre-release, a word) is not a version we offer. */
export function parseVersion(text: string): [number, number, number] | null {
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

/** The hash for `name` in a `sha256sum` style file (`<64 hex>  <name>`, a leading `*` marks binary mode), or undefined. */
export function sumFor(text: string, name: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64}) [ *]?(.+?)\s*$/.exec(line);
    if (m && m[2] === name) return m[1]!.toLowerCase();
  }
  return undefined;
}

/** Reads the release answer into what we need, or null when it is not a release we would install. */
export function readRelease(json: unknown, downloads: string, sums = SUMS_NAME): Release | null {
  if (typeof json !== 'object' || json === null) return null;
  const r = json as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true || typeof r.tag_name !== 'string') return null;
  const v = parseVersion(r.tag_name);
  if (!v || !Array.isArray(r.assets)) return null;
  const version = v.join('.');
  const wanted = `Talkthrough-Setup-${version}.exe`;
  let installer: { size: number; url: string } | undefined, sumsUrl: string | undefined;
  for (const a of r.assets as unknown[]) {
    if (typeof a !== 'object' || a === null) continue;
    const asset = a as Record<string, unknown>;
    if (typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string' || !asset.browser_download_url.startsWith(downloads)) continue;
    if (asset.name === wanted && typeof asset.size === 'number' && Number.isInteger(asset.size) && asset.size > 0 && asset.size <= MAX_INSTALLER_BYTES) installer = { size: asset.size, url: asset.browser_download_url };
    if (asset.name === sums) sumsUrl = asset.browser_download_url;
  }
  if (!installer || !sumsUrl) return null;
  const page = typeof r.html_url === 'string' && r.html_url.startsWith('https://github.com/ProjectIdris/talkthrough/') ? r.html_url : 'https://github.com/ProjectIdris/talkthrough/releases';
  return { version, tag: r.tag_name, page, installer: wanted, bytes: installer.size, url: installer.url, sumsUrl };
}

export function createUpdater(options: UpdaterOptions) {
  const api = options.api ?? RELEASES_API;
  const downloads = options.downloads ?? RELEASE_DOWNLOADS;
  const doFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const secure = (url: string): boolean => url.startsWith('https://') || (options.allowInsecure === true && url.startsWith('http://'));

  let status: UpdateStatus = { kind: 'idle', current: options.current };
  let checkedAt: number | undefined;
  let working = false;
  let stopped = false;
  let first: NodeJS.Timeout | undefined, every: NodeJS.Timeout | undefined, retry: NodeJS.Timeout | undefined;
  let lastPercent = -1;

  const set = (next: UpdateStatus): void => {
    status = next;
    options.onChange?.(next);
  };
  const idle = (): UpdateStatus => ({ kind: 'idle', current: options.current, ...(checkedAt !== undefined ? { checkedAt } : {}) });

  async function get(url: string, accept: string): Promise<Response> {
    if (!secure(url)) throw new UpdateError('bad-release', 'The address is not https.');
    let response: Response;
    try {
      response = await doFetch(url, { redirect: 'follow', headers: { accept, 'user-agent': `Talkthrough/${options.current}` }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new UpdateError('offline', 'Could not reach the release page.', { cause: error });
    }
    if (response.url && !secure(response.url)) throw new UpdateError('wrong-file', 'The download was sent somewhere that is not https.');
    if (response.status === 403 || response.status === 429) throw new UpdateError('rate-limited', 'GitHub is asking for a pause.');
    if (!response.ok) throw new UpdateError('offline', `The release page answered ${response.status}.`);
    return response;
  }

  async function text(response: Response): Promise<string> {
    const body = await response.text();
    if (body.length > MAX_TEXT_BYTES) throw new UpdateError('bad-release', 'The answer was larger than expected.');
    return body;
  }

  /** The latest release when it is newer than the running version, or null. Throws UpdateError. */
  async function latest(): Promise<Release | null> {
    const response = await get(api, 'application/vnd.github+json');
    let json: unknown;
    try { json = JSON.parse(await text(response)); } catch (error) {
      if (error instanceof UpdateError) throw error;
      throw new UpdateError('bad-release', 'The release answer could not be read.', { cause: error });
    }
    const release = readRelease(json, downloads);
    if (!release || !isNewer(release.version, options.current)) return null;
    return release;
  }

  /** Looks for a newer release. Quiet: any failure leaves the status as it was. An automatic call (not `manual`) does nothing when checks are off or an answer is under way. */
  async function check(manual = false): Promise<UpdateStatus> {
    if (working || stopped) return status;
    if (!manual && !options.enabled()) return status;
    if (!manual && options.busy()) {
      clearTimeout(retry);
      retry = setTimeout(() => void check(false), options.busyRetryMs ?? 5 * 60_000);
      retry.unref?.();
      return status;
    }
    working = true;
    const before = status;
    if (status.kind === 'idle') set({ kind: 'checking', current: options.current });
    try {
      const release = await latest();
      checkedAt = now();
      set(release ? { kind: 'available', current: options.current, release } : idle());
    } catch {
      checkedAt = now();
      set(before.kind === 'available' || before.kind === 'failed' ? before : idle());
    } finally {
      working = false;
    }
    return status;
  }

  /** Downloads the offered installer, checks it against the release's SHA256SUMS.txt, runs it and quits. The caller has the person's yes. */
  async function install(): Promise<UpdateStatus> {
    if (working) return status;
    const release = status.kind === 'available' || status.kind === 'failed' ? status.release : undefined;
    if (!release) return status;
    if (options.busy()) {
      set({ kind: 'failed', current: options.current, release, message: 'Talkthrough is busy with a question. Try again when the answer is finished.' });
      return status;
    }
    working = true;
    lastPercent = -1;
    let file: string | undefined;
    try {
      file = await download(release);
      if (options.busy()) throw new UpdateError('busy', 'Talkthrough is busy with a question. Try again when the answer is finished.');
      set({ kind: 'installing', current: options.current, release });
      options.runInstaller(file);
      options.quit();
    } catch (error) {
      if (file) await rm(file, { force: true });
      set({ kind: 'failed', current: options.current, release, message: error instanceof UpdateError ? error.message : 'The update could not be installed.' });
    } finally {
      working = false;
    }
    return status;
  }

  async function download(release: Release): Promise<string> {
    await mkdir(options.dir, { recursive: true });
    for (const name of await readdir(options.dir)) await rm(join(options.dir, name), { force: true, recursive: true });
    set({ kind: 'downloading', current: options.current, release, received: 0, total: release.bytes });
    const sums = sumFor(await text(await get(release.sumsUrl, 'text/plain')), release.installer);
    if (!sums) throw new UpdateError('wrong-file', 'The release has no checksum for its installer, so it was not downloaded.');
    const response = await get(release.url, 'application/octet-stream');
    if (!response.body) throw new UpdateError('offline', 'The download was empty.');
    const final = join(options.dir, release.installer);
    const part = `${final}.part`;
    const hash = createHash('sha256');
    let received = 0;
    const out = createWriteStream(part);
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > release.bytes) throw new UpdateError('wrong-file', 'The download is bigger than expected, so it was not kept.');
        hash.update(value);
        if (!out.write(value)) await new Promise<void>((ok) => out.once('drain', ok));
        const percent = Math.floor((received / release.bytes) * 100);
        if (percent !== lastPercent) {
          lastPercent = percent;
          set({ kind: 'downloading', current: options.current, release, received, total: release.bytes });
        }
      }
      await new Promise<void>((ok, bad) => {
        out.once('error', bad);
        out.end(ok);
      });
    } catch (error) {
      out.destroy();
      await rm(part, { force: true });
      if (error instanceof UpdateError) throw error;
      throw new UpdateError('offline', 'The download was cut off. Try again.', { cause: error });
    }
    if (received !== release.bytes || hash.digest('hex') !== sums) {
      await rm(part, { force: true });
      throw new UpdateError('wrong-file', 'The download did not match its published checksum, so it was not kept or run.');
    }
    await rename(part, final);
    return final;
  }

  function start(): void {
    stopped = false;
    // An installer left from an earlier update (this app was started by it, or the person declined) is not kept.
    void rm(options.dir, { recursive: true, force: true }).catch(() => undefined);
    clearTimeout(first);
    clearInterval(every);
    first = setTimeout(() => void check(false), options.startDelayMs ?? 20_000);
    every = setInterval(() => void check(false), options.intervalMs ?? 24 * 60 * 60_000);
    first.unref?.();
    every.unref?.();
  }

  function stop(): void {
    stopped = true;
    clearTimeout(first);
    clearInterval(every);
    clearTimeout(retry);
  }

  return { status: (): UpdateStatus => status, check, install, start, stop };
}

export type Updater = ReturnType<typeof createUpdater>;

/** What the settings page is shown. */
export function viewOf(status: UpdateStatus): UpdateView {
  const view: UpdateView = { kind: status.kind, current: status.current };
  if (status.kind === 'idle' && status.checkedAt !== undefined) view.checkedAt = status.checkedAt;
  if (status.kind === 'checking' || status.kind === 'idle') return view;
  view.version = status.release.version;
  view.page = status.release.page;
  if (status.kind === 'downloading') { view.received = status.received; view.total = status.total; }
  if (status.kind === 'failed') view.message = status.message;
  return view;
}

/** The one line the tray menu shows about updates, or null when there is nothing to say (idle, checking). */
export function trayLine(status: UpdateStatus): { label: string; enabled: boolean } | null {
  switch (status.kind) {
    case 'available': return { label: `Update available: Talkthrough ${status.release.version}…`, enabled: true };
    case 'downloading': return { label: `Downloading Talkthrough ${status.release.version}… ${Math.floor((status.received / Math.max(1, status.total)) * 100)}%`, enabled: false };
    case 'installing': return { label: `Installing Talkthrough ${status.release.version}…`, enabled: false };
    case 'failed': return { label: `Update to ${status.release.version} did not finish: try again…`, enabled: true };
    default: return null;
  }
}
