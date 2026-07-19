import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { ErpColumn, ErpModule, ErpRow } from "@/lib/admin/erp";
import { resolveChannelAvailability } from "@/lib/channel-availability";

const text = (key: string, label: string, defaultVisible = true): ErpColumn => ({
  key,
  label,
  defaultVisible,
});
const number = (key: string, label: string, defaultVisible = true): ErpColumn => ({
  key,
  label,
  type: "number",
  align: "right",
  defaultVisible,
});
const money = (key: string, label: string, defaultVisible = true): ErpColumn => ({
  key,
  label,
  type: "money",
  align: "right",
  defaultVisible,
});
const date = (key: string, label: string, defaultVisible = true): ErpColumn => ({
  key,
  label,
  type: "date",
  defaultVisible,
});
const status = (
  key: string,
  label: string,
  options?: string[],
): ErpColumn => ({
  key,
  label,
  type: "status",
  options,
  defaultVisible: true,
});
const bool = (key: string, label: string): ErpColumn => ({
  key,
  label,
  type: "boolean",
  align: "center",
  defaultVisible: true,
});

const emptyRows: ErpRow[] = [];

export const operationalErpModules: ErpModule[] = [
  {
    slug: "sifarnici-artikala",
    number: "1b",
    title: "Šifarnici artikala",
    description: "Normalizovane vrednosti atributa, boja, benefita i sertifikata za inline izbor.",
    status: "ready",
    commands: [{ label: "Nova vrednost", tone: "primary", action: "lookup.create" }],
    columns: [
      status("kind", "Vrsta", ["ATTRIBUTE", "COLOR", "BENEFIT", "CERTIFICATE"]),
      text("value", "Vrednost"),
      text("slug", "Slug"),
      number("products", "Artikli"),
      bool("active", "Aktivna"),
    ],
    editableColumns: ["kind", "value", "slug", "active"],
    rows: emptyRows,
  },
  {
    slug: "cenovnici",
    number: "7",
    title: "Cenovnici",
    description: "Datirani MP, nabavni, veleprodajni i izvozni cenovnici sa istorijom stavki.",
    status: "ready",
    commands: [{ label: "Novi cenovnik", tone: "primary", action: "price-list.create" }],
    columns: [
      text("code", "Šifra"),
      text("name", "Naziv"),
      status("kind", "Vrsta", ["RETAIL", "PURCHASE", "WHOLESALE", "EXPORT"]),
      text("currency", "Valuta"),
      number("entries", "Stavke"),
      date("validFrom", "Važi od"),
      date("validTo", "Važi do"),
      bool("active", "Aktivan"),
    ],
    editableColumns: ["code", "name", "kind", "currency", "validFrom", "validTo", "active"],
    rows: emptyRows,
  },
  {
    slug: "akcijske-cene",
    number: "8",
    title: "Akcijske cene proizvoda",
    description: "Cena po proizvodu i akciji sa numeričkim prioritetom i periodom važenja.",
    status: "ready",
    commands: [],
    columns: [
      text("action", "Akcija"),
      number("priority", "Prioritet"),
      text("sku", "SKU"),
      text("product", "Artikal"),
      money("fullPrice", "MP cena"),
      money("salePrice", "Akcijska cena"),
      date("startsAt", "Početak"),
      date("endsAt", "Kraj"),
    ],
    editableColumns: ["priority", "salePrice", "startsAt", "endsAt"],
    rows: emptyRows,
    notes: ["Kada se periodi preklapaju, koristi se aktivna akcija sa najvišim prioritetom."],
  },
  {
    slug: "loyalty",
    number: "9",
    title: "Loyalty pravila i istorija",
    description: "Vremenski ograničena loyalty pravila i trag promena loyalty cena po artiklu.",
    status: "ready",
    commands: [{ label: "Novo pravilo", tone: "primary", action: "loyalty.create" }],
    columns: [
      text("name", "Naziv"),
      number("discountPct", "Popust %"),
      number("priority", "Prioritet"),
      date("startsAt", "Početak"),
      date("endsAt", "Kraj"),
      bool("active", "Aktivno"),
    ],
    editableColumns: ["name", "discountPct", "priority", "startsAt", "endsAt", "active"],
    rows: emptyRows,
  },
  {
    slug: "linearne-promocije",
    number: "10",
    title: "Linearne promocije",
    description: "Globalne, kategorijske i grupne promocije sa prioritetom i kontrolom maksimalnog popusta.",
    status: "ready",
    commands: [
      { label: "Nova promocija", tone: "primary", action: "linear-promotion.create" },
    ],
    columns: [
      text("name", "Naziv"),
      status("target", "Obuhvat", ["ALL", "CATEGORY", "GROUP"]),
      text("scope", "Kategorije / grupe"),
      number("discountPct", "Popust %"),
      number("priority", "Prioritet"),
      date("startsAt", "Početak"),
      date("endsAt", "Kraj"),
      bool("active", "Aktivna"),
    ],
    editableColumns: ["name", "target", "discountPct", "priority", "startsAt", "endsAt", "active"],
    rows: emptyRows,
  },
  {
    slug: "magacini",
    number: "11",
    title: "Magacini",
    description: "Više magacina, kontaktni podaci i izbor podrazumevanog distributivnog centra.",
    status: "ready",
    commands: [{ label: "Novi magacin", tone: "primary", action: "warehouse.create" }],
    columns: [
      text("code", "Šifra"),
      text("name", "Naziv"),
      text("address", "Adresa"),
      text("city", "Grad"),
      text("email", "E-mail"),
      text("phone", "Telefon"),
      bool("isDefault", "DC"),
      bool("active", "Aktivan"),
    ],
    editableColumns: ["code", "name", "address", "city", "email", "phone", "isDefault", "active"],
    rows: emptyRows,
  },
  {
    slug: "stanje-po-magacinima",
    number: "12",
    title: "Stanje po magacinima",
    description: "Fizičko, rezervisano, raspoloživo i dolazeće stanje po artiklu i magacinu.",
    status: "ready",
    commands: [],
    columns: [
      text("warehouse", "Magacin"),
      text("sku", "SKU"),
      text("product", "Artikal"),
      number("physical", "Fizičko"),
      number("reserved", "Rezervisano"),
      number("available", "Raspoloživo"),
      number("incoming", "U dolasku"),
      bool("web", "Web"),
      bool("wholesale", "VP"),
      bool("export", "INO"),
    ],
    rows: emptyRows,
  },
  {
    slug: "kretanja-zaliha",
    number: "13",
    title: "Kretanja zaliha",
    description: "Neizmenjiv trag svih prijema, prodaja, povrata, otpremnica, prenosa i popisa.",
    status: "ready",
    commands: [],
    columns: [
      date("createdAt", "Datum"),
      text("warehouse", "Magacin"),
      status("kind", "Vrsta"),
      text("sku", "SKU"),
      number("qty", "Promena"),
      number("balanceAfterWarehouse", "Stanje magacina"),
      number("balanceAfterTotal", "Ukupno stanje"),
      text("note", "Napomena"),
      text("idempotencyKey", "Idempotency key", false),
    ],
    rows: emptyRows,
  },
  {
    slug: "popisi",
    number: "14",
    title: "Popisi zaliha",
    description: "Kontrolisani popisi po magacinu sa očekivanim, prebrojanim i razlikama.",
    status: "ready",
    commands: [
      { label: "Novi popis", tone: "primary", action: "stock-count.create" },
      {
        label: "Proknjiži popis",
        tone: "neutral",
        action: "stock-count.post",
        needsSelection: true,
        confirm: "Proknjižiti razlike izabranih popisa na lager?",
      },
    ],
    columns: [
      text("number", "Broj"),
      text("warehouse", "Magacin"),
      status("status", "Status", ["DRAFT", "POSTED", "CANCELLED"]),
      number("items", "Stavke"),
      number("difference", "Ukupna razlika"),
      date("countedAt", "Prebrojano"),
      date("postedAt", "Proknjiženo"),
    ],
    rows: emptyRows,
  },
  {
    slug: "prodajni-nalozi",
    number: "15",
    title: "Prodajni nalozi",
    description: "Jedinstven ERP pregled web, Ananas, veleprodajnih i izvoznih naloga.",
    status: "ready",
    commands: [
      { label: "Nova VP porudžbina", tone: "primary", action: "sales-order.create-vp" },
      { label: "Nova INO porudžbina", tone: "neutral", action: "sales-order.create-ino" },
    ],
    detailHrefBase: "/admin/narudzbine",
    columns: [
      text("number", "Broj"),
      status("channel", "Kanal", ["WEB", "ANANAS", "VP", "INO"]),
      status("status", "Status"),
      text("customer", "Kupac"),
      text("email", "E-mail"),
      text("city", "Grad"),
      number("items", "Stavke"),
      money("total", "Ukupno"),
      text("payment", "Plaćanje"),
      text("fiscal", "Fiskalizacija"),
      text("invoice", "Faktura / SEF"),
      date("createdAt", "Kreirano"),
    ],
    rows: emptyRows,
  },
  {
    slug: "otpremnice",
    number: "16",
    title: "Otpremnice i interni prenosi",
    description: "Kupčevske i interne otpremnice sa knjiženjem transakcionalnih kretanja zaliha.",
    status: "ready",
    commands: [
      { label: "Nova otpremnica", tone: "primary", action: "dispatch.create" },
      {
        label: "Proknjiži",
        tone: "neutral",
        action: "dispatch.post",
        needsSelection: true,
        confirm: "Proknjižiti izabrane otpremnice i promeniti lager?",
      },
    ],
    columns: [
      text("number", "Broj"),
      status("type", "Vrsta", ["CUSTOMER", "INTERNAL", "STOCKTAKE"]),
      status("status", "Status", ["DRAFT", "POSTED", "CANCELLED"]),
      text("order", "Nalog"),
      text("source", "Iz magacina"),
      text("destination", "Odredište"),
      number("items", "Stavke"),
      date("postedAt", "Proknjiženo"),
      date("createdAt", "Kreirano"),
    ],
    rows: emptyRows,
  },
  {
    slug: "preuzimanja",
    number: "17",
    title: "Kurirska preuzimanja",
    description: "Paketi, pickup batch-evi i manifesti za kurirsko preuzimanje.",
    status: "ready",
    commands: [{ label: "Novi batch", tone: "primary", action: "pickup.create" }],
    columns: [
      text("number", "Broj"),
      text("courier", "Kurir"),
      status("status", "Status", ["DRAFT", "BOOKED", "PICKED_UP", "CANCELLED"]),
      number("packages", "Paketi"),
      date("pickupDate", "Datum preuzimanja"),
      text("manifestRef", "Manifest"),
      text("configurationIssue", "Konfiguracija"),
    ],
    rows: emptyRows,
  },
  {
    slug: "kupci",
    number: "18",
    title: "Kupci",
    description: "Jedinstvena baza kupaca sa kontaktima, adresama, PIB-om i ručno održavanim polom.",
    status: "ready",
    commands: [{ label: "Novi kupac", tone: "primary", action: "customer.create" }],
    columns: [
      text("name", "Ime / naziv"),
      text("email", "E-mail"),
      text("phone", "Telefon"),
      text("address", "Adresa"),
      text("city", "Grad"),
      text("pib", "PIB"),
      status("gender", "Pol", ["NEPOZNATO", "ZENSKI", "MUSKI"]),
      number("orders", "Porudžbine"),
      money("turnover", "Promet"),
      date("createdAt", "Kreiran"),
    ],
    editableColumns: ["email", "phone", "address", "city", "pib", "gender"],
    rows: emptyRows,
  },
  {
    slug: "partner-klijenti",
    number: "19",
    title: "Partner API klijenti",
    description: "Hashovani bearer ključevi, scope-ovi, rate limit i revokacija partner pristupa.",
    status: "ready",
    commands: [
      { label: "Novi API ključ", tone: "primary", action: "partner-client.create" },
    ],
    columns: [
      text("name", "Partner"),
      text("keyPrefix", "Prefiks ključa"),
      text("scopes", "Scope-ovi"),
      number("rateLimit", "Zahteva/min"),
      bool("enabled", "Aktivan"),
      date("lastUsedAt", "Poslednje korišćenje"),
      date("createdAt", "Kreiran"),
    ],
    editableColumns: ["name", "scopes", "rateLimit", "enabled"],
    rows: emptyRows,
  },
  {
    slug: "partner-rezervacije",
    number: "20",
    title: "Partner rezervacije",
    description: "Idempotentna razmena rezervacija zaliha sa partnerima.",
    status: "ready",
    commands: [],
    columns: [
      text("partner", "Partner"),
      text("externalRef", "Eksterna referenca"),
      text("sku", "SKU"),
      text("product", "Artikal"),
      number("qty", "Količina"),
      status("status", "Status", ["ACTIVE", "RELEASED", "CONSUMED", "CANCELLED"]),
      date("expiresAt", "Ističe"),
      date("createdAt", "Kreirano"),
    ],
    rows: emptyRows,
  },
  {
    slug: "integracije",
    number: "21",
    title: "Integracije i konfiguracija",
    description: "Stvarna spremnost SEF, Ananas, kurirskih, newsletter i Viber adaptera.",
    status: "blocked_external",
    blockedReason: "Pojedinačne akcije se uključuju tek kada health check potvrdi sve obavezne vrednosti.",
    commands: [
      {
        label: "SEF sinhronizacija",
        disabledReason: "Nedostaju SEF_BASE_URL, SEF_CLIENT_ID i SEF_CLIENT_SECRET.",
      },
      {
        label: "Ananas sinhronizacija",
        disabledReason: "Nedostaju ANANAS_BASE_URL i ANANAS_API_KEY.",
      },
    ],
    columns: [
      text("provider", "Provider"),
      status("status", "Status", ["HEALTHY", "UNHEALTHY", "NOT_CONFIGURED"]),
      text("missing", "Nedostaje"),
      text("message", "Objašnjenje"),
    ],
    rows: emptyRows,
  },
  {
    slug: "racunovodstveni-registri",
    number: "22",
    title: "Interni računovodstveni registri",
    description: "Promet, storna/povraćaji, kalkulacije, nivelacije i KEP izvedeni iz autoritativnih dokumenata.",
    status: "ready",
    commands: [],
    columns: [
      text("receiptNumber", "Dokument"),
      text("order", "Nalog"),
      status("kind", "Vrsta"),
      status("status", "Status"),
      money("net", "Neto"),
      money("vat", "PDV"),
      money("gross", "Bruto"),
      text("warehouse", "Magacin"),
      date("issuedAt", "Izdato"),
    ],
    rows: emptyRows,
    notes: ["Interni operativni registar — nije računovodstveno odobren zakonski obrazac."],
  },
  {
    slug: "neobjavljeni-artikli",
    number: "23",
    title: "Neobjavljeni artikli",
    description: "QA izveštaj sa preciznim razlogom zbog kog artikal ne može na prodavnicu.",
    status: "ready",
    commands: [],
    detailHrefBase: "/admin/proizvodi",
    columns: [
      text("sku", "SKU"),
      text("name", "Naziv"),
      status("articleStatus", "ERP status"),
      text("blockingReason", "Razlog blokade"),
      money("fullPrice", "MP cena"),
      number("stock", "Zalihe"),
      bool("isActive", "Aktivan"),
      date("updatedAt", "Izmenjen"),
    ],
    rows: emptyRows,
  },
  {
    slug: "heroji-meseca",
    number: "23b",
    title: "Heroji meseca",
    description: "Mesečni izbor hero artikala povezan sa akcijom i redosledom prikaza.",
    status: "ready",
    commands: [],
    columns: [
      number("year", "Godina"),
      number("month", "Mesec"),
      number("order", "Redosled"),
      text("productSku", "SKU"),
      text("action", "Akcija"),
    ],
    rows: emptyRows,
  },
  {
    slug: "landing-strane",
    number: "24",
    title: "Landing strane",
    description: "Landing page CRUD sa periodom objave, SEO poljima i uređenim sekcijama.",
    status: "ready",
    commands: [
      { label: "Nova landing strana", tone: "primary", action: "landing.create" },
      {
        label: "Dodaj sekciju",
        tone: "neutral",
        action: "landing-section.create",
        needsSelection: true,
      },
      {
        label: "Obriši",
        tone: "danger",
        action: "row.delete",
        needsSelection: true,
        confirm: "Obrisati izabrane landing strane?",
      },
    ],
    columns: [
      text("slug", "Slug"),
      text("title", "Naslov"),
      text("lead", "Uvod", false),
      text("heroImageUrl", "Hero slika", false),
      text("seoTitle", "SEO naslov", false),
      text("seoDescription", "SEO opis", false),
      status("status", "Status", ["DRAFT", "PUBLISHED", "ARCHIVED"]),
      number("sections", "Sekcije"),
      date("startsAt", "Početak"),
      date("endsAt", "Kraj"),
      date("publishedAt", "Objavljeno"),
    ],
    editableColumns: [
      "slug",
      "title",
      "lead",
      "heroImageUrl",
      "seoTitle",
      "seoDescription",
      "status",
      "startsAt",
      "endsAt",
    ],
    rows: emptyRows,
  },
  {
    slug: "landing-sekcije",
    number: "24b",
    title: "Sekcije landing strana",
    description: "Uređene sadržajne sekcije, slike i liste artikala po landing strani.",
    status: "ready",
    commands: [
      {
        label: "Obriši sekciju",
        tone: "danger",
        action: "row.delete",
        needsSelection: true,
        confirm: "Obrisati izabrane landing sekcije?",
      },
    ],
    columns: [
      text("landingPage", "Landing strana"),
      number("position", "Pozicija"),
      text("title", "Naslov"),
      text("body", "Sadržaj", false),
      text("imageUrl", "Slika", false),
      text("productSkus", "SKU artikala"),
    ],
    editableColumns: ["position", "title", "body", "imageUrl", "productSkus"],
    rows: emptyRows,
  },
  {
    slug: "mobilni-tabovi",
    number: "25",
    title: "Mobilni tabovi",
    description: "Četiri jedinstvene mobilne pozicije povezane sa akcijom, landing stranom ili linkom.",
    status: "ready",
    commands: [],
    columns: [
      number("position", "Pozicija"),
      text("label", "Naziv"),
      text("destination", "Odredište"),
      text("icon", "Ikonica"),
      bool("enabled", "Aktivan"),
    ],
    editableColumns: ["position", "label", "icon", "enabled"],
    rows: emptyRows,
  },
  {
    slug: "pozicije-piktograma",
    number: "26",
    title: "Pozicije piktograma",
    description: "Četiri kontrolisane pozicije piktograma na akcijama i landing stranama.",
    status: "ready",
    commands: [],
    columns: [
      text("pictogram", "Piktogram"),
      status("slot", "Pozicija"),
      text("targetType", "Tip odredišta"),
      text("target", "Odredište"),
      date("createdAt", "Kreirano"),
    ],
    rows: emptyRows,
  },
  {
    slug: "newsletter-kampanje",
    number: "27",
    title: "Newsletter kampanje",
    description: "Autorstvo, zakazivanje, slanje i rezultati newsletter kampanja.",
    status: "ready",
    commands: [
      { label: "Nova kampanja", tone: "primary", action: "newsletter.create" },
      {
        label: "Pošalji",
        disabledReason: "Slanje je dostupno tek kada EMAIL_PROVIDER i marketing pošiljalac prođu health check.",
      },
      {
        label: "Obriši nacrt",
        tone: "danger",
        action: "row.delete",
        needsSelection: true,
        confirm: "Obrisati izabrane newsletter nacrte?",
      },
    ],
    columns: [
      text("title", "Naziv"),
      text("subject", "Naslov poruke"),
      text("body", "Sadržaj", false),
      status("status", "Status"),
      date("scheduledAt", "Zakazano"),
      date("sentAt", "Poslato"),
      number("recipients", "Primaoci"),
      number("delivered", "Isporučeno"),
      number("failed", "Greške"),
    ],
    editableColumns: ["title", "subject", "body", "status", "scheduledAt"],
    rows: emptyRows,
  },
  {
    slug: "posete-konverzije",
    number: "28",
    title: "Posete i konverzije",
    description: "First-party događaji zabeleženi samo uz analytics saglasnost i rotirajući anonimni identifikator.",
    status: "ready",
    commands: [],
    columns: [
      date("occurredAt", "Vreme"),
      status("type", "Događaj"),
      text("anonymousId", "Anonimni ID"),
      text("path", "Putanja"),
      text("sku", "SKU"),
      number("quantity", "Količina"),
      money("value", "Vrednost"),
      text("consentVersion", "Verzija saglasnosti"),
    ],
    rows: emptyRows,
  },
  {
    slug: "reklamacije-dnevnik",
    number: "29",
    title: "Dnevnik reklamacija",
    description: "Pravni dnevnik, odluka, odgovor, rešenje i kurirski/magacinski zadaci.",
    status: "ready",
    commands: [],
    columns: [
      text("number", "Broj"),
      text("order", "Porudžbina"),
      text("customer", "Kupac"),
      text("sku", "SKU"),
      status("type", "Vrsta"),
      status("request", "Zahtev"),
      status("decision", "Odluka"),
      status("resolution", "Rešenje"),
      status("status", "Status"),
      date("respondedAt", "Odgovoreno"),
      date("resolvedAt", "Rešeno"),
      date("createdAt", "Primljeno"),
    ],
    editableColumns: [
      "type",
      "request",
      "decision",
      "resolution",
      "status",
      "respondedAt",
      "resolvedAt",
    ],
    rows: emptyRows,
  },
  {
    slug: "admin-podesavanja",
    number: "30",
    title: "ERP podešavanja",
    description: "Centralne poslovne vrednosti za cene, safety stock, valutu i vremensku zonu.",
    status: "ready",
    commands: [],
    columns: [
      text("key", "Ključ"),
      text("value", "Vrednost"),
      text("updatedBy", "Izmenio"),
      date("updatedAt", "Izmenjeno"),
    ],
    editableColumns: ["value"],
    rows: emptyRows,
  },
];

