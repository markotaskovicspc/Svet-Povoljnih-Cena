import type { AdminRoleName } from "@prisma/client";
import { canAccessAdminModule, type AdminAccessPrincipal } from "@/lib/admin/access-policy";

export type ReportDestination = {
  href: string;
  title: string;
  description: string;
  allowed: readonly AdminRoleName[];
};

export const REPORT_DESTINATIONS: readonly ReportDestination[] = [
  {
    href: "/admin/erp/ananas", title: "Ananas porudžbine",
    description: "Preuzete Ananas porudžbine, statusi i vrednost artikala.", allowed: ["OPS"],
  },
  {
    href: "/admin/erp/performans-artikala", title: "Performans artikala",
    description: "Prodaja sajta, raspoloživost lagera, COGS, KOZ i dani pokrića zaliha.", allowed: ["OPS"],
  },
  {
    href: "/admin/erp/order-bump",
    title: "Order bump",
    description: "Porudžbine, isporuke i vrednost artikala dodatih preko ponude u korpi.",
    allowed: ["ADS", "OPS"],
  },
  {
    href: "/admin/erp/dnevni-promet",
    title: "Dnevni promet",
    description:
      "Dnevni broj i iznosi profaktura, fiskalnih računa i refundacija, sa Excel izvozom.",
    allowed: ["OPS"],
  },
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
      "Dnevne porudžbine sajta i Ananasa, ukupna vrednost, konverzija sajta i analiza poseta.",
    allowed: ["ADS", "OPS"],
  },
  {
    href: "/admin/erp/3d-ar",
    title: "3D i AR",
    description: "Otvaranje i korišćenje modela, AR pokušaji, kampanje i A/B test poruka.",
    allowed: ["ADS"],
  },
  {
    href: "/admin/erp/exit-intent",
    title: "Exit-intent ponuda",
    description: "Prikazi ponude za prvu kupovinu, zadržavanje posetilaca i naknadne porudžbine.",
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
  roleOrPrincipal: AdminRoleName | AdminAccessPrincipal | null | undefined,
) {
  const principal = typeof roleOrPrincipal === "string" ? { role: roleOrPrincipal } : roleOrPrincipal;
  return REPORT_DESTINATIONS.filter((destination) =>
    canAccessAdminModule(principal, destination.href, destination.allowed),
  );
}
