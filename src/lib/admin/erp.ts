import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type ErpValue = string | number | boolean | null;

export type ErpColumn = {
  key: string;
  label: string;
  type?: "text" | "number" | "money" | "date" | "status" | "boolean";
  options?: string[];
  defaultVisible?: boolean;
  align?: "left" | "right" | "center";
};

export type ErpRow = {
  id: string;
  values: Record<string, ErpValue>;
};

export type ErpCommand = {
  label: string;
  tone?: "primary" | "danger" | "neutral";
  /** Server command key dispatched to POST /api/admin/erp/[module]/commands. */
  action?: string;
  /** If set, the button navigates to this href instead of dispatching. */
  href?: string;
  /** Command operates on the currently selected rows (button disabled until selection). */
  needsSelection?: boolean;
  /** Optional native confirm() text shown before the command runs. */
  confirm?: string;
};

export type ErpModule = {
  slug: string;
  number: string;
  title: string;
  description: string;
  status: "ready" | "scaffold";
  commands: ErpCommand[];
  columns: ErpColumn[];
  rows: ErpRow[];
  notes?: string[];
  /** When set, each row gets an "Otvori" link to `${detailHrefBase}/${row.id}`. */
  detailHrefBase?: string;
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

function articleStatus(product: {
  isActive: boolean;
  isDtz: boolean;
  isLimited: boolean;
}) {
  if (!product.isActive) return "ARH";
  if (product.isDtz) return "DTZ";
  if (product.isLimited) return "IT";
  return "SP";
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
    PENDING: "Čeka razradu",
    CALCULATED: "Razrađen",
    LOCKED: "Zaključan",
  };
  return labels[status] ?? status;
}

const articleColumns: ErpColumn[] = [
  { key: "photo", label: "Foto", defaultVisible: true },
  { key: "status", label: "Status", type: "status", options: ["SP", "DTZ", "IT", "ARH"], defaultVisible: true },
  { key: "sku", label: "Šifra", defaultVisible: true },
  { key: "supplier", label: "Dobavljač", options: ["Nord Casa", "Forma Legno"], defaultVisible: true },
  { key: "category", label: "Kategorija", options: ["Nameštaj", "Trpezarije", "Spavaće sobe"], defaultVisible: true },
  { key: "group", label: "Grupa", options: ["Police", "Stolovi", "Ormari"], defaultVisible: true },
  { key: "subgroup", label: "Podgrupa" },
  { key: "collection", label: "Kolekcija", defaultVisible: true },
  { key: "shortDescription", label: "Kratki opis", defaultVisible: true },
  { key: "shortName", label: "Kratki naziv", defaultVisible: true },
  { key: "attribute1", label: "Atribut 1" },
  { key: "attribute2", label: "Atribut 2" },
  { key: "attribute3", label: "Atribut 3" },
  { key: "attribute4", label: "Atribut 4" },
  { key: "color1", label: "Boja 1" },
  { key: "color2", label: "Boja 2" },
  { key: "benefits", label: "Benefiti" },
  { key: "siteDescription", label: "Opis za sajt" },
  { key: "stockTotal", label: "Ukupne zalihe", type: "number", align: "right", defaultVisible: true },
  { key: "stockDc", label: "Zalihe DC", type: "number", align: "right", defaultVisible: true },
  { key: "availableTotal", label: "Raspoloživo ukupno", type: "number", align: "right" },
  { key: "availableDc", label: "Raspoloživo DC", type: "number", align: "right" },
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
  { key: "packQty", label: "Kom/pak", type: "number", align: "right" },
  { key: "packWidthCm", label: "Pak. širina", type: "number", align: "right" },
  { key: "packDepthCm", label: "Pak. dubina", type: "number", align: "right" },
  { key: "packHeightCm", label: "Pak. visina", type: "number", align: "right" },
  { key: "packVolumeM3", label: "Pak. m3", type: "number", align: "right" },
  { key: "packGrossWeightKg", label: "Pak. bruto kg", type: "number", align: "right" },
  { key: "lastPurchasePrice", label: "Posl. nabavna", type: "money", align: "right" },
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
];

