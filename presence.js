// Short leases ensure a closed/crashed/disconnected page cannot mute alerts forever.
export function createPresence(now = Date.now, ttl = 15000) {
  const pages = new Map();
  function prune() {
    const time = now();
    for (const [id, page] of pages) if (page.expires <= time) pages.delete(id);
  }
  return {
    update({ id, sequence, active }) {
      prune();
      if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)
        || !Number.isSafeInteger(sequence) || sequence < 0 || typeof active !== 'boolean') return false;
      const previous = pages.get(id);
      if (previous && sequence <= previous.sequence) return true;
      if (!previous && pages.size >= 128) return false;
      pages.set(id, { sequence, active, expires: now() + ttl });
      return true;
    },
    isActive() {
      prune();
      return [...pages.values()].some((page) => page.active);
    },
  };
}