function decimal(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : value.toNumber();
}

function dateOnly(value: Date | null | undefined) {
  return value?.toISOString().slice(0, 10) ?? null;
}

function dateTime(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

export async function getOperationalErpRows(
  slug: string,
  take = 100,
): Promise<ErpRow[]> {
  switch (slug) {
    case "sifarnici-artikala":
      return productLookupRows(take);
    case "cenovnici":
      return priceListRows(take);
    case "akcijske-cene":
      return actionPriceRows(take);
    case "loyalty":
      return loyaltyRows(take);
    case "linearne-promocije":
      return linearPromotionRows(take);
    case "magacini":
      return warehouseRows(take);
    case "stanje-po-magacinima":
      return warehouseStockRows(take);
    case "kretanja-zaliha":
      return stockMovementRows(take);
    case "popisi":
      return stockCountRows(take);
    case "prodajni-nalozi":
      return salesOrderRows(take);
    case "otpremnice":
      return dispatchRows(take);
    case "preuzimanja":
      return pickupRows(take);
    case "kupci":
      return customerRows(take);
    case "partner-klijenti":
      return partnerClientRows(take);
    case "partner-rezervacije":
      return partnerReservationRows(take);
    case "integracije":
      return integrationRows();
    case "racunovodstveni-registri":
      return accountingRows(take);
    case "neobjavljeni-artikli":
      return unpublishedRows(take);
    case "heroji-meseca":
      return heroOfMonthRows(take);
    case "landing-strane":
      return landingPageRows(take);
    case "landing-sekcije":
      return landingSectionRows(take);
    case "mobilni-tabovi":
      return mobileTabRows();
    case "pozicije-piktograma":
      return pictogramPlacementRows(take);
    case "newsletter-kampanje":
      return newsletterRows(take);
    case "posete-konverzije":
      return analyticsRows(take);
    case "reklamacije-dnevnik":
      return reclamationRows(take);
    case "admin-podesavanja":
      return adminSettingRows(take);
    default:
      return [];
  }
}

async function productLookupRows(take: number): Promise<ErpRow[]> {
  const rows = await db.productLookupValue.findMany({
    take,
    orderBy: [{ kind: "asc" }, { value: "asc" }],
    include: { _count: { select: { assignments: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      kind: row.kind,
      value: row.value,
      slug: row.slug,
      products: row._count.assignments,
      active: row.active,
    },
  }));
}

async function priceListRows(take: number): Promise<ErpRow[]> {
  const rows = await db.priceList.findMany({
    take,
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { entries: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      code: row.code,
      name: row.name,
      kind: row.kind,
      currency: row.currency,
      entries: row._count.entries,
      validFrom: dateOnly(row.validFrom),
      validTo: dateOnly(row.validTo),
      active: row.active,
    },
  }));
}

async function actionPriceRows(take: number): Promise<ErpRow[]> {
  const rows = await db.actionProduct.findMany({
    take,
    orderBy: [{ action: { priority: "desc" } }, { updatedAt: "desc" }],
    include: { action: true, product: true },
  });
  return rows.map((row) => ({
    id: `${row.actionId}:${row.productId}`,
    values: {
      action: row.action.name,
      priority: row.action.priority,
      sku: row.product.sku,
      product: row.product.name,
      fullPrice: decimal(row.product.fullPrice),
      salePrice: decimal(row.salePrice),
      startsAt: dateOnly(row.action.startsAt),
      endsAt: dateOnly(row.action.endsAt),
    },
  }));
}

async function loyaltyRows(take: number): Promise<ErpRow[]> {
  const rows = await db.loyaltyRule.findMany({
    take,
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      name: row.name,
      discountPct: decimal(row.discountPct),
      priority: row.priority,
      startsAt: dateOnly(row.startsAt),
      endsAt: dateOnly(row.endsAt),
      active: row.active,
    },
  }));
}

