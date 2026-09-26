type SyncRun = { status: string; startedAt: Date; to: Date; finishedAt: Date | null };

export function ananasOrdersHealth(latest: SyncRun | null, successful: SyncRun | null, now = new Date()) {
  const stale = !successful || now.getTime() - successful.to.getTime() > 30 * 60000;
  const failed = latest?.status === "FAILED" || (latest?.status === "RUNNING" && now.getTime() - latest.startedAt.getTime() > 5 * 60000);
  return { delayed: stale || Boolean(failed), updatedAt: successful?.finishedAt ?? null };
}