const articleRows: ErpRow[] = [
  {
    id: "art-1",
    values: {
      photo: "IMG",
      status: "SP",
      sku: "BS-N2212",
      supplier: "Nord Casa",
      category: "Nameštaj",
      group: "Police",
      subgroup: "Otvorene police",
      collection: "Björn",
      shortDescription: "Otvorena polica",
      shortName: "N2212",
      attribute1: "Hrast",
      attribute2: "Metal",
      color1: "Natur",
      color2: "Grafit",
      benefits: "Masiv, laka montaža",
      stockTotal: 12,
      stockDc: 12,
      availableTotal: 10,
      availableDc: 10,
      cogs: 18400,
      incomingTotal: 24,
      incomingAvailable: 18,
      weightKg: 34,
      widthCm: 80,
      heightCm: 180,
      depthCm: 32,
      areaM2: 0.26,
      volumeM3: 0.46,
      grossWeightKg: 38,
      packQty: 1,
      packWidthCm: 88,
      packDepthCm: 38,
      packHeightCm: 188,
      packVolumeM3: 0.63,
      packGrossWeightKg: 41,
      lastPurchasePrice: 158,
      supplierName: "BJORN shelf N2212",
      material: "Hrast + čelik",
      certificates: "FSC",
      barcode: "8600000122124",
      hsCode: "940360",
      customsRate: 10,
      ananasBrokerage: 12,
      ananasStorage: 4,
      ananasDelivery: 6,
      siteLink: "/p/polica-bjorn-n2212",
      webAuto: true,
      webCheck: true,
      wholesaleAuto: true,
      wholesaleCheck: true,
      exportAuto: false,
      exportCheck: true,
      parity: "DAP",
      deliveryDays: 21,
      moq: 6,
    },
  },
  {
    id: "art-2",
    values: {
      photo: "IMG",
      status: "DTZ",
      sku: "ST-D1101",
      supplier: "Forma Legno",
      category: "Trpezarije",
      group: "Stolovi",
      subgroup: "Trpezarijski stolovi",
      collection: "Dora",
      shortDescription: "Sto za 6 osoba",
      shortName: "D1101",
      attribute1: "Jasen",
      attribute2: "Masiv",
      color1: "Natur",
      benefits: "Ručni završetak",
      stockTotal: 7,
      stockDc: 7,
      availableTotal: 6,
      availableDc: 6,
      cogs: 64400,
      incomingTotal: 12,
      incomingAvailable: 9,
      weightKg: 58,
      widthCm: 180,
      heightCm: 76,
      depthCm: 90,
      areaM2: 1.62,
      volumeM3: 1.23,
      grossWeightKg: 66,
      packQty: 1,
      packWidthCm: 188,
      packDepthCm: 98,
      packHeightCm: 22,
      packVolumeM3: 0.41,
      packGrossWeightKg: 70,
      lastPurchasePrice: 545,
      supplierName: "DORA table 180",
      material: "Masiv jasena",
      certificates: "FSC",
      barcode: "8600000111012",
      hsCode: "940360",
      customsRate: 10,
      siteLink: "/p/trpezarijski-sto-dora-d1101",
      webAuto: true,
      webCheck: true,
      wholesaleAuto: false,
      wholesaleCheck: true,
      exportAuto: false,
      exportCheck: false,
      parity: "EXW",
      deliveryDays: 35,
      moq: 4,
    },
  },
  {
    id: "art-3",
    values: {
      photo: "IMG",
      status: "IT",
      sku: "OR-G3140",
      supplier: "Nord Casa",
      category: "Spavaće sobe",
      group: "Ormari",
      subgroup: "Garderobni ormari",
      collection: "Tora",
      shortDescription: "Trokrilni ormar",
      shortName: "G3140",
      attribute1: "Ogledalo",
      color1: "Hrast natur",
      stockTotal: 4,
      stockDc: 4,
      availableTotal: 3,
      availableDc: 3,
      incomingTotal: 8,
      incomingAvailable: 8,
      widthCm: 150,
      heightCm: 220,
      depthCm: 60,
      volumeM3: 1.98,
      grossWeightKg: 110,
      packQty: 2,
      lastPurchasePrice: 420,
      supplierName: "TORA wardrobe G3140",
      barcode: "8600000131409",
      hsCode: "940350",
      customsRate: 10,
      siteLink: "/p/garderobni-ormar-tora-g3140",
      webAuto: true,
      webCheck: true,
      wholesaleAuto: false,
      wholesaleCheck: true,
      exportAuto: false,
      exportCheck: true,
      parity: "DAP",
      deliveryDays: 28,
      moq: 2,
    },
  },
];

