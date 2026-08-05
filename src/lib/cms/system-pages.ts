export type SystemContentPageDefinition = {
  systemKey: string;
  slug: string;
  template: "STANDARD" | "FAQ";
  eyebrow: string | null;
  heroNote: string | null;
  title: string;
  lead: string | null;
  bodyMarkdown: string;
  seoTitle: string;
  seoDescription: string;
  footerVisible: boolean;
  footerLabel: string;
  footerColumn: "COMPANY" | "TERMS";
  footerOrder: number;
};

export const SYSTEM_CONTENT_PAGES = [
  {
    systemKey: "o-nama",
    slug: "o-nama",
    template: "STANDARD",
    eyebrow: "Naša priča",
    heroNote: null,
    title: "Pošten nameštaj, poštena cena.",
    lead:
      "Gradimo preglednu internet prodavnicu nameštaja i opreme za dom, sa jasnim informacijama o ceni, dostupnosti i isporuci.",
    bodyMarkdown: `## Misija {#misija}

Želimo da kupac pre poručivanja dobije proverljive podatke o proizvodu i sve troškove vidi pre konačne potvrde porudžbine.

## Kako biramo proizvode {#kako}

- **Jasan opis.** Objavljujemo specifikacije koje smo dobili i proverili sa dobavljačem.
- **Vidljiva dostupnost.** Status zaliha i procenjeni rok prikazujemo tamo gde imamo pouzdan podatak.
- **Povratna informacija.** Primedbe kupaca koristimo za ispravke kataloga i procesa.

## Kako radimo {#tim}

Porudžbine obrađujemo kroz mrežu dobavljača, kurirskih službi i servisa koji se aktiviraju tek nakon tehničke i poslovne provere. Dostupne opcije uvek prikazujemo u korpi pre slanja porudžbine.`,
    seoTitle: "O nama",
    seoDescription:
      "Priča o Svetu povoljnih cena — kuratiranoj selekciji nameštaja po poštenim cenama, sa fokusom na materijal, izradu i isporuku.",
    footerVisible: true,
    footerLabel: "O nama",
    footerColumn: "COMPANY",
    footerOrder: 10,
  },
  {
    systemKey: "pomoc",
    slug: "pomoc",
    template: "FAQ",
    eyebrow: "Česta pitanja",
    heroNote: null,
    title: "Pomoć i česta pitanja.",
    lead:
      "Najbrži odgovori na najčešća pitanja. Ako vam nešto nedostaje — pišite nam.",
    bodyMarkdown: `### Koliko traje isporuka? {#koliko-traje-isporuka}

Rok zavisi od potvrđene zalihe, adrese i izabrane dostave. Procena za konkretnu porudžbinu prikazuje se pre potvrde.

### Kako da pratim porudžbinu? {#pracenje-porudzbine}

Status porudžbine vidite u sekciji „Moje porudžbine” u nalogu, a takođe vam stiže potvrda na e-poštu kada porudžbina krene iz skladišta.

### Mogu li da poručim bez registracije? {#kupovina-bez-registracije}

Da, ako je opcija „Nastavi kao gost” ponuđena u checkout-u. Eventualni popust važi samo kada je izričito prikazan i obračunat pre potvrde.

### Da li sklapate nameštaj? {#montaza}

Montaža se nudi samo kada je dostupna za konkretan artikal i adresu. Cena se prikazuje u checkout-u pre potvrde.

### Kako da iskoristim vaučer? {#vaucer}

Vaučer unesite na koraku „Vaučer” u toku checkouta. Vaučeri se ne kombinuju, osim ako u uslovima vaučera nije drugačije navedeno.

### Mogu li da vratim nameštaj? {#vracanje}

Da, imate 14 dana na odustanak. Detalje pogledajte u [Uslovima kupovine](/uslovi-kupovine).

## Niste pronašli odgovor? {#dalje}

Pišite nam preko [kontakt strane](/kontakt), ili otvorite zahtev u [Servisu za kupce](/servis) — tu su i reklamacije, izmene porudžbine i komentari.`,
    seoTitle: "Pomoć",
    seoDescription:
      "Često postavljana pitanja o porudžbinama, dostavi, plaćanju i nalogu — Svet Povoljnih Cena.",
    footerVisible: true,
    footerLabel: "Pomoć",
    footerColumn: "COMPANY",
    footerOrder: 30,
  },
  {
    systemKey: "reklamacije",
    slug: "reklamacije",
    template: "STANDARD",
    eyebrow: "Posle kupovine",
    heroNote: null,
    title: "Reklamacije.",
    lead:
      "Ako artikal ima nedostatak, oštećenje iz transporta ili ne odgovara opisu — javite nam u zakonskom roku, rešićemo brzo.",
    bodyMarkdown: `## Rokovi {#rok}

- **Vidljiva oštećenja iz transporta:** prijavite pri preuzimanju ili u roku od 24 sata.
- **Skrivena oštećenja:** u roku od 48 sati od prijema.
- **Saobraznost:** u roku od 24 meseca od kupovine.

## Šta je potrebno priložiti {#podaci}

- Broj porudžbine (vidi se u potvrdi e-pošte i u nalogu).
- Kratak opis problema.
- 2–4 fotografije (oštećenje, etiketa, ambalaža).
- Vaš kontakt telefon za brzi povratni poziv.

## Kako podneti reklamaciju {#kako}

1. Prijavite reklamaciju kroz formular u nalogu (*Moj nalog → Reklamacije*) ili e-poštom na [reklamacije@svetpovoljnihcena.rs](mailto:reklamacije@svetpovoljnihcena.rs).
2. Dobićete potvrdu prijema u roku od 24h, sa brojem reklamacije.
3. Tehnička služba donosi odluku u roku od **8 dana** (zakonski rok 15 dana).
4. U dogovoru sa vama biramo: zamenu artikla, popravku, sniženje cene ili povraćaj sredstava.

## Šta nije reklamacija {#napomena}

Mehanička oštećenja nastala neispravnim sklapanjem ili upotrebom van uputstva, kao i normalno habanje, nisu predmet saobraznosti. U tim slučajevima nudimo plaćeni servis i rezervne delove.

## Povraćaj sredstava — IPS Skeniraj {#povracaj-ips}

U slučaju vraćanja robe i povraćaja sredstava kupcu koji je prethodno platio IPS Skeniraj metodom, a bez obzira na razlog vraćanja, {{merchant.name}} je u obavezi da povraćaj vrši isključivo preko IPS sistema. Za ostale načine plaćanja povraćaj se vrši na način opisan u [Uslovima kupovine](/uslovi-kupovine#povracaj).`,
    seoTitle: "Reklamacije",
    seoDescription:
      "Postupak za podnošenje reklamacije — koji podaci su potrebni, rokovi i način rešavanja.",
    footerVisible: true,
    footerLabel: "Reklamacije",
    footerColumn: "COMPANY",
    footerOrder: 50,
  },
  {
    systemKey: "uslovi-koriscenja",
    slug: "uslovi-koriscenja",
    template: "STANDARD",
    eyebrow: "Korišćenje sajta",
    heroNote: "Poslednje izmene: 30. jun 2026.",
    title: "Uslovi korišćenja.",
    lead:
      "Ova pravila uređuju pristup sajtu, aplikaciji, korisničkom nalogu, društvenoj prijavi i sadržaju koji objavljujemo.",
    bodyMarkdown: `## Opseg primene {#opseg}

Ovi uslovi važe za korišćenje veb-sajta, aplikacije, naloga, formulara, korpe, liste želja, komentara, recenzija i drugih digitalnih funkcionalnosti koje pruža **{{brand.name}}**. Korišćenjem sajta ili aplikacije potvrđujete da ste pročitali i prihvatili ove uslove.

Za kupovinu proizvoda primenjuju se naši [Uslovi kupovine](/uslovi-kupovine), a za dostavu [Uslovi isporuke](/uslovi-isporuke).

## Korisnički nalog {#nalog}

- Podatke za nalog morate unositi tačno, potpuno i ažurno, naročito e-poštu, telefon i adresu za isporuku.
- Odgovorni ste za čuvanje pristupnih podataka i sve aktivnosti koje nastanu preko vašeg naloga, osim ako je do zloupotrebe došlo našom greškom.
- Možemo privremeno ograničiti ili zatvoriti nalog ako postoji sumnja na zloupotrebu, pokušaj prevare, neovlašćen pristup, automatizovano preuzimanje sadržaja ili kršenje ovih uslova.
- Nalog možete prestati da koristite u svakom trenutku, a zahtev za brisanje podataka možete poslati prema uputstvu na stranici [Brisanje podataka](/brisanje-podataka).

## Facebook login i društvena prijava {#facebook-login}

Ako izaberete prijavu preko Facebook-a ili drugog podržanog provajdera, provajder nam dostavlja podatke za identifikaciju naloga u skladu sa dozvolama koje ste odobrili, najčešće ime, e-poštu, javni identifikator naloga i eventualno profilnu sliku. Te podatke koristimo za kreiranje ili povezivanje naloga, prijavu i zaštitu od zloupotrebe.

Ne dobijamo vašu Facebook lozinku. Pristup aplikacije možete opozvati u podešavanjima svog Facebook naloga, a od nas možete tražiti brisanje ili odvajanje povezanog društvenog naloga preko [instrukcija za brisanje podataka](/brisanje-podataka).

## Dozvoljeno korišćenje {#dozvoljeno-koriscenje}

Sajt i aplikaciju možete koristiti samo za lične i zakonite potrebe: pregled proizvoda, upravljanje nalogom, kupovinu, komunikaciju sa podrškom i ostale funkcije koje su javno dostupne.

- Nije dozvoljen pokušaj neovlašćenog pristupa sistemima ili tuđim nalozima.
- Nije dozvoljeno ometanje rada sajta, slanje malicioznog koda ili testiranje bez odobrenja.
- Nije dozvoljeno masovno kopiranje, scraping ili preprodaja sadržaja bez naše pisane saglasnosti.
- Nije dozvoljeno lažno predstavljanje, zloupotreba promo kodova ili otvaranje naloga radi zaobilaženja ograničenja.

## Sadržaj, komentari i intelektualna svojina {#sadrzaj}

Tekstovi, fotografije, logo, dizajn, kategorije, opisi proizvoda i drugi elementi sajta zaštićeni su pravima intelektualne svojine ili licencama dobavljača. Ne smete ih koristiti van uobičajenog pregleda sajta bez dozvole.

Ako ostavite komentar, recenziju ili sugestiju, potvrđujete da je sadržaj zakonit i da ne povređuje prava trećih lica. Zadržavamo pravo moderacije sadržaja koji sadrži uvrede, govor mržnje, lične podatke trećih lica, netačne tvrdnje ili komercijalni spam.

## Dostupnost i ograničenje odgovornosti {#odgovornost}

Trudimo se da sajt, aplikacija, cene, dostupnost i opisi proizvoda budu tačni i dostupni, ali ne možemo garantovati neprekidan rad bez greške, prekida, tehničkog održavanja ili povremenih netačnosti.

U meri dozvoljenoj zakonom, ne odgovaramo za indirektnu štetu, izgubljenu dobit, gubitak podataka, nemogućnost korišćenja sajta ili posledice korišćenja informacija van njihove namene. Ova odredba ne ograničava vaša obavezna prava potrošača, prava u vezi sa saobraznošću proizvoda, pravo na reklamaciju ili druga prava koja se ne mogu isključiti zakonom.

## Privatnost i brisanje podataka {#privatnost}

Način na koji prikupljamo, koristimo, čuvamo i štitimo lične podatke opisan je na stranici [Politika privatnosti](/politika-privatnosti). Zahtev za pristup, ispravku, ograničenje, prenos ili brisanje podataka možete poslati prema uputstvu na stranici [Brisanje podataka](/brisanje-podataka).

## Izmene uslova i kontakt {#izmene}

Uslove možemo ažurirati kada menjamo funkcionalnosti, pravila naloga, načine prijave, bezbednosne procese ili zakonske obaveze. Nova verzija važi od objave na ovoj stranici, osim ako je naveden kasniji datum primene.

Za pitanja o ovim uslovima obratite se na [{{merchant.email}}](mailto:{{merchant.email}}).`,
    seoTitle: "Uslovi korišćenja",
    seoDescription:
      "Pravila korišćenja sajta, aplikacije, naloga i društvene prijave — Svet Povoljnih Cena.",
    footerVisible: true,
    footerLabel: "Uslovi korišćenja",
    footerColumn: "TERMS",
    footerOrder: 10,
  },
  {
    systemKey: "uslovi-isporuke",
    slug: "uslovi-isporuke",
    template: "STANDARD",
    eyebrow: "Logistika",
    heroNote: null,
    title: "Uslovi isporuke.",
    lead:
      "Šta očekivati posle porudžbine — od potvrde, preko priprema, do dovoza i montaže.",
    bodyMarkdown: `## Rokovi isporuke {#rokovi}

Standardni rok isporuke iznosi 2–3 radna dana od potvrde porudžbine. Ako kupac zatraži odlaganje isporuke, novi termin dostave biće organizovan u skladu sa njegovim zahtevom. Kurirska služba može kontaktirati kupca pre isporuke radi potvrde termina dostave.

## Cena isporuke {#tarifa}

**Cena dostave se ne računa za svaki poseban paket, već kao suma svih težina po kategoriji.** Ukupan iznos dostave prikazuje se pre potvrde porudžbine.

**I kategorija - paketi koji imaju sve dimenzije manje od 60cm:**

Težina od\tTežina do\tCena

       0       5  \t299 rsd
       5\t  10\t399 rsd
      10\t  20\t599 rsd
      20\t  30\t899 rsd
      30      50\t999 rsd

**II kategorija - paketi imaju bar jednu dimenziju veću od od 60cm do volumentrijske dimenzije 300cm:**

Težina od\tTežina do\tCena

       0       5  \t399 rsd
       5\t  10\t499 rsd
      10\t  20\t699 rsd
      20\t  30\t999 rsd
      30      50\t1099 rsd

Paketi sa volumentrijskom dimenzijom većom od 300 cm naplaćuju se po ceni II kategorije, uz doplatu od 300 rsd. Volumentrijska dimenzija se računa po formuli jedan puta najduža stranica plus dva puta širina i plus dva puta visina.

## Pri prijemu pošiljke {#prijem}

- Proverite spoljašnji izgled pakovanja pre potpisa.
- Ako ima vidljivih oštećenja — odbijte preuzimanje ili upišite napomenu na otpremnicu.
- Skrivena oštećenja prijavite bez odlaganja na stranici [reklamacije](/reklamacije).`,
    seoTitle: "Uslovi isporuke",
    seoDescription: "Način obračuna rokova, cena i uslova isporuke porudžbine.",
    footerVisible: true,
    footerLabel: "Uslovi isporuke",
    footerColumn: "TERMS",
    footerOrder: 20,
  },
  {
    systemKey: "uslovi-kupovine",
    slug: "uslovi-kupovine",
    template: "STANDARD",
    eyebrow: "Pravila",
    heroNote: null,
    title: "Uslovi kupovine.",
    lead:
      "Sve što treba da znate pre porudžbine — ko prodaje, kako se plaća, kako se vraća roba i koja prava imate kao potrošač.",
    bodyMarkdown: `## Prodavac {#prodavac}

Prodavac je **{{merchant.name}}**, {{merchant.address}}, PIB {{merchant.pib}}, MB {{merchant.registrationNumber}}. Pretežna delatnost je {{merchant.activityName}}, šifra delatnosti {{merchant.activityCode}}. Web adresa je {{brand.domain}}, a kontakt e-pošta [{{merchant.email}}](mailto:{{merchant.email}}). Svi ugovori zaključuju se na srpskom jeziku.

## Cene i porezi {#cene}

Cene su izražene u dinarima i sadrže PDV. Konačna cena proizvoda, dostave i izabranih dodatnih usluga prikazuje se pre potvrde porudžbine. Oznaku najniže cene u prethodnih 30 dana ne prikazujemo dok ne postoji potpuna i proverljiva istorija cena.

## Načini plaćanja {#kartice}

- Pouzeće — gotovinski ili karticom kod kurira.
- Uplatom na račun — predračun stiže e-poštom.
- IPS, kartice i digitalni novčanici prikazuju se u checkout-u tek nakon produkcione verifikacije odgovarajućeg provajdera.

## Dostava i ograničenja {#dostava-ogranicenja}

Načini, cene i rokovi isporuke prikazani su u checkout-u pre potvrde porudžbine i detaljno opisani na stranici [Uslovi isporuke](/uslovi-isporuke). Isporuka se vrši na teritoriji Republike Srbije; za izvoz, carinske propise i sva posebna ograničenja prodaje kupac mora prethodno kontaktirati podršku.

## IPS plaćanje (kada je dostupno) {#ips}

Nakon potvrde porudžbine preusmeravamo vas na Raiffeisen IPS stranu, gde se prikazuje IPS QR kod ili deep link za m-banking. Plaćanje je izvršeno tek kada od banke dobijemo potvrdu statusa.

## Povraćaj sredstava {#povracaj}

U slučaju vraćanja robe i povraćaja sredstava kupcu koji je prethodno platio IPS Skeniraj metodom, bez obzira na razlog vraćanja, {{merchant.name}} je u obavezi da povraćaj vrši isključivo preko IPS sistema.

## Apple Pay & Google Pay (kada su dostupni) {#wallet}

Plaćanje iz novčanika telefona ili sata — bez deljenja kartičnih podataka. Zahteva podržan uređaj i karticu povezanu sa novčanikom.

## Pravo na odustanak {#odustanak}

Imate pravo da odustanete od ugovora u roku od **14 dana** bez navođenja razloga. Obrazac za odustanak i adresa za povraćaj nalaze se u potvrdi porudžbine i u uputstvu uz artikal. Troškove povratnog transporta snosi kupac, osim u slučaju greške prodavca.

## Saobraznost i garancija {#garancija}

Svi proizvodi su saobrazni opisu na sajtu i imaju zakonski rok od **24 meseca**. Detaljnije o reklamacionom postupku: [Reklamacije](/reklamacije).

## Vansudsko rešavanje sporova {#sporovi}

Eventualne sporove rešavamo dogovorno. Ako to nije moguće, nadležna su sudska tela u Beogradu, uz primenu prava Republike Srbije.`,
    seoTitle: "Uslovi kupovine",
    seoDescription:
      "Pravila kupovine, načini plaćanja, povraćaj i odustanak od ugovora — Svet Povoljnih Cena.",
    footerVisible: true,
    footerLabel: "Uslovi kupovine",
    footerColumn: "TERMS",
    footerOrder: 30,
  },
  {
    systemKey: "politika-privatnosti",
    slug: "politika-privatnosti",
    template: "STANDARD",
    eyebrow: "GDPR & ZZPL",
    heroNote: "Poslednje izmene: 30. jun 2026.",
    title: "Politika privatnosti.",
    lead:
      "Vaše podatke koristimo isključivo za realizaciju porudžbine, podršku i — ako date pristanak — za informisanje o akcijama.",
    bodyMarkdown: `## Rukovalac podacima {#rukovalac}

**{{merchant.name}}**, {{merchant.shortAddress}}. Kontakt za zaštitu podataka: [dpo@svetpovoljnihcena.rs](mailto:dpo@svetpovoljnihcena.rs).

## Koje podatke obrađujemo {#podaci}

- Ime i prezime, adresa, e-pošta, telefon.
- Podaci o porudžbinama, plaćanju i isporuci.
- Tehnički podaci o uređaju i poseti (IP, kolačići, statistika).
- Podaci iz društvene prijave, uključujući Facebook login, kada ga sami izaberete za prijavu ili registraciju.
- Komunikacija sa podrškom (pošta, Viber, telefonski razgovori — ako ste o tome obavešteni).

## Pravni osnov i svrhe {#osnov}

- **Izvršenje ugovora** — obrada porudžbine, isporuka, fakturisanje.
- **Zakonska obaveza** — knjigovodstvo, fiskalizacija.
- **Pristanak** — newsletter, personalizovane akcije.
- **Legitimni interes** — sprečavanje prevara, poboljšanje sajta.

## Kolačići {#kolacici}

Koristimo nužne kolačiće (sesija, korpa) i — uz vaš pristanak — analitičke kolačiće. Analitika se ne učitava pre pristanka. Pristanak možete promeniti u svakom trenutku na stranici [Podešavanja kolačića](/podesavanja-kolacica) ili kroz podešavanja naloga.

## Društvene prijave {#drustvene-prijave}

Kada koristite Facebook, Google ili Apple prijavu, obrađujemo podatke koje nam provajder dostavi u skladu sa dozvolama koje ste odobrili, najčešće ime, e-poštu i javni identifikator naloga. Te podatke koristimo za prijavu, povezivanje naloga i zaštitu od zloupotrebe.

Zahtev za brisanje ili odvajanje društvene prijave možete poslati prema uputstvu na stranici [Brisanje podataka](/brisanje-podataka).

## Vaša prava {#prava}

- Pristup, ispravka, brisanje i prenos podataka.
- Ograničenje obrade i prigovor.
- Podnošenje pritužbe Povereniku za informacije od javnog značaja i zaštitu podataka o ličnosti.

Zahtev podnesite na [dpo@svetpovoljnihcena.rs](mailto:dpo@svetpovoljnihcena.rs). Odgovor stiže u roku od 30 dana.

## Koliko čuvamo podatke {#cuvanje}

Podatke o porudžbinama čuvamo 10 godina (poreske obaveze). Marketing podatke do povlačenja pristanka. Tehničke logove do 12 meseci.`,
    seoTitle: "Politika privatnosti",
    seoDescription:
      "Kako prikupljamo, koristimo i čuvamo vaše lične podatke — Svet Povoljnih Cena.",
    footerVisible: true,
    footerLabel: "Politika privatnosti",
    footerColumn: "TERMS",
    footerOrder: 40,
  },
  {
    systemKey: "brisanje-podataka",
    slug: "brisanje-podataka",
    template: "STANDARD",
    eyebrow: "Data Deletion Instructions",
    heroNote: "Poslednje izmene: 30. jun 2026.",
    title: "Brisanje podataka.",
    lead:
      "Ovde su uputstva za podnošenje zahteva za brisanje naloga, podataka i povezane Facebook ili druge društvene prijave.",
    bodyMarkdown: `## Kako da pošaljete zahtev {#zahtev}

Ako ste prijavljeni, nalog možete odmah obrisati u [podešavanjima naloga](/nalog/podesavanja).

1. Pošaljite e-poštu na [dpo@svetpovoljnihcena.rs](mailto:dpo@svetpovoljnihcena.rs) ili [{{merchant.email}}](mailto:{{merchant.email}}).
2. U naslovu poruke navedite: **Brisanje podataka**.
3. U poruci navedite e-poštu ili telefon koji koristite za nalog, kao i da li ste koristili Facebook, Google ili Apple prijavu.
4. Nemojte slati lozinku, broj platne kartice ili dokumenta koja nisu potrebna za proveru identiteta.

Ako zahtev šaljete sa iste e-pošte kojom je otvoren nalog, postupak provere je brži. Ako podatke ne možemo pouzdano povezati sa nalogom, zatražićemo dodatnu potvrdu identiteta.

## Facebook login {#facebook}

Ako ste koristili Facebook login, u zahtevu navedite e-poštu koja je povezana sa Facebook nalogom ili korisničkim nalogom na našem sajtu. Od nas možete tražiti brisanje naloga, brisanje podataka koje smo dobili kroz Facebook login ili odvajanje Facebook naloga od vašeg profila.

Pristup aplikacije možete ukloniti i direktno u svom Facebook nalogu: otvorite **Podešavanja i privatnost**, zatim **Podešavanja**, **Aplikacije i veb-sajtovi**, izaberite **{{brand.name}}** i uklonite pristup. Nazivi stavki mogu se razlikovati ako Facebook promeni interfejs.

## Šta brišemo {#brisemo}

- Korisnički profil i podatke za prijavu koje nije potrebno čuvati.
- Adrese, listu želja, podešavanja naloga i marketinške saglasnosti.
- Vezu sa Facebook, Google ili Apple nalogom, uključujući tokene ako postoje.
- Komentare, recenzije ili poruke koje možemo obrisati ili anonimizovati na zahtev.

## Podaci koje ne brišemo odmah {#zadrzavamo}

Neke podatke moramo zadržati ograničeno vreme zbog zakonskih obaveza, zaštite potrošača, računovodstva, fiskalizacije, reklamacija, naplate, sprečavanja prevara ili odbrane pravnih zahteva. To se najčešće odnosi na porudžbine, račune, povraćaje, reklamacije i osnovne evidencije komunikacije.

Podaci koji ostaju u rezervnim kopijama brišu se ili prepisuju kroz redovan ciklus čuvanja backup-a i više se ne koriste za aktivnu obradu.

## Rokovi i potvrda {#rokovi}

Zahtev obrađujemo bez nepotrebnog odlaganja, a najkasnije u roku od 30 dana od prijema potpunog i proverljivog zahteva. Ako je zahtev složen ili imamo veliki broj zahteva, obavestićemo vas o produženju roka u skladu sa propisima.

Kada postupak završimo, poslaćemo potvrdu na e-poštu sa koje je zahtev poslat ili na drugu proverenu kontakt adresu.

## Ostala prava {#prava}

Pored brisanja, možete tražiti pristup, ispravku, ograničenje obrade, prenos podataka ili prigovor. Detalji su opisani na stranici [Politika privatnosti](/politika-privatnosti).`,
    seoTitle: "Brisanje podataka",
    seoDescription:
      "Data Deletion Instructions za nalog, Facebook login i druge podatke — Svet Povoljnih Cena.",
    footerVisible: true,
    footerLabel: "Brisanje podataka",
    footerColumn: "TERMS",
    footerOrder: 50,
  },
] as const satisfies readonly SystemContentPageDefinition[];

export function getSystemContentPage(slugOrKey: string) {
  return SYSTEM_CONTENT_PAGES.find(
    (page) => page.slug === slugOrKey || page.systemKey === slugOrKey,
  );
}

export const SYSTEM_CONTENT_SLUGS: ReadonlySet<string> = new Set(
  SYSTEM_CONTENT_PAGES.map((page) => page.slug),
);
