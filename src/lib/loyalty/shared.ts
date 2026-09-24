export const LOYALTY_CONSENT_VERSION = "spc-loyalty-2026-09-24-v3";
export const LOYALTY_CONSENT_SECTIONS = [
  {
    title: "Pristupanje programu",
    body: "Želim da pristupim loyalty programu Svet Povoljnih Cena i dobrovoljno dajem pristanak za obradu podataka opisanu u ovoj izjavi. Loyalty pogodnosti se aktiviraju odmah prihvatanjem ove izjave, bez kreiranja korisničkog naloga, izdavanja broja kartice ili fizičke kartice. Mejl adresu obavezno unosim pri poručivanju kako bi se članstvo i pogodnosti povezali sa mojom porudžbinom; potvrda mejla nije uslov za popust. Kupovinu mogu obaviti i bez pristupanja programu, po cenama i uslovima koji važe za kupce bez loyalty pogodnosti.",
  },
  {
    title: "Ko obrađuje moje podatke",
    body: "Rukovalac je SVET POVOLJNIH CENA DOO BEOGRAD (NOVI BEOGRAD), Jurija Gagarina 32, 11070 Novi Beograd. Za pitanja o obradi podataka i ostvarivanje svojih prava mogu da se obratim na office@svetpovoljnihcena.rs.",
  },
  {
    title: "Podaci i svrha obrade",
    body: "Za članstvo se obrađuju moja mejl adresa uneta pri poručivanju, vreme davanja pristanka i verzija prihvaćene izjave. Mejl adresa povezuje se sa podacima o mojim porudžbinama i iskorišćenim pogodnostima radi provere uslova za popuste, uključujući pogodnost za prvu kupovinu. Ovi podaci služe za evidenciju članstva, obračun pogodnosti i komunikaciju neophodnu za članstvo. Ime, telefon, adresa i ostali podaci koje unesem pri kupovini obrađuju se za realizaciju porudžbine prema Politici privatnosti; samo pristupanje programu ne zahteva njihov ponovni unos.",
  },
  {
    title: "Loyalty pogodnosti",
    body: "Nakon prihvatanja saglasnosti ostvarujem 30% loyalty popusta na artikle koji nisu na aktivnoj akciji. Ako ispunjavam uslov za prvu kupovinu, ostvarujem i dodatnih 15% na već obračunatu vrednost artikala, bez dostave. Pravo na pogodnost za prvu kupovinu proverava se po unosu mejl adrese pri poručivanju, prema istoriji porudžbina povezanih sa mojom mejl adresom: pogodnost je iskorišćena kada postoji izdat fiskalni račun za prodaju. Konačne cene i popusti prikazuju se pre potvrde porudžbine.",
  },
  {
    title: "Pristup podacima i čuvanje",
    body: "Podacima pristupaju ovlašćena lica rukovaoca i pružaoci tehničkih usluga potrebnih za rad programa, u obimu potrebnom za te poslove i uz obavezu zaštite podataka. Podaci se mogu dostaviti nadležnim organima kada za to postoji zakonska obaveza. Podaci o članstvu čuvaju se dok je članstvo aktivno, odnosno do povlačenja pristanka. Nakon toga se brišu ili anonimizuju, osim podataka koje je potrebno zadržati po drugom pravnom osnovu, uz ograničenje na odgovarajuću svrhu i potreban rok. Dokumentacija o porudžbinama i fiskalnim računima čuva se odvojeno, prema rokovima navedenim u Politici privatnosti. Za pamćenje prihvaćene saglasnosti u pregledaču koristi se nužni kolačić koji traje do 30 dana.",
  },
  {
    title: "Povlačenje pristanka i moja prava",
    body: "Pristanak mogu povući u bilo kom trenutku, bez obrazloženja i naknade, slanjem zahteva na office@svetpovoljnihcena.rs. Povlačenjem prestaje moje članstvo i korišćenje budućih loyalty pogodnosti; to ne menja zakonitost ranije obrade na osnovu pristanka niti samo po sebi briše dokumentaciju koju rukovalac mora da čuva po drugom pravnom osnovu. U skladu sa zakonskim uslovima imam prava na pristup, ispravku, brisanje, ograničenje obrade, prenosivost podataka i prigovor. Mogu podneti pritužbu Povereniku za informacije od javnog značaja i zaštitu podataka o ličnosti.",
  },
  {
    title: "Odvojen izbor za reklamne poruke",
    body: "Pristupanje loyalty programu ne predstavlja prijavu za newsletter, reklamne mejlove, SMS ili Viber promocije. Za takve poruke potreban je zaseban izbor. Ako se planira obrada mojih podataka u novu svrhu, o tome ću biti prethodno obavešten/a, uz odgovarajući pravni osnov. Više informacija o obradi i ostvarivanju prava nalazi se u Politici privatnosti.",
  },
] as const;

export const LOYALTY_CONSENT_TEXT = LOYALTY_CONSENT_SECTIONS
  .map(({ title, body }) => `${title}\n${body}`).join("\n\n");

export function normalizeLoyaltyEmail(email: string) {
  return email.trim().toLowerCase();
}

export function loyaltySavings(lines: Array<{
  qty: number;
  unitPriceSale: number;
  unitPriceLoyalty?: number;
}>) {
  return Math.round(lines.reduce((sum, line) => sum +
    Math.max(0, line.unitPriceSale - (line.unitPriceLoyalty ?? line.unitPriceSale)) * line.qty, 0) * 100) / 100;
}

/** Savings already included in payable line prices, separate from sale offers. */
export function appliedLoyaltySavings(lines: Array<{
  qty: number; unitPriceFull: number; unitPriceSale: number; unitPriceLoyalty?: number;
}>) {
  return Math.round(lines.reduce((sum, line) => sum + (
    line.unitPriceLoyalty != null && line.unitPriceSale === line.unitPriceLoyalty
      ? Math.max(0, line.unitPriceFull - line.unitPriceSale) * line.qty : 0
  ), 0) * 100) / 100;
}
