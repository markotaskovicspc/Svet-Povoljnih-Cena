import type { PickupBatchStatus } from "@prisma/client";

export const PICKUP_BATCH_EXTERNAL_BLOCK_REASON =
  "MyGLS produkcijski pozivi su bezbednosno zaključani dok je MYGLS_PRODUCTION_ACCEPTED=false. Nalog i paketi mogu da se pripreme bez slanja GLS-u.";

export const MYGLS_BOOKING_CHANNELS = [
  "MYGLS_API",
  "MYGLS_PORTAL",
  "EMAIL",
  "PHONE",
  "FIXED_SCHEDULE",
] as const;

export type MyGlsBookingChannel = (typeof MYGLS_BOOKING_CHANNELS)[number];

export const MYGLS_BOOKING_CHANNEL_LABEL: Record<MyGlsBookingChannel, string> = {
  MYGLS_API: "MyGLS API",
  MYGLS_PORTAL: "MyGLS portal",
  EMAIL: "Email",
  PHONE: "Telefon",
  FIXED_SCHEDULE: "Stalni termin",
};

export const PICKUP_BATCH_STATUS_LABEL: Record<PickupBatchStatus, string> = {
  DRAFT: "Novi",
  POSTING: "Slanje kuriru",
  BOOKED: "Proknjižen",
  PICKED_UP: "Preuzet",
  CANCELLED: "Otkazan",
};

export type PickupBatchHandoverLine = {
  lineGroupKey: string;
  courierPickedUpAt: Date | null;
};

export type PickupBatchHandoverProgress = {
  totalGroups: number;
  pickedUpGroups: number;
  totalPackages: number;
  pickedUpPackages: number;
};

export function pickupBatchHandoverProgress(
  lines: readonly PickupBatchHandoverLine[],
): PickupBatchHandoverProgress {
  const groups = new Map<
    string,
    { totalPackages: number; pickedUpPackages: number }
  >();
  for (const line of lines) {
    const group = groups.get(line.lineGroupKey) ?? {
      totalPackages: 0,
      pickedUpPackages: 0,
    };
    group.totalPackages += 1;
    if (line.courierPickedUpAt) group.pickedUpPackages += 1;
    groups.set(line.lineGroupKey, group);
  }

  const values = [...groups.values()];
  return {
    totalGroups: values.length,
    pickedUpGroups: values.filter(
      (group) =>
        group.totalPackages > 0 &&
        group.pickedUpPackages === group.totalPackages,
    ).length,
    totalPackages: lines.length,
    pickedUpPackages: lines.filter((line) => line.courierPickedUpAt).length,
  };
}

export function pickupBatchDisplayStatus(
  status: PickupBatchStatus,
  progress: PickupBatchHandoverProgress,
) {
  if (status === "DRAFT" || status === "POSTING" || status === "CANCELLED") {
    return PICKUP_BATCH_STATUS_LABEL[status];
  }
  if (
    progress.totalGroups > 0 &&
    progress.pickedUpGroups === progress.totalGroups
  ) {
    return "Kompletno preuzeta";
  }
  if (progress.pickedUpPackages > 0) return "Delimično preuzeta";
  // Existing MyGLS batches may already be complete without the newly added
  // per-group handover markers. Preserve their meaning until an admin edits
  // the new checklist, which will backfill the markers.
  if (status === "PICKED_UP") return "Kompletno preuzeta";
  return PICKUP_BATCH_STATUS_LABEL[status];
}

export function isPickupBatchEditable(status: PickupBatchStatus) {
  return status === "DRAFT";
}

export function canRecreateMyGlsLabels({
  provider,
  status,
  labelsCreatedAt,
  externalBookedAt,
}: {
  provider?: string | null;
  status: PickupBatchStatus;
  labelsCreatedAt?: Date | null;
  externalBookedAt?: Date | null;
}) {
  return (
    provider?.trim().toUpperCase() === "MYGLS" &&
    status === "DRAFT" &&
    Boolean(labelsCreatedAt) &&
    !externalBookedAt
  );
}

export function pickupPostingBlockReason({
  configurationIssue,
  providerReason,
  provider,
  rowCount,
  completePackageCount,
  invalidPackageCount = 0,
}: {
  configurationIssue?: string | null;
  providerReason?: string | null;
  provider: "MYGLS" | "X_EXPRESS";
  rowCount: number;
  completePackageCount: number;
  invalidPackageCount?: number;
}) {
  return (
    configurationIssue ??
    providerReason ??
    (rowCount === 0
      ? "Učitajte bar jednu odgovarajuću kurirsku porudžbinu iz DC magacina."
      : completePackageCount !== rowCount
        ? "Unesite stvarnu težinu i sve tri dimenzije za svaki paket."
        : invalidPackageCount > 0
          ? provider === "MYGLS"
            ? "Jedan ili više MyGLS paketa prelazi dozvoljenu težinu od 40 kg ili najdužu stranicu od 200 cm. Unesite stvarne transportne mere u dozvoljenim granicama."
            : "Jedan ili više X Express paketa prelazi dozvoljenu težinu od 30 kg ili najdužu stranicu od 60 cm. Prebacite porudžbinu u MyGLS nalog."
          : null)
  );
}

export function nextPickupBatchNumber(
  existingNumbers: readonly string[],
  year: number,
) {
  const prefix = `PRE-${year}-`;
  const maxSequence = existingNumbers.reduce((max, number) => {
    if (!number.startsWith(prefix)) return max;
    const sequence = Number.parseInt(number.slice(prefix.length), 10);
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, 0);
  return `${prefix}${String(maxSequence + 1).padStart(4, "0")}`;
}