async function linearPromotionRows(take: number): Promise<ErpRow[]> {
  const rows = await db.linearPromotion.findMany({
    take,
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    include: {
      categories: { include: { category: { select: { name: true } } } },
      groups: { include: { group: { select: { name: true } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      name: row.name,
      target: row.target,
      scope:
        row.target === "CATEGORY"
          ? row.categories.map((item) => item.category.name).join(", ")
          : row.target === "GROUP"
            ? row.groups.map((item) => item.group.name).join(", ")
            : "Svi artikli",
      discountPct: decimal(row.discountPct),
      priority: row.priority,
      startsAt: dateOnly(row.startsAt),
      endsAt: dateOnly(row.endsAt),
      active: row.active,
    },
  }));
}

async function warehouseRows(take: number): Promise<ErpRow[]> {
  const rows = await db.warehouse.findMany({
    take,
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      code: row.code,
      name: row.name,
      address: row.address,
      city: row.city,
      email: row.email,
      phone: row.phone,
      isDefault: row.isDefault,
      active: row.active,
    },
  }));
}

async function warehouseStockRows(take: number): Promise<ErpRow[]> {
  const rows = await db.warehouseStock.findMany({
    take,
    orderBy: { updatedAt: "desc" },
    include: {
      warehouse: { select: { name: true } },
      product: {
        select: {
          sku: true,
          name: true,
          incomingStock: true,
          availableWebManual: true,
          availableWholesaleManual: true,
          availableExportManual: true,
          partnerReservations: {
            where: {
              status: "ACTIVE",
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            select: { qty: true },
          },
        },
      },
    },
  });
  return rows.map((row) => {
    const reserved = row.product.partnerReservations.reduce((sum, item) => sum + item.qty, 0);
    const channels = resolveChannelAvailability({
      physical: row.qty,
      reserved,
      manualWeb: row.product.availableWebManual,
      manualWholesale: row.product.availableWholesaleManual,
      manualExport: row.product.availableExportManual,
    });
    return {
      id: row.id,
      values: {
        warehouse: row.warehouse.name,
        sku: row.product.sku,
        product: row.product.name,
        physical: row.qty,
        reserved,
        available: channels.available,
        incoming: row.product.incomingStock,
        web: channels.web,
        wholesale: channels.wholesale,
        export: channels.export,
      },
    };
  });
}

async function stockMovementRows(take: number): Promise<ErpRow[]> {
  const rows = await db.stockMovement.findMany({
    take,
    orderBy: { createdAt: "desc" },
    include: { warehouse: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      createdAt: dateTime(row.createdAt),
      warehouse: row.warehouse.name,
      kind: row.kind,
      sku: row.sku,
      qty: row.qty,
      balanceAfterWarehouse: row.balanceAfterWarehouse,
      balanceAfterTotal: row.balanceAfterTotal,
      note: row.note,
      idempotencyKey: row.idempotencyKey,
    },
  }));
}

