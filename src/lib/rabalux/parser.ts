import { findAll, parseXml, type XmlNode } from "@/lib/xml/parser";
import type {
  RabaluxAttachmentAsset,
  RabaluxCatalogItem,
  RabaluxDryRunSummary,
  RabaluxMediaAsset,
  RabaluxStockItem,
  RabaluxTechnicalSpec,
} from "./types";

const MEDIA_HOST = "rabaluxkep.plugin.hu";

const TECHNICAL_LABELS: Record<string, string> = {
  Style: "Stil",
  Usage: "Preporučena prostorija",
  Colour_temperature: "Temperatura boje svetlosti",
  Luminous_flux_of_light_source: "Svetlosni tok (lm)",
  Light_source_specifications: "Specifikacija izvora svetlosti",
  LED_technology: "LED tehnologija",
  IP_protection: "IP zaštita",
  Technical_details_of_sensor: "Senzor",
  Lamp_colour: "Boja lampe",
  Colour_of_lampshade: "Boja abažura",
  Material_of_lamp: "Materijal lampe",
  Material_of_lampshade: "Materijal abažura",
  Light_source_lifetime_hrs: "Radni vek izvora svetlosti (h)",
  Light_source_included: "Izvor svetlosti uključen",
  Light_source_energy_class: "Energetska klasa",
  Illumination_angle: "Ugao osvetljenja",
  "Weighted_energy_consumption_kwh-1000ah": "Potrošnja energije (kWh/1000h)",
  Nr_of_socket: "Broj grla",
  Socket_type: "Tip grla",
  Nr_of_socket2: "Broj grla 2",
  Socket_type2: "Tip grla 2",
  Applied_voltage: "Napon",
  Luminaire_specifications: "Specifikacija svetiljke",
  Color_temperature_K: "Temperatura boje (K)",
  Remote_control: "Daljinski upravljač",
  Color_temp_change: "Promena temperature boje",
  Dimmable: "Prigušivanje",
  Dimm_type: "Način prigušivanja",
  RGB: "RGB",
  Battery: "Baterija",
  Switch_type: "Tip prekidača",
  Memory_function: "Memorijska funkcija",
  Timer_function: "Tajmer",
  Timer_set: "Podešavanje tajmera",
  Nightlight: "Noćno svetlo",
  "Wi-Fi": "Wi‑Fi",
  Bluetooth: "Bluetooth",
  Speaker: "Zvučnik",
  Starry_effect: "Efekat zvezdanog neba",
  Backlight: "Pozadinsko osvetljenje",
  Textile_cable: "Tekstilni kabl",
  Chargeable_w_USB: "USB punjenje",
  USB_charging_port: "USB priključak",
  Installation_size_mm: "Ugradna mera (mm)",
  Installation_depth_mm: "Dubina ugradnje (mm)",
  Sensor_type: "Tip senzora",
  Rabalux_own_design: "Rabalux dizajn",
  Other_functions: "Ostale funkcije",
  Lightsource_shape: "Oblik izvora svetlosti",
  Protection_class: "Klasa zaštite",
  Prod_type: "Tip proizvoda",
  Ideal_operating_range_temp: "Radna temperatura",
  Battery_charging_time: "Vreme punjenja baterije",
  Battery_operating_time: "Vreme rada baterije",
};

function childMap(node: XmlNode) {
  const map = new Map<string, XmlNode[]>();
  for (const child of node.children) {
    const values = map.get(child.tag) ?? [];
    values.push(child);
    map.set(child.tag, values);
  }
  return map;
}

function text(map: Map<string, XmlNode[]>, key: string) {
  return map.get(key)?.[0]?.text.trim() ?? "";
}

function childTexts(map: Map<string, XmlNode[]>, parent: string, child: string) {
  return (map.get(parent)?.[0]?.children ?? [])
    .filter((node) => node.tag === child)
    .map((node) => node.text.trim())
    .filter(Boolean);
}

function numberOrNull(value: string) {
  if (!value.trim()) return null;
  const valueNumber = Number(value.trim().replace(",", "."));
  return Number.isFinite(valueNumber) ? valueNumber : null;
}

