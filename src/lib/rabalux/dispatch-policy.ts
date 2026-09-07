import { resolveReportPeriod } from "@/lib/admin/report-period";

/** The first instant of the next calendar day in Serbia, including DST. */
export function rabaluxCourierAvailableAt(orderCreatedAt: Date): Date {
  return resolveReportPeriod({ range: "today" }, orderCreatedAt).endExclusive;
}
