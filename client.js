window.__ModuleLoader__.load({
  id: '@local/dsh-native-notifications',
  factory() {
    return {
      apply(ctx) {
        ctx.effect(() => {
          const id = crypto.randomUUID();
          let sequence = 0;
          let stopped = false;
          let leaving = false;
          const report = () => {
            const active = !stopped && !leaving
              && document.visibilityState === 'visible' && document.hasFocus();
            // Keepalive allows the final inactive update to survive page navigation.
            void fetch('/api/native-notifications/presence', {
              method: 'POST', credentials: 'same-origin', keepalive: true,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id, sequence: ++sequence, active }),
              signal: AbortSignal.timeout(4000),
            }).catch(() => {});
          };
          const hide = () => { leaving = true; report(); };
          const show = () => { leaving = false; report(); };
          const listeners = [
            [window, 'focus', report], [window, 'blur', report],
            [document, 'visibilitychange', report],
            [window, 'pagehide', hide], [window, 'pageshow', show],
          ];
          for (const [target, event, handler] of listeners) target.addEventListener(event, handler);
          const timer = setInterval(report, 5000);
          report();
          return () => {
            stopped = true;
            clearInterval(timer);
            for (const [target, event, handler] of listeners) target.removeEventListener(event, handler);
            report();
          };
        });
      },
    };
  },
});
