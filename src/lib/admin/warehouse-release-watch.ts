type Options = {
  release: string;
  readRelease: () => Promise<string | null>;
  canReload: () => boolean;
  reload: () => void;
  onPending: () => void;
};

/** Wait for saved/idle UI before replacing a stale application bundle. */
export function watchWarehouseRelease(options: Options) {
  let stopped = false, checking = false, pending = false;
  const timer = setInterval(() => { void check(); }, 30_000);
  function stop() { stopped = true; clearInterval(timer); }
  async function check() {
    if (stopped || checking) return;
    checking = true;
    try {
      if (!pending) {
        const release = await options.readRelease();
        if (stopped) return;
        if (release && release !== options.release) { pending = true; options.onPending(); }
      }
      if (!stopped && pending && options.canReload()) { stop(); options.reload(); }
    } catch { /* Offline/auth failures must not interrupt warehouse work. */ }
    finally { checking = false; }
  }
  void check();
  return { check, stop };
}
