# Izveštaj o komentarima koje je Marko ponovo označio kao nerešene

Datum završne provere: 21. avgust 2026.
Osnovica audita: `main` / `055bc9d`.
Obuhvat: 7, 30, 31, 32, 38, 44, 48, 50, 55, 58, 59, 62, 65, 76, 78, 87, 88, 89, 90, 92, 94, 95, 96, 99, 102, 103, 106, 113, 114 i 115.

## Kratak zaključak

Markova poruka nije samo posledica toga što nije video poslednju implementaciju. Od 30 navedenih tačaka, posle ovog korektivnog prolaza:

- **20 imaju jak dokaz da su rešene u sadašnjem kodu i lokalnom acceptance-u**;
- **9 jesu implementirane, ali još zahtevaju spoljno podešavanje, realne podatke ili Markovu potvrdu**;
- **3 ranije sporne tačke (58, 59 i 65) sada imaju Lukinu konačnu odluku i implementirane su**;
- **102 je razbijen na šest zasebnih backlog stavki**, sa jasnim acceptance kriterijumima i jednom `NEEDS-USER` zavisnošću za Ananas.

Najvažnije: raniji status „implementirano“ je više puta tretiran kao „završeno“. To nije isto. Build i unit test dokazuju da se kod kompajlira i da izolovana pravila rade; ne dokazuju da je Markov konkretan scenario prošao na telefonu, u adminu ili na produkciji.

### Najkritičniji nalazi i odluke

1. **#89 — implementirano i prošlo izolovani browser acceptance.** Admin dozvoljava samo smanjenje količine ili uklanjanje stavke u bezbednim fazama WEB porudžbine, sa atomarnim preračunom, rezervacijama, dokumentima i auditom.
2. **#95/#96 — pronađena i ispravljena dva stvarna propusta.** Registrovani i gost kupac ranije su mogli da pokrenu reklamaciju pre statusa `ISPORUCENO`; success potvrda registrovanog kupca mogla je odmah da nestane posle refresh-a. Oba toka sada prolaze izolovani browser acceptance.
3. **#65 — odluka primenjena.** Title proizvoda sada koristi najnižu cenu koju PDP javno prikazuje, uključujući aktivnu loyalty ponudu.
4. **#58 — primenjen je originalni Markov mobilni checkout**, koji ima prednost nad kasnijim konfliktnim komentarom 80.
5. **#59 — primenjen je veći prikaz:** `text-2xl`, kartice visine najmanje 112 px i horizontalni mobilni skrol.

## Kako je rađena provera

Korišćeni su:

- originalni spisak komentara 1–102 iz `kom v22 export.pdf`;
- starija Pages verzija komentara 1–70;
- lokalna istorija prethodnih Codex razgovora, uključujući posebne niti za komentare 94–115, newsletter i Rabalux;
- Git istorija i trenutno stanje koda na `055bc9d`;
- postojeći unit/E2E testovi i prethodno zabeležene browser/produkcijske provere;
- nova verifikacija: kompletan unit paket, **161 fajl i 798/798 testova prošlo**, Playwright mobile search **7/7**, pet izolovanih acceptance scenarija **5/5** uključujući mobilni checkout na 390 px, i `npm run build`, **uspešno**.

Servis za direktno čitanje starih Codex niti nije odgovorio, pa je istorija rekonstruisana iz lokalno sačuvanih session JSONL zapisa. Za komentare posle 102 izvor su slike i mapiranje zabeleženo u prethodnoj niti; posebno je naznačeno gde to uvodi malu nesigurnost.

## Status po svakoj tački

Legenda:

- **ZATVORENO** — zahtev je prisutan u sadašnjem kodu i postoji jak dokaz za očekivano ponašanje;
- **IMPLEMENTIRANO / PRIJEM NIJE ZATVOREN** — kod postoji, ali nema dovoljno jakog dokaza za Markov realni scenario;
- **OTVORENO** — sadašnji kod ne ispunjava izvorni zahtev ili je promena regresirala;
- **ODLOŽENO / POSEBAN PLAN** — nije jedna završiva stavka u ovom trenutku.

