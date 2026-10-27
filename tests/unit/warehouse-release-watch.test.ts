import { afterEach, expect, it, vi } from "vitest";
import { watchWarehouseRelease } from "@/lib/admin/warehouse-release-watch";

afterEach(() => { vi.useRealTimers(); });
it("automatically loads a new release once the current scan/save has finished", async () => {
  vi.useFakeTimers();
  const readRelease = vi.fn().mockResolvedValue("new");
  const canReload = vi.fn().mockReturnValue(false);
  const reload = vi.fn(), onPending = vi.fn();
  const watcher = watchWarehouseRelease({ release: "old", readRelease, canReload, reload, onPending });
  await vi.advanceTimersByTimeAsync(0);
  expect(onPending).toHaveBeenCalledOnce(); expect(reload).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(reload).not.toHaveBeenCalled();
  canReload.mockReturnValue(true);
  await watcher.check();
  expect(reload).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reload).toHaveBeenCalledOnce(); expect(readRelease).toHaveBeenCalledOnce();
});
it("ignores offline responses and unchanged versions, then recovers on the next check", async () => {
  vi.useFakeTimers();
  const readRelease = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(null).mockResolvedValueOnce("old").mockResolvedValue("new");
  const reload = vi.fn();
  const watcher = watchWarehouseRelease({ release: "old", readRelease, canReload: () => true, reload, onPending: vi.fn() });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reload).not.toHaveBeenCalled();
  await watcher.check(); expect(reload).toHaveBeenCalledOnce();
});
it("does not reload a page that has unmounted while the version request was in flight", async () => {
  vi.useFakeTimers();
  let resolve!: (release: string) => void;
  const reload = vi.fn(), pending = vi.fn();
  const watcher = watchWarehouseRelease({ release: "old", readRelease: () => new Promise<string>(done => { resolve = done; }), canReload: () => true, reload, onPending: pending });
  watcher.stop(); resolve("new");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reload).not.toHaveBeenCalled(); expect(pending).not.toHaveBeenCalled();
});
