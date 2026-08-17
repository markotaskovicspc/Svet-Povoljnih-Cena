import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  getOperationalErpRows,
  operationalErpModules,
} from "@/lib/admin/erp-operations";
import { computeArticleStock } from "@/lib/article-stock";
import { richTextPlainText } from "@/lib/rich-text";
import { resolveSupabaseStorageUrl } from "@/lib/supabase/storage";
import { SUPPLIER_PARITY_OPTIONS } from "@/lib/supplier-master";
import {
  composePurchasePriceAttributes,
  composePurchasePricePattern,
} from "@/lib/admin/purchase-price";
import { getPickupPostingAvailability } from "@/lib/admin/pickup-batch.server";
import { articleSearchWhere } from "@/lib/admin/article-search";
import { ARTICLE_STATUS_LABELS } from "@/lib/article-status";
import {
  RABALUX_SUPPLIER_STOCK_STATUS_LABELS,
  resolveRabaluxSupplierStock,
} from "@/lib/rabalux/availability";
import { isRabaluxSupplierOperational } from "@/lib/rabalux/config";
import { grossMarginPct } from "@/lib/pricing/gross-margin";
import { resolveRetailPrice } from "@/lib/pricing/retail-price";

export type ErpValue = string | number | boolean | null;

export type ErpColumn = {
  key: string;
  label: string;
  type?: "text" | "number" | "money" | "date" | "status" | "boolean";
  options?: string[];
  /** Human-readable labels for compact stored option values. */
  optionLabels?: Record<string, string>;
  defaultVisible?: boolean;
  align?: "left" | "right" | "center";
};

export type AdminGridOperator =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "before"
  | "after";

export type AdminGridFilter = {
  id: string;
  columnKey: string;
  operator: AdminGridOperator;
  value: string;
};

export type AdminGridSort = {
  columnKey: string;
  direction: "asc" | "desc";
};

export type AdminGridQuery = {
  page: number;
  pageSize: number;
  query: string;
  searchColumn?: string;
  filters: AdminGridFilter[];
  sorting: AdminGridSort[];
  visibleColumns: string[];
  columnOrder: string[];
  columnWidths: Record<string, number>;
};

export type SalesOrderExportFilters = {
  warehouseId?: string;
  createdFrom?: Date;
  createdToExclusive?: Date;
  fiscalIssuedFrom?: Date;
  fiscalIssuedToExclusive?: Date;
  fiscalized?: boolean;
  stocktakeArchived?: boolean;
};

export type ErpRow = {
  id: string;
  /** Optional entity id used by row/detail navigation when the grid row is a child record. */
  detailId?: string;
  values: Record<string, ErpValue>;
  /** Optional per-cell links for values such as item photos. */
  cellHrefs?: Record<string, string>;
};

export type ErpCommand = {
  label: string;
  /** Explicit progress copy shown while the command is running. */
  pendingLabel?: string;
  /** Short, command-specific guidance shown in the input dialog. */
  description?: string;
  tone?: "primary" | "danger" | "neutral";
  /** Client-only command handled by the grid without an API mutation. */
  clientAction?: "edit" | "open" | "download-pdf" | "download-excel";
  /** Server command key dispatched to POST /api/admin/erp/[module]/commands. */
  action?: string;
  /** If set, the button navigates to this href instead of dispatching. */
  href?: string;
  /** Command operates on the currently selected rows (button disabled until selection). */
  needsSelection?: boolean;
  /** Optional native confirm() text shown before the command runs. */
  confirm?: string;
  /** Why a provider or business command cannot currently run. */
  disabledReason?: string;
  /** Optional values collected in an accessible dialog before dispatch. */
  fields?: Array<{
    key: string;
    label: string;
    type: "text" | "number" | "date" | "email" | "tel";
    required?: boolean;
    options?: string[];
    /** Optional value-to-label lookup shown below a freely editable field. */
    valueLabels?: Record<string, string>;
    valueLabel?: string;
    valueNotFoundText?: string;
    min?: number;
    step?: number;
  }>;
};

export type ErpModule = {
  slug: string;
  number: string;
  title: string;
  description: string;
  status: "ready" | "blocked_external";
  commands: ErpCommand[];
  columns: ErpColumn[];
  rows: ErpRow[];
  notes?: string[];
  blockedReason?: string;
  /** Canonical admin screen for legacy modules that should no longer render their generic ERP grid. */
  redirectHref?: string;
  /** Only columns with a complete server-side write mapping may enter edit mode. */
  editableColumns?: string[];
  /** When set, each row gets an "Otvori" link to its detailId (or row id). */
  detailHrefBase?: string;
  /** Module-level selectors that change the server-side row context. */
  contextFilters?: Array<{
    key: string;
    label: string;
    options: Array<{ value: string; label: string }>;
  }>;
};

function asNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  return value.toNumber();
}