const supplierColumns: ErpColumn[] = [
  { key: "code", label: "Šifra dobavljača", defaultVisible: true },
  { key: "name", label: "Naziv", defaultVisible: true },
  { key: "address", label: "Adresa", defaultVisible: true },
  { key: "city", label: "Grad", defaultVisible: true },
  { key: "country", label: "Država", defaultVisible: true },
  { key: "email", label: "Kontakt mail", defaultVisible: true },
  { key: "phone", label: "Telefon", defaultVisible: true },
  { key: "currency", label: "Valuta", options: ["RSD", "€", "$"], defaultVisible: true },
  { key: "parity", label: "Paritet", options: ["EXW", "FCA", "FOB", "CIF", "DAP", "DDP"], defaultVisible: true },
  { key: "paymentTerms", label: "Uslovi plaćanja" },
  { key: "deliveryDays", label: "Rok isporuke", type: "number", align: "right", defaultVisible: true },
  { key: "transitDays", label: "Tranzit", type: "number", align: "right" },
  { key: "bank", label: "Banka" },
  { key: "swift", label: "SWIFT" },
  { key: "iban", label: "IBAN" },
];

const supplierRows: ErpRow[] = [
  {
    id: "sup-1",
    values: {
      code: "DOB-0001",
      name: "Nord Casa",
      address: "Industrivej 14",
      city: "Aarhus",
      country: "Danska",
      email: "orders@nordcasa.example",
      phone: "+45 11 22 33",
      currency: "€",
      parity: "DAP",
      paymentTerms: "30% avans, 70% pre utovara",
      deliveryDays: 28,
      transitDays: 6,
      bank: "Danske Bank",
      swift: "DABADKKK",
      iban: "DK5000400440116243",
    },
  },
  {
    id: "sup-2",
    values: {
      code: "DOB-0002",
      name: "Forma Legno",
      address: "Via Roma 22",
      city: "Treviso",
      country: "Italija",
      email: "export@formalegno.example",
      phone: "+39 0422 000",
      currency: "€",
      parity: "EXW",
      paymentTerms: "Po fakturi 15 dana",
      deliveryDays: 35,
      transitDays: 4,
      bank: "Intesa Sanpaolo",
      swift: "BCITITMM",
      iban: "IT60X0542811101000000123456",
    },
  },
];

const purchasePriceColumns: ErpColumn[] = [
  { key: "sku", label: "Šifra artikla", defaultVisible: true },
  { key: "supplier", label: "Dobavljač", options: ["Nord Casa", "Forma Legno"], defaultVisible: true },
  { key: "name", label: "Naziv artikla", defaultVisible: true },
  { key: "attributes", label: "Atributi", defaultVisible: true },
  { key: "pattern", label: "Dezen", defaultVisible: true },
  { key: "purchasePrice", label: "Nabavna cena", type: "money", align: "right", defaultVisible: true },
  { key: "currency", label: "Valuta", options: ["RSD", "€", "$"], defaultVisible: true },
  { key: "parity", label: "Paritet", options: ["EXW", "FCA", "FOB", "CIF", "DAP", "DDP"], defaultVisible: true },
  { key: "validFrom", label: "Važi od", type: "date", defaultVisible: true },
  { key: "validTo", label: "Važi do", type: "date", defaultVisible: true },
];