### 7 — samo Rabalux artikli sa zalihom u Srbiji

**Status: ZATVORENO U KODU I PODACIMA POSLE MARKOVE PORUKE; završna produkcijska vizuelna provera još treba.**

- Poslednji commit `055bc9d` je nastao nakon ranijeg spiska i menja pravilo objave.
- Provera nedeljnog fajla za Srbiju: 2.868 redova, 506 pozitivnih; baza je imala 506/506 poklapanja, bez viška, manjka ili razlike u količini.
- Trenutna politika: nulta zaliha se ne objavljuje; 1–2 komada mogu biti vidljiva, ali ne i kupiva; od 3 komada naviše artikal je kupiv nakon sigurnosne rezerve.
- Prošli su ciljani testovi, svih 790 tadašnjih unit testova i build. U ovom auditu ponovo su prošli Rabalux policy testovi.
- Dokaz: `src/lib/rabalux/weekly-stock-policy.ts`, `src/lib/web-storefront-availability.ts`, commit `055bc9d`.

**Preostalo:** proveriti konkretne pozitivne i nulte SKU-ove na produkcijskom storefrontu posle potvrđenog Vercel deploya.

### 30 — automatski garantni list za sopstvenu robu

**Status: IMPLEMENTIRANO / PRIJEM NIJE ZATVOREN.**

- Jedan PDF obuhvata sve kvalifikovane stavke porudžbine i navodi garanciju od „1 (jedna) godina“.
- PDF se automatski prilaže potvrdi porudžbine.
- Rabalux stavke se izuzimaju; all-Rabalux porudžbina ne dobija garantni list.
- Unit testovi proveravaju sadržaj i email prilog.
- Dokaz: `src/lib/email/guarantee-pdf.ts`, `src/lib/email/send.ts`, `tests/unit/guarantee-pdf.test.ts`, `tests/unit/email-send-flows.test.ts`.

**Rizik:** „sopstvena roba“ je trenutno tehnički definisana kao „sve što nije Rabalux“. Ako postoje drugi eksterni/drop-ship dobavljači, pravilo je preširoko. Potrebni su poslovna potvrda tog pravila i test jednog stvarnog emaila sa mešovitom porudžbinom.

### 31 — porudžbenica u definisanom PDF formatu

**Status: IMPLEMENTIRANO / PRIJEM NIJE ZATVOREN.**

- Postoji dvojezični landscape PDF `PORUDŽBENICA / ORDER REQUEST`, sa dobavljačem, uslovima, tabelom, slikama, zbirnim vrednostima i paginacijom.
- Test potvrđuje da se validan PDF generiše, ali nema vizuelni/golden test koji poredi rezultat sa odobrenim uzorkom.
- Dokaz: `src/lib/admin/po-pdf.ts`, `tests/unit/purchase-order-pdf.test.ts`, commit `09a1aa7`.

U ovom prolazu generisan je A4 landscape uzorak, renderovan u PNG i vizuelno pregledan na 144 dpi. Nisu nađeni preklapanje, odsečen tekst ili nečitljive kolone. Uzorak je u `output/pdf/porudzbenica-prijemni-uzorak.pdf`.

**Preostalo:** dobiti Markovo „da“ na format i zatim ponoviti proveru sa jednom realnom, dužom porudžbenicom. Bez toga ovo nije klijentski zatvoreno.

### 32 — filter po konačnoj ceni i period akcije od–do

**Status: ZATVORENO.**

- Listing filter računa javnu konačnu cenu preko centralnog pricing engine-a, a `/sve-do-999` koristi limit 999.
- Period akcije prikazuje početak i kraj na listingu/PDP-u.
- Dokaz: `src/lib/listing/filters.ts`, `src/lib/api/catalog.ts`, `src/components/listing/listing-shell.tsx`, `src/components/product/pdp-price.tsx`.

Napomena: javni filter namerno koristi anonimnu cenu; personalizovana loyalty naplativa cena zahteva prijavljenog korisnika.

### 38 — „Kako funkcioniše newsletter?“

**Status: OSNOVNI TOK PRODUKCIJSKI DOKAZAN; dve operativne stavke ostaju.**