async function stockCountRows(take: number): Promise<ErpRow[]> {
  const rows = await db.stockCount.findMany({
    take,
    orderBy: { createdAt: "desc" },
    include: {
      warehouse: { select: { name: true } },
      items: { select: { differenceQty: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      number: row.number,
      warehouse: row.warehouse.name,
      status: row.status,
      items: row.items.length,
      difference: row.items.reduce((sum, item) => sum + item.differenceQty, 0),
      countedAt: dateOnly(row.countedAt),
      postedAt: dateOnly(row.postedAt),
    },
  }));
}

async function salesOrderRows(take: number): Promise<ErpRow[]> {
  const rows = await db.order.findMany({
    take,
    orderBy: { createdAt: "desc" },
    include: {
      customer: true,
      _count: { select: { items: true } },
      fiscalDocuments: { take: 1, orderBy: { createdAt: "desc" }, select: { status: true } },
      invoices: { take: 1, orderBy: { issuedAt: "desc" }, select: { status: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      number: row.number,
      channel: row.channel,
      status: row.status,
      customer:
        [row.customer?.firstName ?? row.shipFirstName, row.customer?.lastName ?? row.shipLastName]
          .filter(Boolean)
          .join(" ") || row.customer?.companyName || row.shipCompanyName,
      email: row.customer?.email ?? row.guestEmail,
      city: row.shipCity,
      items: row._count.items,
      total: decimal(row.total),
      payment: row.paymentMethod,
      fiscal: row.fiscalDocuments[0]?.status ?? "NIJE_KREIRAN",
      invoice: row.invoices[0]?.status ?? "NIJE_KREIRANA",
      createdAt: dateTime(row.createdAt),
    },
  }));
}

async function dispatchRows(take: number): Promise<ErpRow[]> {
  const rows = await db.dispatchNote.findMany({
    take,
    orderBy: { createdAt: "desc" },
    include: {
      order: { select: { number: true } },
      sourceWarehouse: { select: { name: true } },
      destinationWarehouse: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      number: row.number,
      type: row.type,
      status: row.status,
      order: row.order?.number ?? null,
      source: row.sourceWarehouse.name,
      destination:
        row.destinationWarehouse?.name ?? row.destinationName ?? row.destinationAddress,
      items: row._count.items,
      postedAt: dateTime(row.postedAt),
      createdAt: dateTime(row.createdAt),
    },
  }));
}

async function pickupRows(take: number): Promise<ErpRow[]> {
  const rows = await db.pickupBatch.findMany({
    take,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { lines: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      number: row.number,
      courier: row.courier,
      status: row.status,
      packages: row._count.lines,
      pickupDate: dateTime(row.pickupDate),
      manifestRef: row.manifestRef,
      configurationIssue: row.configurationIssue,
    },
  }));
}

