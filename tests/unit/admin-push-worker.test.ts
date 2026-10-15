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

it("activates a suspended app before navigating to the exact order", async () => {
  const handlers: Record<string, (event: unknown) => void> = {};
  const focus = vi.fn().mockResolvedValue(undefined);
  const navigated = { focus: vi.fn().mockResolvedValue(undefined) };
  const navigate = vi.fn().mockResolvedValue(navigated);
  const open = vi.fn();
  runInNewContext(readFileSync("public/admin-push-sw.js", "utf8"), { URL, self: {
    location: { origin: "https://shop.example" },
    addEventListener: (name: string, fn: (event: unknown) => void) => { handlers[name] = fn; },
    clients: { matchAll: async () => [{ url: "https://shop.example/admin/erp", focus, navigate }], openWindow: open },
  } });
  const waitUntil = vi.fn();
  handlers.notificationclick({ notification: { close: vi.fn(), data: { url: "/admin/erp/prodajni-nalozi/order-7" } }, waitUntil });
  await waitUntil.mock.calls[0][0];
  expect(focus.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]);
  expect(navigate).toHaveBeenCalledWith("https://shop.example/admin/erp/prodajni-nalozi/order-7");
  expect(navigated.focus).toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

it.each(["focus-rejected", "navigate-rejected", "navigate-null"])("opens the order when an old client is unusable (%s)", async (failure) => {
  const handlers: Record<string, (event: unknown) => void> = {};
  const open = vi.fn();
  runInNewContext(readFileSync("public/admin-push-sw.js", "utf8"), { URL, self: {
    location: { origin: "https://shop.example" },
    addEventListener: (name: string, fn: (event: unknown) => void) => { handlers[name] = fn; },
    clients: { matchAll: async () => [{ url: "https://shop.example/admin/erp", focus: async () => { if (failure === "focus-rejected") throw Error("client gone"); }, navigate: async () => { if (failure === "navigate-rejected") throw Error("client gone"); return null; } }], openWindow: open },
  } });
  const waitUntil = vi.fn();
  handlers.notificationclick({ notification: { close: vi.fn(), data: { url: "/admin/erp/prodajni-nalozi/order-7" } }, waitUntil });
  await waitUntil.mock.calls[0][0];
  expect(open).toHaveBeenCalledWith("https://shop.example/admin/erp/prodajni-nalozi/order-7");
});
