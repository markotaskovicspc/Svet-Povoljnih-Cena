import { formatDate } from "@/lib/format";

export interface ListingActionPeriod {
  startsAt?: string;
  endsAt: string;
  label?: string;
}

/** Customer-facing validity copy used once, in the listing header. */
export function formatListingActionPeriod(period: ListingActionPeriod) {
  const startsAt = period.startsAt
    ? ` od ${formatDate(period.startsAt)}`
    : "";
  return `${period.label ?? "Akcija"} važi${startsAt} do ${formatDate(period.endsAt)}`;
}