async function customerRows(take: number): Promise<ErpRow[]> {
  const rows = await db.customer.findMany({
    take,
    orderBy: { updatedAt: "desc" },
    include: {
      orders: { select: { total: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      name:
        [row.firstName, row.lastName].filter(Boolean).join(" ") ||
        row.companyName ||
        "Bez naziva",
      email: row.email,
      phone: row.phone,
      address: row.address,
      city: row.city,
      pib: row.pib,
      gender: row.gender,
      orders: row.orders.length,
      turnover: row.orders.reduce((sum, order) => sum + Number(order.total), 0),
      createdAt: dateOnly(row.createdAt),
    },
  }));
}

async function partnerClientRows(take: number): Promise<ErpRow[]> {
  const rows = await db.partnerApiClient.findMany({
    take,
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      name: row.name,
      keyPrefix: row.keyPrefix,
      scopes: row.scopes.join(", "),
      rateLimit: row.rateLimit,
      enabled: row.enabled,
      lastUsedAt: dateTime(row.lastUsedAt),
      createdAt: dateTime(row.createdAt),
    },
  }));
}

async function partnerReservationRows(take: number): Promise<ErpRow[]> {
  const rows = await db.partnerReservation.findMany({
    take,
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { name: true } },
      product: { select: { sku: true, name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      partner: row.client.name,
      externalRef: row.externalRef,
      sku: row.product.sku,
      product: row.product.name,
      qty: row.qty,
      status: row.status,
      expiresAt: dateTime(row.expiresAt),
      createdAt: dateTime(row.createdAt),
    },
  }));
}