const purchasePriceRows: ErpRow[] = [
  {
    id: "pp-1",
    values: {
      sku: "BS-N2212",
      supplier: "Nord Casa",
      name: "Björn otvorena polica N2212",
      attributes: "Hrast / metal / 80x32x180",
      pattern: "Natur + grafit",
      purchasePrice: 158,
      currency: "€",
      parity: "DAP",
      validFrom: "2026-05-01",
      validTo: "2026-08-31",
    },
  },
  {
    id: "pp-2",
    values: {
      sku: "BS-N2212",
      supplier: "Nord Casa",
      name: "Björn otvorena polica N2212",
      attributes: "Hrast / metal / 80x32x180",
      pattern: "Natur + grafit",
      purchasePrice: 166,
      currency: "€",
      parity: "DAP",
      validFrom: "2026-09-01",
      validTo: "2026-12-31",
    },
  },
  {
    id: "pp-3",
    values: {
      sku: "ST-D1101",
      supplier: "Forma Legno",
      name: "Dora trpezarijski sto D1101",
      attributes: "Masiv jasena / 180x90",
      pattern: "Natur",
      purchasePrice: 545,
      currency: "€",
      parity: "EXW",
      validFrom: "2026-05-01",
      validTo: "2026-12-31",
    },
  },
];

const purchaseOrderColumns: ErpColumn[] = [
  { key: "number", label: "Broj porudžbenice", defaultVisible: true },
  { key: "status", label: "Status", type: "status", options: ["U obradi", "Poslata", "Potvrđena", "Primljena"], defaultVisible: true },
  { key: "supplier", label: "Dobavljač", options: ["Nord Casa", "Forma Legno"], defaultVisible: true },
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
  { key: "bmPct", label: "Ukupna BM%", type: "number", align: "right", defaultVisible: true },
];

const purchaseOrderRows: ErpRow[] = [
  {
    id: "po-1",
    values: {
      number: "1/26",
      status: "U obradi",
      supplier: "Nord Casa",
      createdAt: "2026-05-13",
      orderDate: "2026-05-13",
      loadingDate: "2026-05-24",
      deliveryDate: "2026-05-30",
      totalVolume: 18.4,
      totalWeight: 4600,
      totalPrice: 18420,
      currency: "€",
      transportType: "Šleper 90m3 / 24t",
      parity: "DAP",
      bmPct: 38.2,
    },
  },
  {
    id: "po-2",
    values: {
      number: "2/26",
      status: "Poslata",
      supplier: "Forma Legno",
      createdAt: "2026-05-11",
      orderDate: "2026-05-12",
      loadingDate: "2026-05-20",
      deliveryDate: "2026-05-24",
      totalVolume: 42.7,
      totalWeight: 11800,
      totalPrice: 32700,
      currency: "€",
      transportType: "Solo kamion 45m3 / 12t",
      parity: "EXW",
      bmPct: 34.8,
    },
  },
];

const purchaseOrderItemColumns: ErpColumn[] = [
  { key: "poNumber", label: "Porudžbenica", defaultVisible: true },
  { key: "sku", label: "Šifra artikla", defaultVisible: true },
  { key: "photo", label: "Foto", defaultVisible: true },
  { key: "supplier", label: "Dobavljač", options: ["Nord Casa", "Forma Legno"], defaultVisible: true },
  { key: "name", label: "Naziv", defaultVisible: true },
  { key: "attributes", label: "Atributi", defaultVisible: true },
  { key: "pattern", label: "Dezen", defaultVisible: true },
  { key: "purchasePrice", label: "Nabavna cena", type: "money", align: "right", defaultVisible: true },
  { key: "currency", label: "Valuta", options: ["RSD", "€", "$"], defaultVisible: true },
  { key: "parity", label: "Paritet", options: ["EXW", "FCA", "FOB", "CIF", "DAP", "DDP"] },
  { key: "validFrom", label: "Važi od", type: "date" },
  { key: "moq", label: "MOQ", type: "number", align: "right" },
  { key: "packQty", label: "Kom/pak", type: "number", align: "right" },
  { key: "qty", label: "Količina za poručivanje", type: "number", align: "right", defaultVisible: true },
  { key: "totalVolume", label: "Ukupna zapremina", type: "number", align: "right", defaultVisible: true },
  { key: "totalWeight", label: "Ukupna težina", type: "number", align: "right", defaultVisible: true },
  { key: "customsRate", label: "Carinska stopa", type: "number", align: "right" },
  { key: "calcRetailPrice", label: "Kalkulativna MPC", type: "money", align: "right", defaultVisible: true },
  { key: "bmPct", label: "BM%", type: "number", align: "right", defaultVisible: true },
  { key: "receivedQty", label: "Primljena količina", type: "number", align: "right" },
];