function positiveInt(value: string) {
  const parsed = numberOrNull(value);
  return parsed != null && parsed > 0 ? Math.round(parsed) : null;
}

export function rabaluxSku(sourceSku: string) {
  return `RAB-${sourceSku.trim()}`;
}

export function slugifyRabalux(name: string, sourceSku: string) {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[čć]/g, "c")
    .replace(/š/g, "s")
    .replace(/ž/g, "z")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "rabalux"}-${sourceSku}`.slice(0, 96);
}

export function normalizeRabaluxMediaUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(
      /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`,
    );
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase() !== MEDIA_HOST) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.pathname.startsWith("/images/") || url.username || url.password) return null;
  url.protocol = "https:";
  url.port = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function rabaluxMediaStorageKey(sourceSku: string, sourceUrl: string, variant?: string) {
  const pathname = new URL(sourceUrl).pathname;
  const filename = decodeURIComponent(pathname.split("/").pop() ?? "asset")
    .replace(/[^A-Za-z0-9._-]+/g, "-");
  return ["rabalux", sourceSku, variant, filename].filter(Boolean).join("/");
}

function fallbackWarranty(map: Map<string, XmlNode[]>, type: string) {
  const feedWarranty = positiveInt(text(map, "Warranty_years"));
  if (feedWarranty) return feedWarranty;
  const integratedLed =
    text(map, "LED_technology").toLowerCase() === "da" ||
    (text(map, "Luminaire_specifications").toLowerCase().includes("led") &&
      !text(map, "Socket_type"));
  if (integratedLed) return 5;
  if (/sijalic|izvor svetlosti|bulb/i.test(type)) return 3;
  return 2;
}

function technicalSpecs(map: Map<string, XmlNode[]>) {
  const specs: RabaluxTechnicalSpec[] = [];
  for (const [key, label] of Object.entries(TECHNICAL_LABELS)) {
    const value = text(map, key);
    if (value) specs.push({ key, label, value });
  }
  return specs;
}

export function sanitizeRabaluxDescription(value: string) {
  return value
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(?!\/?(?:p|br|ul|ol|li|strong|b|em|i|span)\b)[^>]*>/gi, "")
    .replace(
      /<(\/?)(p|br|ul|ol|li|strong|b|em|i|span)\b[^>]*>/gi,
      (_match, closing: string, tagName: string) =>
        `<${closing}${tagName.toLowerCase()}>`,
    )
    .trim();
}

function mediaAssets(map: Map<string, XmlNode[]>) {
  const assets: RabaluxMediaAsset[] = [];
  const fhd = childTexts(map, "Product_fhdimages", "Image");
  const standard = childTexts(map, "Product_images", "Image");
  const images = fhd.length ? fhd : standard;
  for (const raw of images) {
    const sourceUrl = normalizeRabaluxMediaUrl(raw);
    if (sourceUrl) assets.push({ kind: "IMAGE", sourceUrl, order: assets.length });
  }
  const video = normalizeRabaluxMediaUrl(text(map, "Product_video"));
  if (video) assets.push({ kind: "VIDEO", sourceUrl: video, order: assets.length });
  return dedupeAssets(assets);
}

function dedupeAssets(assets: RabaluxMediaAsset[]) {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    if (seen.has(asset.sourceUrl)) return false;
    seen.add(asset.sourceUrl);
    return true;
  });
}

function attachmentAssets(map: Map<string, XmlNode[]>) {
  const assets: RabaluxAttachmentAsset[] = [];
  const manual = normalizeRabaluxMediaUrl(text(map, "Manual_pdf"));
  if (manual) {
    assets.push({ kind: "MANUAL", label: "Uputstvo", sourceUrl: manual, order: 0 });
  }
  const energy = normalizeRabaluxMediaUrl(text(map, "Energylabel_pdf"));
  if (energy) {
    assets.push({
      kind: "ENERGY_LABEL",
      label: "Energetska oznaka",
      sourceUrl: energy,
      order: 0,
    });
  }
  return assets;
}