function configured(value: string | undefined) {
  const normalized = value?.trim();
  return Boolean(
    normalized &&
      !normalized.startsWith("GET_FROM_") &&
      !normalized.includes("CHANGE_ME") &&
      !normalized.toLowerCase().includes("placeholder"),
  );
}

function providerRow(provider: string, keys: string[]): ErpRow {
  const missing = keys.filter((key) => !configured(process.env[key]));
  return {
    id: provider,
    values: {
      provider,
      status: missing.length ? "NOT_CONFIGURED" : "HEALTHY",
      missing: missing.join(", ") || "—",
      message: missing.length
        ? "Akcije su bezbedno isključene dok konfiguracija ne bude potpuna."
        : "Obavezne vrednosti su prisutne; provider može proći aktivni health check.",
    },
  };
}

async function integrationRows(): Promise<ErpRow[]> {
  return [
    providerRow("SEF", ["SEF_BASE_URL", "SEF_CLIENT_ID", "SEF_CLIENT_SECRET"]),
    providerRow("ANANAS", ["ANANAS_BASE_URL", "ANANAS_API_KEY"]),
    providerRow("MYGLS_PICKUP", [
      "MYGLS_USERNAME",
      "MYGLS_PASSWORD",
      "MYGLS_CLIENT_NUMBER",
      "MYGLS_PICKUP_STREET",
      "MYGLS_PICKUP_CITY",
    ]),
    providerRow("XEXPRESS_PICKUP", [
      "XEXPRESS_BASE_URL",
      "XEXPRESS_USERNAME",
      "XEXPRESS_PASSWORD",
    ]),
    providerRow("NEWSLETTER", ["EMAIL_PROVIDER", "EMAIL_MARKETING_FROM"]),
    providerRow("VIBER", ["VIBER_PROVIDER", "VIBER_API_TOKEN", "VIBER_WEBHOOK_SECRET"]),
  ];
}

