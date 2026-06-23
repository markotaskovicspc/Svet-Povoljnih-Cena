# ERP Plan v1 - Faza 1 MVP: Admin Panel + Backend

## Summary

Dizajn je završen i zaključan. U Fazi 1 se ne rade UI redizajn, vizuelni identitet, CSS refaktor, novi layout ili responsive promene, osim minimalnih popravki ako backend podaci tehnički polome postojeći ekran.

Plan pokriva samo admin panel, backend, bazu, XML podatke, checkout logiku, Raiffeisen kartično plaćanje, osnovne email potvrde i dve kurirske službe. ERP dokument se koristi samo za delove koji direktno ulaze u Fazu 1: baneri, promo traka, navigacija/tabovi, homepage sekcije, kategorije, XML feed, pregled porudžbina i kurirski nalozi.

## Radni Paketi

### 0. Stabilizacija baze i konfiguracije

- Proveriti da baza ima sve tabele za Fazu 1:
  - proizvodi
  - kategorije
  - akcije
  - baneri
  - promo traka
  - tabovi
  - homepage slotovi
  - korisnici
  - porudžbine
  - plaćanja
  - email log ako se koristi
  - shipment/courier statusi
- Popraviti nedostajuće migracije za email i courier module pre bilo kakvog testiranja integracija.
- Napraviti non-secret checklistu env vrednosti:
  - Supabase
  - javni URL sajta
  - Raiffeisen/payment gateway
  - email provider
  - dve kurirske službe
  - cron/API secrets
- Zabraniti hardkodovanje cena dostave, payment opcija i kurirskih pravila u checkout backendu.
- Stvarne lozinke, API ključevi, bankarske tajne i privatni tokeni ne smeju biti upisani u ovaj dokument.

### 1. Admin CMS za homepage, banere, tabove i promo

- Baneri moraju podržati:
  - glavni banner sa više slika
  - dodatne bannere
  - status aktivno/neaktivno
  - redosled
  - link
  - desktop/mobile sliku ako postoje polja
  - brisanje
  - jasnu oznaku placement-a
- Glavni banner mora biti jasno razlikovan od običnih bannera, jer jedini sadrži više slika.
- Admin mora prikazati preporučene dimenzije slika za upload.
- Promo traka mora podržati:
  - tekst
  - link
  - početak važenja
  - kraj važenja
  - aktivno/neaktivno stanje
  - postavljanje za današnji dan
  - validaciju protiv preklapanja perioda
  - countdown podatak za poslednja 3 dana
- Tabovi/navigacija moraju podržati:
  - osnovne linkove
  - redosled
  - sprečavanje duplog redosleda
  - dropdown strukturu ako je podržana postojećim modelom
  - četiri mobile taba iz akcija ili landing sekcija
- Homepage slotovi moraju podržati:
  - izbor redova iz akcija ili landing sekcija
  - prvi i drugi red posle glavnog bannera
  - banner posle drugog reda
  - treći i četvrti red
  - banner posle četvrtog reda
  - peti i šesti red
  - skrivanje praznih slotova bez praznog prostora na sajtu
- Piktogrami za Fazu 1 ostaju samo osnovno povezivanje sa tabovima/akcijama ako već postoji u adminu.
- Napredne pozicije piktograma po landing page-u ne širiti preko MVP-a.

### 2. Katalog backend i admin proizvoda

- Proizvodi moraju imati pouzdan izvor istine iz DB/XML-a:
  - naziv
  - kratak opis
  - SKU/bar-kod
  - cena
  - akcijska cena
  - dostupnost
  - kategorija
  - slike
  - osnovne dimenzije/težina ako utiču na dostavu
- Kategorije u adminu moraju podržati:
  - osnovni pregled
  - hijerarhiju
  - izmene
  - jasno razlikovanje top-level kategorija
- Akcije u adminu moraju podržati:
  - naziv
  - slug/link
  - period važenja
  - status aktivno/neaktivno
  - vezu sa proizvodima ili homepage sekcijama
- PDP backend mora vraćati:
  - ispravnu cenu
  - akcijsku cenu
  - dostupnost
  - galeriju
  - specifikacije
  - osnovne delivery informacije
- Delivery informacije na PDP-u ne smeju dolaziti iz hardkodovanih vrednosti kada postoje admin pravila dostave.
- XML polja i ručni admin override moraju biti jasno razdvojeni.
- Sledeći XML import ne sme obrisati namerne ručne korekcije bez kontrole.

### 3. XML feed za proizvode, cene, akcije i dostupnost

- Svaki dobavljač/feed mora imati:
  - feed URL
  - enabled/disabled status
  - JSON mapping iz XML polja u internu šemu
  - evidenciju poslednjeg importa
- Import mora pokriti:
  - proizvode
  - redovne cene
  - akcijske cene
  - dostupnost/lager
  - kategorije/grupe
  - slike ako postoje u feedu
  - dimenzije/težinu ako utiču na dostavu
