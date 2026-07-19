# Izveštaj o statusu i spremnosti za objavu

Datum: 19. jul 2026.
Projekat: Svet povoljnih cena

## 1. Pregled projekta

Platforma ima razvijen javni sajt, korisničke naloge, korpu i checkout,
administraciju, katalog, plaćanja, dostavu, fiskalizaciju, reklamacije,
marketing i izveštavanje. Tehnička osnova je ozbiljna i aktuelna verzija se
uspešno gradi za produkciju.

Trenutni zaključak je **NO-GO za otvaranje realnih porudžbina**. Glavni razlog
nije opšta nestabilnost aplikacije, već to što nijedan aktivan artikal trenutno
ne ispunjava uslove za bezbednu kupovinu, a pojedine produkcione integracije i
operativne procedure još nemaju završenu potvrdu.

## 2. Završeni radovi

- Pregledana je arhitektura, baza, javne i administrativne rute, API-ji,
  integracije, skladište fajlova, bezbednost i produkciona konfiguracija.
- Proverena je produkciona izgradnja aplikacije.
- Proverene su 31 glavna administrativna stranica.
- Proverene su uloge SUPER, CONTENT, OPS i ADS na desktopu i mobilnom prikazu.
- Testirane su kartice proizvoda sa jednom, više i bez fotografije.
- Uklonjen je veliki broj ponovljenih upita na stranici pretrage.
- Smanjena je količina podataka fotografija na listinzima, uz zadržavanje svih
  fotografija na stranici proizvoda.
- Dodata je automatska zaštita od povratka problema sa prvom fotografijom.
- Ograničeni su i zaštićeni javni zahtevi za preporuke i učitavanje proizvoda.
- Ispravljeni su lint i nestabilni E2E testovi.

## 3. Funkcionalnosti koje trenutno rade

- Javni sadržaj, kategorije, pretraga, stranice proizvoda i pravne stranice se
  otvaraju.
- Prva fotografija proizvoda se prikazuje bez klika; kartice imaju odvojeno
  stanje galerije i ispravan prikaz kada fotografija nedostaje.
- Zaštićene korisničke i administrativne stranice pravilno preusmeravaju
  neprijavljene korisnike.
- Administrativne stranice i mobilni meni se pravilno učitavaju.
- Serverske provere uloga štite direktne URL-ove i API-je.
- Bezbednosna zaglavlja, RLS pravila baze i privatni fajlovi su pravilno
  postavljeni.
- Newsletter pravilno prikazuje i uspeh i grešku.
- Produkcioni build, lint i svih 30 unit testova prolaze.
- Provera npm zavisnosti nije pronašla poznate produkcione ranjivosti.

## 4. Sprovedeno testiranje

- Desktop i mobilni Chromium prikaz.
- Javni listing, pretraga, proizvod, povratak u browseru i responsive prikaz.
- Autentifikovane admin stranice i četiri administrativne uloge.
- Zaštita korisničkih, admin, cron i API ruta.
- Provera podataka i spremnosti kataloga u bazi.
- Provera migracija, RLS pravila i pristupa Supabase tabelama.
- Provera produkcionih HTTP zaglavlja i osnovnih performansi.
- Automatizacija: 30/30 unit testova; 4/4 dostupna desktop/mobilna E2E testa.

Nisu izvršene realne naplate, slanje robe, izdavanje fiskalnog računa, refund,
masovno slanje poruka ili brisanje poslovnih podataka. To mora da se uradi kao
kontrolisan, označen acceptance test sa odobrenim nalozima.

## 5. Problemi koji se trenutno rešavaju

1. Svih 209 aktivnih artikala nema kompletne dimenzije. Zbog toga je kupovina
   pravilno blokirana. Jedini artikal sa zalihom ima 9 komada, ali takođe nema
   kompletne dimenzije.
2. Za 68 artikala nedostaje fotografija.
3. Produkciona provera prijavljuje šest obaveznih grešaka: MyGLS kontakt ime i
   telefon, MyGLS odobrenje, X Express odobrenje, BADI lokacija i BADI
   odobrenje.
4. Potrebno je razjasniti 14 neuspešnih email poruka, dve neuspešne MyGLS
   pošiljke i jedan neuspešan fiskalni zapis.
5. Početna strana je i dalje spora u nekesiranom lokalnom testu i zahteva
   dodatnu optimizaciju i test opterećenja.

## 6. Preostali tehnički zadaci

- Završiti katalog koji ide u prvu objavu.
- Izvršiti kompletan test porudžbine: plaćanje/COD, zaliha, dostava, račun,
  email, status, povrat i refundacija.
- U staging okruženju testirati sve ključne admin izmene i njihov audit trag.
- Potvrditi email domen, webhooks, bounce/complaint obradu i šablone.
- Potvrditi kurirske i fiskalne naloge.
- Uključiti i testirati backup/PITR, restore proceduru, uptime i sistemska
  upozorenja.
- Proveriti produkcioni domen, DNS, SSL i sve callback/webhook adrese.
- Izvršiti finalni CI bez preskočenih kritičnih testova i test opterećenja.

## 7. Informacije potrebne od klijenta

- Kompletne dimenzije, fotografije, cene, zalihe i rokovi isporuke za artikle
  koji se objavljuju.
- MyGLS kontakt osoba i telefon, kao i odobrenje produkcionog rada.
- Potvrda X Express produkcionog rada.
- BADI fiskalna lokacija i potvrda fiskalnog provajdera/računovođe.
- Potvrda IPS/RaiAccept naloga ukoliko se nude elektronska plaćanja.
- Odobren email domen i DNS pristup.
- Javni telefon podrške, radno vreme, adresa magacina i povrata.
- Potvrđeni podaci firme i pravno odobreni uslovi, privatnost, kupovina,
  isporuka, reklamacije i povrat.
- Produkcioni domen/hosting pristup i odgovorna osoba za backup, monitoring i
  incidente.
- Imenovane osobe za administraciju sadržaja, operative, oglasa, povrata i
  reklamacija.

## 8. Uslovi za produkcionu objavu

Pre objave moraju postojati:

- najmanje odobreni artikli koji mogu da se kupe;
- nula grešaka u produkcionoj proveri okruženja;
- uspešan kompletan označeni test jedne prodaje i povrata;
- uspešan test emaila, dostave i fiskalizacije;
- potvrđen backup i restore;
- aktivan monitoring i upozorenja;
- završena pravna i poslovna potvrda sadržaja;
- finalni test bez preskočenih kritičnih scenarija.

## 9. Preporučeni sledeći koraci

1. Klijent i tim za katalog popunjavaju mali, jasno definisan launch asortiman.
2. Tehnički tim rešava šest produkcionih konfiguracionih grešaka.
3. U staging okruženju se sprovodi admin i puna transakciona acceptance sesija.
4. Podešavaju se backup, monitoring i produkcioni domen.
5. Radi se završni test opterećenja i release-gate provera.
6. Nakon dokumentovanih rezultata donosi se nova odluka o objavi.

## 10. Zaključak o spremnosti

Procena spremnosti je **55/100**.

Platforma je blizu faze kontrolisane produkcione pripreme, ali trenutno nije
bezbedno otvoriti realne porudžbine. Kada katalog, šest produkcionih grešaka,
kompletan prodajni test, backup/monitoring i pravna potvrda budu završeni,
status može da se promeni u **CONDITIONAL GO**, a zatim u **GO** posle uspešne
finalne provere.