async function accountingRows(take: number): Promise<ErpRow[]> {
  const rows = await db.fiscalDocument.findMany({
    take,
    orderBy: { createdAt: "desc" },
    include: {
      order: { select: { number: true } },
      warehouse: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      receiptNumber: row.receiptNumber ?? row.idempotencyKey,
      order: row.order.number,
      kind: row.kind,
      status: row.status,
      net: decimal(row.totalNet),
      vat: decimal(row.totalVat),
      gross: decimal(row.totalGross),
      warehouse: row.warehouse?.name ?? null,
      issuedAt: dateTime(row.issuedAt ?? row.createdAt),
    },
  }));
}

async function unpublishedRows(take: number): Promise<ErpRow[]> {
  const products = await db.product.findMany({
    take,
    orderBy: { updatedAt: "desc" },
    include: { media: { take: 1, select: { id: true } } },
  });
  return products
    .map((product) => {
      const reasons: string[] = [];
      if (!product.isActive) reasons.push("Artikal je ručno deaktiviran");
      if (product.deletedAt) reasons.push("Artikal je arhiviran");
      if (product.articleStatus === "ARH" || product.articleStatus === "UZ") {
        reasons.push(`ERP status ${product.articleStatus} nije prodajan`);
      }
      if (Number(product.fullPrice) <= 0) reasons.push("MP cena nije veća od nule");
      if (!product.description.trim()) reasons.push("Nedostaje opis za sajt");
      if (!product.media.length) reasons.push("Nedostaje glavna fotografija");
      if (!product.availableWebManual) reasons.push("Web kanal je ručno isključen");
      if (product.stock <= 0 && product.incomingStock <= 0) {
        reasons.push("Nema zaliha ni potvrđene količine u dolasku");
      }
      return {
        id: product.id,
        values: {
          sku: product.sku,
          name: product.name,
          articleStatus: product.articleStatus,
          blockingReason: reasons.join("; "),
          fullPrice: decimal(product.fullPrice),
          stock: product.stock,
          isActive: product.isActive,
          updatedAt: dateTime(product.updatedAt),
        },
      };
    })
    .filter((row) => Boolean(row.values.blockingReason));
}

