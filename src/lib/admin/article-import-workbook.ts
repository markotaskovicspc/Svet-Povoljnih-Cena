import ExcelJS from "exceljs";

export type ArticleImportColumn =
  | "sku"
  | "status"
  | "photoUrl"
  | "supplier"
  | "category"
  | "subgroup"
  | "group"
  | "collection"
  | "shortDescription"
  | "shortName"
  | "attribute1"
  | "attribute2"
  | "attribute3"
  | "attribute4"
  | "color1"
  | "color2"
  | "benefits"
  | "description"
  | "stock"
  | "weightKg"
  | "widthCm"
  | "depthCm"
  | "heightCm"
  | "grossWeightKg"
  | "unitPackWidthCm"
  | "unitPackDepthCm"
  | "unitPackHeightCm"
  | "packQty"
  | "palletQty"
  | "packWidthCm"
  | "packDepthCm"
  | "packHeightCm"
  | "packGrossWeightKg"
  | "containerQty"
  | "containerGrossWeightKg"
  | "supplierProductName"
  | "materialText"
  | "certificates"
  | "barcode"
  | "hsCode"
  | "countryOfOrigin"
  | "retailPrice"
  | "customsRate"
  | "ananasBrokeragePct"
  | "ananasStoragePct"
  | "ananasDeliveryPct"
  | "webCheck"
  | "wholesaleCheck"
  | "exportCheck"
  | "moq"
  | "newUntil"
  | "familyCode"
  | "familyColorLabel"
  | "familyColorHex"
  | "familyPosition"
  | "familyPrimary"
  | "familyStorefrontEnabled";

export const ARTICLE_IMPORT_TEMPLATE_HEADERS = [
  "Šifra",
  "Status",
  "Foto",
  "Dobavljač",
  "Kategorija",
  "Podgrupa",
  "Grupa",
  "Kolekcija",
  "Kratki opis",
  "Kratki naziv",
  "Atribut 1",
  "Atribut 2",
  "Atribut 3",
  "Atribut 4",
  "Boja 1",
  "Boja 2",
  "Benefiti",
  "Opis za sajt",
  "Zalihe",
  "Težina artikla",
  "Širina artikla",
  "Dubina artikla",
  "Visina artikla",
  "Bruto težina artikla",
  "Širina pakovanja pojedinačnog artikla",
  "Dubina pakovanja pojedinačnog artikla",
  "Visina pakovanja pojedinačnog artikla",
  "Broj artikala u pakovanju",
  "Broj komada na paleti",
  "Širina transportnog pakovanja",
  "Dubina transportnog pakovanja",
  "Visina transportnog pakovanja",
  "Bruto težina transportnog pakovanja",
  "Količina za ceo kontejner",
  "Bruto težina kontejnera",
  "Dobavljačev naziv",
  "Materijal",
  "Sertifikati",
  "Bar kod",
  "Tarifni broj",
  "Zemlja porekla",
  "MPC",
  "Carina",
  "Ananas provizija za posredovanje",
  "Ananas provizija za skladištenje",
  "Ananas provizija za isporuku",
  "Web check",
  "VP check",
  "INO check",
  "MOQ",
  "Novo do",
  "Šifra porodice",
  "Naziv boje",
  "HEX boje",
  "Redosled boje",
  "Glavna boja",
  "Boja spremna za web",
] as const;

