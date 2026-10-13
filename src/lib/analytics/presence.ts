export const PRESENCE_WINDOW_MS = 90_000;
export const PRESENCE_HEARTBEAT_MS = 45_000;
export const TRAFFIC_ALERT_THRESHOLD = 20;
export const TRAFFIC_ALERT_COOLDOWN_MS = 3_600_000;
export function shouldAlertTraffic(count: number, lastAlertAt: number | null, now: number, alreadyAbove = false) {
  return !alreadyAbove && count >= TRAFFIC_ALERT_THRESHOLD && (lastAlertAt === null || now - lastAlertAt >= TRAFFIC_ALERT_COOLDOWN_MS);
}
