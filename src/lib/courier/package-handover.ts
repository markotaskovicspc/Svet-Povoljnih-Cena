/** Warehouse reports are separate from the courier's aggregate order status. */
export type PackageHandoverReport = {
  version: 1;
  expectedPackages: number;
  pickedUpPackages: number;
  recordedAt: string;
  note: string;
  source: "ADMIN" | "USER_REPORT";
};

export function readPackageHandoverReport(raw: unknown): PackageHandoverReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>).packageHandover;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const report = value as PackageHandoverReport;
  if (
    report.version !== 1 ||
    !Number.isInteger(report.expectedPackages) || report.expectedPackages < 1 ||
    !Number.isInteger(report.pickedUpPackages) || report.pickedUpPackages < 0 ||
    report.pickedUpPackages > report.expectedPackages ||
    typeof report.recordedAt !== "string" || !Number.isFinite(Date.parse(report.recordedAt)) ||
    typeof report.note !== "string" || !report.note.trim() ||
    !["ADMIN", "USER_REPORT"].includes(report.source)
  ) return null;
  return report;
}

export function incompletePackageHandover(raw: unknown) {
  const report = readPackageHandoverReport(raw);
  return report && report.pickedUpPackages < report.expectedPackages ? report : null;
}

export function packageHandoverLabel(report: PackageHandoverReport) {
  return `${report.pickedUpPackages === report.expectedPackages ? "Kompletno" : "Delimično"} preuzeto (${report.pickedUpPackages}/${report.expectedPackages})`;
}