function mapCatalogNode(node: XmlNode): RabaluxCatalogItem | null {
  const map = childMap(node);
  const sourceSku = text(map, "Sku");
  const name = text(map, "Name");
  if (!sourceSku || !name) return null;
  const category = text(map, "Product_category") || null;
  const type = text(map, "Type") || null;
  const fullPrice = numberOrNull(text(map, "Recommended_price")) ?? 0;
  const rawSale = numberOrNull(text(map, "Recommended_retail_price"));
  const salePrice = rawSale != null && rawSale > 0 && rawSale < fullPrice ? rawSale : null;
  const errors: string[] = [];
  if (fullPrice <= 0) errors.push("invalid_full_price");
  if (!category) errors.push("missing_category");
  if (!type) errors.push("missing_type");
  const productWidth = numberOrNull(text(map, "Horizontal_mm"));
  const productDepth = numberOrNull(text(map, "Distance_from_wall"));
  const productHeight =
    numberOrNull(text(map, "Vertical_mm")) ??
    numberOrNull(text(map, "Distance_from_ceiling"));
  const materialValues = [
    text(map, "Material_of_lamp"),
    text(map, "Material_of_lampshade"),
  ].filter(Boolean);
  return {
    sourceSku,
    sku: rabaluxSku(sourceSku),
    slug: slugifyRabalux(name, sourceSku),
    name,
    barcode: text(map, "Ean11") || null,
    category,
    type,
    description: sanitizeRabaluxDescription(text(map, "Description")),
    fullPrice,
    salePrice,
    discountPct:
      salePrice != null && fullPrice > salePrice
        ? Math.round(((fullPrice - salePrice) / fullPrice) * 100)
        : null,
    colorPrimary: text(map, "Lamp_colour") || null,
    colorSecondary: text(map, "Colour_of_lampshade") || null,
    materials: [...new Set(materialValues)],
    widthCm: productWidth != null ? productWidth / 10 : null,
    depthCm: productDepth != null ? productDepth / 10 : null,
    heightCm: productHeight != null ? productHeight / 10 : null,
    weightKg: numberOrNull(text(map, "Net_weight_kg")),
    grossWeightKg: numberOrNull(text(map, "Gross_weight")),
    packWidthCm: numberOrNull(text(map, "Unique_box_size_X_cm")),
    packDepthCm: numberOrNull(text(map, "Unique_box_size_Y_cm")),
    packHeightCm: numberOrNull(text(map, "Unique_box_size_Z_cm")),
    packGrossWeightKg: numberOrNull(text(map, "Gross_weight")),
    warrantyYears: fallbackWarranty(map, type ?? ""),
    countryOfOrigin: text(map, "Country_of_origin") || null,
    hsCode: text(map, "Custom_tariff_nr_CTN") || null,
    isNew: text(map, "New_product").toLowerCase() === "new",
    technicalSpecs: technicalSpecs(map),
    media: mediaAssets(map),
    attachments: attachmentAssets(map),
    valid: errors.length === 0,
    validationErrors: errors,
  };
}

export function parseRabaluxCatalogXml(raw: string) {
  const root = parseXml(raw);
  return findAll(root, "Product")
    .map(mapCatalogNode)
    .filter((item): item is RabaluxCatalogItem => item !== null);
}