function dateOnly(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function currencyLabel(value: string | null | undefined) {
  if (value === "EUR") return "€";
  if (value === "USD") return "$";
  return "RSD";
}

function purchaseOrderStatusLabel(status: string) {
  const labels: Record<string, string> = {
    DRAFT: "U obradi",
    SENT: "Poslata",
    CONFIRMED: "Potvrđena",
    RECEIVED: "Primljena",
    CANCELLED: "Otkazana",
  };
  return labels[status] ?? status;
}

function inboundInvoiceStatusLabel(status: string) {
  const labels: Record<string, string> = {
    DRAFT: "U pripremi",
    RECEIVED: "Primljena",
    POSTED: "Proknjižena",
    CANCELLED: "Storno",
  };
  return labels[status] ?? status;
}

function cogsStatusLabel(status: string) {
  const labels: Record<string, string> = {
    PENDING: "Čeka obračun",
    CALCULATED: "Obračunat",
    LOCKED: "Proknjižen",
  };
  return labels[status] ?? status;
}

const articleColumns: ErpColumn[] = [
  { key: "photo", label: "Foto", defaultVisible: true },
  {
    key: "status",
    label: "Status",
    type: "status",
    options: ["SP", "IT", "DTZ", "DOB", "ARH", "UZ"],
    optionLabels: ARTICLE_STATUS_LABELS,
    defaultVisible: true,
  },
  { key: "sku", label: "Šifra", defaultVisible: true },
  { key: "supplierExternalId", label: "Dobavljačka šifra" },
  { key: "shortDescription", label: "Kratki opis", defaultVisible: true },
  { key: "shortName", label: "Kratki naziv", defaultVisible: true },
  { key: "supplier", label: "Dobavljač", options: [], defaultVisible: true },
  { key: "supplierIntegrationKey", label: "Integracija dobavljača" },
  { key: "category", label: "Kategorija", defaultVisible: true },
  { key: "group", label: "Interna grupa", defaultVisible: true },
  { key: "subgroup", label: "Podgrupa" },
  { key: "collection", label: "Kolekcija", defaultVisible: true },
  { key: "attribute1", label: "Atribut 1" },
  { key: "attribute2", label: "Atribut 2" },
  { key: "attribute3", label: "Atribut 3" },
  { key: "attribute4", label: "Atribut 4" },
  { key: "color1", label: "Boja 1" },
  { key: "color2", label: "Boja 2" },
  { key: "familyCode", label: "Šifra porodice", defaultVisible: true },
  { key: "familyColorLabel", label: "Naziv boje", defaultVisible: true },
  { key: "familyColorHex", label: "HEX boje", defaultVisible: true },
  { key: "familyPosition", label: "Redosled boje", type: "number", align: "right", defaultVisible: true },
  { key: "familyPrimary", label: "Glavna boja", type: "boolean", align: "center", defaultVisible: true },
  { key: "familyStorefrontEnabled", label: "Boja spremna za web", type: "boolean", align: "center", defaultVisible: true },
  { key: "benefits", label: "Benefiti" },
  { key: "siteDescription", label: "Opis za sajt" },
  { key: "stockTotal", label: "Ukupno fizičko stanje", type: "number", align: "right", defaultVisible: true },
  { key: "reservedStock", label: "Rezervisano", type: "number", align: "right", defaultVisible: true },
  { key: "availableTotal", label: "Ukupno raspoloživo", type: "number", align: "right", defaultVisible: true },
  { key: "stockDc", label: "Fizičko po magacinu", type: "number", align: "right" },
  { key: "availableDc", label: "Raspoloživo po magacinu", type: "number", align: "right" },
  { key: "rabaluxStock", label: "Rabalux stanje", type: "number", align: "right", defaultVisible: true },
  { key: "rabaluxReserved", label: "Rabalux rezervisano", type: "number", align: "right" },
  { key: "rabaluxSafetyStock", label: "Sigurnosni komad", type: "number", align: "right" },
  { key: "rabaluxSellableStock", label: "Rabalux za prodaju", type: "number", align: "right", defaultVisible: true },
  { key: "rabaluxStockStatus", label: "Status Rabalux lagera", type: "status", defaultVisible: true },
  { key: "rabaluxStockSyncedAt", label: "Rabalux osveženo", type: "date", defaultVisible: true },
  { key: "rabaluxNextArrivalAt", label: "Rabalux sledeći dolazak", type: "date" },
  { key: "cogs", label: "COGS", type: "money", align: "right" },
  { key: "incomingTotal", label: "Količina u dolasku", type: "number", align: "right" },
  { key: "incomingAvailable", label: "Raspoloživo u dolasku", type: "number", align: "right" },
  { key: "weightKg", label: "Težina kg", type: "number", align: "right" },
  { key: "widthCm", label: "Širina cm", type: "number", align: "right" },
  { key: "heightCm", label: "Visina cm", type: "number", align: "right" },
  { key: "depthCm", label: "Dubina cm", type: "number", align: "right" },
  { key: "areaM2", label: "Površina", type: "number", align: "right" },
  { key: "volumeM3", label: "Zapremina", type: "number", align: "right" },
  { key: "grossWeightKg", label: "Bruto težina", type: "number", align: "right" },
  { key: "unitPackWidthCm", label: "Poj. pak. širina", type: "number", align: "right" },
  { key: "unitPackDepthCm", label: "Poj. pak. dubina", type: "number", align: "right" },
  { key: "unitPackHeightCm", label: "Poj. pak. visina", type: "number", align: "right" },
  { key: "unitPackVolumeM3", label: "Poj. pak. m3", type: "number", align: "right" },
  { key: "packQty", label: "Kom/pak", type: "number", align: "right" },
  { key: "palletQty", label: "Kom/paleta", type: "number", align: "right" },
  { key: "packWidthCm", label: "Transport. širina", type: "number", align: "right" },
  { key: "packDepthCm", label: "Transport. dubina", type: "number", align: "right" },
  { key: "packHeightCm", label: "Transport. visina", type: "number", align: "right" },
  { key: "packVolumeM3", label: "Transport. m3", type: "number", align: "right" },
  { key: "packGrossWeightKg", label: "Transport. bruto kg", type: "number", align: "right" },
  { key: "containerQty", label: "Količina / kontejner", type: "number", align: "right" },
  { key: "containerGrossWeightKg", label: "Kontejner bruto kg", type: "number", align: "right" },
  { key: "lastPurchasePrice", label: "Posl. nabavna", type: "money", align: "right" },
  { key: "lastPurchaseCurrency", label: "Valuta nabavne" },
  { key: "supplierName", label: "Dobavljačev naziv" },
  { key: "material", label: "Materijal" },
  { key: "certificates", label: "Sertifikati" },
  { key: "barcode", label: "Bar kod" },
  { key: "hsCode", label: "HS kod" },
  { key: "customsRate", label: "Carina %", type: "number", align: "right" },
  { key: "ananasBrokerage", label: "Ananas posred.", type: "number", align: "right" },
  { key: "ananasStorage", label: "Ananas skladiš.", type: "number", align: "right" },
  { key: "ananasDelivery", label: "Ananas ispor.", type: "number", align: "right" },
  { key: "siteLink", label: "Link sajta" },
  { key: "webAuto", label: "Web auto", type: "boolean", align: "center" },
  { key: "webCheck", label: "Web check", type: "boolean", align: "center" },
  { key: "wholesaleAuto", label: "VP auto", type: "boolean", align: "center" },
  { key: "wholesaleCheck", label: "VP check", type: "boolean", align: "center" },
  { key: "exportAuto", label: "INO auto", type: "boolean", align: "center" },
  { key: "exportCheck", label: "INO check", type: "boolean", align: "center" },
  { key: "parity", label: "Paritet", options: ["EXW", "FCA", "FOB", "CIF", "DAP", "DDP"] },
  { key: "deliveryDays", label: "Rok isporuke", type: "number", align: "right" },
  { key: "moq", label: "MOQ", type: "number", align: "right" },
  { key: "newUntil", label: "Novo do", type: "date" },
];

const emptyRows: ErpRow[] = [];

const supplierColumns: ErpColumn[] = [
  { key: "code", label: "Šifra dobavljača", defaultVisible: true },
  { key: "name", label: "Naziv dobavljača", defaultVisible: true },
  { key: "address", label: "Adresa", defaultVisible: true },
  { key: "city", label: "Grad", defaultVisible: true },
  { key: "country", label: "Država", defaultVisible: true },
  { key: "email", label: "Kontakt mail", defaultVisible: true },
  { key: "phone", label: "Telefon dobavljača", defaultVisible: true },
  { key: "currency", label: "Valuta", options: ["RSD", "€", "$"], defaultVisible: true },
  {
    key: "parity",
    label: "Paritet",
    options: [...SUPPLIER_PARITY_OPTIONS],
    defaultVisible: true,
  },
  { key: "paymentTerms", label: "Uslovi plaćanja", defaultVisible: true },
  { key: "deliveryDays", label: "Rok isporuke", type: "number", align: "right", defaultVisible: true },
  { key: "transitDays", label: "Tranzitno vreme", type: "number", align: "right", defaultVisible: true },
  { key: "bank", label: "Banka dobavljača", defaultVisible: true },
  { key: "swift", label: "SWIFT kod", defaultVisible: true },
  { key: "iban", label: "IBAN", defaultVisible: true },
  { key: "defaultPriceList", label: "Cenovnik", defaultVisible: true },
  { key: "loading1", label: "Mesto utovara 1", defaultVisible: true },
  { key: "loading2", label: "Mesto utovara 2", defaultVisible: true },
  { key: "loading3", label: "Mesto utovara 3", defaultVisible: true },
];


const purchasePriceColumns: ErpColumn[] = [
  { key: "sku", label: "Šifra artikla", options: [], defaultVisible: true },
  { key: "supplier", label: "Dobavljač", defaultVisible: true },
  { key: "name", label: "Naziv artikla", defaultVisible: true },
  { key: "attributes", label: "Atributi artikla", defaultVisible: true },
  { key: "pattern", label: "Dezen artikla", defaultVisible: true },
  { key: "purchasePrice", label: "Nabavna cena", type: "money", align: "right", defaultVisible: true },
  { key: "currency", label: "Valuta", options: ["RSD", "€", "$"], defaultVisible: true },
  { key: "parity", label: "Paritet", defaultVisible: true },
  { key: "validFrom", label: "Važenje cene od", type: "date", defaultVisible: true },
  { key: "validTo", label: "Važenje cene do", type: "date", defaultVisible: true },
];


const purchaseOrderColumns: ErpColumn[] = [
  { key: "number", label: "Broj porudžbenice", defaultVisible: true },
  { key: "status", label: "Status", type: "status", options: ["U obradi", "Poslata", "Potvrđena", "Primljena"], defaultVisible: true },
  { key: "supplier", label: "Dobavljač", options: [], defaultVisible: true },
  { key: "createdAt", label: "Datum kreiranja", type: "date", defaultVisible: true },
  { key: "orderDate", label: "Datum porudžbine", type: "date", defaultVisible: true },
  { key: "loadingDate", label: "Datum utovara", type: "date", defaultVisible: true },
  { key: "deliveryDate", label: "Datum isporuke", type: "date", defaultVisible: true },
  { key: "totalVolume", label: "Ukupna zapremina", type: "number", align: "right", defaultVisible: true },
  { key: "totalWeight", label: "Ukupna težina", type: "number", align: "right", defaultVisible: true },
  { key: "totalPrice", label: "Ukupna cena", type: "money", align: "right", defaultVisible: true },
  { key: "currency", label: "Valuta", options: ["RSD", "€", "$"], defaultVisible: true },
  { key: "transportType", label: "Tip transporta", options: ["Šleper 90m3 / 24t", "Solo kamion 45m3 / 12t", "Kombi", "Kontejner 40HC"], defaultVisible: true },
  { key: "parity", label: "Paritet", options: ["EXW", "FCA", "FOB", "CIF", "DAP", "DDP"], defaultVisible: true },
  { key: "bmPct", label: "Ukupna BM% (procena)", type: "number", align: "right", defaultVisible: true },
];


const purchaseOrderItemColumns: ErpColumn[] = [
  { key: "poNumber", label: "Broj porudžbenice", defaultVisible: true },
  { key: "status", label: "Status", type: "status", defaultVisible: true },
  { key: "headerSupplier", label: "Dobavljač (zaglavlje)", defaultVisible: true },
  { key: "createdAt", label: "Datum kreiranja", type: "date", defaultVisible: true },
  { key: "orderDate", label: "Datum porudžbine", type: "date", defaultVisible: true },
  { key: "loadingDate", label: "Datum utovara", type: "date", defaultVisible: true },
  { key: "deliveryDate", label: "Datum isporuke", type: "date", defaultVisible: true },
  { key: "headerCurrency", label: "Valuta (zaglavlje)", defaultVisible: true },
  { key: "transportType", label: "Tip transporta", defaultVisible: true },
  { key: "headerParity", label: "Paritet (zaglavlje)", defaultVisible: true },
  { key: "sku", label: "Šifra artikla", defaultVisible: true },
  { key: "photo", label: "Fotografija artikla", defaultVisible: true },
  { key: "supplier", label: "Dobavljač", options: [], defaultVisible: true },
  { key: "name", label: "Naziv artikla", defaultVisible: true },
  { key: "attributes", label: "Atributi artikla", defaultVisible: true },
  { key: "pattern", label: "Dezen artikla", defaultVisible: true },
  { key: "purchasePrice", label: "Nabavna cena", type: "money", align: "right", defaultVisible: true },
  { key: "currency", label: "Valuta", options: ["RSD", "€", "$"], defaultVisible: true },
  { key: "parity", label: "Paritet", options: ["EXW", "FCA", "FOB", "CIF", "DAP", "DDP"], defaultVisible: true },
  { key: "validFrom", label: "Važenje cene od", type: "date", defaultVisible: true },
  { key: "moq", label: "MOQ", type: "number", align: "right", defaultVisible: true },
  { key: "packQty", label: "Broj artikala u pakovanju", type: "number", align: "right", defaultVisible: true },
  { key: "qty", label: "Količina za poručivanje", type: "number", align: "right", defaultVisible: true },
  { key: "totalVolume", label: "Ukupna zapremina", type: "number", align: "right", defaultVisible: true },
  { key: "totalWeight", label: "Ukupna težina", type: "number", align: "right", defaultVisible: true },
  { key: "customsRate", label: "Carinska stopa (procena)", type: "number", align: "right", defaultVisible: true },
  { key: "calcRetailPrice", label: "Kalkulativna MPC", type: "money", align: "right", defaultVisible: true },
  { key: "bmPct", label: "BM% (procena)", type: "number", align: "right", defaultVisible: true },
  { key: "supplierProductName", label: "Dobavljačev naziv artikla", defaultVisible: true },
  { key: "certificates", label: "Sertifikati", defaultVisible: true },
  { key: "barcode", label: "Bar kod", defaultVisible: true },
];


const inboundInvoiceColumns: ErpColumn[] = [
  { key: "number", label: "Broj prijemnice", defaultVisible: true },
  { key: "invoiceDate", label: "Datum prijema", type: "date", defaultVisible: true },
  { key: "supplier", label: "Naziv dobavljača", defaultVisible: true },
  { key: "invoiceValueRsd", label: "Vrednost fakture u RSD", type: "money", align: "right", defaultVisible: true },
  { key: "customsValueRsd", label: "Vrednost carine u RSD", type: "money", align: "right", defaultVisible: true },
  { key: "transportValueRsd", label: "Vrednost transporta u RSD", type: "money", align: "right", defaultVisible: true },
  { key: "otherRelatedCostsRsd", label: "Ostali vezani troškovi u RSD", type: "money", align: "right", defaultVisible: true },
  { key: "netValue", label: "Ukupno bez PDV-a", type: "money", align: "right", defaultVisible: true },
  { key: "vatValue", label: "PDV (20%)", type: "money", align: "right", defaultVisible: true },
  { key: "grossValue", label: "Ukupno sa PDV-om", type: "money", align: "right", defaultVisible: true },
  { key: "purchaseOrder", label: "Veza sa dokumentom", defaultVisible: true },
  { key: "warehouse", label: "Magacin prijema", defaultVisible: true },
  { key: "status", label: "Status", type: "status", options: ["U pripremi", "Primljena", "Proknjižena", "Storno"], defaultVisible: true },
  { key: "locked", label: "Proknjiženo", type: "boolean", defaultVisible: true },
  { key: "type", label: "Tip", options: ["COGS"] },
  { key: "currency", label: "Valuta", options: ["RSD", "€", "$"] },
  { key: "exchangeRate", label: "Kurs", type: "number", align: "right" },
  {
    key: "allocationBasis",
    label: "Raspodela",
    type: "status",
    options: ["AUTO_UTILIZATION", "VALUE", "WEIGHT", "VOLUME", "MANUAL"],
  },
  { key: "cogsStatus", label: "COGS", type: "status", options: ["Čeka obračun", "Obračunat", "Proknjižen"] },
];


const retailPriceColumns: ErpColumn[] = [
  { key: "sku", label: "Šifra artikla", defaultVisible: true },
  { key: "name", label: "Naziv", defaultVisible: true },
  { key: "currentMpc", label: "Trenutna MPC", type: "money", align: "right", defaultVisible: true },
  { key: "calcMpc", label: "Kalkulativna MPC", type: "money", align: "right", defaultVisible: true },
  { key: "bmPct", label: "BM%", type: "number", align: "right", defaultVisible: true },
  { key: "validFrom", label: "Važi od", type: "date", defaultVisible: true },
  { key: "status", label: "Status", type: "status", options: ["Predlog", "Objavljeno", "Arhiva"], defaultVisible: true },
];


const coreErpModules: ErpModule[] = [
  {
    slug: "artikli",
    number: "1",
    title: "Matični podaci o artiklima",
    description:
      "Centralni matični karton artikla: status, dobavljač, kategorije, dimenzije, pakovanja, kanali prodaje i povezani opisi za sajt.",
    status: "ready",
    commands: [
      {
        label: "Unos novog",
        pendingLabel: "Kreiranje artikla…",
        description:
          "Unesite šifru sličnog artikla ako želite da prekopirate njegove matične podatke i pozitivnu MP cenu. Novoformirana šifra, slike, dokumenti, zalihe i ostali transakcioni podaci se ne kopiraju. Ostavite prazno za potpuno nov artikal.",
        tone: "primary",
        action: "article.create",
        fields: [
          {
            key: "sourceSku",
            label: "Kopiraj podatke iz artikla (šifra)",
            type: "text",
          },
        ],
      },
      { label: "Excel unos", tone: "neutral", href: "/admin/erp/artikli/import" },
      {
        label: "Arhiviraj",
        tone: "danger",
        action: "row.delete",
        needsSelection: true,
        confirm: "Arhivirati izabrane artikle?",
      },
    ],
    columns: articleColumns,
    editableColumns: [
      "sku",
      "status",
      "collection",
      "shortName",
      "shortDescription",
      "attribute1",
      "attribute2",
      "attribute3",
      "attribute4",
      "color1",
      "color2",
      "customsRate",
      "widthCm",
      "heightCm",
      "depthCm",
      "weightKg",
      "grossWeightKg",
      "unitPackWidthCm",
      "unitPackDepthCm",
      "unitPackHeightCm",
      "packQty",
      "palletQty",
      "packWidthCm",
      "packDepthCm",
      "packHeightCm",
      "packGrossWeightKg",
      "containerQty",
      "containerGrossWeightKg",
      "supplierName",
      "barcode",
      "hsCode",
      "ananasBrokerage",
      "ananasStorage",
      "ananasDelivery",
      "webCheck",
      "wholesaleCheck",
      "exportCheck",
      "moq",
    ],
    detailHrefBase: "/admin/erp/artikli",
    rows: emptyRows,
    notes: [
      "Sistem dodeljuje najmanju slobodnu brojčanu šifru veću od 100000; šifra može naknadno da se uskladi sa deklaracijom.",
      "Naziv za web i ostale module se formira od kolekcije, kratkog opisa i kratkog naziva.",
      "Atributi se formiraju iz polja Atribut 1-4, a dezen iz Boja 1-2.",
    ],
  },
  {
    slug: "dobavljaci",
    number: "2",
    title: "Matični podaci o dobavljačima",
    description:
      "Šifarnik dobavljača sa paritetom, valutom, rokovima isporuke, bankarskim podacima i kontaktima.",
    status: "ready",
    commands: [
      { label: "Unos novog", tone: "primary", action: "supplier.create" },
      { label: "Uredi", tone: "neutral", clientAction: "edit" },
      {
        label: "Brisanje",
        tone: "danger",
        action: "row.delete",
        needsSelection: true,
        confirm: "Obrisati izabrane dobavljače? Akcija je nepovratna.",
      },
    ],
    columns: supplierColumns,
    editableColumns: [
      "name",
      "address",
      "city",
      "country",
      "email",
      "phone",
      "currency",
      "parity",
      "paymentTerms",
      "deliveryDays",
      "transitDays",
      "bank",
      "swift",
      "iban",
      "defaultPriceList",
      "loading1",
      "loading2",
      "loading3",
    ],
    rows: emptyRows,
    notes: [
      "Šifra dobavljača se automatski dodeljuje i nije ručno izmenljiva.",
      "Kontakt mail mora da sadrži @.",
      "Valuta je ograničena na RSD, $ ili €, a paritet se bira iz Incoterms liste.",
      "Cenovnik se bira iz postojećih vrednosti, a mesta utovara su slobodan unos.",
    ],
  },
  {
    slug: "nabavne-cene",
    number: "3",
    title: "Cenovnik nabavnih cena",
    description:
      "Više važećih cena za isti SKU, sa automatskim povlačenjem dobavljača, naziva, atributa, dezena, valute i pariteta.",
    status: "ready",
    commands: [
      {
        label: "Unos nove",
        tone: "primary",
        action: "purchase-price.create",
        fields: [
          {
            key: "sku",
            label: "Šifra artikla",
            type: "text",
            required: true,
          },
          {
            key: "purchasePrice",
            label: "Nabavna cena",
            type: "number",
            required: true,
            min: 0,
            step: 0.01,
          },
          {
            key: "validFrom",
            label: "Važenje cene od",
            type: "date",
            required: true,
          },
          {
            key: "validTo",
            label: "Važenje cene do",
            type: "date",
          },
        ],
      },
      { label: "Uredi", tone: "neutral", clientAction: "edit" },
      {
        label: "Brisanje",
        tone: "danger",
        action: "row.delete",
        needsSelection: true,
        confirm: "Obrisati izabrane nabavne cene? Akcija je nepovratna.",
      },
    ],
    columns: purchasePriceColumns,
    editableColumns: [
      "sku",
      "purchasePrice",
      "validFrom",
      "validTo",
    ],
    rows: emptyRows,
    notes: [
      "Dobavljač, naziv, atributi, dezen, valuta i paritet se automatski preuzimaju iz baze artikala i dobavljača i ne mogu ručno da se menjaju.",
      "Ista šifra artikla može da se unese više puta sa različitim periodima važenja.",
    ],
  },
  {
    slug: "porudzbenice",
    number: "4",
    title: "Porudžbenice",
    description:
      "Pregled porudžbenica i pregled porudžbenica po artiklima, sa sumarnim vrednostima, statusima i komandama za slanje, PDF i Excel.",
    status: "ready",
    commands: [
      { label: "Kreiraj novu", tone: "primary", action: "po.create" },
      {
        label: "Pregled po artiklima",
        tone: "neutral",
        href: "/admin/erp/porudzbenice-po-artiklima",
      },
      {
        label: "Pošalji dobavljaču",
        tone: "neutral",
        action: "po.send",
        needsSelection: true,
        confirm: "Označiti izabrane porudžbenice kao poslate dobavljaču?",
      },
      {
        label: "Proknjiži porudžbenicu",
        tone: "primary",
        action: "po.post",
        needsSelection: true,
        confirm:
          "Proknjižiti i zaključati izabrane porudžbenice? Posle toga redovno uređivanje nije moguće.",
      },
    ],
    columns: purchaseOrderColumns,
    editableColumns: [],
    rows: emptyRows,
    detailHrefBase: "/admin/erp/porudzbenice",
    notes: [
      "Statusi: U obradi, Poslata, Potvrđena, Primljena.",
      "Broj porudžbenice ide po rednom broju za tekuću godinu, npr. 1/26.",
      "Ispod pregleda porudžbenica postoji i pregled po artiklima.",
    ],
  },
  {
    slug: "porudzbenice-po-artiklima",
    number: "4b",
    title: "Porudžbenice po artiklima",
    description:
      "Operativni pregled stavki porudžbenica sa količinom za poručivanje, zapreminom, težinom, carinom, kalkulativnom MPC i BM%.",
    status: "ready",
    commands: [
      {
        label: "Pregled porudžbenica",
        tone: "neutral",
        href: "/admin/erp/porudzbenice",
      },
      {
        label: "Dodaj stavku",
        tone: "neutral",
        disabledReason: "Stavka se dodaje iz detalja konkretne porudžbenice.",
      },
      {
        label: "Proveri pakovanja",
        tone: "neutral",
        action: "po-items.validate-packs",
        needsSelection: true,
      },
    ],
    columns: purchaseOrderItemColumns,
    editableColumns: [],
    rows: emptyRows,
    notes: [
      "Količina treba da se zacrveni kada nije deljiva brojem artikala u pakovanju.",
      "BM% je procena iz kalkulativne MPC bez PDV-a i procenjenog jediničnog COGS-a. Stvarni COGS potvrđuje prijemnica.",
    ],
  },
  {
    slug: "ulazne-fakture",
    number: "5",
    title: "Prijemnice",
    description:
      "Prijem robe, domaće i ino fakture, poreske vrednosti, veze sa porudžbenicama i raspodela troškova za COGS.",
    status: "ready",
    commands: [
      { label: "Nova", tone: "primary", action: "invoice.create" },
      {
        label: "Uredi",
        tone: "neutral",
        clientAction: "open",
        needsSelection: true,
      },
      {
        label: "Proknjiži",
        tone: "neutral",
        action: "invoice.lock",
        needsSelection: true,
        confirm:
          "Proknjižiti izabrane prijemnice i porudžbenice i primiti robu u izabrane magacine?",
      },
      {
        label: "Storniraj",
        tone: "danger",
        action: "invoice.cancel",
        needsSelection: true,
        confirm: "Stornirati izabrane prijemnice i ponovo izračunati COGS i dolaz?",
      },
    ],
    columns: inboundInvoiceColumns,
    editableColumns: [],
    rows: emptyRows,
    detailHrefBase: "/admin/erp/ulazne-fakture",
    notes: [
      "Dvoklik na red otvara pojedinačnu prijemnicu.",
      "Vrednost fakture se vodi u izabranoj valuti i preračunava po konačnom srednjem kursu. Carina se raspoređuje proporcionalno po stopama, a transport i ostali troškovi po zapremini.",
      "Knjiženje je blokirano ako bilo kojoj stavci nedostaje količina po kontejneru ili dimenzije transportnog pakovanja.",
      "Proknjižena prijemnica se ne može redovno menjati niti ponovo uključiti u COGS.",
    ],
  },
  {
    slug: "mp-cene",
    number: "6",
    title: "Upravljanje MP cenama",
    description:
      "Datirani MP cenovnici i predlozi cena sa kontrolisanom objavom i istorijom.",
    status: "ready",
    commands: [
      {
        label: "Otvori cenovnike",
        tone: "primary",
        href: "/admin/erp/cenovnici",
      },
    ],
    columns: retailPriceColumns,
    editableColumns: [],
    rows: emptyRows,
    notes: [
      "MP cena se više ne objavljuje u legacy Product.salePrice polje, već kroz važeće stavke RETAIL cenovnika.",
      "Aktivna artikalska akcija isključuje loyalty; bez nje loyalty važi za sve prijavljene kupce. Linearni popust se dodaje na aktivnu akcijsku ili loyalty cenu.",
      "Kombinovani popust je ograničen admin podešavanjem; početna vrednost je 30%.",
    ],
  },
];

const primaryErpModulePresentation = [
  { slug: "artikli", number: "1", title: "Matični podaci o artiklima" },
  { slug: "dobavljaci", number: "2", title: "Matični podaci o dobavljačima" },
  { slug: "nabavne-cene", number: "3", title: "Cenovnik nabavnih cena" },
  { slug: "porudzbenice", number: "4", title: "Nabavne porudžbenice" },
  { slug: "ulazne-fakture", number: "5", title: "Prijemnice" },
  { slug: "cenovnici", number: "6", title: "Cenovnici" },
  {
    slug: "akcijske-cene",
    number: "7",
    title: "Upravljanje akcijskim cenama i prioritetima",
  },
  { slug: "magacini", number: "8", title: "Magacini" },
  { slug: "stanje-po-magacinima", number: "9", title: "Lageri" },
  { slug: "prodajni-nalozi", number: "10", title: "Pregled porudžbina" },
  { slug: "otpremnice", number: "12", title: "Otpremnice" },
  {
    slug: "preuzimanja",
    number: "13",
    title: "Nalozi za preuzimanje (Kurirske službe)",
  },
  { slug: "integracije", number: "14", title: "Povezivanje sa Ananasom" },
  {
    slug: "racunovodstveni-registri",
    number: "15",
    title: "Knjigovodstveni izveštaji",
  },
  {
    slug: "partner-klijenti",
    number: "16",
    title: "API za razmenu lagera i rezervacije",
  },
  { slug: "popisi", number: "17", title: "Popisi" },
  { slug: "kupci", number: "19", title: "Baza kupaca" },
] as const;

const allErpRouteModules = [...coreErpModules, ...operationalErpModules];
const primaryErpModuleSlugs = new Set<string>(
  primaryErpModulePresentation.map((module) => module.slug),
);

const primaryErpRouteModules = primaryErpModulePresentation.map((presentation) => {
  const routeModule = allErpRouteModules.find(
    (candidate) => candidate.slug === presentation.slug,
  );

  if (!routeModule) {
    throw new Error(`Nedostaje definicija ERP modula: ${presentation.slug}`);
  }

  return {
    ...routeModule,
    number: presentation.number,
    title: presentation.title,
  };
});

const secondaryErpRouteModules = allErpRouteModules
  .filter((routeModule) => !primaryErpModuleSlugs.has(routeModule.slug))
  .map((routeModule, index) => ({
    ...routeModule,
    number: String(20 + index),
  }));

export const erpModules: ErpModule[] = [
  ...primaryErpRouteModules,
  ...secondaryErpRouteModules,
];

export type ErpDashboardModule = Pick<
  ErpModule,
  "slug" | "number" | "title" | "description" | "status"
> & {
  href: string;
};

const fiscalizationDashboardModule: ErpDashboardModule = {
  slug: "fiskalizacija",
  number: "11",
  title: "Fiskalizacija i refundacija",
  description:
    "Jedinstven pregled fiskalnih dokumenata, ručne i automatske fiskalizacije i refundacija.",
  status: "ready",
  href: "/admin/fiskalizacija",
};

let secondaryDashboardModuleNumber = 20;

export const erpDashboardModules: ErpDashboardModule[] = erpModules.flatMap(
  (routeModule) => {
    if (routeModule.redirectHref) return [];

    const dashboardNumber = primaryErpModuleSlugs.has(routeModule.slug)
      ? routeModule.number
      : String(secondaryDashboardModuleNumber++);
    const dashboardModule = {
      slug: routeModule.slug,
      number: dashboardNumber,
      title: routeModule.title,
      description: routeModule.description,
      status: routeModule.status,
      href: `/admin/erp/${routeModule.slug}`,
    } satisfies ErpDashboardModule;

    return routeModule.number === "12"
      ? [fiscalizationDashboardModule, dashboardModule]
      : [dashboardModule];
  },
);

export async function getErpDashboardModules() {
  const availability = await getPickupPostingAvailability();
  return erpDashboardModules.map((module) =>
    module.slug === "preuzimanja"
      ? { ...module, status: availability.available ? "ready" as const : "blocked_external" as const }
      : module,
  );
}

export function getErpModuleDefinition(slug: string) {
  return erpModules.find((m) => m.slug === slug);
}

export async function getErpModule(
  slug: string,
  options: {
    take?: number;
    skip?: number;
    warehouseId?: string | null;
    includeLookupOptions?: boolean;
    query?: string;
    searchColumn?: string;
    salesOrderFilters?: SalesOrderExportFilters;
    stocktakeArchived?: boolean;
  } = {},
) {
  const definition = getErpModuleDefinition(slug);
  if (!definition) return undefined;
  const pickupAvailability =
    slug === "preuzimanja" ? await getPickupPostingAvailability() : null;
  const runtimeDefinition = pickupAvailability
    ? {
        ...definition,
        status: pickupAvailability.available
          ? ("ready" as const)
          : ("blocked_external" as const),
        blockedReason: pickupAvailability.reason ?? undefined,
      }
    : definition;
  const take = Math.max(1, Math.min(options.take ?? 100, 500_000));
  const skip = Math.max(0, options.skip ?? 0);
  const includeLookupOptions = options.includeLookupOptions !== false;
  const [rows, articleContext, supplierContext, purchasePriceContext] = await Promise.all([
    getPersistedErpRows(
      slug,
      take,
      options.warehouseId,
      options.query,
      options.searchColumn,
      {
        ...options.salesOrderFilters,
        stocktakeArchived: options.stocktakeArchived,
      },
      skip,
    ),
    includeLookupOptions && slug === "artikli"
      ? getArticleModuleContext()
      : Promise.resolve(null),
    includeLookupOptions && slug === "dobavljaci"
      ? getSupplierModuleContext()
      : Promise.resolve(null),
    includeLookupOptions && slug === "nabavne-cene"
      ? getPurchasePriceModuleContext()
      : Promise.resolve(null),
  ]);
  const columns = runtimeDefinition.columns.map((column) => ({
    ...column,
    options: articleContext
      ? column.key === "supplier"
        ? articleContext.suppliers
        : column.key === "category"
          ? articleContext.categories
          : column.key === "subgroup"
            ? articleContext.subgroups
          : column.key === "group"
            ? articleContext.groups
            : column.key === "collection"
              ? articleContext.collections
              : column.options
      : supplierContext
        ? column.key === "defaultPriceList"
          ? supplierContext.priceLists
          : column.options
        : purchasePriceContext && column.key === "sku"
          ? purchasePriceContext.skus
        : column.options,
  }));
  const commands = runtimeDefinition.commands
    .filter((command) => {
      if (slug !== "popisi") return true;
      if (options.stocktakeArchived) {
        return (
          command.action === "stocktake.restore" ||
          command.href === "/admin/erp/popisi"
        );
      }
      return (
        command.action !== "stocktake.restore" &&
        command.href !== "/admin/erp/popisi"
      );
    })
    .map((command) => ({
    ...command,
    label:
      pickupAvailability?.provider === "MYGLS" && command.action === "pickup.post"
        ? "Kreiraj adresnice"
        : command.label,
    disabledReason:
      pickupAvailability && command.action === "pickup.post"
        ? pickupAvailability.reason ?? undefined
        : command.disabledReason,
    fields: command.fields?.map((field) => ({
      ...field,
      options:
        purchasePriceContext && field.key === "sku"
          ? undefined
          : field.options,
      valueLabels:
        purchasePriceContext && field.key === "sku"
          ? purchasePriceContext.namesBySku
          : field.valueLabels,
      valueLabel:
        purchasePriceContext && field.key === "sku"
          ? "Naziv artikla"
          : field.valueLabel,
      valueNotFoundText:
        purchasePriceContext && field.key === "sku"
          ? "Artikal sa tom šifrom nije pronađen."
          : field.valueNotFoundText,
    })),
    }));
  return {
    ...runtimeDefinition,
    columns,
    commands,
    rows,
    contextFilters: articleContext
      ? [
          {
            key: "warehouseId",
            label: "Kontekst zaliha",
            options: [
              { value: "", label: "Svi magacini" },
              ...articleContext.warehouses,
            ],
          },
        ]
      : runtimeDefinition.contextFilters,
    notes: [
      ...(runtimeDefinition.notes ?? []),
      rows.length
        ? "Redovi su učitani iz baze. Izmene podržanih polja se snimaju kroz admin API i ulaze u audit log."
        : "Nema još zapisa u bazi za ovaj ERP modul.",
    ],
  };
}

async function getPersistedErpRows(
  slug: string,
  take: number,
  warehouseId?: string | null,
  query?: string,
  searchColumn?: string,
  salesOrderFilters?: SalesOrderExportFilters,
  skip = 0,
): Promise<ErpRow[]> {
  switch (slug) {
    case "artikli":
      return getArticleRows(take, warehouseId, query, searchColumn, skip);
    case "dobavljaci":
      return getSupplierRows(take);
    case "nabavne-cene":
      return getPurchasePriceRows(take);
    case "porudzbenice":
      return getPurchaseOrderRows(take);
    case "porudzbenice-po-artiklima":
      return getPurchaseOrderItemRows(take);
    case "ulazne-fakture":
      return getInboundInvoiceRows(take);
    case "mp-cene":
      return getRetailPriceRows(take);
    default:
      return getOperationalErpRows(slug, take, {
        ...salesOrderFilters,
        ...(warehouseId ? { warehouseId } : {}),
      });
  }
}

async function getArticleModuleContext() {
  const [warehouses, suppliers, categories, groups, collections] = await Promise.all([
    db.warehouse.findMany({
      where: { active: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, name: true, code: true, isDefault: true },
    }),
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    db.category.findMany({
      orderBy: [{ level: "asc" }, { name: "asc" }],
      select: { name: true, level: true },
    }),
    db.group.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    db.collection.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
  ]);
  return {
    warehouses: warehouses.map((warehouse) => ({
      value: warehouse.id,
      label: `${warehouse.name} (${warehouse.code})${warehouse.isDefault ? " · DC" : ""}`,
    })),
    suppliers: suppliers.map((row) => row.name),
    categories: categories.filter((row) => row.level === 0).map((row) => row.name),
    subgroups: categories.filter((row) => row.level > 0).map((row) => row.name),
    groups: groups.map((row) => row.name),
    collections: collections.map((row) => row.name),
  };
}

async function getSupplierModuleContext() {
  const priceLists = await db.priceList.findMany({
    where: { active: true },
    orderBy: { code: "asc" },
    select: { code: true },
  });

  return {
    priceLists: priceLists.map((priceList) => priceList.code),
  };
}

async function getPurchasePriceModuleContext() {
  const products = await db.product.findMany({
    where: { deletedAt: null },
    orderBy: { sku: "asc" },
    select: { sku: true, name: true },
  });
  return {
    skus: products.map((product) => product.sku),
    namesBySku: Object.fromEntries(
      products.map((product) => [
        product.sku.toLocaleLowerCase("sr-Latn-RS"),
        product.name,
      ]),
    ),
  };
}

async function getArticleRows(
  take: number,
  selectedWarehouseId?: string | null,
  query?: string,
  searchColumn?: string,
  skip = 0,
): Promise<ErpRow[]> {
  const where = articleSearchWhere(query, searchColumn);
  const [products, activeWarehouses] = await Promise.all([db.product.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take,
    skip,
    select: {
      id: true,
      sku: true,
      barcode: true,
      slug: true,
      name: true,
      shortName: true,
      description: true,
      shortDescription: true,
      sizeLabel: true,
      colorPrimary: true,
      colorSecondary: true,
      attribute1: true,
      attribute2: true,
      attribute3: true,
      attribute4: true,
      cogs: true,
      customsRate: true,
      widthCm: true,
      depthCm: true,
      heightCm: true,
      fullPrice: true,
      stock: true,
      incomingStock: true,
      supplierExternalId: true,
      supplierStock: true,
      supplierReservedStock: true,
      lastSupplierStockSyncAt: true,
      supplierNextArrivalAt: true,
      supplierApprovalStatus: true,
      deliveryDaysMax: true,
      allowsAssembly: true,
      isActive: true,
      isDtz: true,
      isLimited: true,
      articleStatus: true,
      weightKg: true,
      grossWeightKg: true,
      unitPackWidthCm: true,
      unitPackDepthCm: true,
      unitPackHeightCm: true,
      packQty: true,
      palletQty: true,
      packWidthCm: true,
      packDepthCm: true,
      packHeightCm: true,
      packGrossWeightKg: true,
      containerQty: true,
      containerGrossWeightKg: true,
      supplierProductName: true,
      materialText: true,
      hsCode: true,
      moq: true,
      newUntil: true,
      ananasBrokeragePct: true,
      ananasStoragePct: true,
      ananasDeliveryPct: true,
      availableWebManual: true,
      availableWholesaleManual: true,
      availableExportManual: true,
      supplier: {
        select: {
          name: true,
          parity: true,
          deliveryDays: true,
          integrationKey: true,
          enabled: true,
        },
      },
      group: { select: { name: true } },
      collection: { select: { name: true } },
      categories: {
        take: 1,
        select: {
          category: {
            select: {
              name: true,
              path: true,
              parent: { select: { name: true } },
            },
          },
        },
      },
      media: {
        take: 1,
        orderBy: { order: "asc" },
        where: { kind: "IMAGE", syncStatus: "READY" },
        select: { url: true, thumbUrl: true },
      },
      materials: {
        take: 2,
        select: { material: { select: { label: true } } },
      },
      purchasePrices: {
        take: 1,
        orderBy: { validFrom: "desc" },
        select: { price: true, currency: true, parity: true },
      },
      warehouseStocks: {
        where: { warehouse: { active: true } },
        select: {
          qty: true,
          warehouse: {
            select: { id: true, name: true, isDefault: true },
          },
        },
      },
      orderItems: {
        where: {
          warehouseReservedQty: { gt: 0 },
          order: {
            status: {
              notIn: ["ISPORUCENO", "OTKAZANO", "VRACENO"],
            },
          },
        },
        select: { warehouseId: true, warehouseReservedQty: true },
      },
      partnerReservations: {
        where: {
          status: "ACTIVE",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { warehouseId: true, qty: true },
      },
      lookupAssignments: {
        where: {
          lookupValue: {
            kind: { in: ["BENEFIT", "CERTIFICATE"] },
            active: true,
          },
        },
        select: { lookupValue: { select: { kind: true, value: true } } },
      },
      familyMembership: {
        select: {
          label: true,
          colorHex: true,
          position: true,
          storefrontEnabled: true,
          family: { select: { code: true, primaryProductId: true } },
        },
      },
    },
  }), db.warehouse.findMany({
    where: { active: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, name: true, isDefault: true },
  })]);

  return products.map((product) => {
    const width = asNumber(product.widthCm);
    const depth = asNumber(product.depthCm);
    const height = asNumber(product.heightCm);
    const packWidth = asNumber(product.packWidthCm);
    const packDepth = asNumber(product.packDepthCm);
    const packHeight = asNumber(product.packHeightCm);
    const unitPackWidth = asNumber(product.unitPackWidthCm);
    const unitPackDepth = asNumber(product.unitPackDepthCm);
    const unitPackHeight = asNumber(product.unitPackHeightCm);
    const volume =
      width !== null && depth !== null && height !== null
        ? Number(((width * depth * height) / 1_000_000).toFixed(3))
        : null;
    const area =
      width !== null && depth !== null
        ? Number(((width * depth) / 10_000).toFixed(3))
        : null;
    const packVolume =
      packWidth !== null && packDepth !== null && packHeight !== null
        ? Number(((packWidth * packDepth * packHeight) / 1_000_000).toFixed(3))
        : null;
    const unitPackVolume =
      unitPackWidth !== null && unitPackDepth !== null && unitPackHeight !== null
        ? Number(
            ((unitPackWidth * unitPackDepth * unitPackHeight) / 1_000_000).toFixed(3),
          )
        : null;
    const lastPurchase = product.purchasePrices[0] ?? null;
    const stockRows = new Map(
      product.warehouseStocks.map((row) => [row.warehouse.id, row.qty]),
    );
    const stock = computeArticleStock({
      aggregateStock: product.stock,
      warehouses: activeWarehouses.map((warehouse) => ({
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        isDefault: warehouse.isDefault,
        qty:
          stockRows.get(warehouse.id) ??
          (!stockRows.size && warehouse.isDefault ? product.stock : 0),
      })),
      orderReservations: product.orderItems.map((row) => ({
        warehouseId: row.warehouseId,
        qty: row.warehouseReservedQty,
      })),
      partnerReservations: product.partnerReservations,
      manualWeb: product.availableWebManual,
      manualWholesale: product.availableWholesaleManual,
      manualExport: product.availableExportManual,
      selectedWarehouseId,
    });
    const benefits = product.lookupAssignments
      .filter((row) => row.lookupValue.kind === "BENEFIT")
      .map((row) => row.lookupValue.value)
      .join(", ");
    const certificates = product.lookupAssignments
      .filter((row) => row.lookupValue.kind === "CERTIFICATE")
      .map((row) => row.lookupValue.value)
      .join(", ");
    const mediaUrl = resolveSupabaseStorageUrl(
      product.media[0]?.thumbUrl ?? product.media[0]?.url,
    );
    const isRabalux =
      product.supplier?.integrationKey === "RABALUX" &&
      Boolean(product.supplierExternalId);
    const rabaluxStock = isRabalux
      ? resolveRabaluxSupplierStock({
          supplierStock: product.supplierStock,
          supplierReservedStock: product.supplierReservedStock,
          lastSupplierStockSyncAt: product.lastSupplierStockSyncAt,
          supplierOperational: isRabaluxSupplierOperational(product.supplier),
          supplierApproved: product.supplierApprovalStatus === "APPROVED",
        })
      : null;
    return {
      id: product.id,
      values: {
        photo: mediaUrl || null,
        status: product.articleStatus,
        sku: product.sku,
        supplierExternalId: product.supplierExternalId,
        supplier: product.supplier?.name ?? null,
        supplierIntegrationKey: product.supplier?.integrationKey ?? null,
        category:
          product.categories[0]?.category.parent?.name ??
          product.categories[0]?.category.name ??
          null,
        group: product.group?.name ?? null,
        subgroup: product.categories[0]?.category.parent
          ? product.categories[0].category.name
          : null,
        collection: product.collection?.name ?? null,
        shortDescription: product.shortDescription ?? null,
        shortName: product.shortName ?? product.name,
        attribute1: product.attribute1 ?? product.sizeLabel ?? null,
        attribute2: product.attribute2 ?? null,
        attribute3: product.attribute3 ?? null,
        attribute4: product.attribute4 ?? null,
        color1: product.colorPrimary ?? null,
        color2: product.colorSecondary ?? null,
        familyCode: product.familyMembership?.family.code ?? null,
        familyColorLabel: product.familyMembership?.label ?? null,
        familyColorHex: product.familyMembership?.colorHex ?? null,
        familyPosition: product.familyMembership?.position ?? null,
        familyPrimary:
          product.familyMembership?.family.primaryProductId === product.id,
        familyStorefrontEnabled:
          product.familyMembership?.storefrontEnabled ?? false,
        benefits: benefits || null,
        certificates: certificates || null,
        siteDescription: richTextPlainText(product.description),
        stockTotal: stock.physicalTotal,
        reservedStock: stock.contextual.reserved,
        availableTotal: stock.availableTotal,
        stockDc: stock.contextual.physical,
        availableDc: stock.contextual.available,
        rabaluxStock: rabaluxStock?.rawStock ?? null,
        rabaluxReserved: rabaluxStock?.reservedStock ?? null,
        rabaluxSafetyStock: rabaluxStock?.safetyStock ?? null,
        rabaluxSellableStock: rabaluxStock?.sellableStock ?? null,
        rabaluxStockStatus: rabaluxStock
          ? RABALUX_SUPPLIER_STOCK_STATUS_LABELS[rabaluxStock.status]
          : null,
        rabaluxStockSyncedAt:
          isRabalux && product.lastSupplierStockSyncAt
            ? product.lastSupplierStockSyncAt.toISOString()
            : null,
        rabaluxNextArrivalAt:
          isRabalux && product.supplierNextArrivalAt
            ? product.supplierNextArrivalAt.toISOString()
            : null,
        cogs: asNumber(product.cogs),
        incomingTotal: product.incomingStock,
        incomingAvailable: product.incomingStock,
        widthCm: width,
        heightCm: height,
        depthCm: depth,
        areaM2: area,
        volumeM3: volume,
        weightKg: asNumber(product.weightKg),
        grossWeightKg: asNumber(product.grossWeightKg),
        unitPackWidthCm: unitPackWidth,
        unitPackDepthCm: unitPackDepth,
        unitPackHeightCm: unitPackHeight,
        unitPackVolumeM3: unitPackVolume,
        packQty: product.packQty,
        palletQty: product.palletQty,
        packWidthCm: packWidth,
        packDepthCm: packDepth,
        packHeightCm: packHeight,
        packVolumeM3: packVolume,
        packGrossWeightKg: asNumber(product.packGrossWeightKg),
        containerQty: product.containerQty,
        containerGrossWeightKg: asNumber(product.containerGrossWeightKg),
        lastPurchasePrice: lastPurchase ? asNumber(lastPurchase.price) : null,
        lastPurchaseCurrency: lastPurchase?.currency ?? null,
        supplierName: product.supplierProductName ?? product.supplier?.name ?? null,
        material:
          product.materialText ??
          (product.materials.map((item) => item.material.label).join(", ") || null),
        barcode: product.barcode ?? null,
        siteLink: `/p/${product.slug}`,
        webAuto: stock.channels.webAuto,
        webCheck: product.availableWebManual,
        wholesaleAuto: stock.channels.wholesaleAuto,
        wholesaleCheck: product.availableWholesaleManual,
        exportAuto: stock.channels.exportAuto,
        exportCheck: product.availableExportManual,
        customsRate: asNumber(product.customsRate),
        hsCode: product.hsCode,
        moq: product.moq,
        ananasBrokerage: asNumber(product.ananasBrokeragePct),
        ananasStorage: asNumber(product.ananasStoragePct),
        ananasDelivery: asNumber(product.ananasDeliveryPct),
        parity: product.supplier?.parity ?? null,
        deliveryDays: product.supplier?.deliveryDays ?? null,
        newUntil: dateOnly(product.newUntil),
        calcRetailPrice: asNumber(product.fullPrice),
      },
    };
  });
}