const purchaseOrderItemRows: ErpRow[] = [
  {
    id: "poi-1",
    values: {
      poNumber: "1/26",
      sku: "BS-N2212",
      photo: "IMG",
      supplier: "Nord Casa",
      name: "Björn otvorena polica N2212",
      attributes: "Hrast / metal",
      pattern: "Natur + grafit",
      purchasePrice: 158,
      currency: "€",
      parity: "DAP",
      validFrom: "2026-05-01",
      moq: 6,
      packQty: 1,
      qty: 24,
      totalVolume: 15.12,
      totalWeight: 984,
      customsRate: 10,
      calcRetailPrice: 39990,
      bmPct: 41.4,
      receivedQty: 0,
    },
  },
  {
    id: "poi-2",
    values: {
      poNumber: "2/26",
      sku: "ST-D1101",
      photo: "IMG",
      supplier: "Forma Legno",
      name: "Dora trpezarijski sto D1101",
      attributes: "Masiv jasena",
      pattern: "Natur",
      purchasePrice: 545,
      currency: "€",
      parity: "EXW",
      validFrom: "2026-05-01",
      moq: 4,
      packQty: 1,
      qty: 12,
      totalVolume: 4.92,
      totalWeight: 840,
      customsRate: 10,
      calcRetailPrice: 119990,
      bmPct: 36.1,
      receivedQty: 0,
    },
  },
];

const inboundInvoiceColumns: ErpColumn[] = [
  { key: "number", label: "Broj fakture", defaultVisible: true },
  { key: "type", label: "Tip", options: ["DOM", "INO", "COGS"], defaultVisible: true },
  { key: "supplier", label: "Dobavljač", options: ["Nord Casa", "Forma Legno"], defaultVisible: true },
  { key: "status", label: "Status", type: "status", options: ["U pripremi", "Primljena", "Proknjižena", "Storno"], defaultVisible: true },
  { key: "invoiceDate", label: "Datum fakture", type: "date", defaultVisible: true },
  { key: "currency", label: "Valuta", options: ["RSD", "€", "$"], defaultVisible: true },
  { key: "value", label: "Vrednost", type: "money", align: "right", defaultVisible: true },
  { key: "cogsStatus", label: "COGS", type: "status", options: ["Čeka razradu", "Razrađen", "Zaključan"], defaultVisible: true },
];

