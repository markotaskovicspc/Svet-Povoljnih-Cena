import "server-only";

/**
 * Fire-and-forget kick to the media-variant worker endpoint. Used to start
 * variant generation the moment an import finishes (event-driven — replaces the
 * old fixed cron). Kept dependency-light on purpose: no db/sharp imports, so
 * callers like the import route don't pull the heavy worker into their bundle.
 *
 * Auth reuses CRON_SECRET (same bearer the endpoint validates). Any failure is
 * swallowed — a trigger problem must never surface to the import that called it.
 */
export async function triggerVariantBackfill(
  origin: string,
  limit = 20,
): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !origin) return;
  try {
    await fetch(`${origin}/api/cron/media-variants?limit=${limit}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
  } catch {
    // fire-and-forget
  }
}