export function countArticleRows(query?: string, searchColumn?: string) {
  return db.product.count({
    where: articleSearchWhere(query, searchColumn),
  });
}

async function getSupplierRows(take: number): Promise<ErpRow[]> {
  const suppliers = await db.supplier.findMany({
    orderBy: { name: "asc" },
    take,
    select: {
      id: true,
      code: true,
      name: true,
      address: true,
      city: true,
      country: true,
      email: true,
      phone: true,
      currency: true,
      parity: true,
      paymentTerms: true,
      deliveryDays: true,
      transitDays: true,
      bank: true,
      swift: true,
      iban: true,
      defaultPriceList: { select: { code: true } },
      loadingLocations: {
        orderBy: { position: "asc" },
        take: 3,
        select: { position: true, name: true },
      },
    },
  });

  return suppliers.map((supplier) => ({
    id: supplier.id,
    values: {
      code: supplier.code,
      name: supplier.name,
      address: supplier.address ?? null,
      city: supplier.city ?? null,
      country: supplier.country ?? "RS",
      email: supplier.email ?? null,
      phone: supplier.phone ?? null,
      currency: currencyLabel(supplier.currency),
      parity: supplier.parity ?? null,
      paymentTerms: supplier.paymentTerms ?? null,
      deliveryDays: supplier.deliveryDays ?? null,
      transitDays: supplier.transitDays ?? null,
      bank: supplier.bank ?? null,
      swift: supplier.swift ?? null,
      iban: supplier.iban ?? null,
      defaultPriceList: supplier.defaultPriceList?.code ?? null,
      loading1: supplier.loadingLocations.find((item) => item.position === 1)?.name ?? null,
      loading2: supplier.loadingLocations.find((item) => item.position === 2)?.name ?? null,
      loading3: supplier.loadingLocations.find((item) => item.position === 3)?.name ?? null,
    },
  }));
}