- Validacija pre upisa mora proveriti obavezna MVP polja:
  - status artikla
  - dobavljač
  - kategorija/grupa
  - kratak naziv/opis
  - cena
  - dostupnost
  - bar-kod/SKU gde postoji
  - dimenzije/težina gde su potrebne
- Ako obavezno polje nedostaje ili je lošeg formata, import se zaustavlja.
- Greška importa mora prikazati:
  - red/proizvod
  - naziv polja
  - razlog greške
  - da li je import u potpunosti zaustavljen
- Import run mora prikazati:
  - status
  - vreme početka
  - vreme kraja
  - broj kreiranih proizvoda
  - broj ažuriranih proizvoda
  - broj deaktiviranih proizvoda
  - broj preskočenih proizvoda
  - listu grešaka
- Checkout ne sme prodati deaktiviran ili nedostupan proizvod osim ako je za taj status eksplicitno dozvoljena kupovina.

### 4. Search backend

- Pretraga mora raditi nad DB proizvodima.
- Statički fallback ne sme biti produkcioni izvor pretrage.
- Pretraga mora podržati:
  - naziv
  - deo naziva
  - SKU/bar-kod
  - postojeću fuzzy/trigram logiku ako je već aktivna
- Rezultati moraju poštovati:
  - status proizvoda
  - dostupnost
  - pravila vidljivosti
- API mora imati stabilan empty-state odgovor.
- Greška u pretrazi ne sme rušiti header/search UI.

### 5. Korpa i checkout backend

- Korpa mora podržati guest korisnika i registrovanog korisnika.
- Registrovani korisnik ne sme izgubiti artikle iz korpe posle login-a.
- Checkout mora validirati:
  - kupca
  - telefon
  - email
  - adresu
  - mesto
  - poštanski broj
  - način dostave
  - način plaćanja
  - stavke korpe
- Cene dostave i dostupne delivery opcije moraju se čitati iz admin delivery rules.
- Cene dostave ne smeju dolaziti iz hardkodovanih konstanti.
- Payment metode moraju se čitati iz `PaymentMethodConfig`.
- Kartica se prikazuje/aktivira samo kada je Raiffeisen konfiguracija validna.
- Kreiranje porudžbine mora biti transakciono:
  - order
  - order items
  - payment record
  - status event
  - stock/dostupnost update
  - voucher ako se koristi
- Checkout greške moraju biti jasne:
  - nevalidni podaci
  - promenjena cena
  - promenjena dostupnost
  - proizvod više nije dostupan
  - neuspešno plaćanje
  - neuspešno kreiranje porudžbine

### 6. Korisnici i osnovni nalog

- Registracija mora podržati:
  - email
  - lozinku
  - validaciju
  - email potvrdu ako je uključena
- Guest kupovina ostaje obavezna.
- Checkout ne sme forsirati registraciju.
- `/nalog` mora prikazati:
  - osnovne podatke korisnika
  - status email potvrde ako postoji
  - link ka korpi
  - link ka podršci/kontaktu
  - osnovni pregled porudžbina
- Pregled porudžbina u nalogu mora prikazati:
  - broj porudžbine
  - datum
  - status
  - ukupan iznos
  - payment status
  - osnovne stavke ili link na detalj
- Order history mora prikazivati samo porudžbine tog korisnika ili email-a.
- Ne sme biti curenja tuđih porudžbina ili ličnih podataka.

### 7. Admin pregled porudžbina

- Lista porudžbina mora prikazati:
  - broj porudžbine
  - datum
  - kupca
  - email
  - telefon
  - mesto
  - ukupan iznos
  - status porudžbine
  - status plaćanja
  - status dostave
- MVP filteri:
  - status
  - datum/period
  - payment method/status
  - courier/shipment status ako postoji
- Klik na broj porudžbine otvara detalj.
- Detalj porudžbine mora prikazati:
  - podatke kupca
  - adresu
  - kontakt
  - stavke
  - količine
  - cene
  - ukupne iznose
  - payment status
  - shipment status
- Admin može promeniti osnovni status porudžbine.
- Promena statusa može poslati email kupcu ako je opcija uključena.
- ERP kolone vezane za Ananas, VP/INO, SEF, fiskalizaciju i fakturisanje se ne uvode u Fazu 1.

### 8. Osnovni admin za sadržaj i operacije

- Admin forme moraju prikazivati greške korisniku.
- Server action ne sme tiho propasti.
- Role guard ostaje obavezan za admin module.
- Osnovni admin moduli u Fazi 1:
  - baneri
  - promo traka
  - tabovi
  - početna
  - kategorije
  - proizvodi
  - akcije
  - XML import
  - porudžbine
  - plaćanje
  - dostava
  - osnovni tekstovi
- Module za Viber, oglase, napredne reklamacije, loyalty i velike ERP operacije ne uključivati u Fazu 1 plan.

### 9. Raiffeisen kartično plaćanje

- Implementirati adapter prema stvarnom Raiffeisen ugovoru.
- Postojeći WSPay kod koristiti samo ako je to zvanični procesor iz Raiffeisen konfiguracije.
- Payment flow mora pokriti:
  - create order
  - start payment
  - redirect ili form submit
  - success return
  - failed return
  - cancel return
  - webhook/callback ako postoji
  - idempotentnu obradu callback-a