const HEADER_ALIASES: Record<string, ArticleImportColumn> = {
  sku: "sku",
  sifra: "sku",
  sifraartikla: "sku",
  photo: "photoUrl",
  photourl: "photoUrl",
  image: "photoUrl",
  imageurl: "photoUrl",
  foto: "photoUrl",
  fotografija: "photoUrl",
  fotografijazasajt: "photoUrl",
  urlfotografije: "photoUrl",
  status: "status",
  statusartikla: "status",
  supplier: "supplier",
  dobavljac: "supplier",
  suppliercode: "supplier",
  category: "category",
  kategorija: "category",
  kategorijaartikala: "category",
  subgroup: "subgroup",
  podgrupa: "subgroup",
  podgrupaartikla: "subgroup",
  group: "group",
  grupa: "group",
  grupaartikla: "group",
  collection: "collection",
  kolekcija: "collection",
  shortdescription: "shortDescription",
  kratkiopis: "shortDescription",
  kratkiopisartikla: "shortDescription",
  shortname: "shortName",
  name: "shortName",
  naziv: "shortName",
  kratkinaziv: "shortName",
  kratkinazivartikla: "shortName",
  attribute1: "attribute1",
  atribut1: "attribute1",
  attribute2: "attribute2",
  atribut2: "attribute2",
  attribute3: "attribute3",
  atribut3: "attribute3",
  attribute4: "attribute4",
  atribut4: "attribute4",
  color1: "color1",
  boja1: "color1",
  color2: "color2",
  boja2: "color2",
  benefits: "benefits",
  benefiti: "benefits",
  sitedescription: "description",
  description: "description",
  opis: "description",
  opiszasajt: "description",
  stock: "stock",
  zalihe: "stock",
  fizickostanje: "stock",
  ukupnofizickostanje: "stock",
  weightkg: "weightKg",
  tezinakg: "weightKg",
  tezinaartikla: "weightKg",
  widthcm: "widthCm",
  sirinacm: "widthCm",
  sirinaartikla: "widthCm",
  depthcm: "depthCm",
  dubinacm: "depthCm",
  dubinaartikla: "depthCm",
  heightcm: "heightCm",
  visinacm: "heightCm",
  visinaartikla: "heightCm",
  grossweightkg: "grossWeightKg",
  brutotezinakg: "grossWeightKg",
  brutotezina: "grossWeightKg",
  brutotezinaartikla: "grossWeightKg",
  unitpackwidthcm: "unitPackWidthCm",
  sirinapakovanjajednogartikla: "unitPackWidthCm",
  sirinapakovanjapojedinacnogartikla: "unitPackWidthCm",
  sirinapojedinacnogpakovanja: "unitPackWidthCm",
  unitpackdepthcm: "unitPackDepthCm",
  dubinapakovanjajednogartikla: "unitPackDepthCm",
  dubinapakovanjapojedinacnogartikla: "unitPackDepthCm",
  dubinapojedinacnogpakovanja: "unitPackDepthCm",
  unitpackheightcm: "unitPackHeightCm",
  visinapakovanjajednogartikla: "unitPackHeightCm",
  visinapakovanjapojedinacnogartikla: "unitPackHeightCm",
  visinapojedinacnogpakovanja: "unitPackHeightCm",
  packqty: "packQty",
  kompak: "packQty",
  brojartikalaupakovanju: "packQty",
  palletqty: "palletQty",
  kompaleta: "palletQty",
  brojkomadanapaleti: "palletQty",
  kolicinapaleta: "palletQty",
  packwidthcm: "packWidthCm",
  paksirinacm: "packWidthCm",
  paksirina: "packWidthCm",
  sirinatransportnogpakovanja: "packWidthCm",
  packdepthcm: "packDepthCm",
  pakdubinacm: "packDepthCm",
  pakdubina: "packDepthCm",
  dubinatransportnogpakovanja: "packDepthCm",
  packheightcm: "packHeightCm",
  pakvisinacm: "packHeightCm",
  pakvisina: "packHeightCm",
  visinatransportnogpakovanja: "packHeightCm",
  packgrossweightkg: "packGrossWeightKg",
  pakbrutokg: "packGrossWeightKg",
  brutotezinatransportnogpakovanja: "packGrossWeightKg",
  containerqty: "containerQty",
  kolicinazaceokontejner: "containerQty",
  kolicinapokontejneru: "containerQty",
  containergrossweightkg: "containerGrossWeightKg",
  brutokgzaceokontejner: "containerGrossWeightKg",
  brutotezinakontejnera: "containerGrossWeightKg",
  suppliername: "supplierProductName",
  dobavljacevnaziv: "supplierProductName",
  material: "materialText",
  certificates: "certificates",
  sertifikati: "certificates",
  barcode: "barcode",
  barkod: "barcode",
  hscode: "hsCode",
  hskod: "hsCode",
  tarifnibroj: "hsCode",
  carinskatarifa: "hsCode",
  countryoforigin: "countryOfOrigin",
  zemljaporekla: "countryOfOrigin",
  poreklo: "countryOfOrigin",
  retailprice: "retailPrice",
  mpc: "retailPrice",
  maloprodajnacena: "retailPrice",
  customsrate: "customsRate",
  carina: "customsRate",
  ananasbrokerage: "ananasBrokeragePct",
  ananasposred: "ananasBrokeragePct",
  ananasprovizijazaposredovanje: "ananasBrokeragePct",
  ananasstorage: "ananasStoragePct",
  ananasskladis: "ananasStoragePct",
  ananasprovizijazaskladistenje: "ananasStoragePct",
  ananasdelivery: "ananasDeliveryPct",
  ananasispor: "ananasDeliveryPct",
  ananasprovizijazaisporuku: "ananasDeliveryPct",
  webcheck: "webCheck",
  wholesalecheck: "wholesaleCheck",
  vpcheck: "wholesaleCheck",
  exportcheck: "exportCheck",
  inocheck: "exportCheck",
  moq: "moq",
  newuntil: "newUntil",
  novodo: "newUntil",
  sifraporodice: "familyCode",
  familycode: "familyCode",
  nazivboje: "familyColorLabel",
  colorname: "familyColorLabel",
  hexboje: "familyColorHex",
  colorhex: "familyColorHex",
  redosledboje: "familyPosition",
  colorposition: "familyPosition",
  glavnaboja: "familyPrimary",
  primarycolor: "familyPrimary",
  bojaspremljenazaweb: "familyStorefrontEnabled",
  colorstorefrontenabled: "familyStorefrontEnabled",
};

