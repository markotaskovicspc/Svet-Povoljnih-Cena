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
  let url = new URL("/admin", self.location.origin).href;
  try {
    const candidate = new URL(event.notification.data?.url || "/admin", self.location.origin);
    if (candidate.origin === self.location.origin && candidate.pathname.startsWith("/admin/")) url = candidate.href;
  } catch { /* Invalid notification data still opens the admin. */ }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).pathname.startsWith("/admin"));
    if (existing) {
      try {
        // Resume a suspended home-screen window before navigating it. A stale
        // client may disappear during activation; do not lose the click then.
        await existing.focus();
        const navigated = await existing.navigate(url);
        if (navigated) return navigated.focus();
      } catch { /* Fall back to opening the exact order in a new window. */ }
    }
    return self.clients.openWindow(url);
  })());
});
