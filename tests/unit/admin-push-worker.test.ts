import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

function worker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const show = vi.fn().mockResolvedValue(undefined);
  const open = vi.fn().mockResolvedValue(undefined);
  runInNewContext(readFileSync("public/admin-push-sw.js", "utf8"), {
    URL,
    self: {
      location: { origin: "https://shop.example" },
      addEventListener: (type: string, handler: (event: unknown) => void) => { handlers[type] = handler; },
      registration: { showNotification: show },
      clients: { matchAll: async () => [], openWindow: open },
    },
  });
  return { handlers, show, open };
}
it("always displays a notification even for malformed pushes", async () => {
  const { handlers, show } = worker();
  const waitUntil = vi.fn();
  handlers.push({ data: { json: () => { throw new Error("Invalid JSON"); } }, waitUntil });
  await waitUntil.mock.calls[0][0];
  expect(show).toHaveBeenCalledWith("Nova porudžbina", expect.objectContaining({ body: "Otvorite administraciju za pregled." }));
});
it("opens only same-origin admin links", async () => {
  for (const [candidate, expected] of [["/admin/erp/prodajni-nalozi/o1", "https://shop.example/admin/erp/prodajni-nalozi/o1"], ["https://attacker.example/admin/o1", "https://shop.example/admin"], ["/nalog", "https://shop.example/admin"]]) {
    const { handlers, open } = worker();
    const waitUntil = vi.fn();
    handlers.notificationclick({ notification: { close: vi.fn(), data: { url: candidate } }, waitUntil });
    await waitUntil.mock.calls[0][0];
    expect(open).toHaveBeenCalledWith(expected);
  }
});
