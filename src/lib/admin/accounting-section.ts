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
      "Ulazne fakture, poreske vrednosti, raspodela zavisnih troškova i status COGS obračuna.",
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
      "Predlozi, objave i istorija promena maloprodajnih cena sa datumom važenja i BM procentom.",
    moduleSlug: "mp-cene",
    fixedFilters: [] satisfies AdminGridFilter[],
    visibleColumns: [
      "sku",
      "name",
      "currentMpc",
      "calcMpc",
      "bmPct",
      "validFrom",
      "status",
    ],
    notes: [] as string[],
  },
  {
    key: "kep-knjiga",
    number: "15.5",
    label: "KEP knjiga",
    description:
      "Interni KEP pregled iz izdatih fiskalnih dokumenata, spreman za pretragu i Excel izvoz.",
    moduleSlug: "racunovodstveni-registri",
    fixedFilters: [
      {
        id: "section-15-kep-issued",
        columnKey: "status",
        operator: "equals",
        value: "Izdato",
      },
    ] satisfies AdminGridFilter[],
    visibleColumns: [
      "issuedAt",
      "receiptNumber",
      "order",
      "kind",
      "net",
      "vat",
      "gross",
      "warehouse",
    ],
    notes: [
      "Interni operativni registar — nije računovodstveno odobren zakonski obrazac.",
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