- Ovo je izvorno pitanje, ne precizno definisan bug.
- U posebnoj niti su poslate dve stvarne kampanje na Lukin Gmail i QA alias. Provereni su pošiljalac `marketing@svetpovoljnihcena.rs`, TLS, sadržaj, CTA, vaučer i unsubscribe.
- Ispravljeni su promo pricing, invalid SKU validacija, background queue, Resend 429, limiti segmenata i bezbedan retry.
- Dokaz: posebna newsletter nit i postojeći newsletter unit/E2E testovi.

Kod već obrađuje `contact.updated` webhook i ima unit test. **Preostalo je samo spoljašnje podešavanje:** uključiti taj webhook u pravom Resend workspace-u i podesiti tracking domen/CNAME da bi open/click metrike radile. Zato aplikacioni deo radi, ali operativno praćenje nije potpuno zatvoreno.

### 44 — korisničko podešavanje levog admin menija i sačuvani pogledi

**Status: ZATVORENO U KODU I IZOLOVANOM BROWSER ACCEPTANCE-U.**

- Svaki admin korisnik može da bira vidljive stavke i njihov redosled; podešavanje se čuva kao korisnički saved view za `admin-navigation`.
- Dozvole po ulozi se i dalje poštuju; implementacija pokriva desktop i mobilni meni.
- Dokaz: `src/lib/admin/nav.ts`, `src/components/admin/sidebar.tsx`, `src/app/admin/layout.tsx`, `tests/unit/admin-nav-preferences.test.ts`, commit `4537065`.

U ovom prolazu dodat je i uspešno pokrenut izolovani Playwright acceptance sa dva admin naloga, odvojenim desktop/mobilnim menijima i zabranom brisanja tuđih podešavanja. Scenario je prošao **1/1**; privremena schema je obrisana.

### 48 — bela pozadina iza teksta, boja i atributa

**Status: ZATVORENO U SADAŠNJEM KODU.**

- Atributi na PDP-u imaju `bg-white`.
- Varijante/boje se prikazuju na beloj podlozi.
- Testovi proveravaju belu pozadinu i odsustvo starog gradijenta u relevantnim slučajevima.
- Dokaz: `src/app/(shop)/p/[slug]/page.tsx`, `src/components/product/color-options.tsx`, `tests/unit/product-color-options.test.tsx`.

### 50 — mali thumbnail i kada postoji samo jedna boja

**Status: ZATVORENO.**

- Za jednu boju se prikazuje jedan mali thumbnail/swatch i ne ostaje prazna rupa.
- Dokaz: `src/components/product/color-options.tsx` i testovi za single-color prikaz.

### 55 — automatsko otvaranje tastature pri otvaranju pretrage

**Status: ZATVORENO U KODU I LOKALNOM BROWSER TESTU.**

- Uklonjen je odloženi `setTimeout(100)` fokus.
- Sheet sada dobija input kao `initialFocus`, pa je fokus deo samog otvaranja dijaloga.
- Stvarni Playwright tok prošao je **7/7** scenarija na širinama 360, 390 i 430 px, uključujući fokus, unos sa tastature, Escape i ponovni pokušaj.
- Dokaz: `src/components/layout/mobile-search-sheet.tsx`, `tests/e2e/mobile-search.spec.ts`.

Markov realni iPhone ostaje koristan završni prijem, ali više nema poznatog odloženog-focus rizika u implementaciji.

### 58 — mobilni checkout raspored

**Status: ZATVORENO U KODU I IZOLOVANOM MOBILNOM ACCEPTANCE-U; DEPLOY NIJE RAĐEN.**