async function getPurchasePriceRows(take: number): Promise<ErpRow[]> {
  const prices = await db.purchasePrice.findMany({
    orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
    take,
    include: {
      supplier: { select: { name: true } },
      product: {
        select: {
          name: true,
          attribute1: true,
          attribute2: true,
          attribute3: true,
          attribute4: true,
          sizeLabel: true,
          colorPrimary: true,
          colorSecondary: true,
        },
      },
    },
  });

  return prices.map((price) => ({
    id: price.id,
    values: {
      sku: price.sku,
      supplier: price.supplier?.name ?? null,
      name: price.name ?? price.product?.name ?? null,
      attributes:
        price.attributes ??
        (price.product ? composePurchasePriceAttributes(price.product) : null),
      pattern:
        price.pattern ??
        (price.product ? composePurchasePricePattern(price.product) : null),
      purchasePrice: asNumber(price.price),
      currency: currencyLabel(price.currency),
      parity: price.parity ?? null,
      validFrom: dateOnly(price.validFrom),
      validTo: dateOnly(price.validTo),
    },
  }));
}

async function getPurchaseOrderRows(take: number): Promise<ErpRow[]> {
  const orders = await db.purchaseOrder.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: {
      supplier: { select: { name: true } },
    },
  });

  return orders.map((order) => ({
    id: order.id,
    values: {
      number: order.number,
      status: purchaseOrderStatusLabel(order.status),
      supplier: order.supplier?.name ?? null,
      createdAt: dateOnly(order.createdAt),
      orderDate: dateOnly(order.orderDate),
      loadingDate: dateOnly(order.loadingDate),
      deliveryDate: dateOnly(order.deliveryDate),
      totalVolume: asNumber(order.totalVolume),
      totalWeight: asNumber(order.totalWeight),
      totalPrice: asNumber(order.totalPrice),
      currency: currencyLabel(order.currency),
      transportType: order.transportType ?? null,
      parity: order.parity ?? null,
      bmPct: asNumber(order.bmPct),
    },
  }));
}

