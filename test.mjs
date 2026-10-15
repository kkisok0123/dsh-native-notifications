import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desktopText, notificationForEvent, createDesktopSender, registerNotifications } from './index.js';

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