- Primenjen je originalni Markov zahtev, sa prednošću nad kasnijim konfliktnim komentarom 80.
- Tok za gosta je sada `Identifikacija → Isporuka i plaćanje → Pregled i potvrda`; prijavljeni kupac nema korak identifikacije. Zaseban korak plaćanja je stvarno uklonjen, a njegova validacija spojena sa isporukom.
- „Pouzeće — gotovina“ je podrazumevani metod kada je omogućen.
- Na mobilnom su Ime/Prezime u jednom redu, Grad/poštanski broj u drugom, dok je adresa puna širina. Potvrda prikazuje četiri informativna bloka u rasporedu 2×2.
- Saglasnost je pre komande za potvrdu, mobilna navigacija je fiksirana pri dnu sa safe-area razmakom, a sažetak sledi nakon forme. Desktop zadržava komande uz sažetak.
- Naslov stranice više nije generičko „Naplata“, već „Završetak porudžbine“.
- Stvarni mobilni Playwright scenario na 390 × 844 px proverava spojeni korak, default pouzeće, fiksnu navigaciju, redove polja, 2×2 potvrdu, reset scroll-a i uspešnu porudžbinu.

Dokaz: `src/components/checkout/checkout-flow.tsx`, `src/components/checkout/shipping-form.tsx`, `src/app/(checkout)/checkout/podaci/page.tsx`, `tests/e2e/checkout-confirmation-navigation.spec.ts`.

### 59 — duplo veći font mobilnih prečica

**Status: ZATVORENO.**

- Luka je izabrao originalni veći prikaz umesto smeštanja svih prečica u jedan viewport.
- Homepage kartice ponovo koriste `text-2xl`, `min-h-28`, veće ikone i horizontalni `snap` skrol sa delimično vidljivom sledećom karticom.
- Desktop i dalje koristi mrežu od četiri kolone.
- Unit test sada eksplicitno zahteva veliki font, veću visinu i horizontalni skrol.
- Dokaz: `src/components/home/promo-shortcut-tile.tsx`, `tests/unit/shortcut-strip.test.tsx`.

### 62 — Google logo, naslov i opis

**Status: IMPLEMENTIRANO I JAVNO INDEKSIRANO / TAČAN GOOGLE PRIKAZ NIJE POD NAŠOM KONTROLOM.**

- Globalni title i description su promenjeni na traženi marketinški tekst.
- Uveden je `src/app/icon.svg`, a stari favicon je uklonjen.
- Dodati su Open Graph podaci.
- Dokaz: `src/app/layout.tsx`, `src/app/icon.svg`, commit `ccc1b19`.

Javna provera 20. avgusta pokazuje da je `www.svetpovoljnihcena.rs` dostupan, da ga Google indeksira i da rezultat već koristi novi naziv sajta. Google ipak može da prepiše title/description, a Search Console nije bio dostupan u ovom prolazu.

**Preostalo:** vlasnik Search Console naloga treba da uradi URL inspection/reindex ako želi ubrzano osvežavanje i da vizuelno potvrdi logo/snippet u svom Google rezultatu.

### 65 — pogrešna cena u browser tabu proizvoda

**Status: ZATVORENO U KODU I UNIT TESTU; SEO OSVEŽAVANJE SLEDI POSLE DEPLOYA.**

- Luka je izabrao najnižu javno prikazanu loyalty cenu.
- Dodat je centralni resolver `lowestPublicDisplayedUnitPrice()`, koji bira najnižu ponudu koju PDP javno renderuje, uključujući loyalty cenu dostupnu uz prijavu.
- `generateMetadata()` sada koristi taj resolver, pa naslov taba više ne ostaje na višoj anonimnoj naplativoj ceni kada je niža loyalty cena javno prikazana.
- Unit test potvrđuje primer redovne cene 10.000 i javne loyalty cene 8.000 RSD.
- Dokaz: `src/app/(shop)/p/[slug]/page.tsx`, `src/lib/pricing/engine.ts`, `tests/unit/pricing-precedence.test.ts`.

**Preostalo:** nakon deploya Google može kasniti sa osvežavanjem title-a; po potrebi zatražiti reindex kroz Search Console.

### 76 — SVG za banere i piktograme

**Status: ZATVORENO U KODU.**

- Baneri, landing media i piktogrami prihvataju SVG.
- SVG prolazi bezbednosnu proveru koja blokira script, event handlere, DOCTYPE i spoljne resurse.
- Dokaz: `src/lib/media/safe-svg.ts`, `src/app/api/admin/banner-uploads/route.ts`, `src/app/api/admin/landing-media/route.ts`, `src/lib/pictograms/icon-file.ts` i relevantni unit testovi.