const inboundInvoiceRows: ErpRow[] = [
  {
    id: "inv-1",
    values: {
      number: "IF-2026-001",
      type: "INO",
      supplier: "Nord Casa",
      status: "U pripremi",
      invoiceDate: "2026-05-13",
      currency: "€",
      value: 18420,
      cogsStatus: "Čeka razradu",
    },
  },
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

const retailPriceRows: ErpRow[] = [
  {
    id: "mp-1",
    values: {
      sku: "BS-N2212",
      name: "Björn otvorena polica N2212",
      currentMpc: 39990,
      calcMpc: 38990,
      bmPct: 41.4,
      validFrom: "2026-05-15",
      status: "Predlog",
    },
  },
];

export const erpModules: ErpModule[] = [
  {
    slug: "artikli",
    number: "1",
    title: "Matični podaci o artiklima",
    description:
      "Centralni matični karton artikla: status, dobavljač, kategorije, dimenzije, pakovanja, kanali prodaje i povezani opisi za sajt.",
    status: "ready",
    commands: [
      { label: "Unos novog", tone: "primary" },
      { label: "Excel unos", tone: "neutral" },
      { label: "Brisanje", tone: "danger" },
    ],
    columns: articleColumns,
    rows: articleRows,
    notes: [
      "Šifra artikla se automatski popunjava kod novog unosa.",
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
      {
        label: "Brisanje",
        tone: "danger",
        action: "row.delete",
        needsSelection: true,
        confirm: "Obrisati izabrane dobavljače? Akcija je nepovratna.",
      },
    ],
    columns: supplierColumns,
    rows: supplierRows,
    notes: ["Kontakt mail mora da sadrži @.", "Valuta je ograničena na RSD, $ ili €."],
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
        label: "Brisanje",
        tone: "danger",
        action: "row.delete",
        needsSelection: true,
        confirm: "Obrisati izabrane nabavne cene? Akcija je nepovratna.",
      },
    ],
    columns: purchasePriceColumns,
    rows: purchasePriceRows,
    notes: ["Ista šifra artikla može da se unese više puta sa različitim periodima važenja."],
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
        label: "Pošalji dobavljaču",
        tone: "neutral",
        action: "po.send",
        needsSelection: true,
        confirm: "Označiti izabrane porudžbenice kao poslate dobavljaču?",
      },
      {
        label: "Kreiraj prijemnicu",
        tone: "neutral",
        action: "po.receive",
        needsSelection: true,
        confirm:
          "Proknjižiti prijem izabranih porudžbenica? Roba se dodaje na lager podrazumevanog magacina.",
      },
    ],
    columns: purchaseOrderColumns,
    rows: purchaseOrderRows,
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
      { label: "Dodaj stavku", tone: "primary" },
      { label: "Proveri pakovanja", tone: "neutral" },
      { label: "Štampa Excel", tone: "neutral" },
    ],
    columns: purchaseOrderItemColumns,
    rows: purchaseOrderItemRows,
    notes: [
      "Količina treba da se zacrveni kada nije deljiva brojem artikala u pakovanju.",
      "BM% se računa iz nabavne cene u RSD, transporta po jedinici i carine.",
    ],
  },
  {
    slug: "ulazne-fakture",
    number: "5",
    title: "Ulazne fakture",
    description:
      "Scaffold za domaće fakture, ino fakture i COGS obračun. Dokument navodi oblast, ali detaljna pravila čekaju dopunu.",
    status: "scaffold",
    commands: [
      { label: "Nova faktura", tone: "primary", action: "invoice.create" },
      {
        label: "Proknjiži",
        tone: "neutral",
        action: "invoice.post",
        needsSelection: true,
        confirm: "Proknjižiti izabrane ulazne fakture?",
      },
    ],
    columns: inboundInvoiceColumns,
    rows: inboundInvoiceRows,
    notes: ["Domaće fakture, ino fakture i COGS obračun su označeni kao sledeća razrada."],
  },
  {
    slug: "mp-cene",
    number: "6",
    title: "Upravljanje MP cenama",
    description:
      "Scaffold za upravljanje maloprodajnim cenama. Detaljna pravila cena i odobravanja čekaju specifikaciju.",
    status: "scaffold",
    commands: [
      {
        label: "Novi predlog cene",
        tone: "primary",
        action: "mp.proposal",
        needsSelection: true,
        confirm: "Kreirati predlog cene za izabrane artikle?",
      },
      {
        label: "Objavi cene",
        tone: "neutral",
        action: "mp.publish",
        needsSelection: true,
        confirm: "Objaviti predložene cene za izabrane artikle? Cena na sajtu se menja.",
      },
    ],
    columns: retailPriceColumns,
    rows: retailPriceRows,
    notes: ["Ovaj modul je pripremljen kao radni okvir do dopune poslovnih pravila."],
  },
];

export function getErpModuleDefinition(slug: string) {
  return erpModules.find((m) => m.slug === slug);
}

export async function getErpModule(slug: string) {
  const definition = getErpModuleDefinition(slug);
  if (!definition) return undefined;
  const rows = await getPersistedErpRows(slug);
  return {
    ...definition,
    rows,
    notes: [
      ...(definition.notes ?? []),
      rows.length
        ? "Redovi su učitani iz baze. Izmene podržanih polja se snimaju kroz admin API i ulaze u audit log."
        : "Nema još zapisa u bazi za ovaj ERP modul.",
    ],
  };
}