export function parseDelimitedRows(raw: string, delimiter = ";") {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === '"') {
      if (quoted && raw[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && raw[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseRabaluxCatalogCsv(raw: string) {
  const rows = parseDelimitedRows(raw.replace(/^\uFEFF/, ""));
  const header = rows.shift() ?? [];
  const index = new Map(header.map((name, position) => [name.trim(), position]));
  const value = (row: string[], name: string) => row[index.get(name) ?? -1]?.trim() ?? "";
  const normalizedIndex = new Map(
    header.map((name, position) => [normalizeHeader(name), position]),
  );
  const valueNormalized = (row: string[], name: string) =>
    row[normalizedIndex.get(normalizeHeader(name)) ?? -1]?.trim() ?? "";
  const xml = [
    "<Products>",
    ...rows.map((row) => {
      const fhdPhotos = header
        .filter((name) => /^FHDPhotos\d+$/.test(name))
        .map((name) => value(row, name))
        .filter(Boolean);
      const standardPhotos = header
        .filter((name) => /^Photos\d+$/.test(name))
        .map((name) => value(row, name))
        .filter(Boolean);
      const photos = fhdPhotos.length ? fhdPhotos : standardPhotos;
      const specs = [
        ["Colour_temperature", "Temperatura boje izvora svetlosti"],
        ["Luminous_flux_of_light_source", "Svetlosni tok izvora svetlosti (lm)"],
        ["Light_source_specifications", "Specifikacije izvora svetlosti"],
        ["IP_protection", "IP zaštita"],
        ["Technical_details_of_sensor", "Specifikacije senzora pokreta"],
        ["Light_source_lifetime_hrs", "Vek trajanja izvora svetlosti (h)"],
        ["Light_source_included", "Uključenih izvora svetlosti"],
        ["Light_source_energy_class", "Energetska klasa izvora osvetljenja"],
        ["Illumination_angle", "Ugao osvetljenja (x°)"],
        ["Nr_of_socket", "Broj grla"],
        ["Socket_type", "Vrsta grla"],
        ["Nr_of_socket2", "Broj grla br. 2"],
        ["Socket_type2", "Vrsta grla br.2"],
        ["Applied_voltage", "Primenjena voltaža"],
        ["Luminaire_specifications", "Specifikacije osvetljenja"],
        ["Distance_from_ceiling", "Udaljenost od stropa."],
        ["Distance_from_wall", "Udaljenost od zida"],
        ["Diameter_mm", "Prečnik"],
        ["Color_temperature_K", "Temperatura boje (K)"],
        ["Remote_control", "Daljinski upravljač"],
        ["Color_temp_change", "Podesiva temperatura boje"],
        ["Dimmable", "Podesiva osvetljenost"],
        ["Dimm_type", "Način podešavanja osvetljenosti"],
        ["RGB", "RGB"],
        ["Battery", "Baterija"],
        ["Switch_type", "Tip prekidača"],
        ["Memory_function", "Funkcija memorije"],
        ["Timer_function", "Funkcija tajmera"],
        ["Timer_set", "Tajming vreme (s)"],
        ["Nightlight", "Noćna funkcija"],
        ["Wi-Fi", "Wi-Fi"],
        ["Bluetooth", "Bluetooth"],
        ["Speaker", "Zvučnik"],
        ["Starry_effect", "Efekat sjaja"],
        ["Backlight", "Pozadinsko osvetljenje"],
        ["Textile_cable", "Tekstilni kabl"],
        ["Chargeable_w_USB", "Lampa se može puniti USB kablom"],
        ["USB_charging_port", "Ugrađeni USB punjač"],
        ["Installation_size_mm", "Dimenzije ugradnje (mm)"],
        ["Installation_depth_mm", "Dubina ugradnje (mm)"],
        ["Sensor_type", "Tip senzora"],
        ["Rabalux_own_design", "Rabalux sopstveni dizajn"],
        ["Other_functions", "Ostale funkcije"],
        ["Lightsource_shape", "Oblik svetlosnog izvora"],
        ["Protection_class", "Klasa zaštite"],
        ["Prod_type", "Cikkfajta"],
        ["Ideal_operating_range_temp", "Idealan radni opseg"],
        ["Battery_charging_time", "Vreme punjenja baterije"],
        ["Battery_operating_time", "Vreme rada baterije"],
      ].map(([xmlName, csvName]) =>
        tag(xmlName, valueNormalized(row, csvName)),
      );
      return [
        "<Product>",
        tag("Sku", value(row, "Br.stavke")),
        tag("Name", value(row, "Prezime")),
        tag("Ean11", value(row, "EAN kod")),
        tag("Product_category", value(row, "Kategorija")),
        tag("Type", value(row, "Tip")),
        tag("Style", value(row, "Stil lampe")),
        tag("Usage", value(row, "Preporučena prostorija za korišćenje")),
        tag("LED_technology", value(row, "LED tehnologija")),
        tag("Lamp_colour", value(row, "Boja lampe")),
        tag("Colour_of_lampshade", value(row, "Boja abažura")),
        tag("Material_of_lamp", value(row, "Materijal lampe")),
        tag("Material_of_lampshade", value(row, "Materijal abažura")),
        tag("Warranty_years", value(row, "Garancija (godina)")),
        ...specs,
        tag("Horizontal_mm", value(row, "Dužina proizvoda X (mm)")),
        tag("Vertical_mm", value(row, "Visina proizvoda Z (mm)")),
        tag("Unique_box_size_X_cm", value(row, "Jedinstvena veličina kutije X (cm)")),
        tag("Unique_box_size_Y_cm", value(row, "Jedinstvena veličina kutije Y (cm)")),
        tag("Unique_box_size_Z_cm", value(row, "Jedinstvena veličina kutije Z (cm)")),
        tag("Net_weight_kg", value(row, "Neto težina (kg)")),
        tag("Gross_weight", value(row, "Bruto težina")),
        tag("Custom_tariff_nr_CTN", value(row, "Carinski broj (CTN)")),
        tag("Country_of_origin", value(row, "Zemlja porekla")),
        tag("Description", value(row, "Opis proizvoda")),
        tag("Recommended_price", value(row, "Preporučena maloprodajna cena")),
        tag("Recommended_retail_price", value(row, "Snižena preporučena maloprodajna cena")),
        tag("New_product", value(row, "Novi proizvodi")),
        tag("Product_video", value(row, "Video")),
        `<Product_fhdimages>${photos.map((photo) => tag("Image", photo)).join("")}</Product_fhdimages>`,
        tag("Energylabel_pdf", value(row, "Energylabel PDF")),
        tag("Manual_pdf", value(row, "Manual")),
        "</Product>",
      ].join("");
    }),
    "</Products>",
  ].join("");
  return parseRabaluxCatalogXml(xml);
}

function tag(name: string, value: string) {
  return `<${name}>${escapeXml(value)}</${name}>`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeHeader(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("sr-Latn");
}

function parseStockDate(value: string) {
  if (!value) return null;
  const match = value.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  const date = match
    ? new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseRabaluxStockCsv(raw: string): RabaluxStockItem[] {
  const rows = parseDelimitedRows(raw.replace(/^\uFEFF/, ""));
  rows.shift();
  return rows
    .map((row) => {
      const sourceSku = row[0]?.trim();
      if (!sourceSku) return null;
      const status = row[5]?.trim() ?? "";
      const stockNumber = Number.parseInt(row[6]?.trim() ?? "0", 10);
      return {
        sourceSku,
        stock: Number.isFinite(stockNumber) && stockNumber > 0 ? stockNumber : 0,
        status,
        outgoing: /\boutgoing\b/i.test(status),
        restricted: /\brestricted\b/i.test(status),
        nextArrivalAt: parseStockDate(row[8]?.trim() ?? ""),
      };
    })
    .filter((item): item is RabaluxStockItem => item !== null);
}

export function summarizeRabaluxDryRun(
  catalog: RabaluxCatalogItem[],
  stock: RabaluxStockItem[],
): RabaluxDryRunSummary {
  const catalogSkus = new Set(catalog.map((item) => item.sourceSku));
  const stockSkus = new Set(stock.map((item) => item.sourceSku));
  return {
    catalogRows: catalog.length,
    stockRows: stock.length,
    catalogUnique: catalogSkus.size,
    stockUnique: stockSkus.size,
    invalidPrice: catalog.filter((item) => item.fullPrice <= 0).length,
    catalogOnly: [...catalogSkus].filter((sku) => !stockSkus.has(sku)).sort(),
    stockOnly: [...stockSkus].filter((sku) => !catalogSkus.has(sku)).sort(),
    videos: catalog.reduce(
      (sum, item) => sum + item.media.filter((asset) => asset.kind === "VIDEO").length,
      0,
    ),
    manuals: catalog.reduce(
      (sum, item) => sum + item.attachments.filter((asset) => asset.kind === "MANUAL").length,
      0,
    ),
    energyLabels: catalog.reduce(
      (sum, item) =>
        sum + item.attachments.filter((asset) => asset.kind === "ENERGY_LABEL").length,
      0,
    ),
    imageAssets: catalog.reduce(
      (sum, item) => sum + item.media.filter((asset) => asset.kind === "IMAGE").length,
      0,
    ),
  };
}