- Payment record mora čuvati:
  - provider
  - transaction/reference id
  - status
  - iznos
  - vreme
  - raw provider metadata bez osetljivih kartičnih podataka
- Checkout mora ažurirati order/payment status posle uspeha, neuspeha ili otkazivanja.
- Admin mora prikazati status plaćanja.
- Kartično plaćanje ostaje disabled ako env/config nije kompletan.

### 10. Email potvrde

- Podesiti produkcioni/test email provider.
- Obavezan email:
  - potvrda porudžbine nakon uspešne kupovine
- Poželjni emailovi ako već postoje u toku:
  - potvrda registracije
  - potvrda email adrese
  - reset lozinke
  - promena statusa porudžbine
- Email potvrda porudžbine mora sadržati:
  - broj porudžbine
  - kupca
  - stavke
  - ukupan iznos
  - način plaćanja
  - način dostave
  - kontakt podrške
- Slanje emaila ne sme oboriti porudžbinu.
- Greška slanja mora biti logovana za admin/dev proveru.

### 11. Dve kurirske službe

- Default implementaciona pretpostavka iz trenutnog koda:
  - MyGLS/GLS
  - X Express
- Ako klijent potvrdi druge kurire, plan integracije se prilagođava stvarnim API-jima tih kurira.
- Za oba kurira definisati:
  - credentials
  - enabled flag
  - service rules
  - gradove/zone
  - cene
  - pickup flow
  - label flow
  - status sync
- Admin dostava mora omogućiti pravila cena i dostupnosti po tipu dostave/proizvodu/gradu u meri postojećeg modela.
- Admin detalj porudžbine mora omogućiti:
  - kreiranje pošiljke
  - prikaz tracking broja
  - prikaz labela ako API podržava
  - prikaz statusa
  - ručni status sync ako je API dostupan
  - prikaz greške ako API poziv ne uspe
- ERP “nalozi za preuzimanje” se u Fazi 1 svode na osnovni courier shipment/pickup flow za web porudžbine.
- VP/INO i magacinski ERP proces nisu deo Faze 1.
- Statusi kurira se čuvaju u shipment event istoriji.
- Kurirski statusi se mapiraju na osnovni order status kad je bezbedno.

## Public Interfaces / Data Contracts

- Checkout API prima validirane customer, address, delivery, payment i cart stavke.
- Server ponovo računa cene, dostavu i dostupnost.
- Payment provider adapter mora imati jedinstven interfejs:
  - start payment
  - verify return/callback
  - map provider status
- Courier adapter mora imati jedinstven interfejs:
  - create shipment
  - sync status
  - parse webhook/callback
  - expose label/tracking
- XML mapping ostaje supplier-specific JSON.
- XML import rezultat mora biti strukturisan i čitljiv u adminu.
- Customer account order query mora biti scoped na trenutno ulogovanog korisnika.

## Test Plan

- `npm run lint`
- `npx prisma validate`
- `npm run build`
- DB smoke:
  - sve Faza 1 tabele postoje
  - Prisma schema se slaže sa bazom
- Admin smoke:
  - baneri čuvaju izmene
  - promo traka čuva izmene
  - tabovi čuvaju izmene
  - homepage slotovi čuvaju izmene
  - akcije čuvaju izmene
  - proizvodi čuvaju izmene
  - kategorije čuvaju izmene
  - payment config čuva izmene
  - dostava čuva izmene
  - XML import može da se pokrene
- XML tests:
  - valid feed import
  - invalid required field
  - bad format
  - unavailable product
  - action price update
- Checkout tests:
  - guest order
  - registered order
  - unavailable product
  - changed price
  - delivery rule
  - disabled payment method
- Payment tests:
  - Raiffeisen success
  - Raiffeisen fail
  - Raiffeisen cancel
  - duplicate callback
  - admin payment status
- Email tests:
  - order confirmation success
  - provider failure logging
- Courier tests:
  - create shipment
  - label/tracking
  - status sync
  - API failure
  - admin error display for both couriers
- Regression smoke:
  - postojeći dizajn se ne menja
  - backend podaci ne ruše postojeće stranice
  - nema layout promene osim ako je nužna tehnička popravka

## Assumptions

- Dizajn je završen i ne menja se.
- Faza 1 je samo admin panel, backend, podaci i integracije za dogovoreni ecommerce MVP.
- Raiffeisen kartično plaćanje je obavezno.
- Procesor kartičnog plaćanja se potvrđuje iz bankarske dokumentacije.
- Dve kurirske službe su MyGLS/GLS i X Express dok klijent ne potvrdi drugi par.
- Fiskalizacija nije deo Faze 1 osim ako se naknadno eksplicitno vrati u dogovor.
- Viber, Google/Meta oglasi, loyalty, napredne reklamacije, Ananas, VP/INO, nabavka, COGS, magacini i veliki ERP reporting nisu deo ovog plana.
