export type ErpRequirementStatus =
  | "implemented"
  | "partial"
  | "blocked_external"
  | "deferred_user";

export type ErpRequirement = {
  id: number;
  section: string;
  route: string;
  status: ErpRequirementStatus;
  acceptance: string;
  evidence: string;
  note: string;
};

/**
 * The 67 substantive table-of-contents entries from ERP finalllll.pages.
 * “Uvod” defines shared grid behaviour and is covered by acceptance GRID-01,
 * rather than counted as a business section.
 */
const ERP_REQUIREMENT_ROWS: readonly Omit<ErpRequirement, "evidence">[] = [
  { id: 1, section: "Matični podaci o artiklima", route: "/admin/erp/artikli", status: "implemented", acceptance: "CAT-01", note: "Šest statusa, kompletna ERP polja, mediji, kanali, zalihe i atomski XLSX uvoz." },
  { id: 2, section: "Matični podaci o dobavljačima", route: "/admin/erp/dobavljaci", status: "implemented", acceptance: "CAT-02", note: "Cenovnik, valuta, paritet, rokovi i tri mesta utovara." },
  { id: 3, section: "Cenovnik nabavnih cena", route: "/admin/erp/nabavne-cene", status: "implemented", acceptance: "BUY-01", note: "Istorijske nabavne cene po artiklu i dobavljaču." },
  { id: 4, section: "Nabavne porudžbenice", route: "/admin/erp/porudzbenice", status: "implemented", acceptance: "BUY-02", note: "Kreiranje, statusi, zaključavanje, prijem i vezani dokumenti." },
  { id: 5, section: "Pregled nabavnih porudžbenice", route: "/admin/erp/porudzbenice", status: "implemented", acceptance: "BUY-03", note: "Zbirni pregled zaglavlja porudžbenica." },
  { id: 6, section: "Pojedinačne nabavne porudžbenice", route: "/admin/erp/porudzbenice", status: "implemented", acceptance: "BUY-04", note: "Detalj zaglavlja i stavki sa magacinom prijema." },
  { id: 7, section: "Štampa PDF i Excel", route: "/admin/erp/porudzbenice", status: "implemented", acceptance: "BUY-05", note: "PDF porudžbenice i pravi XLSX izvoz." },
  { id: 8, section: "Pošalji dobavljaču", route: "/admin/erp/porudzbenice", status: "deferred_user", acceptance: "BUY-06", note: "E-mail tok je izričito van ovog ERP rada; postojeći kod nije menjan niti se sama ruta računa kao završetak." },
  { id: 9, section: "Pregled nabavnih porudžbenica po redovima", route: "/admin/erp/porudzbenice-po-artiklima", status: "implemented", acceptance: "BUY-07", note: "Zbirni pregled svih stavki, pakovanja, BM%, težine i zapremine." },
  { id: 10, section: "Ulazne fakture", route: "/admin/erp/ulazne-fakture", status: "implemented", acceptance: "COGS-01", note: "Neto, PDV, bruto, valuta, veza, raspodela, knjiženje i zaključavanje." },
  { id: 11, section: "COGS (trošak nabavke po jedinici) obračun", route: "/admin/erp/ulazne-fakture", status: "implemented", acceptance: "COGS-02", note: "Raspodela zavisnih troškova i ponderisani prosečni COGS." },
  { id: 12, section: "Cenovnici", route: "/admin/erp/cenovnici", status: "implemented", acceptance: "PRICE-01", note: "Datirani MP, nabavni, VP i INO cenovnici sa stavkama." },
  { id: 13, section: "Upravljanje akcijskim cenama i prioritetima", route: "/admin/erp/akcijske-cene", status: "implemented", acceptance: "PRICE-02", note: "Veza akcija–artikal i izbor najvećeg numeričkog prioriteta." },
  { id: 14, section: "Program lojalnosti", route: "/admin/erp/loyalty", status: "implemented", acceptance: "PRICE-03", note: "Datirana pravila za ulogovane kupce i istorija cena." },
  { id: 15, section: "Akcija sa popustom na ceo ili deo asortimana", route: "/admin/erp/linearne-promocije", status: "implemented", acceptance: "PRICE-04", note: "Globalne, kategorijske i grupne promocije sa administrativnim cap-om." },
  { id: 16, section: "Magacini", route: "/admin/erp/magacini", status: "implemented", acceptance: "STOCK-01", note: "Višemagacinski šifarnik sa podrazumevanim DC-om." },
  { id: 17, section: "Lageri", route: "/admin/erp/stanje-po-magacinima", status: "implemented", acceptance: "STOCK-02", note: "Fizičko, rezervisano, raspoloživo, dolazeće stanje i neizmenjiva kretanja." },
  { id: 18, section: "Pregled porudžbina", route: "/admin/erp/prodajni-nalozi", status: "implemented", acceptance: "SALE-01", note: "Jedinstven WEB, ANANAS, VP i INO pregled sa po jednim redom po šifri, dokumentnim statusima i detaljem cele porudžbine." },
  { id: 19, section: "Nova porudžbina", route: "/admin/erp/prodajni-nalozi/nova", status: "implemented", acceptance: "SALE-02", note: "Transakcioni VP/INO unos sa zasebnom numeracijom, snimkom matičnih podataka, cenovnikom i DC/dobavljač rezervacijama." },
  { id: 20, section: "Fiskalizacija i refundacija", route: "/admin/fiskalizacija", status: "implemented", acceptance: "FISC-01", note: "Jedinstven pregled fiskalnih dokumenata i povraćaja." },
  { id: 21, section: "Fiskalizacija", route: "/admin/fiskalizacija", status: "blocked_external", acceptance: "FISC-02", note: "Implementacija i lokalni provider testovi postoje; BADI sandbox prolaz čeka lokalno postavljene kredencijale i povezan PFR." },
  { id: 22, section: "Refundacija", route: "/admin/fiskalizacija", status: "blocked_external", acceptance: "FISC-03", note: "Idempotentni refund i lager povrat postoje; stvarni BADI sandbox refund čeka iste spoljne preduslove." },
  { id: 23, section: "Otpremnice", route: "/admin/erp/otpremnice", status: "partial", acceptance: "LOG-01", note: "CRUD, knjiženje, PDF/XLSX i mock transport postoje; eOtpremnica sandbox acceptance još nije izvršen sa kredencijalima." },
  { id: 24, section: "Pojedinačne otpremnice", route: "/admin/erp/otpremnice", status: "implemented", acceptance: "LOG-02", note: "Kupčevske i interne otpremnice sa firmama, magacinima, transportom, uvozom VP/INO porudžbina i automatskim stavkama." },
  { id: 25, section: "Nalozi za preuzimanje (Kurirske službe)", route: "/admin/erp/preuzimanja", status: "blocked_external", acceptance: "EXT-GLS-01", note: "Admin tok i manifest postoje; slanje je isključeno dok GLS/X Express pickup ugovor i kredencijali ne prođu health check." },
  { id: 26, section: "Povezivanje sa Ananasom", route: "/admin/erp/integracije", status: "deferred_user", acceptance: "EXT-ANANAS-01", note: "Ananas je izričito van obuhvata ovog rada; adapter ostaje bezbedno isključen." },
  { id: 27, section: "Knjigovodstveni izveštaji", route: "/admin/erp/racunovodstveni-registri", status: "deferred_user", acceptance: "ACC-01", note: "Računovodstveni registri su odloženi odlukom korisnika; postojeći interni prikaz nije proglašen završenim." },
  { id: 28, section: "Evidencija prometa", route: "/admin/erp/racunovodstveni-registri", status: "deferred_user", acceptance: "ACC-02", note: "Računovodstvena evidencija prometa je van dogovorenog obuhvata." },
  { id: 29, section: "Evidencija storniranja i refundacija", route: "/admin/erp/racunovodstveni-registri", status: "deferred_user", acceptance: "ACC-03", note: "Računovodstveni registar storna/refundacija je van dogovorenog obuhvata." },
  { id: 30, section: "Kalkulacije", route: "/admin/erp/ulazne-fakture", status: "implemented", acceptance: "ACC-04", note: "Kalkulacija nabavne vrednosti i zavisnih troškova." },
  { id: 31, section: "Nivelacije", route: "/admin/erp/mp-cene", status: "implemented", acceptance: "ACC-05", note: "Predlog i objava MP cena uz trag promene." },
  { id: 32, section: "KEP knjiga", route: "/admin/erp/racunovodstveni-registri", status: "deferred_user", acceptance: "ACC-06", note: "KEP je izričito odložen; interni prikaz se ne predstavlja kao zakonski prihvaćen registar." },
  { id: 33, section: "API za razmenu lagera i rezervacije", route: "/admin/erp/partner-klijenti", status: "implemented", acceptance: "PARTNER-01", note: "Scope-ovani bearer ključevi, rate limit, audit i idempotentne rezervacije." },
  { id: 34, section: "Popisi", route: "/admin/erp/popisi", status: "implemented", acceptance: "STOCK-03", note: "Očekivano/prebrojano/razlika i transakciono knjiženje." },
  { id: 35, section: "Baza kupaca", route: "/admin/erp/kupci", status: "implemented", acceptance: "CRM-01", note: "Fizička lica i firme; adresa, poreski i kontaktni podaci, uz automatsko određivanje pola fizičkog lica." },
  { id: 36, section: "Postojeći moduli u admin panelu", route: "/admin", status: "implemented", acceptance: "ADMIN-01", note: "Postojeći moduli su sačuvani, a duple legacy ERP rute su uklonjene i vraćaju 404 bez redirect-a." },
  { id: 37, section: "Kontrolna tabla", route: "/admin", status: "implemented", acceptance: "DASH-01", note: "Dnevne i periodske porudžbine, neto fiskalizovani promet, reklamacije, zalihe, dolazna roba, posete, top artikli, niski lager i XLSX izvozi uz podrazumevane sačuvane poglede." },
  { id: 38, section: "Baneri", route: "/admin/baneri", status: "implemented", acceptance: "CONTENT-01", note: "Tri pozicije, višestruki HERO slajdovi, periodi, dimenzije i brisanje sa potvrdom." },
  { id: 39, section: "Promo traka", route: "/admin/promo-traka", status: "deferred_user", acceptance: "CONTENT-02", note: "Odluka o promo overlap-u i današnjoj akciji odložena je do posebne Lukine potvrde." },
  { id: 40, section: "Navigacija", route: "/admin/tabovi", status: "implemented", acceptance: "CONTENT-03", note: "Deset jedinstvenih desktop pozicija sa padajućim odredištima." },
  { id: 41, section: "Kategorije", route: "/admin/kategorije", status: "implemented", acceptance: "CONTENT-04", note: "Stablo sa fiksnim editorom i naglašenim vršnim nivoima." },
  { id: 42, section: "Piktogrami", route: "/admin/erp/pozicije-piktograma", status: "deferred_user", acceptance: "CONTENT-05", note: "Obavezna četiri piktograma po akciji ostaju nepromenjena do posebne Lukine potvrde." },
  { id: 43, section: "Proizvodi", route: "/admin/erp/artikli", status: "implemented", acceptance: "REDIRECT-01", note: "Kanonska lista i detalj su u ERP-u; /admin/proizvodi i stari duboki linkovi vraćaju 404." },
  { id: 44, section: "Akcije", route: "/admin/erp/akcije", status: "implemented", acceptance: "PRICE-05", note: "Selektovana akcija, modal artikala, MP/akcijska cena, loyalty i linearni popusti." },
  { id: 45, section: "Heroji meseca", route: "/admin/erp/heroji-meseca", status: "implemented", acceptance: "CONTENT-06", note: "Mesečni izbor proizvoda, redosled i veza sa akcijom." },
  { id: 46, section: "Preporuke kupovine", route: "/admin/preporuke", status: "deferred_user", acceptance: "CONTENT-07", note: "Tri konačna režima preporuka čekaju posebnu Lukinu odluku i ne blokiraju osnovni ERP release." },
  { id: 47, section: "Pravila dostave", route: "/admin/dostava", status: "partial", acceptance: "LOG-03", note: "Rutiranje, paketi i mock ugovori postoje; X Express cancel ugovor nije dostavljen pa se ta komanda ne nagađa." },
  { id: 48, section: "Vaučeri", route: "/admin/vauceri", status: "implemented", acceptance: "EXISTING-01", note: "Postojeći funkcionalni tok je sačuvan." },
  { id: 49, section: "Načini plaćanja", route: "/admin/placanje", status: "implemented", acceptance: "EXISTING-02", note: "Postojeća konfiguracija plaćanja je sačuvana." },
  { id: 50, section: "Narudžbine", route: "/admin/erp/prodajni-nalozi", status: "implemented", acceptance: "REDIRECT-03", note: "Kanonska lista i detalj su u ERP-u; /admin/narudzbine i stari detalji vraćaju 404." },
  { id: 51, section: "Reklamacije", route: "/admin/erp/reklamacije-dnevnik", status: "implemented", acceptance: "SERVICE-01", note: "Zakonski dnevnik, numeracija, odluka, rešenje, rokovi i operativni zadaci." },
  { id: 52, section: "Komentari", route: "/admin/komentari", status: "deferred_user", acceptance: "SERVICE-02", note: "Modul je eksplicitno isključen i sama postojeća ruta se ne računa kao implementacija." },
  { id: 53, section: "XML feed", route: "/admin/xml-import", status: "deferred_user", acceptance: "IMPORT-01", note: "Postojeći import ostaje; stroga konačna lista obaveznih XML/XLSX polja čeka posebnu Lukinu odluku." },
  { id: 54, section: "Newsletter", route: "/admin/newsletter", status: "deferred_user", acceptance: "EXT-NEWS-01", note: "Kampanje i svi povezani newsletter podaci vode se iz jedinstvenog Newsletter centra." },
  { id: 55, section: "Viber kampanje", route: "/admin/viber", status: "deferred_user", acceptance: "EXT-VIBER-01", note: "Viber je izričito van obuhvata ovog ERP rada." },
  { id: 56, section: "Oglasi (GMS/Meta)", route: "/admin/oglasi", status: "deferred_user", acceptance: "EXT-ADS-01", note: "Google/Meta oglasi su izričito van obuhvata ovog ERP rada." },
  { id: 57, section: "Izveštaji", route: "/admin/izvestaji", status: "implemented", acceptance: "REPORT-01", note: "Role-aware Izveštajni centar vodi ka namenskim knjigovodstvenim, analytics, QA i audit ekranima bez dupliranja kontrolne table." },
  { id: 58, section: "Porudžbine", route: "/admin", status: "implemented", acceptance: "REPORT-02", note: "Današnji i sačuvani periodski broj svih primljenih porudžbina uz kompletan XLSX izvoz modula Prodajni nalozi." },
  { id: 59, section: "Zalihe", route: "/admin", status: "implemented", acceptance: "REPORT-03", note: "Ukupna COGS i m³ vrednost svih aktivnih magacina i zaseban pregled po izabranom magacinu." },
  { id: 60, section: "Roba u dolasku", route: "/admin", status: "implemented", acceptance: "REPORT-04", note: "Preostala fakturna vrednost i m³ aktivnih poslatih i potvrđenih porudžbenica." },
  { id: 61, section: "Reklamacije", route: "/admin", status: "implemented", acceptance: "REPORT-05", note: "Broj reklamacija primljenih u izabranom i sačuvanom periodu." },
  { id: 62, section: "Posete i konverzije", route: "/admin/erp/posete-konverzije", status: "implemented", acceptance: "ANALYTICS-01", note: "First-party događaji samo uz analytics saglasnost i rotirajući anonimni identifikator." },
  { id: 63, section: "Audit log", route: "/admin/audit-log", status: "implemented", acceptance: "SEC-01", note: "SUPER-only pregled promena, komandi i partnerskih API događaja." },
  { id: 64, section: "Neobjavljeno na sajtu", route: "/admin/erp/neobjavljeni-artikli", status: "implemented", acceptance: "QA-01", note: "Precizan razlog blokade za svaki artikal sa zalihom ili dolaskom." },
  { id: 65, section: "Landing pages", route: "/admin/erp/landing-strane", status: "implemented", acceptance: "CONTENT-08", note: "CRUD model sa sekcijama, periodom i statusom objave." },
  { id: 66, section: "Početna strana", route: "/admin/pocetna", status: "implemented", acceptance: "CONTENT-09", note: "Šest redova, dve baner pozicije i uklanjanje praznog prostora." },
  { id: 67, section: "Mobile tabovi", route: "/admin/tabovi#mobile-tabs", status: "implemented", acceptance: "CONTENT-10", note: "Prve četiri navigacione pozicije su mobilni tabovi ispod hero sekcije i biraju piktogram iz centralne biblioteke." },
] as const;

