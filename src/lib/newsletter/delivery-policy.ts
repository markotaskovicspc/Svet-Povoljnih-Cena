export function newsletterDeliveryPolicy() {
  const batch = Number.parseInt(process.env.SES_NEWSLETTER_BATCH_SIZE ?? "", 10);
  const interval = Number.parseInt(process.env.SES_NEWSLETTER_INTERVAL_SECONDS ?? "", 10);
  return {
    batchSize: Number.isFinite(batch) ? Math.min(Math.max(batch, 1), 10) : 10,
    intervalMs: (Number.isFinite(interval) ? Math.min(Math.max(interval, 10), 60) : 10) * 1000,
    runBudgetMs: 50_000,
  };
}
