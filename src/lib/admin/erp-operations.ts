import { DispatchNoteType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type {
  ErpColumn,
  ErpModule,
  ErpRow,
  SalesOrderExportFilters,
} from "@/lib/admin/erp";
import { resolveChannelAvailability } from "@/lib/channel-availability";
import {
  STOCK_MOVEMENT_KIND_LABELS,
  stockMovementKindLabel,
} from "@/lib/inventory-movement";
import { calculateSalesLineTotals } from "@/lib/admin/sales-order";
import {
  PICKUP_BATCH_EXTERNAL_BLOCK_REASON,
  PICKUP_BATCH_STATUS_LABEL,
} from "@/lib/admin/pickup-batch";
import {
  customerGenderLabel,
  inferCustomerGender,
} from "@/lib/admin/customer-master";
import {
  STOCKTAKE_DESTINATION_NAME,
  STOCKTAKE_STATUS_LABEL,
} from "@/lib/admin/stocktake-dispatch";
import { resolveEotpremnicaGate } from "@/lib/eotpremnica/config";
import { activeRetailPriceEntryWhere } from "@/lib/pricing/retail-price-write.server";
import { actionGrossMarginPct } from "@/lib/pricing/action-bm";
import { storefrontPublicationBlockers } from "@/lib/web-storefront-availability";

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
    number: "7a",
    title: "Cenovnici",
    description: "Datirani MP, nabavni, veleprodajni i izvozni cenovnici sa istorijom stavki.",
    status: "ready",
    commands: [
      { label: "Novi cenovnik", tone: "primary", action: "price-list.create" },
      { label: "Otvori stavke", clientAction: "open", needsSelection: true },
    ],
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
    detailHrefBase: "/admin/cenovnici",
    rows: emptyRows,
  },
  {
    slug: "akcije",
    number: "7",
    title: "Akcije",
    description: "Kanonski listovni pregled akcija; izbor reda otvara postojeći kompletan editor.",
    status: "ready",
    commands: [],
    columns: [
      text("name", "Naziv"),
      text("slug", "Slug"),
      status("kind", "Vrsta"),
      number("priority", "Prioritet"),
      number("sortOrder", "Redosled"),
      number("products", "Artikli"),
      bool("isHero", "Hero"),
      bool("isPermanent", "Trajna"),
      date("startsAt", "Početak"),
      date("endsAt", "Kraj"),
    ],
    rows: emptyRows,
  },
  {
    slug: "akcijske-cene",
    number: "7b",
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
      number("bmPct", "Akcijska BM%"),
      date("startsAt", "Početak"),
      date("endsAt", "Kraj"),
    ],
    editableColumns: ["priority", "salePrice", "startsAt", "endsAt"],
    rows: emptyRows,
    notes: ["Kada se periodi preklapaju, koristi se aktivna akcija sa najvišim prioritetom."],
  },
  {
    slug: "loyalty",
    number: "7c",
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
    number: "7d",
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
    number: "8",
    title: "Magacini",
    description: "Definisanje i održavanje više magacina sa adresnim i kontaktnim podacima.",
    status: "ready",
    commands: [
      {
        label: "Novi magacin",
        description:
          "Unesite podatke novog magacina. Naziv je obavezan, a interna šifra se dodeljuje automatski.",
        tone: "primary",
        action: "warehouse.create",
        fields: [
          { key: "name", label: "Naziv", type: "text", required: true },
          { key: "address", label: "Adresa", type: "text" },
          { key: "city", label: "Mesto", type: "text" },
          { key: "email", label: "E-mail", type: "email" },
          { key: "phone", label: "Telefon", type: "tel" },
        ],
      },
      {
        label: "Arhiviraj",
        pendingLabel: "Arhiviranje…",
        tone: "danger",
        action: "warehouse.archive",
        needsSelection: true,
        confirm:
          "Arhivirani magacin se više neće nuditi u novim dokumentima. Nastaviti?",
      },
      {
        label: "Ponovo aktiviraj",
        pendingLabel: "Aktiviranje…",
        tone: "neutral",
        action: "warehouse.restore",
        needsSelection: true,
      },
    ],
    columns: [
      text("name", "Naziv"),
      text("address", "Adresa"),
      text("city", "Mesto"),
      text("email", "E-mail"),
      text("phone", "Telefon"),
      status("state", "Status", ["Aktivan", "Arhiviran"]),
    ],
    editableColumns: ["name", "address", "city", "email", "phone"],
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
    description:
      "Neizmenjiva istorija promena zaliha po artiklu i magacinu, sa automatski popunjenim matičnim podacima i stanjem nakon svake promene.",
    status: "ready",
    commands: [],
    columns: [
      text("sku", "Šifra artikla"),
      text("supplier", "Dobavljač"),
      text("category", "Kategorija artikala"),
      text("group", "Grupa artikla"),
      text("subgroup", "Podgrupa artikla"),
      text("collection", "Kolekcija"),
      text("shortDescription", "Kratki opis artikla"),
      text("shortName", "Kratki naziv artikla"),
      text("attribute1", "Atribut 1"),
      text("attribute2", "Atribut 2"),
      text("attribute3", "Atribut 3"),
      text("attribute4", "Atribut 4"),
      text("color1", "Boja 1"),
      text("color2", "Boja 2"),
      date("createdAt", "Datum promene"),
      status("kind", "Tip promene", Object.values(STOCK_MOVEMENT_KIND_LABELS)),
      number("qty", "Promena količine"),
      text("warehouse", "Magacin"),
      number(
        "balanceAfterWarehouse",
        "Ukupna količina na magacinu nakon promene",
      ),
      number("balanceAfterTotal", "Ukupna količina nakon promene"),
      text("note", "Napomena"),
      text("idempotencyKey", "Idempotency key", false),
    ],
    rows: emptyRows,
    notes: [
      "Šifra i matični podaci artikla popunjavaju se automatski iz baze artikala.",
      "Datum, tip, magacin, promena i oba stanja nastaju automatski prilikom knjiženja; istorija nema ručnu izmenu ni brisanje.",
    ],
  },
  {
    slug: "popisi",
    number: "14",
    title: "Popisi",
    description:
      "Popisne otpremnice iz magacina firme ka fiksnom odredištu Popis.",
    status: "ready",
    commands: [
      { label: "Novi popis", tone: "primary", action: "stocktake.create" },
      {
        label: "Uredi",
        tone: "neutral",
        clientAction: "open",
        needsSelection: true,
      },
      {
        label: "Proknjiži popis",
        tone: "neutral",
        action: "stocktake.post",
        needsSelection: true,
        confirm:
          "Proknjižiti izabrane popise kao otpremnice i skinuti stavke sa izvornog lagera?",
      },
      {
        label: "Arhiviraj",
        tone: "neutral",
        action: "stocktake.archive",
        needsSelection: true,
        confirm:
          "Arhivirati izabrane popise? Dokumenti i proknjižena kretanja zaliha ostaju sačuvani.",
      },
      {
        label: "Arhiva",
        tone: "neutral",
        href: "/admin/erp/popisi?view=archive",
      },
      {
        label: "Vrati iz arhive",
        tone: "neutral",
        action: "stocktake.restore",
        needsSelection: true,
      },
      {
        label: "Aktivni popisi",
        tone: "neutral",
        href: "/admin/erp/popisi",
      },
    ],
    detailHrefBase: "/admin/erp/popisi",
    columns: [
      text("number", "Broj"),
      text("source", "Magacin firme koja šalje robu"),
      text("destination", "Magacin firme koja prima robu"),
      status("status", "Status", ["DRAFT", "POSTED", "CANCELLED"]),
      number("items", "Stavke"),
      number("totalQty", "Ukupna količina"),
      date("postedAt", "Proknjiženo"),
      date("archivedAt", "Arhivirano"),
      date("createdAt", "Kreirano"),
    ],
    rows: emptyRows,
    notes: [
      `Odredišni magacin je uvek „${STOCKTAKE_DESTINATION_NAME}”.`,
      "Knjiženjem nastaje popisna otpremnica i količina se skida sa izvornog magacina.",
    ],
  },
  {
    slug: "prodajni-nalozi",
    number: "15",
    title: "Pregled porudžbina",
    description:
      "Jedinstven pregled WEB, Ananas, VP i INO porudžbina — jedan red za svaku šifru artikla.",
    status: "ready",
    commands: [
      {
        label: "Nova",
        tone: "primary",
        href: "/admin/erp/prodajni-nalozi/nova",
      },
      {
        label: "Uredi",
        tone: "neutral",
        clientAction: "open",
        needsSelection: true,
      },
      {
        label: "Obriši",
        tone: "danger",
        action: "sales-order.delete",
        needsSelection: true,
        confirm:
          "Obrisati izabrane neobrađene VP/INO porudžbine? WEB, Ananas, plaćene i dokumentovane porudžbine ne mogu da se obrišu.",
      },
    ],
    detailHrefBase: "/admin/erp/prodajni-nalozi",
    columns: [
      text("number", "Broj porudžbine"),
      status("channel", "Kanal", ["WEB", "ANANAS", "VP", "INO"]),
      text("customer", "Ime i prezime kupca / firma"),
      text("pib", "PIB"),
      text("priceList", "Cenovnik"),
      text("address", "Adresa"),
      text("city", "Mesto"),
      text("postalCode", "Poštanski broj"),
      text("phone", "Telefon"),
      text("email", "E-mail"),
      text("sku", "Šifra artikla"),
      text("supplier", "Dobavljač"),
      text("category", "Kategorija artikala"),
      text("group", "Grupa artikla"),
      text("subgroup", "Podgrupa artikla"),
      text("collection", "Kolekcija"),
      text("shortDescription", "Kratki opis artikla"),
      text("shortName", "Kratki naziv artikla"),
      text("attribute1", "Atribut 1"),
      text("attribute2", "Atribut 2"),
      text("attribute3", "Atribut 3"),
      text("attribute4", "Atribut 4"),
      text("color1", "Boja 1"),
      text("color2", "Boja 2"),
      number("qty", "Količina"),
      money("unitPrice", "MP cena"),
      money("totalNet", "Ukupno bez PDV-a po šifri"),
      money("totalGross", "Ukupno sa PDV-om po šifri"),
      text("warehouse", "Magacin"),
      status("status", "Status porudžbine"),
      bool("fiscalized", "Fiskalizovano"),
      bool("invoiced", "Fakturisano"),
      bool("sefAccepted", "Prihvaćeno na SEF-u"),
      bool("paid", "Plaćeno"),
    ],
    rows: emptyRows,
    notes: [
      "Klik na broj otvara celu porudžbinu. Nova, Uredi i Obriši rade nad celom porudžbinom i kada je izabran samo jedan red artikla.",
      "DOB artikal se podrazumevano vodi u DC-u kada tamo postoji raspoloživo stanje; bez DC stanja vodi se kod dobavljača. Ostali statusi podrazumevano koriste DC.",
    ],
  },
  {
    slug: "otpremnice",
    number: "16",
    title: "Otpremnice",
    description: "Kupčevske i interne otpremnice sa uvozom VP/INO porudžbina, štampom, SEF slanjem i knjiženjem lagera.",
    status: "ready",
    commands: [
      {
        label: "Nova",
        tone: "primary",
        href: "/admin/erp/otpremnice/nova",
      },
      {
        label: "Uredi",
        clientAction: "open",
        needsSelection: true,
      },
      {
        label: "Obriši",
        tone: "danger",
        action: "dispatch.delete",
        needsSelection: true,
        confirm: "Obrisati izabrane nacrte otpremnica?",
      },
      {
        label: "Proknjiži",
        tone: "neutral",
        action: "dispatch.post",
        needsSelection: true,
        confirm: "Proknjižiti izabrane otpremnice i promeniti lager?",
      },
      {
        label: "Pošalji na SEF",
        tone: "neutral",
        action: "dispatch.sef-send",
        needsSelection: true,
        confirm: "Poslati izabrane proknjižene otpremnice na SEF?",
      },
      {
        label: "Štampaj otpremnicu PDF",
        clientAction: "download-pdf",
        needsSelection: true,
      },
      {
        label: "Štampaj otpremnicu Excel",
        clientAction: "download-excel",
        needsSelection: true,
      },
    ],
    columns: [
      text("number", "Broj otpremnice"),
      date("issueDate", "Datum otpremnice"),
      text("issuer", "Naziv firme koja izdaje"),
      text("sourceWarehouse", "Magacin"),
      text("receiver", "Naziv firme koja prima robu"),
      text("destinationWarehouse", "Magacin primaoca"),
      money("totalNet", "Vrednost bez PDV-a"),
      money("totalGross", "Vrednost sa PDV-om"),
      bool("posted", "Proknjiženo"),
      bool("sefSent", "Poslato na SEF"),
    ],
    rows: emptyRows,
    detailHrefBase: "/admin/erp/otpremnice",
    notes: [
      "Dupli klik na red otvara celu otpremnicu. Proknjižena ili poslata otpremnica je zaključana za izmene i brisanje.",
      "Kod internog prenosa odredišni magacin je obavezan, a cene se ne prikazuju niti ulaze u iznose.",
    ],
  },
  {
    slug: "preuzimanja",
    number: "17",
    title: "Kurirska preuzimanja",
    description:
      "Nalozi sa DC redovima kreiranih porudžbina za najavu preuzimanja izabranoj kurirskoj službi.",
    status: "blocked_external",
    blockedReason: PICKUP_BATCH_EXTERNAL_BLOCK_REASON,
    commands: [
      { label: "Novi", tone: "primary", action: "pickup.create" },
      {
        label: "Uredi",
        tone: "neutral",
        clientAction: "open",
        needsSelection: true,
      },
      {
        label: "Obriši",
        tone: "danger",
        action: "pickup.delete",
        needsSelection: true,
        confirm:
          "Obrisati izabrane naloge? Učitane porudžbine biće vraćene u status Kreirano.",
      },
      {
        label: "Proknjiži",
        tone: "neutral",
        action: "pickup.post",
        needsSelection: true,
        disabledReason: PICKUP_BATCH_EXTERNAL_BLOCK_REASON,
      },
    ],
    columns: [
      status("status", "Status", [
        "Novi",
        "Slanje kuriru",
        "Proknjižen",
        "Preuzet",
        "Otkazan",
      ]),
      text("number", "Broj naloga"),
      date("createdAt", "Datum naloga"),
      date("pickupDate", "Datum preuzimanja"),
      number("packages", "Broj redova"),
    ],
    detailHrefBase: "/admin/erp/preuzimanja",
    rows: emptyRows,
  },
  {
    slug: "kupci",
    number: "19",
    title: "Baza kupaca",
    description:
      "Jedinstvena baza fizičkih lica i firmi sa adresnim, poreskim i kontaktnim podacima.",
    status: "ready",
    commands: [
      {
        label: "Novi kupac / firma",
        description:
          "Za fizičko lice pol se određuje na osnovu imena. Firma dobija podatke potrebne za VP/INO naloge i otpremnice.",
        tone: "primary",
        action: "customer.create",
        fields: [
          {
            key: "customerType",
            label: "Vrsta kupca",
            type: "text",
            required: true,
            options: ["Fizičko lice", "Firma"],
          },
          {
            key: "name",
            label: "Ime i prezime / naziv firme",
            type: "text",
            required: true,
          },
          { key: "pib", label: "PIB firme", type: "text" },
          {
            key: "registrationNumber",
            label: "Matični broj firme",
            type: "text",
          },
          { key: "address", label: "Adresa", type: "text" },
          { key: "city", label: "Mesto", type: "text" },
          { key: "postalCode", label: "Poštanski broj", type: "text" },
          { key: "country", label: "Država (ISO 2)", type: "text" },
          { key: "phone", label: "Telefon", type: "tel" },
          { key: "email", label: "E-mail", type: "email" },
        ],
      },
    ],
    columns: [
      status("customerType", "Vrsta", ["Fizičko lice", "Firma"]),
      text("name", "Ime i prezime / firma"),
      text("pib", "PIB"),
      text("registrationNumber", "Matični broj"),
      text("address", "Adresa"),
      text("city", "Mesto"),
      text("postalCode", "Poštanski broj"),
      text("country", "Država"),
      text("phone", "Telefon"),
      text("email", "E-mail"),
      status("gender", "Pol", ["Nepoznato", "Ženski", "Muški"]),
    ],
    editableColumns: [
      "name",
      "pib",
      "registrationNumber",
      "address",
      "city",
      "postalCode",
      "country",
      "phone",
      "email",
    ],
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
    description: "Stvarna spremnost eOtpremnice, Ananas, kurirskih, newsletter i Viber adaptera.",
    status: "blocked_external",
    blockedReason: "Pojedinačne akcije se uključuju tek kada health check potvrdi sve obavezne vrednosti.",
    commands: [
      {
        label: "eOtpremnica sinhronizacija",
        disabledReason:
          "Nedostaju EOTPREMNICA_BASE_URL i EOTPREMNICA_API_KEY.",
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
    detailHrefBase: "/admin/erp/artikli",
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
    slug: "landing-strane",
    number: "24",
    title: "Landing strane",
    description: "Landing page CRUD sa periodom objave, SEO poljima i uređenim sekcijama.",
    status: "ready",
    commands: [
      { label: "Nova landing strana", tone: "primary", href: "/admin/erp/landing-strane/nova" },
    ],
    detailHrefBase: "/admin/erp/landing-strane",
    columns: [
      text("slug", "Slug"),
      text("title", "Naslov"),
      text("lead", "Uvod", false),
      text("heroImageUrl", "Hero slika", false),
      text("seoTitle", "SEO naslov", false),
      text("seoDescription", "SEO opis", false),
      status("status", "Status", ["DRAFT", "PUBLISHED", "PUBLISHED_CHANGES", "ARCHIVED"]),
      text("preview", "Pregled"),
      number("sections", "Blokovi"),
      date("startsAt", "Početak"),
      date("endsAt", "Kraj"),
      date("publishedAt", "Objavljeno"),
    ],
    rows: emptyRows,
  },
  {
    slug: "landing-sekcije",
    number: "24b",
    title: "Legacy sekcije landing strana",
    description: "Pregled starih sekcija. Novi sadržaj se uređuje blokovima unutar landing strane.",
    status: "ready",
    redirectHref: "/admin/erp/landing-strane",
    commands: [],
    columns: [
      text("landingPage", "Landing strana"),
      number("position", "Pozicija"),
      text("title", "Naslov"),
      text("body", "Sadržaj", false),
      text("imageUrl", "Slika", false),
      text("productSkus", "SKU artikala"),
    ],
    rows: emptyRows,
  },
  {
    slug: "mobilni-tabovi",
    number: "25",
    title: "Mobilni prečaci",
    description: "Namenski editor za četiri boksa ispod hero sekcije na mobilnoj početnoj strani.",
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
    redirectHref: "/admin/newsletter",
    commands: [
      { label: "Otvori Newsletter centar", tone: "primary", href: "/admin/newsletter" },
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
    editableColumns: [],
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
      text("productName", "Naziv artikla"),
      number("quantity", "Količina"),
      text("description", "Opis"),
      status("type", "Vrsta"),
      status("request", "Zahtev"),
      status("decision", "Odluka"),
      status("resolution", "Rešenje"),
      status("status", "Status"),
      text("adminNote", "Interna napomena"),
      text("resolutionNote", "Napomena o rešenju"),
      text("warehouse", "Magacin"),
      status("warehouseStatus", "Status pripreme"),
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
  salesOrderFilters?: SalesOrderExportFilters,
): Promise<ErpRow[]> {
  switch (slug) {
    case "sifarnici-artikala":
      return productLookupRows(take);
    case "cenovnici":
      return priceListRows(take);
    case "akcijske-cene":
      return actionPriceRows(take);
    case "akcije":
      return actionRows(take);
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
      return stocktakeDispatchRows(take, salesOrderFilters?.stocktakeArchived);
    case "prodajni-nalozi":
      return salesOrderRows(take, salesOrderFilters);
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
      bmPct: actionGrossMarginPct(
        decimal(row.salePrice),
        row.product.cogs == null ? null : decimal(row.product.cogs),
      ),
      startsAt: dateOnly(row.action.startsAt),
      endsAt: dateOnly(row.action.endsAt),
    },
  }));
}