async function heroOfMonthRows(take: number): Promise<ErpRow[]> {
  const rows = await db.heroOfMonth.findMany({
    take,
    orderBy: [{ year: "desc" }, { month: "desc" }, { order: "asc" }],
    include: { action: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      year: row.year,
      month: row.month,
      order: row.order,
      productSku: row.productSku,
      action: row.action?.name ?? null,
    },
  }));
}

async function landingPageRows(take: number): Promise<ErpRow[]> {
  const rows = await db.landingPage.findMany({
    take,
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { sections: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      slug: row.slug,
      title: row.title,
      lead: row.lead,
      heroImageUrl: row.heroImageUrl,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      status: row.status,
      sections: row._count.sections,
      startsAt: dateOnly(row.startsAt),
      endsAt: dateOnly(row.endsAt),
      publishedAt: dateTime(row.publishedAt),
    },
  }));
}

async function landingSectionRows(take: number): Promise<ErpRow[]> {
  const rows = await db.landingPageSection.findMany({
    take,
    orderBy: [{ landingPage: { title: "asc" } }, { position: "asc" }],
    include: { landingPage: { select: { title: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      landingPage: row.landingPage.title,
      position: row.position,
      title: row.title,
      body: row.body,
      imageUrl: row.imageUrl,
      productSkus: row.productSkus.join(", "),
    },
  }));
}

async function mobileTabRows(): Promise<ErpRow[]> {
  const rows = await db.mobileTab.findMany({
    take: 4,
    orderBy: { position: "asc" },
    include: {
      action: { select: { name: true } },
      landingPage: { select: { title: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      position: row.position,
      label: row.label,
      destination: row.action?.name ?? row.landingPage?.title ?? row.href,
      icon: row.icon,
      enabled: row.enabled,
    },
  }));
}

async function pictogramPlacementRows(take: number): Promise<ErpRow[]> {
  const rows = await db.pictogramPlacement.findMany({
    take,
    orderBy: { createdAt: "desc" },
    include: {
      pictogram: { select: { label: true } },
      action: { select: { name: true } },
      landingPage: { select: { title: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      pictogram: row.pictogram.label,
      slot: row.slot,
      targetType: row.actionId ? "AKCIJA" : "LANDING",
      target: row.action?.name ?? row.landingPage?.title ?? null,
      createdAt: dateTime(row.createdAt),
    },
  }));
}

async function newsletterRows(take: number): Promise<ErpRow[]> {
  const rows = await db.newsletterCampaign.findMany({
    take,
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      title: row.title,
      subject: row.subject,
      body: row.body,
      status: row.status,
      scheduledAt: dateTime(row.scheduledAt),
      sentAt: dateTime(row.sentAt),
      recipients: row.recipients,
      delivered: row.delivered,
      failed: row.failed,
    },
  }));
}

async function analyticsRows(take: number): Promise<ErpRow[]> {
  const rows = await db.analyticsEvent.findMany({
    take,
    orderBy: { occurredAt: "desc" },
    include: { product: { select: { sku: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      occurredAt: dateTime(row.occurredAt),
      type: row.type,
      anonymousId: `${row.anonymousId.slice(0, 8)}…`,
      path: row.path,
      sku: row.product?.sku ?? null,
      quantity: row.quantity,
      value: decimal(row.value),
      consentVersion: row.consentVersion,
    },
  }));
}

async function reclamationRows(take: number): Promise<ErpRow[]> {
  const rows = await db.reclamation.findMany({
    take,
    orderBy: { createdAt: "desc" },
    include: { order: { select: { number: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      number: row.number,
      order: row.order.number,
      customer: `${row.customerFirst} ${row.customerLast}`.trim(),
      sku: row.sku,
      type: row.type,
      request: row.request,
      decision: row.decision,
      resolution: row.resolution,
      status: row.status,
      respondedAt: dateTime(row.respondedAt),
      resolvedAt: dateTime(row.resolvedAt),
      createdAt: dateTime(row.createdAt),
    },
  }));
}

async function adminSettingRows(take: number): Promise<ErpRow[]> {
  const rows = await db.adminSetting.findMany({
    take,
    orderBy: { key: "asc" },
  });
  return rows.map((row) => ({
    id: row.key,
    values: {
      key: row.key,
      value: JSON.stringify(row.value),
      updatedBy: row.updatedBy,
      updatedAt: dateTime(row.updatedAt),
    },
  }));
}
