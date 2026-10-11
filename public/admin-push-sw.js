/* Push only: never cache admin pages or authenticated responses. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { /* Always show a visible notification. */ }
  event.waitUntil(self.registration.showNotification(payload.title || "Nova porudžbina", {
    body: payload.body || "Otvorite administraciju za pregled.",
    icon: "/apple-icon.png",
    tag: payload.tag || "admin-order",
    data: { url: payload.url || "/admin/erp/prodajni-nalozi" },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const candidate = new URL(event.notification.data?.url || "/admin", self.location.origin);
  const url = candidate.origin === self.location.origin && candidate.pathname.startsWith("/admin/")
    ? candidate.href : new URL("/admin", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).pathname.startsWith("/admin"));
    if (existing) {
      await existing.navigate(url);
      return existing.focus();
    }
    return self.clients.openWindow(url);
  })());
});
