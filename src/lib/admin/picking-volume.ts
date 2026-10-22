type Parcel = {
  id: string; widthCm?: unknown; depthCm?: unknown; heightCm?: unknown;
  deferredAt?: Date | string | null; purpose?: string;
  order?: { status?: string; cancelledAt?: Date | string | null };
};
export function pickingVolume(lines: readonly Parcel[]) {
  let knownM3 = 0, missingPackages = 0, packageCount = 0;
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.id) || line.deferredAt || line.purpose === "RECLAMATION_RETURN") continue;
    seen.add(line.id); packageCount++;
    const dimensions = [line.widthCm, line.depthCm, line.heightCm].map(Number);
    if (dimensions.some(value => !Number.isFinite(value) || value <= 0)) { missingPackages++; continue; }
    knownM3 += dimensions[0] * dimensions[1] * dimensions[2] / 1_000_000;
  }
  return { knownM3: Math.round(knownM3 * 1e9) / 1e9, missingPackages, packageCount };
}
export function formatPickingVolume(volume: ReturnType<typeof pickingVolume>) {
  const value = volume.knownM3.toLocaleString("sr-Latn-RS", { minimumFractionDigits: 3, maximumFractionDigits: 6 });
  return volume.missingPackages
    ? `${value} m³ (nepotpuno — nedostaju mere za ${volume.missingPackages} paketa)`
    : `${value} m³`;
}