async function getPurchaseOrderItemRows(take: number): Promise<ErpRow[]> {
  const items = await db.purchaseOrderItem.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: {
      purchaseOrder: {
        select: {
          number: true,
          status: true,
          createdAt: true,
          orderDate: true,
          loadingDate: true,
          deliveryDate: true,
          currency: true,
          transportType: true,
          parity: true,
          supplier: { select: { name: true } },
        },
      },
      product: { select: { media: { take: 1, orderBy: { order: "asc" }, select: { url: true } } } },
    },
  });

  return items.map((item) => ({
    id: item.id,
    cellHrefs: item.productId
      ? { photo: `/admin/erp/artikli/${item.productId}#mediji` }
      : undefined,
    values: {
      poNumber: item.purchaseOrder.number,
      status: purchaseOrderStatusLabel(item.purchaseOrder.status),
      headerSupplier: item.purchaseOrder.supplier?.name ?? null,
      createdAt: dateOnly(item.purchaseOrder.createdAt),
      orderDate: dateOnly(item.purchaseOrder.orderDate),
      loadingDate: dateOnly(item.purchaseOrder.loadingDate),
      deliveryDate: dateOnly(item.purchaseOrder.deliveryDate),
      headerCurrency: currencyLabel(item.purchaseOrder.currency),
      transportType: item.purchaseOrder.transportType ?? null,
      headerParity: item.purchaseOrder.parity ?? null,
      sku: item.sku,
      photo: item.product?.media[0]?.url
        ? resolveSupabaseStorageUrl(item.product.media[0].url)
        : null,
      supplier: item.purchaseOrder.supplier?.name ?? null,
      name: item.name,
      attributes: item.attributes ?? null,
      pattern: item.pattern ?? null,
      purchasePrice: asNumber(item.purchasePrice),
      currency: currencyLabel(item.currency),
      parity: item.parity ?? item.purchaseOrder.parity ?? null,
      validFrom: dateOnly(item.priceValidFrom),
      moq: item.moq ?? null,
      packQty: item.packQty ?? null,
      qty: item.qty,
      totalVolume: asNumber(item.totalVolume),
      totalWeight: asNumber(item.totalWeight),
      customsRate: asNumber(item.customsRate),
      calcRetailPrice: asNumber(item.calcRetailPrice),
      bmPct: asNumber(item.bmPct),
      supplierProductName: item.supplierProductName ?? null,
      certificates: item.certificates ?? null,
      barcode: item.barcode ?? null,
    },
  }));
}