### 78 — boje u pregledu; bez vidljivog „BOJA: CRNA“ na PDP-u

**Status: ZATVORENO.**

- Kartice proizvoda prikazuju boje/varijante.
- PDP prikazuje thumbnail/swatch bez vidljivog teksta „Boja: ...“; naziv ostaje u pristupačnom `aria-label`-u.
- Dokaz: `src/components/product/color-options.tsx`, `src/components/product/product-card.tsx`, `tests/unit/product-color-options.test.tsx`.

### 87 — gde se menja natpis uz „Mesečna akcija“

**Status: ZATVORENO.**

- U adminu za akcije postoji posebna kontrola „Naslov stranice Mesečna akcija“.
- Storefront metadata čita tu vrednost sa fallback-om.
- Dokaz: `src/app/admin/erp/akcije/page.tsx`, `src/lib/storefront/monthly-action-metadata.ts`, `tests/unit/monthly-action-metadata.test.ts`, commit `cdbbe56`.

### 88 — tri artikla kategorije I, a dostava 990 RSD

**Status: IMPLEMENTIRANO PRAVILO / MARKOV KONKRETAN SLUČAJ NIJE PONOVLJEN.**

- Trenutna tarifa sabira težinu po kategoriji i za kategoriju I vraća 299 RSD do 5 kg, 399 do 10 kg, 599 do 20 kg, 899 do 30 kg i 999 do 50 kg.
- Unit test eksplicitno proverava tri category-I stavke i očekuje 299 RSD u testiranom primeru.
- Dokaz: `src/lib/delivery-tariff.ts`, `tests/unit/client-feedback-rules.test.ts`.

**Preostalo:** ponoviti baš tri SKU-a sa Markove slike, sa njihovim stvarnim težinama i aktivnim admin pravilima. Ako je zbirna težina ili override drugačiji, 990/999 može biti posledica podataka, ne algoritma.

### 89 — brisanje artikla i promena količine u porudžbini

**Status: ZATVORENO U KODU I IZOLOVANOM BROWSER ACCEPTANCE-U; DEPLOY NIJE RAĐEN.**

- U admin tabeli stavki postoji promena količine; dozvoljeno je samo smanjenje ili unos nule za uklanjanje.
- Izmena je ograničena na WEB porudžbine u statusima `KREIRANO`, `POTVRDJENO` i `U_PRIPREMI`, pre fiskalizacije, otpreme, reklamacije/refundacije i nepovratne dobavljačke obrade.
- Poslednja stavka se ne može obrisati; tada se koristi otkazivanje celog naloga.
- Jedna transakcija zaključava porudžbinu i preračunava stavke, subtotal, uštedu, dostavu/montažu, vaučer, first/card popuste, plaćanje i sesiju.
- Oslobađaju se odgovarajuće DC/dobavljačke rezervacije; postojeća snapshot cena se ne menja.
- Predračun se regeneriše, audit/status događaj se upisuje, a fiskalna konkurentnost je ojačana da stari snapshot ne može paralelno da ode ka PFR-u.
- Dokaz: `src/lib/admin/web-order-edit.ts`, `src/lib/admin/web-order-edit.server.ts`, `src/components/admin/web-order-detail.tsx`, `src/lib/fiscal/issue.ts`, `tests/unit/web-order-edit.test.ts`.

Dodat je i uspešno pokrenut izolovani browser test koji pokriva smanjenje, brisanje, rezervacije, ukupne iznose, plaćanje, predračun, audit i zabranu brisanja poslednje stavke. Scenario je prošao **1/1**; privremena schema je obrisana. Pre produkcijskog korišćenja ostaje deploy i jedan kontrolisani admin smoke test.

### 90 — „ovo mi se čini da ne radi ili ja ne znam da koristim“

**Status: IMPLEMENTIRANO I POKRIVENO LOKALNIM E2E, ALI KLIJENTSKI PRIJEM NIJE ZATVOREN.**