const EVIDENCE_BY_ACCEPTANCE = {
  "CAT-01": "tests/e2e/article-master.spec.ts",
  "CAT-02": "tests/e2e/supplier-master.spec.ts",
  "BUY-01": "tests/e2e/purchase-price.spec.ts",
  "BUY-02": "tests/e2e/purchase-order.spec.ts",
  "BUY-03": "tests/e2e/purchase-order.spec.ts",
  "BUY-04": "tests/e2e/purchase-order.spec.ts",
  "BUY-05": "tests/e2e/purchase-order.spec.ts",
  "BUY-06": "tests/unit/erp-requirements-matrix.test.ts",
  "BUY-07": "tests/e2e/purchase-order.spec.ts",
  "COGS-01": "tests/e2e/inbound-invoice.spec.ts",
  "COGS-02": "tests/e2e/inbound-invoice.spec.ts",
  "PRICE-01": "tests/e2e/module-7-pricing.spec.ts",
  "PRICE-02": "tests/e2e/module-7-pricing.spec.ts",
  "PRICE-03": "tests/e2e/module-7-pricing.spec.ts",
  "PRICE-04": "tests/e2e/module-7-pricing.spec.ts",
  "STOCK-01": "tests/e2e/module-8-warehouses.spec.ts",
  "STOCK-02": "tests/e2e/inventory-import.spec.ts",
  "SALE-01": "tests/e2e/sales-order.spec.ts",
  "SALE-02": "tests/e2e/sales-order.spec.ts",
  "FISC-01": "tests/unit/fiscal-transport.test.ts",
  "FISC-02": "tests/unit/fiscal-transport.test.ts",
  "FISC-03": "tests/unit/fiscal-transport.test.ts",
  "LOG-01": "tests/unit/eotpremnica-transport.test.ts",
  "LOG-02": "tests/e2e/stocktake-dispatch.spec.ts",
  "EXT-GLS-01": "tests/e2e/pickup-batch.spec.ts",
  "EXT-ANANAS-01": "tests/unit/erp-requirements-matrix.test.ts",
  "ACC-01": "tests/unit/erp-requirements-matrix.test.ts",
  "ACC-02": "tests/unit/erp-requirements-matrix.test.ts",
  "ACC-03": "tests/unit/erp-requirements-matrix.test.ts",
  "ACC-04": "tests/e2e/inbound-invoice.spec.ts",
  "ACC-05": "tests/e2e/module-7-pricing.spec.ts",
  "ACC-06": "tests/unit/erp-requirements-matrix.test.ts",
  "PARTNER-01": "tests/e2e/partner-api.spec.ts",
  "STOCK-03": "tests/e2e/stocktake-dispatch.spec.ts",
  "CRM-01": "tests/unit/customer-master.test.ts",
  "ADMIN-01": "tests/e2e/erp-critical-smoke.spec.ts",
  "DASH-01": "tests/e2e/reclamation-analytics.spec.ts",
  "CONTENT-01": "tests/e2e/admin-banners.spec.ts",
  "CONTENT-02": "tests/unit/erp-requirements-matrix.test.ts",
  "CONTENT-03": "tests/e2e/erp-critical-smoke.spec.ts",
  "CONTENT-04": "tests/e2e/admin-mutations.spec.ts",
  "CONTENT-05": "tests/unit/erp-requirements-matrix.test.ts",
  "REDIRECT-01": "tests/e2e/erp-critical-smoke.spec.ts",
  "PRICE-05": "tests/e2e/module-7-pricing.spec.ts",
  "CONTENT-06": "tests/e2e/erp-critical-smoke.spec.ts",
  "CONTENT-07": "tests/unit/erp-requirements-matrix.test.ts",
  "LOG-03": "tests/integration/x-express.shipment.integration.test.ts",
  "EXISTING-01": "tests/e2e/admin-mutations.spec.ts",
  "EXISTING-02": "tests/e2e/admin-mutations.spec.ts",
  "REDIRECT-03": "tests/e2e/erp-critical-smoke.spec.ts",
  "SERVICE-01": "tests/e2e/reclamation-analytics.spec.ts",
  "SERVICE-02": "tests/unit/erp-requirements-matrix.test.ts",
  "IMPORT-01": "tests/unit/erp-requirements-matrix.test.ts",
  "EXT-NEWS-01": "tests/unit/erp-requirements-matrix.test.ts",
  "EXT-VIBER-01": "tests/unit/erp-requirements-matrix.test.ts",
  "EXT-ADS-01": "tests/unit/erp-requirements-matrix.test.ts",
  "REPORT-01": "tests/e2e/reclamation-analytics.spec.ts",
  "REPORT-02": "tests/e2e/reclamation-analytics.spec.ts",
  "REPORT-03": "tests/e2e/reclamation-analytics.spec.ts",
  "REPORT-04": "tests/e2e/reclamation-analytics.spec.ts",
  "REPORT-05": "tests/e2e/reclamation-analytics.spec.ts",
  "ANALYTICS-01": "tests/e2e/reclamation-analytics.spec.ts",
  "SEC-01": "tests/e2e/admin-roles.spec.ts",
  "QA-01": "tests/unit/catalog-readiness.test.ts",
  "CONTENT-08": "tests/e2e/landing-page.spec.ts",
  "CONTENT-09": "tests/e2e/erp-critical-smoke.spec.ts",
  "CONTENT-10": "tests/e2e/mobile-shortcuts-cms.spec.ts",
} as const satisfies Readonly<Record<string, string>>;

function evidenceFor(acceptance: string) {
  const file = EVIDENCE_BY_ACCEPTANCE[
    acceptance as keyof typeof EVIDENCE_BY_ACCEPTANCE
  ];
  if (!file) throw new Error(`Nedostaje acceptance dokaz za ${acceptance}.`);
  return `${file}#${acceptance}`;
}

export const ERP_REQUIREMENTS: readonly ErpRequirement[] = ERP_REQUIREMENT_ROWS.map(
  (requirement) => ({
    ...requirement,
    evidence: evidenceFor(requirement.acceptance),
  }),
);