async function getInboundInvoiceRows(take: number): Promise<ErpRow[]> {
  const invoices = await db.inboundInvoice.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: {
      supplier: { select: { name: true } },
      purchaseOrder: { select: { number: true } },
      warehouse: { select: { name: true } },
    },
  });

  return invoices.map((invoice) => ({
    id: invoice.id,
    cellHrefs: invoice.purchaseOrderId
      ? {
          purchaseOrder: `/admin/erp/porudzbenice/${invoice.purchaseOrderId}`,
        }
      : undefined,
    values: {
      number: invoice.number,
      type: invoice.type,
      supplier: invoice.supplier?.name ?? null,
      purchaseOrder: invoice.purchaseOrder?.number ?? null,
      warehouse: invoice.warehouse?.name ?? null,
      status: inboundInvoiceStatusLabel(invoice.status),
      invoiceDate: dateOnly(invoice.invoiceDate),
      currency: currencyLabel(invoice.currency),
      exchangeRate: asNumber(invoice.exchangeRate),
      invoiceValueRsd: asNumber(invoice.invoiceValueRsd),
      customsValueRsd: asNumber(invoice.customsValueRsd),
      transportValueRsd: asNumber(invoice.transportValueRsd),
      otherRelatedCostsRsd: asNumber(invoice.otherRelatedCostsRsd),
      netValue: asNumber(invoice.netValue),
      vatValue: asNumber(invoice.vatValue),
      grossValue: asNumber(invoice.grossValue),
      allocationBasis: invoice.allocationBasis,
      cogsStatus: cogsStatusLabel(invoice.cogsStatus),
      locked: Boolean(invoice.lockedAt),
    },
  }));
}

async function getRetailPriceRows(take: number): Promise<ErpRow[]> {
  const now = new Date();
  const products = await db.product.findMany({
    orderBy: { updatedAt: "desc" },
    take,
    select: {
      id: true,
      sku: true,
      name: true,
      fullPrice: true,
      cogs: true,
      priceListEntries: {
        where: {
          priceList: { kind: "RETAIL", active: true },
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gte: now } }],
        },
        include: { priceList: true },
        orderBy: { validFrom: "desc" },
      },
      updatedAt: true,
      isActive: true,
    },
  });

  return products.map((product) => {
    const retailPrice = resolveRetailPrice(
      product.priceListEntries,
      product.fullPrice,
      now,
    );
    const cogs = asNumber(product.cogs);
    return {
      id: product.id,
      values: {
        sku: product.sku,
        name: product.name,
        currentMpc: retailPrice.price,
        calcMpc: asNumber(product.fullPrice),
        bmPct: grossMarginPct(retailPrice.price, cogs),
        validFrom: dateOnly(product.updatedAt),
        status: product.isActive ? "Objavljeno" : "Arhiva",
      },
    };
  });
}