- Slika se odnosi na tok „Nalog za preuzimanje“ sa komandama Novi, Završi uređivanje, Obriši i Proknjiži.
- Posle komentara su dodate korekcije toka i E2E scenariji, uključujući brisanje praznog naloga i kompletan lokalni tok bez stvarnog GLS poziva.
- Dokaz: `src/app/admin/erp/preuzimanja/[id]/page.tsx`, `src/lib/admin/pickup-batch.ts`, `tests/e2e/pickup-batch.spec.ts`, commit `7483a37`.

**Preostalo:** Markov komentar ne kaže koje dugme, stanje ili očekivani rezultat nije radio. Potrebna je reprodukcija sa njegovim nalogom/brojem preuzimanja; bez toga nije bezbedno proglasiti zatvorenim.

### 92 — jedna porudžbina, deo X Express a deo GLS

**Status: ZATVORENO U KODU.**

- Admin dozvoljava izbor podskupa stavki i kurira za taj nalog; nakon toga se za preostale stavke može napraviti drugi nalog drugog kurira.
- Sprečeno je dvostruko dodeljivanje iste stavke aktivnim pošiljkama; COD se raspodeljuje po odabranim stavkama.
- Dokaz: `src/components/admin/web-order-detail.tsx`, `src/lib/courier/shipment-assignment.ts`, `tests/unit/shipment-assignment.test.ts`, commit `cdbbe56`.

Napomena: ovo dokazuje aplikativni tok, ne i da su oba produkcijska courier naloga prihvaćena od provajdera sa realnim etiketama.

### 94 — stilizovanje predračuna kao otpremnice

**Status: ZATVORENO U IMPLEMENTACIJI.**

- Predračun je prepravljen u stilizovani A4 dokument sa brendom, tabelom stavki, sumama i paginacijom.
- U prethodnoj niti dokument je renderovan i vizuelno pregledan; unit testovi proveravaju generisanje PDF-a.
- Dokaz: `src/lib/email/pdf.ts`, `tests/unit/email-pdf.test.ts`, commit `2d54af2`.

### 95 — unos reklamacije na sajtu ne radi

**Status: ZATVORENO U KODU I IZOLOVANOM BROWSER ACCEPTANCE-U; REALNI PRIVATE UPLOAD JOŠ TREBA.**

- Postoji prijava reklamacije za ulogovanog kupca, validacija porudžbine/stavke/količine, kreiranje broja reklamacije i pozadinska obaveštenja.
- U ovom prolazu pronađen je i ispravljen propust: izbor i API sada dozvoljavaju prijavu samo za porudžbinu sa statusom `ISPORUCENO`.
- Ispravljen je i UX propust zbog kog je success potvrda nestajala čim poslednja raspoloživa stavka više nije mogla ponovo da se reklamira.
- Prisma 7 advisory lock za cart/wishlist login sync sada vraća podržani tekstualni tip, pa pozadinske login greške više ne prate ovaj tok.
- Dokaz: `src/app/(account)/nalog/reklamacije/reclamation-form.tsx`, `src/app/api/reclamations/route.ts`, `src/lib/api/reclamations.ts`.

Izolovani browser scenario registrovanog kupca je prošao. **Preostalo:** posebno proveriti stvarni upload u privatni bucket; acceptance je namerno radio sa praznim Supabase storage kredencijalima.

### 96 — reklamacija kupca koji je kupio bez registracije

**Status: ZATVORENO U KODU I IZOLOVANOM BROWSER ACCEPTANCE-U.**

- Gost dobija bezbedan link sa brojem porudžbine i access tokenom; stranica `/reklamacije/prijava` učitava samo tu porudžbinu i njene stavke.
- Gost pre isporuke više ne može da otvori niti podnese reklamaciju; scenario je dodat i u integration i u browser acceptance test.
- Dokaz: `src/app/(content)/reklamacije/prijava/page.tsx`, `src/lib/api/reclamations.ts`, order confirmation/confirmation view u commit-u `2d54af2`.

Registrovani i gost scenario prošli su **2/2** nad izolovanom bazom; pogrešan token i tuđi SKU su odbijeni, a privremena schema je obrisana. Stare gostujuće porudžbine bez sačuvanog tokena/linka i dalje zahtevaju podršku ili migracioni tok.

### 99 — samo artikli iz porudžbine i upload slika

