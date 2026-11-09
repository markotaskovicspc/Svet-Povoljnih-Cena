import type { AdminGridFilter } from "@/lib/admin/erp";

export const ACCOUNTING_SECTION_VIEWS = [
  {
    key: "promet",
    number: "15.1",
    label: "Evidencija prometa",
    description:
      "Izdati, neuspešni i započeti fiskalni računi prodaje sa neto, PDV i bruto vrednostima.",
    moduleSlug: "racunovodstveni-registri",
    fixedFilters: [
      {
        id: "section-15-turnover",
        columnKey: "kind",
        operator: "equals",
        value: "Promet",
      },
    ] satisfies AdminGridFilter[],
    visibleColumns: [
      "receiptNumber",
      "order",
      "status",
      "net",
      "vat",
      "gross",
      "warehouse",
      "issuedAt",
    ],
    notes: [] as string[],
  },
  {
    key: "storna-refundacije",
    number: "15.2",
    label: "Evidencija storniranja i refundacija",
    description:
      "Neizmenjiv pregled fiskalnih storna i refundacija povezanih sa izvornom porudžbinom.",
    moduleSlug: "racunovodstveni-registri",
    fixedFilters: [
      {
        id: "section-15-refunds",
        columnKey: "kind",
        operator: "equals",
        value: "Storno / refundacija",
      },
    ] satisfies AdminGridFilter[],
    visibleColumns: [
      "receiptNumber",
      "order",
      "status",
      "net",
      "vat",
      "gross",
      "warehouse",
      "issuedAt",
    ],
    notes: [] as string[],
  },
  {
    key: "kalkulacije",
    number: "15.3",
    label: "Kalkulacije",
    description:
      "Prijemnice, poreske vrednosti, raspodela zavisnih troškova i status COGS obračuna.",
    moduleSlug: "ulazne-fakture",
    fixedFilters: [] satisfies AdminGridFilter[],
    visibleColumns: [
      "number",
      "invoiceDate",
      "supplier",
      "netValue",
      "vatValue",
      "grossValue",
      "allocationBasis",
      "cogsStatus",
      "status",
      "locked",
    ],
    notes: [] as string[],
  },
  {
    key: "nivelacije",
    number: "15.4",
    label: "Nivelacije",
    description:
      "Objavljene promene pune MP cene na lageru i razlike između pune i fiskalizovane cene.",
    moduleSlug: "nivelacije",
    fixedFilters: [] satisfies AdminGridFilter[],
    visibleColumns: [
      "date",
      "company",
      "sku",
      "name",
      "type",
      "quantity",
      "fullMpc",
      "actualMpc",
      "valueDifference",
    ],
    notes: [] as string[],
  },
  {
    key: "kep-spc",
    number: "15.5",
    label: "KEP knjiga SPC",
    description:
      "Zaduženje robe po punoj MP vrednosti pri prijemu i dnevno razduženje prema izdatim fiskalnim dokumentima.",
    moduleSlug: "kep-spc",
    fixedFilters: [] satisfies AdminGridFilter[],
    visibleColumns: ["date", "description", "debit", "credit"],
    notes: [
      "Prikaz obuhvata knjiženja od 1. januara tekuće godine. Interni operativni registar — nije računovodstveno odobren zakonski obrazac.",
    ],
  },
  {
    key: "kep-ananas",
    number: "15.6",
    label: "KEP knjiga Ananas",
    description:
      "Odvojeno zaduženje Ananas robe po ERP otpremnicama i dnevno razduženje prema Ananas fiskalizaciji.",
    moduleSlug: "kep-ananas",
    fixedFilters: [] satisfies AdminGridFilter[],
    visibleColumns: ["date", "description", "debit", "credit"],
    notes: [
      "Prikaz obuhvata knjiženja od 1. januara tekuće godine. Interni operativni registar — nije računovodstveno odobren zakonski obrazac.",
    ],
  },
] as const;

export type AccountingSectionViewKey =
  (typeof ACCOUNTING_SECTION_VIEWS)[number]["key"];

export function getAccountingSectionView(value: string | string[] | undefined) {
  const key = Array.isArray(value) ? value[0] : value;
  return (
    ACCOUNTING_SECTION_VIEWS.find((view) => view.key === key) ??
    ACCOUNTING_SECTION_VIEWS[0]
  );
}