async function getPersistedErpRows(slug: string): Promise<ErpRow[]> {
  switch (slug) {
    case "artikli":
      return getArticleRows();
    case "dobavljaci":
      return getSupplierRows();
    case "nabavne-cene":
      return getPurchasePriceRows();
    case "porudzbenice":
      return getPurchaseOrderRows();
    case "porudzbenice-po-artiklima":
      return getPurchaseOrderItemRows();
    case "ulazne-fakture":
      return getInboundInvoiceRows();
    case "mp-cene":
      return getRetailPriceRows();
    default:
      return [];
  }
}

async function getArticleRows(): Promise<ErpRow[]> {
  const products = await db.product.findMany({
    orderBy: { updatedAt: "desc" },
    take: 500,
    select: {
      id: true,
      sku: true,
      barcode: true,
      slug: true,
      name: true,
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
      supplierStock: true,
      deliveryDaysMax: true,
      allowsAssembly: true,
      isActive: true,
      isDtz: true,
      isLimited: true,
      availableWebManual: true,
      availableWholesaleManual: true,
      availableExportManual: true,
      supplier: { select: { name: true } },
      group: { select: { name: true } },
      collection: { select: { name: true } },
      categories: {
        take: 1,
        select: { category: { select: { name: true, path: true } } },
      },
      media: {
        take: 1,
        orderBy: { order: "asc" },
        select: { url: true },
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
    },
  });

  return products.map((product) => {
    const width = asNumber(product.widthCm);
    const depth = asNumber(product.depthCm);
    const height = asNumber(product.heightCm);
    const volume =
      width !== null && depth !== null && height !== null
        ? Number(((width * depth * height) / 1_000_000).toFixed(3))
        : null;
    const lastPurchase = product.purchasePrices[0] ?? null;
    return {
      id: product.id,
      values: {
        photo: product.media[0]?.url ? "IMG" : null,
        status: articleStatus(product),
        sku: product.sku,
        supplier: product.supplier?.name ?? null,
        category: product.categories[0]?.category.name ?? null,
        group: product.group?.name ?? null,
        subgroup: product.categories[0]?.category.path ?? null,
        collection: product.collection?.name ?? null,
        shortDescription: product.shortDescription ?? null,
        shortName: product.name,
        attribute1: product.attribute1 ?? product.sizeLabel ?? null,
        attribute2: product.attribute2 ?? null,
        attribute3: product.attribute3 ?? null,
        attribute4: product.attribute4 ?? null,
        color1: product.colorPrimary ?? null,
        color2: product.colorSecondary ?? null,
        siteDescription: product.description,
        stockTotal: product.stock,
        stockDc: product.stock,
        availableTotal: Math.max(product.stock, 0),
        availableDc: Math.max(product.stock, 0),
        cogs: asNumber(product.cogs) ?? (lastPurchase ? asNumber(lastPurchase.price) : null),
        incomingTotal: product.incomingStock,
        incomingAvailable: product.incomingStock,
        widthCm: width,
        heightCm: height,
        depthCm: depth,
        volumeM3: volume,
        lastPurchasePrice: lastPurchase ? asNumber(lastPurchase.price) : null,
        supplierName: product.supplier?.name ?? null,
        material: product.materials.map((item) => item.material.label).join(", ") || null,
        barcode: product.barcode ?? null,
        siteLink: `/p/${product.slug}`,
        webAuto: product.stock > 0,
        webCheck: product.availableWebManual,
        wholesaleAuto: product.stock > 0,
        wholesaleCheck: product.availableWholesaleManual,
        exportAuto: product.stock > 0,
        exportCheck: product.availableExportManual,
        customsRate: asNumber(product.customsRate),
        parity: lastPurchase?.parity ?? null,
        deliveryDays: product.deliveryDaysMax,
        calcRetailPrice: asNumber(product.fullPrice),
      },
    };
  });
}

async function getSupplierRows(): Promise<ErpRow[]> {
  const suppliers = await db.supplier.findMany({
    orderBy: { name: "asc" },
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
    },
  });

  return suppliers.map((supplier, index) => ({
    id: supplier.id,
    values: {
      code: supplier.code ?? `DOB-${String(index + 1).padStart(4, "0")}`,
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
    },
  }));
}