**Status: ZATVORENO U KODU.**

- API traži SKU iz konkretne porudžbine i odbija tuđu stavku.
- Količina se ograničava preostalom nereklamiranom količinom.
- Fotografije idu kroz zaštićen presigned upload; bucket je privatan, a prikaz koristi potpisane URL-ove.
- Dokaz: `src/lib/api/reclamations.ts`, `src/app/api/reclamations/upload/route.ts`, `src/lib/api/uploads.ts`, reclamation form.

### 102 — grupa stavki „nije testirano“

**Status: RAZBIJENO U POSEBAN PLAN.**

Ovo nije jedan komentar koji se može zatvoriti jednim commit-om:

- fiskalizacija i refundacija: kasnije su dodati testovi i izolovana prihvatna provera rezervacija/fiskalizacije;
- knjigovodstveni izveštaji: izvorno planirani posle puštanja sajta;
- partnerski API: postoji, ali produkcijski partnerski acceptance nije završen samim unit/build testom;
- Ananas: planirano posle puštanja;
- nalog magacinu za INO/veleprodaju: planirano posle puštanja.

U `BACKLOG.md` je dodat Phase 5 sa zasebnim acceptance kriterijumima za fiskalizaciju/refundaciju, knjigovodstvene registre, partnerski API, Ananas zavisnosti i implementaciju, kao i INO/veleprodajni magacinski tok. Time #102 više nije jedan neodređen komentar.

### 103 — desktop kategorije da rade kao mobilne

**Status: ZATVORENO I RANIJE PRODUKCIJSKI PROVERENO.**

- Klik na kategoriju sa decom otvara sledeći nivo umesto listinga svih proizvoda.
- Commit `18d7fcc` je prošao unit testove, build i produkcijsku browser proveru; za „Rasveta“ su prikazane podkategorije „Unutrašnja rasveta“, „Spoljna rasveta“, „Šinski sistem“ i „Sijalice“.
- Dokaz: `src/components/layout/category-menu-action.ts`, `src/components/layout/desktop-menu.tsx`, `tests/unit/category-menu-action.test.ts`.

### 106 — sortiranje DC lagera po robi u dolasku

**Status: IMPLEMENTIRANO NA NIVOU GENERIČKOG SORTA / PRIJEM NA REALNIM PODACIMA NIJE ZATVOREN.**

- Kolona `incoming` je numerička, a test proverava redosled 100, 10, 0.
- Dokaz: `src/lib/admin/grid-query.ts`, `src/lib/admin/erp-operations.ts`, `tests/unit/grid-query.test.ts`, commit `2d54af2`.

**Rizik:** nije dokazano da ekran sa Markovim realnim DC artiklima dobija ne-nulte `incomingStock` vrednosti niti da je baš ta kolona odabrana u saved view-u. Ako „nema promena“, uzrok može biti sinhronizacija podataka ili prikaz, iako generički sort radi.

### 113 — popunjen garantni list

**Status: IMPLEMENTIRANO / PRIJEM NIJE ZATVOREN.**

Mapiranje iz prethodne niti označava 113 kao zahtev da garantni list bude popunjen stavkama. Sadašnji PDF dobija broj porudžbine, kupca, datum, stavke, SKU, količinu i rok garancije, i prilaže se emailu. Dokaz je isti kao za #30.

**Preostalo:** stvaran mešoviti order email i Markova vizuelna potvrda; takođe potvrditi da mapiranje 113 odgovara originalnoj slici, pošto glavni PDF izvora završava na 102.

### 114 — CMS izmena funkcionalnih stranica

**Status: IMPLEMENTIRANO / PRODUKCIJSKI SADRŽAJ NIJE OVDE MENJAN.**

Mapiranje iz prethodne niti označava 114 kao CMS uređivanje funkcionalnih stranica. Kontakt, Servis i Podešavanja kolačića imaju registrovane CMS fallback-e i admin editor; forme i bezbednosne kontrole ostaju u kodu.

- Dokaz: `src/lib/cms/system-pages.ts`, `src/lib/cms/pages.ts`, `src/app/admin/sadrzaj`, `tests/unit/cms-content.test.ts`, `tests/e2e/cms-functional-pages.spec.ts`.
- Build potvrđuje sve javne rute.

