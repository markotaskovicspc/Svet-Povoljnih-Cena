/** Merchant-requested adjustment at the provider boundary only.
 * Keep source/package measurements intact for catalogue, routing and hard limits.
 * Never persist this result as a physical measurement or feed it back as input.
 */
export function courierApiWeightKg(weightKg: number): number {
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new Error("Kurirski paket mora imati pozitivnu težinu.");
  }
  return Math.max(0.001, Math.round(weightKg * 0.8 * 1000) / 1000);
}
