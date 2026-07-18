export type ErpRequirementStatus = "implemented" | "blocked_external";

export type ErpRequirement = {
  id: number;
  section: string;
  route: string;
  status: ErpRequirementStatus;
  acceptance: string;
  note: string;
};

/**
 * The 67 substantive table-of-contents entries from ERP finalllll.pages.
 * “Uvod” defines shared grid behaviour and is covered by acceptance GRID-01,
 * rather than counted as a business section.
 */
export const ERP_REQUIREMENTS: readonly ErpRequirement[] = [
  { id: 1, section: "Matični podaci o artiklima", route: "/admin/erp/artikli", status: "implemented", acceptance: "CAT-01", note: "Šest statusa, kompletna ERP polja, mediji, kanali, zalihe i atomski XLSX uvoz." },
  { id: 2, section: "Matični podaci o dobavljačima", route: "/admin/erp/dobavljaci", status: "implemented", acceptance: "CAT-02", note: "Cenovnik, valuta, paritet, rokovi i tri mesta utovara." },
  { id: 3, section: "Cenovnik nabavnih cena", route: "/admin/erp/nabavne-cene", status: "implemented", acceptance: "BUY-01", note: "Istorijske nabavne cene po artiklu i dobavljaču." },
  { id: 4, section: "Nabavne porudžbenice", route: "/admin/erp/porudzbenice", status: "implemented", acceptance: "BUY-02", note: "Kreiranje, statusi, zaključavanje, prijem i vezani dokumenti." },
  { id: 5, section: "Pregled nabavnih porudžbenice", route: "/admin/erp/porudzbenice", status: "implemented", acceptance: "BUY-03", note: "Zbirni pregled zaglavlja porudžbenica." },
  { id: 6, section: "Pojedinačne nabavne porudžbenice", route: "/admin/erp/porudzbenice", status: "implemented", acceptance: "BUY-04", note: "Detalj zaglavlja i stavki sa magacinom prijema." },
  { id: 7, section: "Štampa PDF i Excel", route: "/admin/erp/porudzbenice", status: "implemented", acceptance: "BUY-05", note: "PDF porudžbenice i pravi XLSX izvoz." },
  { id: 8, section: "Pošalji dobavljaču", route: "/admin/erp/porudzbenice", status: "implemented", acceptance: "BUY-06", note: "Dokumentovani engleski e-mail sa PDF prilogom i zaključavanjem." },
  { id: 9, section: "Pregled nabavnih porudžbenica po redovima", route: "/admin/erp/porudzbenice-po-artiklima", status: "implemented", acceptance: "BUY-07", note: "Zbirni pregled svih stavki, pakovanja, BM%, težine i zapremine." },
  { id: 10, section: "Ulazne fakture", route: "/admin/erp/ulazne-fakture", status: "implemented", acceptance: "COGS-01", note: "Neto, PDV, bruto, valuta, veza, raspodela, knjiženje i zaključavanje." },
  { id: 11, section: "COGS (trošak nabavke po jedinici) obračun", route: "/admin/erp/ulazne-fakture", status: "implemented", acceptance: "COGS-02", note: "Raspodela zavisnih troškova i ponderisani prosečni COGS." },
  { id: 12, section: "Cenovnici", route: "/admin/erp/cenovnici", status: "implemented", acceptance: "PRICE-01", note: "Datirani MP, nabavni, VP i INO cenovnici sa stavkama." },
  { id: 13, section: "Upravljanje akcijskim cenama i prioritetima", route: "/admin/erp/akcijske-cene", status: "implemented", acceptance: "PRICE-02", note: "Veza akcija–artikal i izbor najvećeg numeričkog prioriteta." },
  { id: 14, section: "Program lojalnosti", route: "/admin/erp/loyalty", status: "implemented", acceptance: "PRICE-03", note: "Datirana pravila za ulogovane kupce i istorija cena." },
  { id: 15, section: "Akcija sa popustom na ceo ili deo asortimana", route: "/admin/erp/linearne-promocije", status: "implemented", acceptance: "PRICE-04", note: "Globalne, kategorijske i grupne promocije sa administrativnim cap-om." },
  { id: 16, section: "Magacini", route: "/admin/erp/magacini", status: "implemented", acceptance: "STOCK-01", note: "Višemagacinski šifarnik sa podrazumevanim DC-om." },
  { id: 17, section: "Lageri", route: "/admin/erp/stanje-po-magacinima", status: "implemented", acceptance: "STOCK-02", note: "Fizičko, rezervisano, raspoloživo, dolazeće stanje i neizmenjiva kretanja." },
  { id: 18, section: "Pregled porudžbina", route: "/admin/erp/prodajni-nalozi", status: "implemented", acceptance: "SALE-01", note: "Jedinstven pregled WEB, ANANAS, VP i INO naloga." },
  { id: 19, section: "Nova porudžbina", route: "/admin/erp/prodajni-nalozi", status: "implemented", acceptance: "SALE-02", note: "Ručne VP i INO porudžbine sa zasebnim numeracijama." },
  { id: 20, section: "Fiskalizacija i refundacija", route: "/admin/fiskalizacija", status: "implemented", acceptance: "FISC-01", note: "Jedinstven pregled fiskalnih dokumenata i povraćaja." },
  { id: 21, section: "Fiskalizacija", route: "/admin/fiskalizacija", status: "implemented", acceptance: "FISC-02", note: "Automatska i ručna fiskalizacija po stavkama kroz provider apstrakciju." },
  { id: 22, section: "Refundacija", route: "/admin/fiskalizacija", status: "implemented", acceptance: "FISC-03", note: "Povraćaj novca i robe u izabrani magacin, sa idempotentnim kretanjem." },
  { id: 23, section: "Otpremnice", route: "/admin/erp/otpremnice", status: "implemented", acceptance: "LOG-01", note: "Kreiranje, knjiženje, PDF/XLSX i status SEF integracije." },
  { id: 24, section: "Pojedinačne otpremnice", route: "/admin/erp/otpremnice", status: "implemented", acceptance: "LOG-02", note: "Kupčevske, interne i popisne otpremnice sa stavkama i magacinima." },
  { id: 25, section: "Nalozi za preuzimanje (Kurirske službe)", route: "/admin/erp/preuzimanja", status: "blocked_external", acceptance: "EXT-GLS-01", note: "Admin tok i manifest postoje; slanje je isključeno dok GLS/X Express pickup ugovor i kredencijali ne prođu health check." },
  { id: 26, section: "Povezivanje sa Ananasom", route: "/admin/erp/integracije", status: "blocked_external", acceptance: "EXT-ANANAS-01", note: "Adapter je bezbedno isključen; nedostaju ANANAS_BASE_URL i ANANAS_API_KEY." },
  { id: 27, section: "Knjigovodstveni izveštaji", route: "/admin/erp/racunovodstveni-registri", status: "implemented", acceptance: "ACC-01", note: "Interni registri izvedeni iz fiskalnih dokumenata, zaliha i COGS-a." },
  { id: 28, section: "Evidencija prometa", route: "/admin/erp/racunovodstveni-registri", status: "implemented", acceptance: "ACC-02", note: "Promet po fiskalnim dokumentima sa neto, PDV i bruto iznosima." },
  { id: 29, section: "Evidencija storniranja i refundacija", route: "/admin/erp/racunovodstveni-registri", status: "implemented", acceptance: "ACC-03", note: "Storna i refundacije u istom neizmenjivom registru." },
  { id: 30, section: "Kalkulacije", route: "/admin/erp/ulazne-fakture", status: "implemented", acceptance: "ACC-04", note: "Kalkulacija nabavne vrednosti i zavisnih troškova." },
  { id: 31, section: "Nivelacije", route: "/admin/erp/mp-cene", status: "implemented", acceptance: "ACC-05", note: "Predlog i objava MP cena uz trag promene." },
  { id: 32, section: "KEP knjiga", route: "/admin/erp/racunovodstveni-registri", status: "implemented", acceptance: "ACC-06", note: "Interni KEP prikaz sa jasnom oznakom da nije odobren statutarni obrazac." },
  { id: 33, section: "API za razmenu lagera i rezervacije", route: "/admin/erp/partner-klijenti", status: "implemented", acceptance: "PARTNER-01", note: "Scope-ovani bearer ključevi, rate limit, audit i idempotentne rezervacije." },
  { id: 34, section: "Popisi", route: "/admin/erp/popisi", status: "implemented", acceptance: "STOCK-03", note: "Očekivano/prebrojano/razlika i transakciono knjiženje." },
  { id: 35, section: "Baza kupaca", route: "/admin/erp/kupci", status: "implemented", acceptance: "CRM-01", note: "Kontakti, adrese, PIB i isključivo ručno NEPOZNATO/ŽENSKI/MUŠKI." },
  { id: 36, section: "Postojeći moduli u admin panelu", route: "/admin", status: "implemented", acceptance: "ADMIN-01", note: "Postojeći moduli su sačuvani, a duplikati preusmereni na kanonski ERP." },
  { id: 37, section: "Kontrolna tabla", route: "/admin", status: "implemented", acceptance: "DASH-01", note: "Operativne metrike i linkovi ka filtriranim ERP pregledima." },
  { id: 38, section: "Baneri", route: "/admin/baneri", status: "implemented", acceptance: "CONTENT-01", note: "Tri pozicije, višestruki HERO slajdovi, periodi, dimenzije i brisanje sa potvrdom." },
  { id: 39, section: "Promo traka", route: "/admin/promo-traka", status: "implemented", acceptance: "CONTENT-02", note: "Današnji period, zabrana preklapanja i završno 72-časovno odbrojavanje." },
  { id: 40, section: "Navigacija", route: "/admin/tabovi", status: "implemented", acceptance: "CONTENT-03", note: "Deset jedinstvenih desktop pozicija sa padajućim odredištima." },
  { id: 41, section: "Kategorije", route: "/admin/kategorije", status: "implemented", acceptance: "CONTENT-04", note: "Stablo sa fiksnim editorom i naglašenim vršnim nivoima." },
  { id: 42, section: "Piktogrami", route: "/admin/erp/pozicije-piktograma", status: "implemented", acceptance: "CONTENT-05", note: "Četiri pozicije po akciji ili landing strani." },
  { id: 43, section: "Proizvodi", route: "/admin/erp/artikli", status: "implemented", acceptance: "REDIRECT-01", note: "Legacy lista preusmerena; duboki linkovi ostaju očuvani." },
  { id: 44, section: "Akcije", route: "/admin/erp/akcijske-cene", status: "implemented", acceptance: "REDIRECT-02", note: "Legacy lista preusmerena na ERP akcijske cene." },
  { id: 45, section: "Heroji meseca", route: "/admin/erp/heroji-meseca", status: "implemented", acceptance: "CONTENT-06", note: "Mesečni izbor proizvoda, redosled i veza sa akcijom." },
  { id: 46, section: "Preporuke kupovine", route: "/admin/preporuke", status: "implemented", acceptance: "CONTENT-07", note: "Kategorijska, globalna i rodna strategija bez automatskog zaključivanja pola." },
  { id: 47, section: "Pravila dostave", route: "/admin/dostava", status: "implemented", acceptance: "LOG-03", note: "Rutiranje i numeracija paketa iz stvarnih dimenzija, težine i sastava porudžbine." },
  { id: 48, section: "Vaučeri", route: "/admin/vauceri", status: "implemented", acceptance: "EXISTING-01", note: "Postojeći funkcionalni tok je sačuvan." },
  { id: 49, section: "Načini plaćanja", route: "/admin/placanje", status: "implemented", acceptance: "EXISTING-02", note: "Postojeća konfiguracija plaćanja je sačuvana." },
  { id: 50, section: "Narudžbine", route: "/admin/erp/prodajni-nalozi", status: "implemented", acceptance: "REDIRECT-03", note: "Legacy lista preusmerena na kanonske prodajne naloge." },
  { id: 51, section: "Reklamacije", route: "/admin/erp/reklamacije-dnevnik", status: "implemented", acceptance: "SERVICE-01", note: "Zakonski dnevnik, numeracija, odluka, rešenje, rokovi i operativni zadaci." },
  { id: 52, section: "Komentari", route: "/admin/komentari", status: "implemented", acceptance: "SERVICE-02", note: "Modul je eksplicitno isključen u skladu sa dokumentom." },
  { id: 53, section: "XML feed", route: "/admin/xml-import", status: "implemented", acceptance: "IMPORT-01", note: "Dobavljački XML je sačuvan, a atomski XLSX uvoz artikala dodat." },
  { id: 54, section: "Newsletter", route: "/admin/erp/newsletter-kampanje", status: "blocked_external", acceptance: "EXT-NEWS-01", note: "Autorstvo i zakazivanje postoje; slanje je isključeno dok EMAIL_PROVIDER i marketing pošiljalac ne prođu health check." },
  { id: 55, section: "Viber kampanje", route: "/admin/viber", status: "blocked_external", acceptance: "EXT-VIBER-01", note: "Upravljanje postoji; slanje čeka VIBER_PROVIDER, token i webhook secret." },
  { id: 56, section: "Oglasi (GMS/Meta)", route: "/admin/oglasi", status: "blocked_external", acceptance: "EXT-ADS-01", note: "Feed i upravljanje postoje; objava ostaje isključena bez ugovorenih Google/Meta kredencijala." },
  { id: 57, section: "Izveštaji", route: "/admin/izvestaji", status: "implemented", acceptance: "REPORT-01", note: "Periodski pregledi prodaje, zaliha, dolazne robe i reklamacija." },
  { id: 58, section: "Porudžbine", route: "/admin/izvestaji", status: "implemented", acceptance: "REPORT-02", note: "Promet, kupovine, proseci, kupci i rok isporuke." },
  { id: 59, section: "Zalihe", route: "/admin/izvestaji", status: "implemented", acceptance: "REPORT-03", note: "COGS vrednost, m³, obrt, dobavljači, statusi i magacini." },
  { id: 60, section: "Roba u dolasku", route: "/admin/izvestaji", status: "implemented", acceptance: "REPORT-04", note: "Fakturna vrednost i m³ ukupno, po dobavljaču i statusu." },
  { id: 61, section: "Reklamacije", route: "/admin/izvestaji", status: "implemented", acceptance: "REPORT-05", note: "Broj, udeo, tip, rešenje, starost, dobavljači i top artikli." },
  { id: 62, section: "Posete i konverzije", route: "/admin/erp/posete-konverzije", status: "implemented", acceptance: "ANALYTICS-01", note: "First-party događaji samo uz analytics saglasnost i rotirajući anonimni identifikator." },
  { id: 63, section: "Audit log", route: "/admin/audit-log", status: "implemented", acceptance: "SEC-01", note: "SUPER-only pregled promena, komandi i partnerskih API događaja." },
  { id: 64, section: "Neobjavljeno na sajtu", route: "/admin/erp/neobjavljeni-artikli", status: "implemented", acceptance: "QA-01", note: "Precizan razlog blokade za svaki artikal sa zalihom ili dolaskom." },
  { id: 65, section: "Landing pages", route: "/admin/erp/landing-strane", status: "implemented", acceptance: "CONTENT-08", note: "CRUD model sa sekcijama, periodom i statusom objave." },
  { id: 66, section: "Početna strana", route: "/admin/pocetna", status: "implemented", acceptance: "CONTENT-09", note: "Šest redova, dve baner pozicije i uklanjanje praznog prostora." },
  { id: 67, section: "Mobile tabovi", route: "/admin/erp/mobilni-tabovi", status: "implemented", acceptance: "CONTENT-10", note: "Tačno četiri jedinstvena taba iz akcija ili landing strana." },
] as const;