async function actionRows(take: number): Promise<ErpRow[]> {
  const rows = await db.action.findMany({
    take,
    orderBy: [{ priority: "desc" }, { startsAt: "desc" }],
    include: { _count: { select: { actionPrices: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    cellHrefs: { name: `/admin/erp/akcije?edit=${encodeURIComponent(row.id)}` },
    values: {
      name: row.name,
      slug: row.slug,
      kind: row.kind,
      priority: row.priority,
      sortOrder: row.sortOrder,
      products: row._count.actionPrices,
      isHero: row.isHero,
      isPermanent: row.isPermanent,
      startsAt: dateTime(row.startsAt),
      endsAt: dateTime(row.endsAt),
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
        [
          ...row.categories.map((item) => item.category.name),
          ...row.groups.map((item) => item.group.name),
        ].join(", ") || "Svi artikli",
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
      name: row.name,
      address: row.address,
      city: row.city,
      email: row.email,
      phone: row.phone,
      state: row.active ? "Aktivan" : "Arhiviran",
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
    include: {
      warehouse: { select: { name: true } },
      product: {
        select: {
          name: true,
          shortName: true,
          shortDescription: true,
          attribute1: true,
          attribute2: true,
          attribute3: true,
          attribute4: true,
          colorPrimary: true,
          colorSecondary: true,
          supplier: { select: { name: true } },
          group: { select: { name: true } },
          collection: { select: { name: true } },
          categories: {
            take: 1,
            orderBy: { category: { level: "desc" } },
            select: {
              category: {
                select: {
                  name: true,
                  parent: { select: { name: true } },
                },
              },
            },
          },
        },
      },
      orderItem: {
        select: {
          name: true,
          supplierName: true,
          categoryName: true,
          groupName: true,
          subgroupName: true,
          collectionName: true,
          shortDescriptionSnapshot: true,
          shortNameSnapshot: true,
          attribute1: true,
          attribute2: true,
          attribute3: true,
          attribute4: true,
          color1: true,
          color2: true,
        },
      },
    },
  });
  return rows.map((row) => {
    const category = row.product?.categories[0]?.category;
    return {
      id: row.id,
      values: {
        sku: row.sku,
        supplier: row.product?.supplier?.name ?? row.orderItem?.supplierName ?? null,
        category:
          category?.parent?.name ??
          category?.name ??
          row.orderItem?.categoryName ??
          null,
        group: row.product?.group?.name ?? row.orderItem?.groupName ?? null,
        subgroup:
          (category?.parent ? category.name : null) ??
          row.orderItem?.subgroupName ??
          null,
        collection:
          row.product?.collection?.name ??
          row.orderItem?.collectionName ??
          null,
        shortDescription:
          row.product?.shortDescription ??
          row.orderItem?.shortDescriptionSnapshot ??
          null,
        shortName:
          row.product?.shortName ??
          row.orderItem?.shortNameSnapshot ??
          row.product?.name ??
          row.orderItem?.name ??
          null,
        attribute1: row.product?.attribute1 ?? row.orderItem?.attribute1 ?? null,
        attribute2: row.product?.attribute2 ?? row.orderItem?.attribute2 ?? null,
        attribute3: row.product?.attribute3 ?? row.orderItem?.attribute3 ?? null,
        attribute4: row.product?.attribute4 ?? row.orderItem?.attribute4 ?? null,
        color1: row.product?.colorPrimary ?? row.orderItem?.color1 ?? null,
        color2: row.product?.colorSecondary ?? row.orderItem?.color2 ?? null,
        createdAt: dateTime(row.createdAt),
        kind: stockMovementKindLabel(row.kind),
        qty: row.qty,
        warehouse: row.warehouse.name,
        balanceAfterWarehouse: row.balanceAfterWarehouse,
        balanceAfterTotal: row.balanceAfterTotal,
        note: row.note,
        idempotencyKey: row.idempotencyKey,
      },
    };
  });
}

async function stocktakeDispatchRows(
  take: number,
  archived = false,
): Promise<ErpRow[]> {
  const rows = await db.dispatchNote.findMany({
    where: {
      type: DispatchNoteType.STOCKTAKE,
      archivedAt: archived ? { not: null } : null,
    },
    take,
    orderBy: { createdAt: "desc" },
    include: {
      sourceWarehouse: { select: { name: true } },
      items: { select: { qty: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      number: row.number,
      source: row.sourceWarehouse.name,
      destination: row.destinationName ?? STOCKTAKE_DESTINATION_NAME,
      status: STOCKTAKE_STATUS_LABEL[row.status],
      items: row.items.length,
      totalQty: row.items.reduce((sum, item) => sum + item.qty, 0),
      postedAt: dateTime(row.postedAt),
      archivedAt: dateTime(row.archivedAt),
      createdAt: dateTime(row.createdAt),
    },
  }));
}

async function salesOrderRows(
  take: number,
  filters?: SalesOrderExportFilters,
): Promise<ErpRow[]> {
  const createdAt =
    filters?.createdFrom || filters?.createdToExclusive
      ? {
          ...(filters.createdFrom ? { gte: filters.createdFrom } : {}),
          ...(filters.createdToExclusive ? { lt: filters.createdToExclusive } : {}),
        }
      : undefined;
  const fiscalizedWhere = filters?.fiscalized === true
    ? {
        OR: [
          { fiscal: { isNot: null } },
          { fiscalDocuments: { some: { kind: "SALE" as const, status: "ISSUED" as const } } },
        ],
      }
    : filters?.fiscalized === false
      ? {
          fiscal: { is: null },
          fiscalDocuments: { none: { kind: "SALE" as const, status: "ISSUED" as const } },
        }
      : {};
  const fiscalIssuedWhere =
    filters?.fiscalIssuedFrom || filters?.fiscalIssuedToExclusive
      ? {
          OR: [
            {
              fiscal: {
                is: {
                  fiscalizedAt: {
                    ...(filters.fiscalIssuedFrom ? { gte: filters.fiscalIssuedFrom } : {}),
                    ...(filters.fiscalIssuedToExclusive
                      ? { lt: filters.fiscalIssuedToExclusive }
                      : {}),
                  },
                },
              },
            },
            {
              fiscalDocuments: {
                some: {
                  kind: "SALE" as const,
                  status: "ISSUED" as const,
                  issuedAt: {
                    ...(filters.fiscalIssuedFrom ? { gte: filters.fiscalIssuedFrom } : {}),
                    ...(filters.fiscalIssuedToExclusive
                      ? { lt: filters.fiscalIssuedToExclusive }
                      : {}),
                  },
                },
              },
            },
          ],
        }
      : {};
  const orders = await db.order.findMany({
    where: {
      ...(createdAt ? { createdAt } : {}),
      ...(filters?.warehouseId
        ? { items: { some: { warehouseId: filters.warehouseId } } }
        : {}),
      AND: [fiscalizedWhere, fiscalIssuedWhere],
    },
    take,
    orderBy: { createdAt: "desc" },
    include: {
      customer: true,
      priceList: { select: { code: true, name: true, currency: true } },
      items: {
        ...(filters?.warehouseId ? { where: { warehouseId: filters.warehouseId } } : {}),
        orderBy: { id: "asc" },
        include: {
          warehouse: { select: { name: true } },
          product: {
            include: {
              supplier: { select: { name: true } },
              group: { select: { name: true } },
              collection: { select: { name: true } },
              categories: {
                orderBy: { category: { level: "desc" } },
                include: {
                  category: {
                    select: {
                      name: true,
                      parent: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      fiscal: { select: { id: true } },
      fiscalDocuments: {
        where: { kind: "SALE", status: "ISSUED" },
        select: { id: true },
      },
      invoices: {
        where: { status: { not: "CANCELLED" } },
        select: { id: true },
      },
      payments: {
        where: { status: "PAID" },
        select: { id: true },
      },
    },
  });
  return orders.flatMap((order): ErpRow[] => {
    const customer =
      order.shipCompanyName ||
      [order.shipFirstName, order.shipLastName].filter(Boolean).join(" ");
    const common = {
      number: order.number,
      channel: order.channel,
      customer,
      pib: order.shipPib,
      priceList: order.priceList
        ? `${order.priceList.code} · ${order.priceList.name} (${order.priceList.currency})`
        : null,
      address: order.shipStreet,
      city: order.shipCity,
      postalCode: order.shipPostalCode,
      phone: order.shipPhone,
      email: order.guestEmail ?? order.customer?.email ?? null,
      status: order.status,
      fiscalized: Boolean(order.fiscal || order.fiscalDocuments.length),
      invoiced: order.invoices.length > 0,
      sefAccepted: Boolean(order.sefAcceptedAt),
      paid: order.payments.length > 0,
    };
    if (!order.items.length) {
      return [
        {
          id: order.id,
          detailId: order.id,
          cellHrefs: {
            number: `/admin/erp/prodajni-nalozi/${order.id}`,
          },
          values: {
            ...common,
            sku: null,
            supplier: null,
            category: null,
            group: null,
            subgroup: null,
            collection: null,
            shortDescription: null,
            shortName: null,
            attribute1: null,
            attribute2: null,
            attribute3: null,
            attribute4: null,
            color1: null,
            color2: null,
            qty: 0,
            unitPrice: 0,
            totalNet: 0,
            totalGross: 0,
            warehouse: null,
          },
        },
      ];
    }
    return order.items.map((item) => {
      const product = item.product;
      const leaf = product?.categories[0]?.category ?? null;
      const unitPrice = decimal(item.unitPriceSale) ?? 0;
      const totals = calculateSalesLineTotals(item.qty, unitPrice);
      return {
        id: item.id,
        detailId: order.id,
        cellHrefs: {
          number: `/admin/erp/prodajni-nalozi/${order.id}`,
        },
        values: {
          ...common,
          sku: item.sku,
          supplier: product?.supplier?.name ?? item.supplierName,
          category:
            leaf?.parent?.name ?? leaf?.name ?? item.categoryName,
          group: product?.group?.name ?? item.groupName,
          subgroup:
            (leaf?.parent ? leaf.name : null) ?? item.subgroupName,
          collection: product?.collection?.name ?? item.collectionName,
          shortDescription:
            product?.shortDescription ?? item.shortDescriptionSnapshot,
          shortName:
            product?.shortName ??
            item.shortNameSnapshot ??
            product?.name ??
            item.name,
          attribute1: product?.attribute1 ?? item.attribute1,
          attribute2: product?.attribute2 ?? item.attribute2,
          attribute3: product?.attribute3 ?? item.attribute3,
          attribute4: product?.attribute4 ?? item.attribute4,
          color1: product?.colorPrimary ?? item.color1,
          color2: product?.colorSecondary ?? item.color2,
          qty: item.qty,
          unitPrice,
          totalNet: totals.totalNet,
          totalGross: totals.totalGross,
          warehouse:
            item.warehouse?.name ??
            (item.supplierReservedQty > 0
              ? `Kod dobavljača${product?.supplier?.name ? ` · ${product.supplier.name}` : ""}`
              : null),
        },
      };
    });
  });
}

async function dispatchRows(take: number): Promise<ErpRow[]> {
  const rows = await db.dispatchNote.findMany({
    where: {
      type: { in: [DispatchNoteType.CUSTOMER, DispatchNoteType.INTERNAL] },
    },
    take,
    orderBy: { createdAt: "desc" },
    include: {
      sourceWarehouse: { select: { name: true } },
      destinationWarehouse: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    detailId: row.id,
    values: {
      number: row.number,
      issueDate: dateOnly(row.issueDate),
      issuer: row.issuerName || null,
      sourceWarehouse: row.sourceWarehouse.name,
      receiver: row.receiverName || null,
      destinationWarehouse:
        row.destinationWarehouse?.name ??
        (row.type === "INTERNAL" ? row.destinationName : null),
      totalNet: decimal(row.totalNet),
      totalGross: decimal(row.totalGross),
      posted: row.status === "POSTED",
      sefSent: Boolean(row.sefSentAt),
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
      status: PICKUP_BATCH_STATUS_LABEL[row.status],
      packages: row._count.lines,
      createdAt: dateTime(row.createdAt),
      pickupDate: dateTime(row.pickupDate),
    },
  }));
}

async function customerRows(take: number): Promise<ErpRow[]> {
  const rows = await db.customer.findMany({
    take,
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      name:
        [row.firstName, row.lastName].filter(Boolean).join(" ") ||
        row.companyName ||
        "Bez imena",
      customerType: row.companyName ? "Firma" : "Fizičko lice",
      pib: row.pib,
      registrationNumber: row.registrationNumber,
      address: row.address,
      city: row.city,
      postalCode: row.postalCode,
      country: row.country,
      phone: row.phone,
      email: row.email,
      gender: customerGenderLabel(inferCustomerGender(row.firstName)),
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

function eotpremnicaProviderRow(): ErpRow {
  const gate = resolveEotpremnicaGate();
  const missing = ["EOTPREMNICA_BASE_URL", "EOTPREMNICA_API_KEY"].filter(
    (key) => !configured(process.env[key]),
  );
  if (!gate.allowed) missing.unshift(gate.reason);
  return {
    id: "EOTPREMNICA",
    values: {
      provider: "EOTPREMNICA",
      status: missing.length ? "NOT_CONFIGURED" : "HEALTHY",
      missing: missing.join(", ") || "—",
      message: missing.length
        ? "Slanje je zaključano dok sandbox ili zasebno prihvaćena produkcija nisu potpuno konfigurisani."
        : `Konfigurisan je ${gate.allowed ? gate.mode : "isključen"} režim; aktivni contract test tek potvrđuje spremnost.`,
    },
  };
}

async function integrationRows(): Promise<ErpRow[]> {
  return [
    eotpremnicaProviderRow(),
    providerRow("ANANAS", ["ANANAS_BASE_URL", "ANANAS_API_KEY"]),
    providerRow("MYGLS_PICKUP", [
      "MYGLS_USERNAME",
      "MYGLS_PASSWORD",
      "MYGLS_CLIENT_NUMBER",
      "MYGLS_PICKUP_STREET",
      "MYGLS_PICKUP_CITY",
    ]),
    providerRow("XEXPRESS_PICKUP", [
      "X_EXPRESS_BASE_URL",
      "X_EXPRESS_API_USER",
      "X_EXPRESS_API_KEY",
      "X_EXPRESS_CONTRACT_CODE",
      "X_EXPRESS_PICKUP_TOWN_ID",
      "X_EXPRESS_PICKUP_STREET_NAME",
      "X_EXPRESS_PICKUP_STREET_NUMBER",
      "X_EXPRESS_PICKUP_LATITUDE",
      "X_EXPRESS_PICKUP_LONGITUDE",
      "X_EXPRESS_PICKUP_CONTACT_PHONE",
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
      kind: row.kind === "SALE" ? "Promet" : "Storno / refundacija",
      status:
        row.status === "ISSUED"
          ? "Izdato"
          : row.status === "FAILED"
            ? "Neuspešno"
            : "Na čekanju",
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
    include: {
      supplier: { select: { integrationKey: true, enabled: true } },
      familyMembership: { select: { storefrontEnabled: true } },
      priceListEntries: {
        where: activeRetailPriceEntryWhere(),
        take: 1,
        select: { id: true },
      },
    },
  });
  return products
    .map((product) => {
      const reasons = storefrontPublicationBlockers({
        isActive: product.isActive,
        deletedAt: product.deletedAt,
        availableWebManual: product.availableWebManual,
        availableWebAuto: product.availableWebAuto,
        articleStatus: product.articleStatus,
        dcAvailableQty: product.dcAvailableQty,
        supplierStock: product.supplierStock,
        supplierApprovalStatus: product.supplierApprovalStatus,
        lastSupplierStockSyncAt: product.lastSupplierStockSyncAt,
        supplier: product.supplier,
        hasActiveRetailPrice: product.priceListEntries.length > 0,
        familyStorefrontEnabled:
          product.familyMembership?.storefrontEnabled ?? null,
      });
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
      status:
        row.status === "PUBLISHED" &&
        row.draftRevisionId &&
        row.draftRevisionId !== row.publishedRevisionId
          ? "PUBLISHED_CHANGES"
          : row.status,
      preview: "Otvori stranu",
      sections: Array.isArray(row.blocks) && row.blocks.length
        ? row.blocks.length
        : row._count.sections,
      startsAt: dateOnly(row.startsAt),
      endsAt: dateOnly(row.endsAt),
      publishedAt: dateTime(row.publishedAt),
    },
    cellHrefs: { preview: `/ponuda/${row.slug}?preview=1` },
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
    include: {
      order: { select: { number: true } },
      orderItem: { select: { name: true } },
      product: { select: { name: true } },
      warehouse: { select: { code: true, name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    values: {
      number: row.number,
      order: row.order.number,
      customer: `${row.customerFirst} ${row.customerLast}`.trim(),
      sku: row.sku,
      productName: row.orderItem?.name ?? row.product?.name ?? row.sku,
      quantity: row.quantity,
      description: row.description,
      type: row.type,
      request: row.request,
      decision: row.decision,
      resolution: row.resolution,
      status: row.status,
      adminNote: row.adminNote,
      resolutionNote: row.resolutionNote,
      warehouse: row.warehouse
        ? `${row.warehouse.code} · ${row.warehouse.name}`
        : null,
      warehouseStatus: row.warehouseStatus,
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
