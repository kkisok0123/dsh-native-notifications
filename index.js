import { execFile } from 'node:child_process';
import { createPresence } from './presence.js';

// Native desktop messages, not browser notifications. Never use a shell with
// model-authored text. Escape markup supported by the freedesktop protocol.
export function desktopText(value, limit = 240) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function notificationForEvent(session, event) {
  if (session.header?.origin === 'subagent') return;
  if (event.type !== 'turn/end' || event.data.reason?.kind !== 'completed') return;
  return {
    title: 'DSH — response finished',
    body: `Your agent has finished responding. Open DSH to review it.\nConversation: ${String(session.id).slice(0, 12)}`,
  };
}

export function createDesktopSender(run = execFile, warn = console.warn) {
  const children = new Set();
  let disposed = false;
  return {
    send({ title, body, attention = false }) {
      if (disposed) return;
      try {
        const child = run('notify-send', [
          '--app-name=DSH', '--icon=dialog-information',
          `--urgency=${attention ? 'critical' : 'normal'}`,
          '--', desktopText(title, 100), desktopText(body),
        ], { timeout: 5000, windowsHide: true }, (error) => {
          children.delete(child);
          if (error && !disposed) warn(`[DSH native notifications] ${error.message}`);
        });
        children.add(child);
      } catch (error) {
        warn(`[DSH native notifications] ${error.message}`);
      }
    },
    dispose() {
      disposed = true;
      for (const child of children) child.kill();
      children.clear();
    },
  };
}

export function registerNotifications(ctx, sender) {
  // This is a live side effect only: do not replay history, rescan the log,
  // or report interrupted/cancelled/error turns as successful completions.
  ctx.on('session/event', (session, event) => {
    const notification = notificationForEvent(session, event);
    if (notification) sender.send(notification);
  });
  ctx.on('user-questions/request', (request, next) => {
    if (!request.signal?.aborted) {
      sender.send({
        title: 'DSH — needs your input',
        body: request.questions.map((item) => item.question).join(' • '),
        attention: true,
      });
    }
    return next();
  }, { prepend: true });
  ctx.on('approval/request', (request, next) => {
    if (!request.signal?.aborted) {
      sender.send({
        title: 'DSH — approval needed',
        body: request.displayReason?.en || request.reason || `Permission requested for ${request.toolName}.`,
        attention: true,
      });
    }
    return next();
  }, { prepend: true });
}

export function registerPresence(ctx, presence) {
  ctx.inject(['connection'], (scope) => {
    scope.effect(() => scope.connection.fetch.register({
      path: '/api/native-notifications/presence',
      methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        // Defense in depth: presence is writable only by an admitted DSH client.
        const rejection = scope.connection.requestRejection(request);
        if (rejection) return new Response(null, { status: rejection });
        const text = await request.text();
        if (text.length > 1024) return new Response(null, { status: 413 });
        try {
          if (!presence.update(JSON.parse(text))) return new Response(null, { status: 400 });
        } catch {
          return new Response(null, { status: 400 });
        }
        return new Response(null, { status: 204 });
      },
    }));
  });
}

export function foregroundAwareSender(sender, presence) {
  return { send(notification) { if (!presence.isActive()) sender.send(notification); } };
}

export function apply(ctx) {
  const sender = createDesktopSender();
  const presence = createPresence();
  ctx.effect(() => () => sender.dispose());
  registerPresence(ctx, presence);
  registerNotifications(ctx, foregroundAwareSender(sender, presence));
}