async function getPurchasePriceRows(): Promise<ErpRow[]> {
  const prices = await db.purchasePrice.findMany({
    orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
    take: 500,
    include: {
      supplier: { select: { name: true } },
      product: { select: { name: true, sizeLabel: true, colorPrimary: true, colorSecondary: true } },
    },
  });

  return prices.map((price) => ({
    id: price.id,
    values: {
      sku: price.sku,
      supplier: price.supplier?.name ?? null,
      name: price.name ?? price.product?.name ?? null,
      attributes: price.attributes ?? price.product?.sizeLabel ?? null,
      pattern:
        price.pattern ??
        ([price.product?.colorPrimary, price.product?.colorSecondary]
          .filter(Boolean)
          .join(" + ") || null),
      purchasePrice: asNumber(price.price),
      currency: currencyLabel(price.currency),
      parity: price.parity ?? null,
      validFrom: dateOnly(price.validFrom),
      validTo: dateOnly(price.validTo),
    },
  }));
}

async function getPurchaseOrderRows(): Promise<ErpRow[]> {
  const orders = await db.purchaseOrder.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
    include: { supplier: { select: { name: true } } },
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

async function getPurchaseOrderItemRows(): Promise<ErpRow[]> {
  const items = await db.purchaseOrderItem.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      purchaseOrder: {
        select: {
          number: true,
          parity: true,
          supplier: { select: { name: true } },
        },
      },
      product: { select: { media: { take: 1, orderBy: { order: "asc" }, select: { url: true } } } },
    },
  });

  return items.map((item) => ({
    id: item.id,
    values: {
      poNumber: item.purchaseOrder.number,
      sku: item.sku,
      photo: item.product?.media[0]?.url ? "IMG" : null,
      supplier: item.purchaseOrder.supplier?.name ?? null,
      name: item.name,
      attributes: item.attributes ?? null,
      pattern: item.pattern ?? null,
      purchasePrice: asNumber(item.purchasePrice),
      currency: currencyLabel(item.currency),
      parity: item.parity ?? item.purchaseOrder.parity ?? null,
      validFrom: null,
      moq: item.moq ?? null,
      packQty: item.packQty ?? null,
      qty: item.qty,
      totalVolume: asNumber(item.totalVolume),
      totalWeight: asNumber(item.totalWeight),
      customsRate: asNumber(item.customsRate),
      calcRetailPrice: asNumber(item.calcRetailPrice),
      bmPct: asNumber(item.bmPct),
      receivedQty: item.receivedQty,
    },
  }));
}

async function getInboundInvoiceRows(): Promise<ErpRow[]> {
  const invoices = await db.inboundInvoice.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
    include: { supplier: { select: { name: true } } },
  });

  return invoices.map((invoice) => ({
    id: invoice.id,
    values: {
      number: invoice.number,
      type: invoice.type,
      supplier: invoice.supplier?.name ?? null,
      status: inboundInvoiceStatusLabel(invoice.status),
      invoiceDate: dateOnly(invoice.invoiceDate),
      currency: currencyLabel(invoice.currency),
      value: asNumber(invoice.value),
      cogsStatus: cogsStatusLabel(invoice.cogsStatus),
    },
  }));
}

async function getRetailPriceRows(): Promise<ErpRow[]> {
  const products = await db.product.findMany({
    orderBy: { updatedAt: "desc" },
    take: 500,
    select: {
      id: true,
      sku: true,
      name: true,
      fullPrice: true,
      salePrice: true,
      discountPct: true,
      updatedAt: true,
      isActive: true,
    },
  });

  return products.map((product) => ({
    id: product.id,
    values: {
      sku: product.sku,
      name: product.name,
      currentMpc: asNumber(product.salePrice ?? product.fullPrice),
      calcMpc: asNumber(product.fullPrice),
      bmPct: product.discountPct ?? null,
      validFrom: dateOnly(product.updatedAt),
      status: product.isActive ? "Objavljeno" : "Arhiva",
    },
  }));
}