**Preostalo:** produkcijski admin prijem: izmeniti nacrt, pregledati, objaviti kontrolnu promenu i vratiti sadržaj. Potvrditi i tačno mapiranje broja 114 prema originalnoj slici.

### 115 — parcijalna pretraga, npr. „trp“ → „trpezarijske“

**Status: ZATVORENO I RANIJE PRODUKCIJSKI PROVERENO.**

- Za kratke code-like upite pretraga proverava normalizovani spojeni naziv i `ILIKE %upit%`; minimum je tri znaka.
- U prethodnoj browser proveri `trp` je vraćao rezultate iz „trpezarijske“ kategorije/naziva.
- Dokaz: `src/lib/api/search.ts`, commit `2d54af2` i prethodna produkcijska browser provera.

## Preporučeni redosled rada

### P0 — završene poslovne odluke

1. **#58** — originalni Markov checkout ima prednost nad komentarom 80; implementirano.
2. **#59** — duplo veći font uz horizontalni skrol; implementirano.
3. **#65** — najniža javno prikazana loyalty cena u title-u; implementirano.

### P1 — reprodukovati klijentske scenarije

1. **#88** sa ista tri SKU-a i njihovim stvarnim podacima.
2. **#90** sa tačnim brojem naloga i dugmetom koje Marko koristi.
3. **#106** sa realnom incoming zalihom, ne samo sintetičkim unit redovima.
4. **#95/#96/#99** uraditi realni private-storage upload smoke test posle deploya.

### P2 — zatvoriti prijem dokumentima i adminom

- #30/#113: stvaran email sa garantnim listom;
- #31: vizuelno odobren PDF porudžbenice;
- #62: Search Console i SERP reindex;
- #92: dve realne courier pošiljke i etikete;
- #114: produkcijski draft/preview/publish/rollback test.

### P3 — razbiti #102

Urađeno u `BACKLOG.md`: šest odvojenih stavki umesto jednog večito „nije testirano“ komentara.

## Važna napomena o dostupnosti robe

Vercel Production trenutno koristi `ENFORCE_WEB_AUTO_AVAILABILITY=false`. Ne treba ga uključivati dok DC lager nije uvezen i auditovan; bezbedan rollback je vratiti `false` i redeployovati.

Praktično, postoje „dve kutije“: DC kutija se puni iz CSV/XLSX i može ručno da se koriguje, a Rabalux kutija dolazi iz dobavljačkog stanja i čuva sigurnosnu rezervu. Međutim, interno uputstvo još pominje svežinu od 30 minuta, dok trenutni Rabalux kod koristi nedeljni fajl sa drugačijim prozorom svežine. To treba formalno usaglasiti sa klijentom pre nego što se strogo automatsko dostupno stanje uključi za ceo web.

## Tehnička verifikacija ovog audita

- Kompletni unit testovi: **161 fajl, 798 testova, svi prošli**.
- Mobile search Playwright: **7/7 prošlo** na 360/390/430 px.
- Novi izolovani E2E acceptance: admin preference **1/1**, WEB izmena porudžbine **1/1**, reklamacije registrovanog i gost kupca **2/2**, mobilni checkout **1/1** na 390 × 844 px. Sve privremene schema-e su obrisane; private storage i email provajder bili su isključeni.
- Lint svih promenjenih aplikacionih i test fajlova: **uspešno**.
- `npm run build`: **uspešno** na Next.js 16.2.11; TypeScript, 83 statičke stranice i sve rute generisani bez greške.
- Aplikacioni kod je menjan za #55, #58, #59, #65, #89 i #95/#96, uz kompatibilnost Prisma 7 advisory lock-a; #102 je razbijen u `BACKLOG.md`. Izmene još nisu commitovane niti deployovane.

Zaključak: projekat je tehnički u buildable stanju. Za 58, 59 i 65 više nema nerešene poslovne odluke; devet preostalih implementiranih tačaka i dalje zahteva spoljno podešavanje, realne podatke ili Markovu vizuelnu potvrdu pre oznake „gotovo“.