const LEGACY_TNC_HEADERS = new Set([
  "tncfrom",
  "tncod",
  "tcfrom",
  "tcod",
  "tncuntil",
  "tncdo",
  "tcuntil",
  "tcdo",
]);

export type ArticleImportWorksheetSelection = {
  worksheet: ExcelJS.Worksheet;
  headerRow: number;
  headers: Map<ArticleImportColumn, number>;
  recognizedColumns: string[];
  hasLegacyTncColumns: boolean;
};

export function normalizeArticleImportHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function findArticleImportWorksheet(
  workbook: ExcelJS.Workbook,
): ArticleImportWorksheetSelection | null {
  type Candidate = ArticleImportWorksheetSelection & {
    worksheetIndex: number;
  };

  const candidates: Candidate[] = [];
  workbook.worksheets.forEach((worksheet, worksheetIndex) => {
    const lastCandidateRow = Math.min(Math.max(worksheet.rowCount, 1), 50);
    for (let rowNumber = 1; rowNumber <= lastCandidateRow; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const headers = new Map<ArticleImportColumn, number>();
      const recognizedColumns: string[] = [];
      let hasLegacyTncColumns = false;
      row.eachCell({ includeEmpty: false }, (cell, column) => {
        const rawHeader = cell.text.trim();
        const normalizedHeader = normalizeArticleImportHeader(rawHeader);
        if (LEGACY_TNC_HEADERS.has(normalizedHeader)) hasLegacyTncColumns = true;
        const field = HEADER_ALIASES[normalizedHeader];
        if (!field) return;
        headers.set(field, column);
        recognizedColumns.push(rawHeader);
      });
      if (!headers.size && !hasLegacyTncColumns) continue;
      candidates.push({
        worksheet,
        worksheetIndex,
        headerRow: rowNumber,
        headers,
        recognizedColumns,
        hasLegacyTncColumns,
      });
    }
  });

  const candidatesWithShortName = candidates.filter((candidate) =>
    candidate.headers.has("shortName"),
  );
  const pool = candidatesWithShortName.length ? candidatesWithShortName : candidates;
  pool.sort(
    (left, right) =>
      right.headers.size - left.headers.size ||
      left.worksheetIndex - right.worksheetIndex ||
      left.headerRow - right.headerRow,
  );
  const selected = pool[0];
  if (selected) {
    return {
      worksheet: selected.worksheet,
      headerRow: selected.headerRow,
      headers: selected.headers,
      recognizedColumns: selected.recognizedColumns,
      hasLegacyTncColumns: selected.hasLegacyTncColumns,
    };
  }

  const worksheet = workbook.worksheets[0];
  return worksheet
    ? {
        worksheet,
        headerRow: 1,
        headers: new Map(),
        recognizedColumns: [],
        hasLegacyTncColumns: false,
      }
    : null;
}
