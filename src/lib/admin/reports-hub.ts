import type { AdminRoleName } from "@prisma/client";
import { isAuthorized } from "@/lib/admin/authorization";

export type ReportDestination = {
  href: string;
  title: string;
  description: string;
  allowed: readonly AdminRoleName[];
};

export const REPORT_DESTINATIONS: readonly ReportDestination[] = [
  {
    href: "/admin/erp/racunovodstveni-registri",
    title: "Knjigovodstveni izveštaji",
    description:
      "Promet, storna i refundacije, kalkulacije, nivelacije i interni KEP pregled sa Excel izvozom.",
    allowed: ["OPS"],
  },
  {
    href: "/admin/erp/posete-konverzije",
    title: "Posete i konverzije",
    description:
      "Detaljna analiza consented poseta, proizvoda, korpi, kupovina i first-party događaja.",
    allowed: ["ADS"],
  },
  {
    href: "/admin/erp/neobjavljeni-artikli",
    title: "QA objave",
    description:
      "Artikli koji nisu spremni za sajt, sa preciznim razlozima blokade i standardnim ERP izvozom.",
    allowed: ["CONTENT"],
  },
  {
    href: "/admin/audit-log",
    title: "Audit log",
    description:
      "Neizmenjiv administrativni trag promena, komandi i partnerskih API događaja.",
    allowed: [],
  },
];

export function reportDestinationsForRole(
  role: AdminRoleName | null | undefined,
) {
  return REPORT_DESTINATIONS.filter((destination) =>
    isAuthorized(role, destination.allowed),
  );
}
