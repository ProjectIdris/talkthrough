import test from 'node:test';
import assert from 'node:assert/strict';
import { HELPER_ENCODED_MAX, HELPER_READ_SOURCE, HELPER_SOURCE, createHelper } from '../src/main/ps-helper.ts';
import { PS_PRELUDE } from '../src/main/ps-prelude.ts';
import { fakeChild } from './support/fake-helper-child.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('answers are matched to their requests by id, in whatever order they come, and chatter on the output is ignored', async () => {
  const child = fakeChild((r) => (r.op === 'slow' ? undefined : { ok: true, echo: r.n }));
  const helper = createHelper({ start: () => child })!;
  const slow = helper.request({ op: 'slow', n: 1 }, { timeoutMs: 1000 });
  const fast = helper.request({ op: 'read', n: 2 }, { timeoutMs: 1000 });
  child.say('some words PowerShell wrote\r\n{"not":"an answer for us"}\r\n');
  assert.equal((await fast).body?.echo, 2);
  child.say(`${JSON.stringify({ id: child.requests[0]!.id, ok: true, echo: 1 })}\n`);
  assert.equal((await slow).body?.echo, 1);
  helper.stop();
});

test('nothing is started until something asks, and one child serves every request', async () => {
  let started = 0;
  const helper = createHelper({ start: () => { started++; return fakeChild(() => ({ ok: true })); } })!;
  assert.equal(started, 0);
  await helper.request({ op: 'read' }, { timeoutMs: 1000 });
  await helper.request({ op: 'read' }, { timeoutMs: 1000 });
  await helper.request({ op: 'nav' }, { timeoutMs: 1000 });
  assert.equal(started, 1, 'the child is started once and kept');
  helper.stop();
});

test('a request that is not answered in time stops the child (it may be stuck) and the next request starts a fresh one', async () => {
  const children: Array<ReturnType<typeof fakeChild>> = [];
  const helper = createHelper({ startupMs: 0, start: () => { const c = fakeChild(() => (children.length === 1 ? undefined : { ok: true })); children.push(c); return c; } })!;
  const r = await helper.request({ op: 'read' }, { timeoutMs: 30 });
  assert.equal(r.why, 'timed out');
  assert.equal(children[0]!.killed, 1);
  const again = await helper.request({ op: 'read' }, { timeoutMs: 1000 });
  assert.equal(again.body?.ok, true);
  assert.equal(children.length, 2, 'a new child answered');
  helper.stop();
});

test('the first request has the start itself added to its time; a cancelled request answers at once and its late answer is dropped', async () => {
  const slowStart = createHelper({ startupMs: 400, start: () => fakeChild(() => undefined) })!;
  const t = Date.now();
  const r = await slowStart.request({ op: 'read' }, { timeoutMs: 50 });
  assert.equal(r.why, 'timed out');
  assert.ok(Date.now() - t >= 400, 'it waited for the start as well');
  const child = fakeChild(() => undefined);
  const helper = createHelper({ start: () => child })!;
  const abort = new AbortController();
  const pending = helper.request({ op: 'read' }, { timeoutMs: 5000, signal: abort.signal });
  abort.abort();
  assert.equal((await pending).why, 'cancelled');
  child.say(`${JSON.stringify({ id: child.requests[0]!.id, ok: true })}\n`); // late
  assert.equal((await helper.request({ op: 'read' }, { timeoutMs: 20, signal: AbortSignal.abort() })).why, 'cancelled', 'an already cancelled request never reaches the child');
  assert.equal(child.requests.length, 1);
  helper.stop();
});

test('a child that ends fails what it was asked, and the next request starts a new one; stopping the helper ends the child', async () => {
  const kids: Array<ReturnType<typeof fakeChild>> = [];
  const helper = createHelper({ start: () => { const c = fakeChild(() => undefined); kids.push(c); return c; } })!;
  const pending = helper.request({ op: 'read' }, { timeoutMs: 5000 });
  kids[0]!.die();
  assert.equal((await pending).why, 'failed');
  void helper.request({ op: 'read' }, { timeoutMs: 20 });
  assert.equal(kids.length, 2);
  helper.stop();
  assert.equal(kids[1]!.killed, 1);
  await wait(30);
});

test('the helper compiles nothing and writes nothing: user32 through an in-memory assembly, no Add-Type of C#, no temp file, no download', () => {
  for (const banned of ['Add-Type -TypeDefinition', 'Add-Type -MemberDefinition', 'Add-Type -Path', 'csc', 'Out-File', 'Set-Content', 'Invoke-Expression', 'Invoke-WebRequest', 'Start-Process', 'New-Item', 'Register-', 'Net.WebClient']) {
    assert.ok(!HELPER_SOURCE.includes(banned), `the helper must not contain ${banned}`);
  }
  assert.ok(PS_PRELUDE.includes('DefineDynamicAssembly'));
});

test('the helper looks at a window\'s class before any call to the accessibility API, and the classes it skips are the browser engines\'', () => {
  const prelude = PS_PRELUDE;
  for (const cls of ['Chrome_', 'MozillaWindowClass', 'Qt', 'CefBrowser']) assert.ok(prelude.includes(cls), cls);
  // Both entry points check before touching UI Automation.
  const read = HELPER_SOURCE.slice(HELPER_SOURCE.indexOf('function Read-Controls'));
  assert.ok(read.indexOf('Has-Browser') > 0 && read.indexOf('Has-Browser') < read.indexOf('::FromHandle'));
  const nav = HELPER_SOURCE.slice(HELPER_SOURCE.indexOf('function Invoke-Nav'));
  assert.ok(nav.indexOf('Has-Browser') > 0 && nav.indexOf('Has-Browser') < nav.indexOf('::FromPoint'));
  const re = new RegExp(/\$browserClass = '(.*)'/.exec(prelude)![1]!);
  for (const c of ['Chrome_WidgetWin_1', 'Chrome_WidgetWin_0', 'Chrome_RenderWidgetHostHWND', 'MozillaWindowClass', 'Qt5152QWindowIcon', 'Qt623QWindowIcon', 'CefBrowserWindow']) assert.ok(re.test(c), c);
  for (const c of ['Notepad', 'CabinetWClass', 'HwndWrapper[tt.exe;;1234]', 'WindowsForms10.Window.8.app', 'ApplicationFrameWindow', '#32770']) assert.ok(!re.test(c), c);
});

test('the helper travels on the command line, which Windows limits to 32,767 characters: both forms stay under the cap', () => {
  for (const [name, source] of [['reading only', HELPER_READ_SOURCE], ['with navigation', HELPER_SOURCE]] as const) {
    const length = Buffer.from(source, 'utf16le').toString('base64').length;
    assert.ok(length < HELPER_ENCODED_MAX, `${name}: ${length} characters encoded, the cap is ${HELPER_ENCODED_MAX}`);
  }
});

test('the helper that only reads holds no verb at all: no select, expand, scroll or navigation function', () => {
  for (const verb of ['function Invoke-Nav', 'SelectionItemPattern', 'ExpandCollapsePattern', 'ScrollPattern', '.Select(', '.Expand(', '.Scroll(']) {
    assert.ok(!HELPER_READ_SOURCE.includes(verb), `the reading helper must not contain ${verb}`);
  }
  assert.ok(HELPER_SOURCE.includes('function Invoke-Nav'));
});
