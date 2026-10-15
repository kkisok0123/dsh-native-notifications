import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desktopText, notificationForEvent, createDesktopSender, registerNotifications, foregroundAwareSender, registerPresence } from './index.js';
import { createPresence } from './presence.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const session = { id: 'test-conversation', header: {} };
const end = (kind) => ({ type: 'turn/end', data: { reason: { kind } } });
test('only successful top-level turn endings notify', () => {
  assert.match(notificationForEvent(session, end('completed')).title, /finished/);
  for (const kind of ['aborted', 'interrupted', 'error', 'max-tokens', 'blocked', 'forked']) {
    assert.equal(notificationForEvent(session, end(kind)), undefined);
  }
  assert.equal(notificationForEvent({ ...session, header: { origin: 'subagent' } }, end('completed')), undefined);
  assert.equal(notificationForEvent(session, { type: 'tool/result' }), undefined);
});
test('untrusted desktop text is bounded and markup escaped', () => {
  assert.equal(desktopText('<b> A & B </b>'), '&lt;b&gt; A &amp; B &lt;/b&gt;');
  assert.equal(desktopText('x'.repeat(500)).length, 240);
});
test('sender uses argument array, contains errors, and cleans up', () => {
  let args, callback, killed = 0;
  const warnings = [];
  const sender = createDesktopSender((file, argv, options, cb) => {
    assert.equal(file, 'notify-send');
    assert.equal(options.timeout, 5000);
    args = argv; callback = cb;
    return { kill() { killed++; } };
  }, (warning) => warnings.push(warning));
  sender.send({ title: 'Hello', body: '$(touch /tmp/nope)', attention: true });
  assert.ok(args.includes('--urgency=critical'));
  assert.equal(args.at(-1), '$(touch /tmp/nope)');
  callback(new Error('service unavailable'));
  assert.equal(warnings.length, 1);
  sender.send({ title: 'Next', body: '' });
  sender.dispose();
  assert.equal(killed, 1);
  sender.send({ title: 'Ignored' });
  assert.equal(killed, 1);
});
test('question and approval hooks delegate unchanged, skip aborted requests', async () => {
  const handlers = new Map(), sent = [];
  registerNotifications({ on(name, handler, options) {
    handlers.set(name, handler);
    if (name !== 'session/event') assert.equal(options.prepend, true);
  } }, { send(value) { sent.push(value); } });
  let called = 0;
  const next = async () => { called++; return 'answer'; };
  assert.equal(await handlers.get('user-questions/request')({ questions: [{ question: 'Which option?' }] }, next), 'answer');
  assert.equal(await handlers.get('approval/request')({ toolName: 'bash' }, next), 'answer');
  await handlers.get('user-questions/request')({ questions: [], signal: { aborted: true } }, next);
  assert.equal(called, 3);
  assert.equal(sent.length, 2);
  handlers.get('session/event')(session, end('completed'));
  assert.equal(sent.length, 3);
});

test('foreground leases cover multiple tabs, stale ordering, expiry and invalid reports', () => {
  let time = 0;
  const presence = createPresence(() => time);
  assert.equal(presence.isActive(), false);
  assert.equal(presence.update({ id: 'a', sequence: 1, active: true }), true);
  presence.update({ id: 'b', sequence: 1, active: false });
  assert.equal(presence.isActive(), true);
  presence.update({ id: 'a', sequence: 3, active: false });
  presence.update({ id: 'a', sequence: 2, active: true });
  assert.equal(presence.isActive(), false);
  presence.update({ id: 'b', sequence: 2, active: true });
  time = 15000;
  assert.equal(presence.isActive(), false);
  for (const input of [{}, { id: 'a', sequence: 1, active: 'true' }, { id: '', sequence: 1, active: true }]) {
    assert.equal(presence.update(input), false);
  }
});

test('all three notification types are suppressed in foreground and restored in background', async () => {
  const presence = createPresence(), sent = [], handlers = new Map();
  registerNotifications({ on(name, handler) { handlers.set(name, handler); } },
    foregroundAwareSender({ send(value) { sent.push(value); } }, presence));
  const trigger = async () => {
    handlers.get('session/event')(session, end('completed'));
    await handlers.get('user-questions/request')({ questions: [{ question: 'Question' }] }, () => 'ok');
    await handlers.get('approval/request')({ toolName: 'bash' }, () => 'ok');
  };
  presence.update({ id: 'a', sequence: 1, active: true });
  await trigger();
  assert.equal(sent.length, 0);
  presence.update({ id: 'a', sequence: 2, active: false });
  await trigger();
  assert.equal(sent.length, 3);
});

test('presence endpoint rejects untrusted and invalid requests', async () => {
  let route;
  const presence = createPresence();
  const connection = {
    requestRejection: (request) => request.headers.get('x-deny') ? 403 : undefined,
    fetch: { register(value) { route = value; return () => {}; } },
  };
  registerPresence({ inject(keys, callback) {
    assert.deepEqual(keys, ['connection']);
    callback({ connection, effect: (fn) => fn() });
  } }, presence);
  const request = (body, headers = {}) => new Request('http://localhost/api/native-notifications/presence', {
    method: 'POST', body, headers,
  });
  assert.equal((await route.fetch(request('{}', { 'x-deny': 'yes' }))).status, 403);
  assert.equal((await route.fetch(request('invalid'))).status, 400);
  assert.equal((await route.fetch(request('{}'))).status, 400);
  assert.equal((await route.fetch(request('x'.repeat(1025)))).status, 413);
  assert.equal((await route.fetch(request(JSON.stringify({ id: 'a', sequence: 1, active: true })))).status, 204);
  assert.equal(presence.isActive(), true);
});

test('client reports focus, visibility, page lifecycle and cleans up', () => {
  const win = new EventTarget(), doc = new EventTarget(), reports = [];
  let focused = true, timer, cleanup, cleared = false;
  doc.visibilityState = 'visible';
  doc.hasFocus = () => focused;
  win.__ModuleLoader__ = { load({ factory }) {
    factory().apply({ effect(fn) { cleanup = fn(); } });
  } };
  runInNewContext(readFileSync(new URL('./client.js', import.meta.url), 'utf8'), {
    window: win, document: doc, crypto: { randomUUID: () => 'page-id' },
    AbortSignal, fetch: (_url, opts) => { reports.push(JSON.parse(opts.body)); return Promise.resolve(); },
    setInterval: (fn) => { timer = fn; return 1; }, clearInterval: () => { cleared = true; },
  });
  assert.equal(reports.at(-1).active, true);
  focused = false; win.dispatchEvent(new Event('blur'));
  assert.equal(reports.at(-1).active, false);
  focused = true; win.dispatchEvent(new Event('focus'));
  assert.equal(reports.at(-1).active, true);
  doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(reports.at(-1).active, false);
  doc.visibilityState = 'visible'; win.dispatchEvent(new Event('pagehide'));
  timer(); assert.equal(reports.at(-1).active, false);
  win.dispatchEvent(new Event('pageshow'));
  assert.equal(reports.at(-1).active, true);
  cleanup();
  assert.equal(cleared, true);
  assert.equal(reports.at(-1).active, false);
  const count = reports.length;
  win.dispatchEvent(new Event('focus'));
  assert.equal(reports.length, count);
  assert.ok(reports.every((item, i) => item.sequence === i + 1));
});
