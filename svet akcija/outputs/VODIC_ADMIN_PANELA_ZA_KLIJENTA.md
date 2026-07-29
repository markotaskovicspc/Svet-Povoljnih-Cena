# Vodič kroz admin panel za sastanak sa klijentom

Datum pregleda: 21. jul 2026.

Ovaj vodič je napravljen prema aktuelnoj `main` verziji aplikacije. Obuhvata stavke koje se vide u meniju, zajedničke ERP komande, detalje proizvoda, narudžbine i porudžbenice, kao i nekoliko direktnih administrativnih stranica koje postoje, ali nisu u glavnom meniju.

## 1. Najvažnija poruka pre početka demonstracije

Klijentu bih na početku rekao ovako:

> „Proći ćemo kroz ceo panel i proveriti svaku funkciju, ali nećemo nasumično pritiskati dugmad koja šalju dokumente, menjaju lager, izdaju fiskalni račun, vraćaju novac ili šalju podatke kuriru. Takve radnje testiramo samo na test zapisu i, gde je potrebno, u sandbox okruženju provajdera.“

Praktična podela radnji:

- **Bezbedne radnje:** otvaranje stranica, pretraga, filteri, sortiranje, menjanje prikaza kolona, pregled istorije, preview i Excel izvoz.
- **Kontrolisane izmene:** kreiranje test zapisa, izmena teksta, isključivanje test stavke, promena redosleda i dodavanje test fotografije.
- **Poslovno osetljive radnje:** promena cena, lagera, statusa porudžbine, načina plaćanja, aktiviranje feeda ili kampanje.
- **Spoljne/finansijske radnje:** fiskalizacija, refundacija, IPS povraćaj, slanje dobavljaču, prijem robe, kurirski nalog, newsletter/Viber slanje i stvarni XML/Rabalux import.
- **Nepovratne radnje:** pojedina hard brisanja i rollback. Njih raditi samo na jasno označenom test zapisu ili u test okruženju.

## 2. Ko vidi koje stranice

Panel ima četiri uloge:

- **Super admin** vidi i koristi sve.
- **Sadržaj** uređuje početnu, tekstove, banere, kategorije, proizvode, cene, promocije i QA objave.
- **Operativa** radi sa dobavljačima, nabavkom, zalihama, narudžbinama, dostavom, plaćanjem, fiskalizacijom, reklamacijama i integracijama.
- **Marketing** radi sa newsletterom, Viberom, oglasima, posetama i izveštajima.

Ako klijent ne vidi neku stavku, to ne znači automatski da stranica ne radi. Prvo treba proveriti ulogu njegovog naloga. Neovlašćena stranica vraća korisnika na kontrolnu tablu i prikazuje poruku da nema ovlašćenje.

## 3. Dugmad koja su stalno prisutna

### Mobilni meni

Dugme sa tri crte otvara bočni meni na telefonu ili užem ekranu. Klik na neku stavku otvara izabranu stranicu i zatvara meni.

### SPC admin

Naziv „SPC admin“ na vrhu levog menija vraća na kontrolnu tablu.

### Stavke levog menija

Svaka stavka otvara odgovarajuću administrativnu stranicu. Aktivna stranica je vizuelno označena.

### Otvori prodavnicu →

Otvara javnu prodavnicu u novom tabu. Korisno je posle izmene sadržaja proveriti kako promena izgleda kupcu.

### Odjava

Odjavljuje trenutnog administratora i vraća ga na admin prijavu.

### Breadcrumb linkovi: Admin / ERP / ...

To su linkovi iznad naslova stranice. Služe za brz povratak na prethodni nivo bez korišćenja browser Back dugmeta.

## 4. Preporučen redosled zajedničkog testiranja

Ovo je najbezbedniji i najjasniji scenario za sastanak.

1. Prijaviti se test ili Super admin nalogom.
2. Na kontrolnoj tabli objasniti četiri glavne brojke i proveriti da se podaci učitavaju.
3. Otvoriti javnu prodavnicu u novom tabu, da se kasnije mogu porediti izmene.
4. Proći kroz stranice sadržaja bez brisanja postojećih poslovnih podataka.
5. Napraviti jedan test CMS tekst, test promo poruku ili test baner sa rečju `TEST` u nazivu; ostaviti ga neaktivnim.
6. U ERP-u otvoriti **Artikli**.
7. Kliknuti **Unos novog**. Panel automatski pravi neobjavljen artikal sa šifrom oblika `NOV-2026-00001` i otvara njegov detalj.
8. U naziv staviti, na primer, `TEST KLIJENT 2026-07-21`; zadržati status `UZ`/neobjavljen i ne uključivati „Aktivan“.
9. Dopuniti minimalna polja i kliknuti **Sačuvaj izmene**.
10. Vratiti se na Artikle, pronaći test artikal i kliknuti **Excel**. Tako se proverava izvoz trenutnog prikaza.
11. Za uvoz napraviti posebnu malu XLSX datoteku sa kolonama `SKU`, `Naziv`, `Opis`, `MPC`, `Status` i `Zalihe`. ERP izvoz je izveštaj i nije garantovano isti format kao import fajl.
12. Otvoriti **Excel unos**, izabrati fajl i kliknuti **Proveri i uvezi**.
13. Proveriti da se izmena vidi na test artiklu. Uvoz radi „upsert“ po SKU-u: postojeći SKU ažurira, novi SKU kreira.
14. Izabrati test artikal i kliknuti **Arhiviraj**. Ovo ga ne briše fizički: postavlja status `ARH`, isključuje ga i upisuje datum arhiviranja.
15. Ponovo uvesti isti SKU sa statusom `UZ` ili `SP`, u zavisnosti od testa. Uvoz uklanja datum arhiviranja i ponovo ažurira zapis. Za potpuno bezbedan test ostaviti `UZ`, jer taj status nije aktivan na prodavnici.
16. Proveriti Audit log: treba da postoji trag uvoza, izmene i arhiviranja.
17. Sve spoljne radnje pokazati i objasniti, ali ih izvršavati samo nad posebnom test porudžbinom i uz potvrdu da su fiskalni, email, kurirski i payment provajder u sandbox režimu.
18. Na kraju obrisati samo test sadržaj za koji postoji potvrda ili ga ostaviti neaktivnim. Test artikal je bolje ostaviti arhiviran nego fizički brisati.

Važno za import/export test:

- XLSX import prihvata najviše 8 MB.
- Obavezne kolone su `SKU/Šifra`, `Naziv`, `Opis` i `MPC`.
- Podržani statusi su `SP`, `IT`, `DTZ`, `DOB`, `ARH` i `UZ`.
- Ako je makar jedan red neispravan, nijedan red iz fajla se ne upisuje. To je „atomski“ uvoz.
- Duplirani SKU ili bar kod u samom fajlu se prijavljuje kao greška.
- Bar kod koji već pripada drugom SKU-u se odbija.
- Dobavljač iz fajla mora već postojati pod tom šifrom.
- Excel izvoz poštuje trenutnu pretragu, filtere, sortiranje i vidljive kolone i izvozi do 10.000 redova.
- ERP izvoz nije isto što i import šablon. Za kružni test treba napraviti fajl sa tačno podržanim import zaglavljima.

## 5. Stranica po stranica

### 5.1 Admin prijava

Polja:

- **E-pošta** — administratorska email adresa.
- **Lozinka** — lozinka tog administratora.

Dugme:

- **Prijavi se** — proverava podatke. Ako su ispravni i admin nalog je uključen, otvara traženu admin stranicu. Ako nalog nije admin, nije aktivan ili je lozinka pogrešna, prijava se odbija.

### 5.2 Kontrolna tabla

Ova stranica nema posebna akciona dugmad. Ona je pregled stanja:

- **Promet danas** — zbir današnjih neotkazanih narudžbina.
- **Promet u mesecu** — zbir od prvog dana meseca.
- **Otvorene narudžbine** — statusi KREIRANO, POTVRDJENO i U_PRIPREMI.
- **Reklamacije / komentari** — aktivne reklamacije i nepregledane poruke kupaca.
- **Top proizvodi** — najprodavaniji artikli u tekućem mesecu.
- **Niske zalihe** — aktivni artikli sa stanjem 2 ili manje.
- **Status feed-a** — poslednjih pet XML importa.

Ako baza nije povezana, prikazuje se preview upozorenje umesto realnih podataka.

## 6. Sadržaj

### 6.1 Početna

Stranica ima šest fiksnih promo pozicija posle glavnog banera. Svaka kartica je nezavisna.

Kontrole u svakoj kartici:

- **Tip izvora** — bira da li sekcija povlači proizvode iz administrativne akcije ili iz definisane landing stranice.
- **Broj proizvoda** — koliko proizvoda se prikazuje; dozvoljeno je 1–24.
- **Akcija** — bira konkretnu akciju kada je tip izvora „Akcija“.
- **Landing page** — bira gotovu kolekciju/odredište kada je izvor „Landing page“.
- **Naslov sekcije** — opcioni naslov koji zamenjuje standardni naslov.
- **Aktivno / Prikaži ovu sekciju na početnoj** — uključuje ili skriva tu sekciju.
- **Sačuvaj sekciju** — snima samo tu promo poziciju. Ostalih pet kartica se ne menja.

Klijentu objasniti: izbor izvora određuje **koji proizvodi** ulaze u red, a broj proizvoda određuje **koliko** njih se vidi.

### 6.2 Tekstovi / Sadržaj

Služi za pravne i servisne stranice kao što su uslovi, pomoć ili politika privatnosti.

Dugmad i linkovi:

- **Nova stranica** — otvara prazan editor za novi tekst.
- **Klik na postojeću stranicu** — otvara njen editor.
- **Obriši** — briše izabranu CMS stranicu. U aktuelnom interfejsu nema dodatnog confirm prozora, zato ga koristiti samo na test stranici.
- **Sačuvaj stranicu** — kreira ili ažurira slug, naslov, uvodni tekst, glavni tekst, SEO naslov/opis i stanje „objavljeno“.

Polja jednostavno:

- **Slug** je deo URL-a.
- **Lead tekst** je kratak uvod.
- **Tekst stranice** je glavni sadržaj.
- **SEO naslov/opis** se koriste za pretraživače i deljenje linka.
- **Published/objavljeno** određuje da li stranicu posetilac može da vidi.

### 6.3 Baneri

Postoje tri fiksne pozicije: glavni carousel i dva pojedinačna banera između redova proizvoda.

Dugmad:

- **↑** — pomera slajd glavnog carousela jednu poziciju naviše.
- **↓** — pomera slajd naniže.
- **Izmeni** — otvara editor ispod konkretnog banera.
- **Obriši** — traži potvrdu, pa nepovratno briše baner.
- **Dodaj slajd u carousel** — dodaje novi slajd u glavni baner.
- **Dodaj/zameni baner** — dodaje baner na pojedinačnoj poziciji; na toj poziciji praktično upravlja slikom koja se prikazuje.
- **Resetuj** — vraća polja te forme na vrednosti koje su bila učitana kada je forma otvorena. Ne vraća već sačuvanu stariju verziju iz baze.
- **Dodaj** — kreira novi baner.
- **Sačuvaj** — snima izmene postojećeg banera.

Važna polja:

- **CTA labela** je tekst na dugmetu banera, npr. „Pogledaj ponudu“.
- **CTA link** je odredište tog dugmeta.
- **Desktop/mobilna slika** omogućavaju prilagođenu sliku za širinu ekrana.
- **Počinje/Završava** ograničavaju period prikaza.
- **Aktivan** uključuje ili skriva baner.

### 6.4 Promo traka

To je uska traka iznad zaglavlja prodavnice. Više aktivnih poruka može da se rotira.

Dugmad:

- **Nova poruka** — otvara prazan editor.
- **Klik na postojeću poruku** — otvara izmenu.
- **Obriši** — odmah briše poruku; nema dodatni confirm prozor.
- **Dodaj** — kreira novu poruku.
- **Sačuvaj** — čuva izmenu.

Polja:

- tekst poruke;
- opcioni link;
- početak i kraj važenja;
- aktivno/neaktivno.

### 6.5 Navigacija

Upravlja sa deset fiksnih desktop pozicija glavnog menija.

Dugmad i klikovi:

- **Klik na red/poziciju** — učitava tu stavku u desni editor.
- **Nova navigacija / slobodna pozicija** — editor bez postojećeg ID-a kreira novu stavku.
- **×** — briše stavku menija. U aktuelnom interfejsu nema dodatne potvrde.
- **Dodaj** — kreira novu stavku.
- **Sačuvaj** — menja postojeću stavku.

Polja:

- **Naziv** je tekst koji kupac vidi.
- **Link** se bira iz postojeće kategorije ili landing strane.
- **Ikona** je opciona.
- **Redosled** je pozicija 1–10; zauzeta pozicija ne može da se izabere.
- **Aktivan** odlučuje da li se stavka vidi u meniju.

### 6.6 Kategorije

Prikazuje stablo kategorija i podkategorija.

Dugmad i klikovi:

- **Nova kategorija** — otvara praznu formu.
- **Klik na naziv kategorije** — otvara izmenu te kategorije.
- **×** — briše kategoriju; nema dodatni confirm. Ako postoje zavisni podaci, baza može odbiti brisanje.
- **Dodaj** — kreira kategoriju.
- **Sačuvaj** — čuva izmenu.

Polja:

- **Slug** može da ostane prazan; tada se pravi iz naziva.
- **Roditelj** određuje da li je kategorija glavna ili podkategorija.
- **Redosled** utiče na prikaz među kategorijama istog nivoa.
- **Slika URL** i **Opis** se koriste na kategorijskoj stranici.

### 6.7 Piktogrami

Piktogram je bedž proizvoda, npr. „Brza isporuka“ ili „Uštedi 20%“.

Dugmad:

- **Klik na karticu piktograma** — otvara izmenu.
- **Obriši** — briše piktogram bez dodatnog confirm prozora.
- **Dodaj** — kreira novi piktogram.
- **Sačuvaj** — čuva izmenu postojećeg.

Polja:

- **Kod** je interna jedinstvena oznaka.
- **Labela** je tekst za korisnika.
- **Ikona URL** je slika piktograma.

### 6.8 Landing strane

Ovo je ERP grid stranica. Pored svih zajedničkih ERP dugmadi opisanih u sledećem poglavlju ima:

- **Nova landing strana** — kreira novi nacrt sa privremenim nazivom i slugom.
- **Dodaj sekciju** — radi tek kada je izabrana najmanje jedna landing strana; svakoj izabranoj dodaje sledeću sekciju i vodi na pregled sekcija.
- **Obriši** — briše izabrane landing strane posle potvrde.

U režimu uređivanja mogu se menjati slug, naslov, lead, hero slika, SEO podaci, status i period prikaza.

### 6.9 Mobilni tabovi

Upravlja sa četiri jedinstvene mobilne pozicije.

Nema posebno komandno dugme za kreiranje ili brisanje. Dostupna su zajednička ERP dugmad, a u režimu uređivanja mogu se menjati pozicija, naziv, ikona i aktivnost. Odredište se na ovoj grid stranici samo prikazuje.

## 7. ERP radni prostor — dugmad koja se ponavljaju na svim ERP stranicama

### Otvori artikle

Na početnoj ERP stranici vodi direktno na matične podatke artikala.

### Kartica ERP modula

Klik na bilo koju karticu otvara taj modul. Oznaka „Operativno“ znači da je modul povezan; „Spoljna konfiguracija“ znači da nedostaje provider ili konfiguracija.

### Brza pretraga po vidljivim kolonama

Pretraga se primenjuje dok korisnik kuca. Pretražuju se samo trenutno vidljive kolone.

### Izbor kolone + Filter

Prvo se izabere kolona, zatim klikne **Filter**. Panel dodaje filter sa operatorom:

- sadrži;
- jednako / nije jednako;
- veće, veće ili jednako, manje, manje ili jednako;
- pre / posle za datum.

Ikonica kante uz filter uklanja samo taj filter.

### Checkbox u zaglavlju i checkbox pored reda

- Checkbox u zaglavlju bira ili skida sve trenutno prikazane redove.
- Checkbox pored reda bira samo taj red.
- Komande kao što su Arhiviraj, Obriši, Proknjiži ili Objavi rade nad izabranim redovima.

### Uredi podržana polja

Uključuje inline uređivanje. Mogu se menjati samo kolone za koje postoji bezbedno server mapiranje.

- Klik na ćeliju otvara unos.
- Enter ili izlazak iz polja snima izmenu.
- Escape zatvara izmenu tekstualne ćelije bez novog unosa.
- Boolean checkbox se snima odmah pri promeni.
- Nema posebnog dugmeta „Sačuvaj ceo red“.

### Završi uređivanje

Isključuje inline uređivanje da se spreče slučajne promene.

### Excel

Preuzima `.xlsx` sa trenutnom pretragom, filterima, redosledom i vidljivim kolonama, do 10.000 redova. To je poslovni izveštaj, ne nužno import šablon.

### Osveži podatke

Pojavljuje se kada su ćelije menjane. Ponovo učitava podatke iz baze i čisti lokalni brojač snimljenih izmena.

### Snimi pogled

Pita za naziv i čuva lični prikaz: vidljive kolone, njihov redosled i širine, pretragu, filtere i sortiranje. Ako ponovo upišete isti naziv, zamenjuje taj pogled.

### Dugme sa nazivom sačuvanog pogleda

Primeni snimljenu kombinaciju kolona, filtera, sortiranja i pretrage.

### Reset kolona

Vraća podrazumevane vidljive kolone i njihov redosled, briše ručno sortiranje i vraća standardne širine. Ne briše podatke iz baze.

### Klik na naziv kolone

Prvi klik sortira rastuće, drugi opadajuće, treći uklanja sortiranje.

### Ručica na desnoj ivici kolone

Prevlačenjem menja širinu kolone.

### Prevlačenje zaglavlja ili stavke u panelu Kolone

Menja redosled kolona.

### Checkbox u panelu Kolone

Prikazuje ili skriva kolonu. Skrivena kolona ne ulazi u brzu pretragu ni Excel dok je skrivena.

### Otvori

Postoji kod modula koji imaju detalj zapisa. Otvara detalj porudžbenice, narudžbine ili proizvoda.

### Prethodna / Sledeća

Menja stranu rezultata. Komande se odnose na redove izabrane u trenutnom prikazu; promena podataka ili strane može očistiti izbor.

### Onemogućeno dugme

Najčešća značenja:

- nije izabran nijedan red;
- komanda zahteva spoljnu konfiguraciju;
- druga komanda je trenutno u toku;
- funkcija je samo informativno prikazana, ali još nije povezana.

## 8. Posebna dugmad po ERP modulu

Zajednička dugmad iz prethodnog poglavlja važe za svaki modul. Ovde su samo dodatne poslovne komande.

### 8.1 Artikli

- **Unos novog** — automatski kreira neobjavljen test/nacrt artikal sa šifrom `NOV-godina-redni broj` i otvara detalj proizvoda.
- **Excel unos** — otvara XLSX import.
- **Arhiviraj** — traži izbor redova i potvrdu. Postavlja status `ARH`, isključuje artikal i upisuje datum arhiviranja; nije hard delete.

### 8.2 Šifarnici artikala

- **Nova vrednost** — pravi isključenu šifarsku vrednost tipa atribut. Posle toga se u gridu menja vrsta, vrednost, slug i aktivnost.

### 8.3 Dobavljači

- **Unos novog** — kreira dobavljača sa privremenim nazivom.
- **Brisanje** — posle potvrde fizički briše izabrane dobavljače; zavisni zapisi mogu sprečiti brisanje.

### 8.4 Nabavne cene

- **Brisanje** — nepovratno briše izabrane redove nabavnih cena posle potvrde.

### 8.5 Porudžbenice

- **Kreiraj novu** — pravi porudžbenicu u statusu „U obradi“ i otvara detalj.
- **Pošalji dobavljaču** — označene porudžbenice šalje/označava kao poslate; traži potvrdu.
- **Kreiraj prijemnicu** — knjiži prijem robe, dodaje robu na lager podrazumevanog magacina i traži potvrdu.
- **Otvori** — otvara detalj porudžbenice.

### 8.6 Porudžbenice po artiklima

- **Dodaj stavku** — prikazano je, ali onemogućeno; stavka se dodaje iz detalja konkretne porudžbenice.
- **Proveri pakovanja** — proverava da li je količina deljiva brojem komada u pakovanju i javlja problematične SKU-ove.

### 8.7 Ulazne fakture

- **Nova faktura** — pravi domaću ulaznu fakturu u nacrtu.
- **Proknjiži** — proverava neto + PDV = bruto, potrebne veze i kurs; zatim zaključava i knjiži izabrane fakture.

### 8.8 MP cene

- **Novi predlog cene** — pravi predloge za izabrane artikle.
- **Objavi cene** — objavljuje izabrane predloge i menja cenu koja se koristi na sajtu; obavezno proveriti izbor pre potvrde.

### 8.9 Cenovnici

- **Novi cenovnik** — pravi novi maloprodajni cenovnik sa automatskom šifrom i današnjim početkom važenja.

### 8.10 Akcijske cene proizvoda

Nema posebnih komandnih dugmadi. Cena, prioritet i period menjaju se kroz **Uredi podržana polja**.

### 8.11 Loyalty pravila

- **Novo pravilo** — pravi isključeno pravilo sa početnim popustom 5% i periodom od 30 dana.

### 8.12 Linearne promocije

- **Nova promocija** — pravi isključenu globalnu promociju od 5% i periodom od 30 dana.

### 8.13 Magacini

- **Novi magacin** — kreira neaktivan magacin sa automatskom šifrom `MAG-xx`.

### 8.14 Stanje po magacinima

Nema posebne komande. Stranica je pregled fizičkog, rezervisanog, raspoloživog i dolazećeg stanja.

### 8.15 Kretanja zaliha

Nema dugmeta za izmenu ili brisanje. To je namerno neizmenjiv trag prijema, prodaje, povrata, prenosa i popisa.

### 8.16 Popisi

- **Novi popis** — pravi nacrt popisa za aktivni podrazumevani magacin.
- **Proknjiži popis** — upisuje razlike na lager i zaključava izabrani popis; traži potvrdu.

### 8.17 Prodajni nalozi

- **Nova VP porudžbina** — kreira ručnu veleprodajnu porudžbinu sa privremenim podacima i otvara detalj.
- **Nova INO porudžbina** — isto za izvozni kanal.
- **Otvori** — otvara detalj porudžbine.

### 8.18 Otpremnice i interni prenosi

- **Nova otpremnica** — pravi nacrt iz aktivnog podrazumevanog magacina.
- **Proknjiži** — skida robu sa izvornog lagera; kod internog prenosa dodaje je odredišnom magacinu. Traži potvrdu.

### 8.19 Kurirska preuzimanja

- **Novi batch** — pravi nacrt grupe paketa za preuzimanje. Stvarna rezervacija ostaje isključena dok kurirski health check nije zelen.

### 8.20 Kupci

- **Novi kupac** — pravi privremeni zapis „Novi kupac“; kontakt i pol se zatim ručno dopunjavaju.

### 8.21 Partner API klijenti

- **Novi API ključ** — kreira isključenog partnera i prikaže puni ključ samo jednom. Ključ odmah treba bezbedno sačuvati; kasnije se vidi samo prefiks i hash.

### 8.22 Partner rezervacije

Nema posebnih komandi. To je pregled rezervacija zaliha partnera.

### 8.23 Integracije i konfiguracija

- **SEF sinhronizacija** — trenutno je onemogućena dok nedostaje kompletna SEF konfiguracija.
- **Ananas sinhronizacija** — trenutno je onemogućena dok nedostaje Ananas konfiguracija.

Stranica prikazuje razlog zbog kog dugme nije dostupno.

### 8.24 Interni računovodstveni registri

Nema komandnih dugmadi. To je izvedeni operativni pregled i nije označen kao zakonski odobren računovodstveni obrazac.

### 8.25 Neobjavljeni artikli

Nema posebnih komandi.

- **Otvori** vodi na detalj proizvoda.
- Kolona „Razlog blokade“ objašnjava šta nedostaje: opis, dimenzije, slika, cena, zaliha, kategorija ili aktivnost.

### 8.26 Heroji meseca

Nema posebnih komandnih dugmadi u ERP prikazu. Stranica prikazuje godinu, mesec, redosled, SKU i povezanu akciju.

### 8.27 Landing strane

Opisano je u odeljku Sadržaj: **Nova landing strana**, **Dodaj sekciju**, **Obriši**.

### 8.28 Sekcije landing strana

- **Obriši sekciju** — briše izabrane sekcije posle potvrde.
- Sadržaj sekcije, slika, pozicija i lista SKU-ova menjaju se inline.

### 8.29 Mobilni tabovi

Nema posebnih komandi; uređivanje ide inline.

### 8.30 Pozicije piktograma

Nema posebnih komandi. To je pregled četiri kontrolisane pozicije piktograma na akcijama i landing stranama.

### 8.31 Newsletter kampanje

- **Nova kampanja** — kreira newsletter nacrt sa privremenim naslovom i sadržajem.
- **Pošalji** — u aktuelnoj verziji je onemogućeno uz objašnjenje da email provider i marketing pošiljalac moraju proći health check.
- **Obriši nacrt** — briše samo izabrane kampanje u statusu DRAFT, posle potvrde.

### 8.32 Posete i konverzije

Nema posebnih komandi. Prikazuje samo događaje za koje je postojala analytics saglasnost.

### 8.33 Dnevnik reklamacija

Nema posebnih komandi. Odluka, rešenje, status i datumi menjaju se inline tamo gde je podržano.

### 8.34 ERP podešavanja

Nema posebnih komandi. Vrednost podešavanja menja se inline; ključ i audit podaci su samo za čitanje.

## 9. XLSX unos artikala

Dugmad:

- **Nazad na artikle** — vraća na listu artikala.
- **Izaberi datoteku** — otvara izbor lokalnog `.xlsx` fajla.
- **Proveri i uvezi** — prvo validira celu datoteku, a zatim u istoj atomskoj transakciji kreira ili ažurira artikle.
- Dok obrada traje piše **Provera i uvoz…** i dugme je onemogućeno da se isti fajl ne pošalje dva puta.

Ako postoji greška, prikazuje tabelu sa brojem reda, poljem i jasnim razlogom. Nijedan red se ne upisuje dok se sve greške ne isprave.

## 10. Detalj proizvoda

Ova stranica se otvara nakon **Unos novog**, preko QA pregleda ili direktnog linka.

### Osnovni podaci

- **Sačuvaj izmene** — snima naziv, opise, PDP informacije, cene, zalihe, dimenzije, loyalty podatke, rok isporuke i oznake.

Oznake:

- **Aktivan** — dozvoljava objavu ako su ispunjeni ostali uslovi.
- **Hero meseca** — uključuje artikal u hero logiku.
- **Novo** — prikazuje ga kao novitet.
- **Ograničena ponuda** — označava limitiranu ponudu.
- **Dok traju zalihe** — DTZ ponuda.
- **Dozvoljena montaža** — omogućava montažu kao opciju isporuke.
- **Google Merchant / Meta katalog** — uključuju proizvod u odgovarajući feed, uz ostale uslove spremnosti.

### Kategorije

- **Sačuvaj kategoriju** — menja glavnu vezanu kategoriju proizvoda na izabranu vrednost.

### Piktogrami

Na ovoj stranici se postojeći piktogrami samo prikazuju; nema dugmeta za dodelu ili uklanjanje.

### Dobavljač/Rabalux

Prikazuje se samo za odgovarajući Rabalux proizvod.

- **Sync samo ovog proizvoda** — zahteva razlog i tačno upisanu frazu `SYNC eksterni-ID`; sinhronizuje samo taj proizvod.
- **Retry samo neuspelog medija** — ponavlja obradu samo neuspelih slika/dokumenata tog proizvoda.

### XML zaštita polja

- Checkbox pored polja znači: „XML import ovo polje ne sme prepisati“.
- **Sačuvaj XML zaštitu** — snima izabrane zaštite.

### Mediji

Za svaku postojeću sliku:

- **Sačuvaj medij** — menja URL/storage putanju, thumb, card i PDP varijantu, redosled i alt tekst.
- **Obriši** — briše medij bez dodatnog confirm prozora.

Za novu sliku:

- **Izaberi fajl** — bira fotografiju za upload.
- Može se uneti i gotov **URL fotografije** umesto fajla.
- **Dodaj fotografiju** — dodaje medij. Potrebno je uneti fajl ili URL.

## 11. Detalj porudžbenice

Dugmad:

- **Preuzmi PDF** — generiše/preuzima PDF porudžbenice.
- **Pošalji dobavljaču** — šalje ili označava dokument kao poslat dobavljaču.
- **Kreiraj prijemnicu** — uz potvrdu prima robu, dodaje je na lager i preračunava COGS.
- **Sačuvaj zaglavlje** — snima dobavljača, datume, transport, valutu, paritet, trošak i napomenu.
- **OK** pored količine stavke — snima izmenjenu količinu tog reda.
- **Obriši** pored stavke — traži potvrdu i briše stavku.
- **Dodaj** u kartici Dodaj stavku — nalazi artikal po SKU-u i dodaje zadatu količinu; naziv i nabavni podaci se povlače automatski.
- **Nazad na pregled porudžbenica** — vraća na listu.

Kada je porudžbenica primljena, zaključana je za dalju izmenu stavki.

## 12. Pravila dostave

### Lista pravila

- **×** — briše pravilo dostave. Nema dodatni confirm prozor.
- **Dodaj** — kreira novo pravilo.

Pravilo može važiti:

- globalno;
- za kategoriju;
- za tačan proizvod;
- opciono samo za određeni grad.

Za svako pravilo unose se cene kurira, kamiona i montaže.

### X Express i MyGLS

- **Osveži X Express** — server-side preuzima/obnavlja lokalne šifarnike adresa, bez izlaganja kredencijala browseru.
- **Osveži MyGLS** — obnavlja paket shopove, lockere i lokacije za Srbiju.

### Gradovi

- **Uključi kamion** — dozvoljava kamionsku isporuku za grad.
- **Isključi kamion** — zabranjuje je za grad.

## 13. Vaučeri

Dugmad:

- **Novi vaučer** — otvara prazan editor.
- **Izmeni** — otvara postojeći vaučer; kod tada više ne može da se menja.
- **×** — briše vaučer bez dodatnog confirm prozora.
- **Dodaj** — kreira novi kod.
- **Sačuvaj** — čuva postojeći kod.

Polja:

- `PERCENT` daje procentualni popust;
- `FIXED` daje fiksni iznos;
- minimum korpe ograničava kada kod može da se koristi;
- početak/kraj određuju period;
- ukupan limit i limit po korisniku kontrolišu broj korišćenja;
- „Aktivan“ dozvoljava korišćenje.

## 14. Načini plaćanja

Za svaki metod postoji posebna kartica.

- **Prikaži u checkout-u** — uključuje ili isključuje metod za kupce.
- Ako provider nije poslovno prihvaćen/konfigurisan, checkbox je zaključan i panel prikazuje uslov.
- **Custom labela** — opcioni naziv koji kupac vidi umesto standardnog.
- **Napomena za kupca** — dodatno objašnjenje u checkout-u.
- **Sačuvaj** — uz potvrdu odmah menja vidljivost i tekst u checkout-u.

## 15. Fiskalizacija

### Filteri

- **Filtriraj** — primenjuje pretragu po porudžbini, kupcu ili SKU-u, dobavljaču, kategoriji, datumima i refundiranom stanju.
- Checkbox u zaglavlju bira sve vidljive nerefundirane redove.
- Checkbox pored reda bira pojedinačnu fiskalnu stavku.

### Ručna fiskalizacija

- **Ručna fiskalizacija** — otvara prozor za izbor porudžbine, stavki i načina plaćanja.
- Checkbox pored stavke bira šta ulazi na fiskalni račun.
- **Fiskalizuj** — traži potvrdu i poziva fiskalnog provajdera.
- **X/Zatvori** na dijalogu — zatvara prozor bez izvršenja.

### Refundacija

- **Refundiraj** na vrhu je aktivno tek kada je izabran barem jedan nerefundiran red.
- U prozoru se bira način vraćanja novca, magacin za povrat i identifikacija kupca.
- **Refundiraj** u dijalogu traži novu potvrdu, izdaje fiskalni refundacioni dokument i vraća robu u izabrani magacin.
- Identifikacija mora biti oblika `10:PIB`, `11:JMBG` ili `20:broj lične karte`.

Ovo ne testirati na stvarnoj prodaji bez dogovorenog test računa i sandbox fiskalnog okruženja.

## 16. Checkouti

- **Filtriraj** — traži po emailu, gradu, broju porudžbine ili ID-u sesije i filtrira Aktivne, Konvertovane i Napuštene.
- **Broj porudžbine** — kada checkout ima nastalu porudžbinu, otvara njen detalj.
- **Prethodna / Sledeća** — menja stranu rezultata.

Ova stranica ne menja checkout; služi za dijagnostiku gde su kupci odustali.

## 17. Reklamacije

Dugmad i linkovi:

- **Sve** i svaki status — filtriraju reklamacije.
- **Broj porudžbine** — vodi na pregled prodajnih naloga/narudžbinu.
- **Klik na fotografiju** — otvara potpisani privatni link pune fotografije u novom tabu.
- **Sačuvaj** — menja status reklamacije i upisuje internu napomenu; promena ulazi u istoriju.
- **Istorija statusa** — otvara/zatvara listu ranijih promena.

## 18. XML feed / Rabalux

Ovo je jedna od najosetljivijih stranica.

### Rabalux kontrola

- Izbor **Katalog sync / Stock sync / Media sync** određuje šta se proverava.
- **Napravi live preview** — preuzima/analizira trenutne dobavljačke podatke i pokazuje broj novih zapisa, izmena, predloga cena, deaktivacija, konflikata i medija. Ne treba ga mešati sa stvarnim izvršenjem.
- Posle preview-a se unosi razlog i tačna prikazana fraza.
- **Izvrši preview-ovanu akciju** — traži potvrdu i izvršava baš proverenu verziju akcije.

### Mapiranja i odobrenja

- **Mapiraj** — povezuje dobavljačku kombinaciju kategorije/tipa sa internom kategorijom.
- **Odobri / Odbij** — prihvata ili odbija novi dobavljački proizvod; razlog je obavezan.
- **Odobri cenu / Odbij** — prihvata ili odbija veliku promenu cene; razlog je obavezan.
- **Pokreni rollback** — zahteva razlog, tačnu frazu `ROLLBACK ID` i potvrdu. Pokušava da vrati samo polja koja posle tog batch-a nisu ponovo menjana.
- **Sačuvaj mesta preuzimanja** — čuva adresu i grad Rabalux lokacija preuzimanja.

### Ostali XML dobavljači

- **Osnovni podaci / Izmeni** — učitava dobavljača u desni editor.
- **Preview** — pokreće probni import bez primene promena.
- **Pokreni import** — traži potvrdu i stvarno može promeniti katalog, cene i zalihe.
- **Kreiraj** — dodaje novog dobavljača.
- **Sačuvaj** — menja dobavljača.

Rabalux feed adrese i autentikacija su zaključani u server konfiguraciji i ne prikazuju se u adminu.

## 19. Monitoring i backup

Ova stranica nema akciona dugmad. Ona prikazuje:

- da li baza radi i vreme odgovora;
- da li je spoljni monitoring povezan;
- trenutno stanje backup povezivanja;
- brojeve email, shipment, fiskalnih i background grešaka;
- Rabalux media/stale/approval/mapping stanje;
- spremnost spoljnih integracija i samo nazive nedostajućih env promenljivih.

Tajne vrednosti se nikada ne prikazuju.

## 20. Marketing

### 20.1 Newsletter kampanje

Ovo je ERP modul i koristi sva zajednička ERP dugmad.

- **Nova kampanja** — pravi nacrt.
- **Pošalji** — trenutno zaključano dok email konfiguracija ne prođe health check.
- **Obriši nacrt** — briše samo DRAFT kampanje posle potvrde.
- Uređivanje naslova, subjecta, tela, statusa i vremena zakazivanja ide preko **Uredi podržana polja**.

### 20.2 Viber kampanje

Audijencije:

- **Izmeni** — učitava publiku u editor.
- **Obriši** — traži potvrdu i nepovratno briše publiku.
- **Kreiraj / Sačuvaj** — kreira ili menja naziv i JSON filter.

Kampanje:

- **Izmeni** — učitava kampanju.
- **Obriši** — traži potvrdu i briše kampanju.
- **Kreiraj / Sačuvaj** — čuva publiku, naslov, tekst, sliku, CTA, status i vreme zakazivanja.

Promena statusa na zakazan/aktivan nije samo vizuelna; može pripremiti kampanju za pozadinsko slanje kada je provider konfigurisan.

### 20.3 Oglasi i feedovi

Za svaki kanal:

- **Sinhronizuj feed** — uključuje ili isključuje kanal.
- **Mesečni budžet** — informativno/poslovno podešavanje budžeta u RSD.
- **Sačuvaj** — snima kanal i budžet.

Tabela proizvoda:

- **Filtriraj** — traži SKU ili naziv.
- Dugme **✓** znači da je proizvod uključen u taj kanal; klik ga isključuje.
- Dugme **—** znači da nije uključen; klik ga uključuje.

Uključivanje proizvoda ne garantuje da će ući u feed: mora biti aktivan, neobrisan i imati sliku, uz ostale uslove feeda.

## 21. Analitika

### 21.1 Preporuke kupovine

Pravila određuju šta se nudi u cross-sell prozoru kada kupac dodaje proizvod iz određene grupe.

- **Klik na pravilo** — otvara izmenu.
- **Obriši pravilo** — briše bez dodatnog confirm prozora.
- **Novo pravilo** — otvara praznu formu.
- **Dodaj / Sačuvaj** — snima grupu, listu SKU-ova, redosled i aktivnost.

SKU-ovi se mogu razdvojiti zarezom ili razmakom.

### 21.2 Izveštaji

Dugmad perioda:

- **Poslednjih 7 dana**;
- **Poslednjih 30 dana**;
- **Poslednjih 90 dana**;
- **Od početka godine**.

Klik menja period za promet, broj narudžbina, prosečnu korpu, vaučer popuste, top SKU-ove i top kategorije. Otkazane narudžbine se ne računaju.

### 21.3 Posete i konverzije

ERP pregled bez posebnih komandi. Filteri i Excel služe za analizu događaja uz analytics saglasnost.

### 21.4 QA objave / Neobjavljeni artikli

- **Otvori** — vodi na detalj proizvoda koji nije spreman.
- Filter, kolone, sortiranje, pogled i Excel rade kao u svakom ERP modulu.
- „Razlog blokade“ treba rešavati pre uključivanja proizvoda.

### 21.5 Audit log

Samo Super admin.

- **Filtriraj** — traži po nazivu akcije ili ID-u entiteta i opciono po tipu entiteta.
- **Pregledaj** u koloni Diff — otvara tehnički zapis šta je promenjeno.
- **Prethodna / Sledeća** — menja stranu, po 50 zapisa.

Audit log se ne uređuje i ne briše iz panela.

## 22. Detalj narudžbine

Ova stranica ima najviše poslovno osetljivih radnji.

### Dobavljačka realizacija

- **Potvrdi preuzimanje** — čuva lokaciju/adresu/grad i status realizacije dobavljača; zahteva razlog i potvrdu.
- **Pošalji ponovo** — ponavlja slanje dobavljačke porudžbine; zahteva razlog i potvrdu.

### Status narudžbine

- **Sačuvaj** — menja status i upisuje napomenu. Otkazivanje vraća robu na lager, a određeni statusi mogu pokrenuti email ili kurirski proces.

### IPS povraćaj

- **Izvrši IPS povraćaj** — vraća ceo ili deo potvrđene IPS uplate. Dostupno je samo ako postoji preostali iznos za povraćaj. Traži potvrdu.

### Kurir

- **Otvori** pored etikete — otvara/preuzima postojeću kurirsku etiketu.
- **Osveži status** — pita kurirskog provajdera za najnoviji status.
- **Izmeni COD** — menja pouzeće kod MyGLS-a; traži potvrdu.
- **Obriši GLS** — otkazuje MyGLS nalog kod provajdera i briše etiketu; traži potvrdu.
- **Ponovi nalog** — ponavlja ranije neuspelo kreiranje pošiljke.
- **Kreiraj MyGLS/X Express nalog** — šalje podatke kuriru i kreira pošiljku/etiketu; kod X Express-a se unosi broj paketa.
- **Događaji** — otvara istoriju kurirskih statusa.

### Dokument za kupca

- **Preuzmi PDF** — preuzima predračun/račun.
- **Izdaj i pošalji** — pravi dokument ako ne postoji i šalje ga na email.
- **Ponovo pošalji** — ponavlja slanje postojećeg dokumenta.

### Fiskalizacija na narudžbini

- **Izdaj fiskalni račun** — poziva fiskalnog provajdera i email slanje.
- **Ponovo pošalji fiskalni račun** — ponavlja email za postojeći fiskalni dokument.
- **Sačuvaj** uz broj fiskalnog računa — ručno upisuje broj i traži potvrdu da se podudara sa dokumentom provajdera.

## 23. Direktne administrativne stranice koje nisu u glavnom meniju

### Komentari kupaca — `/admin/komentari`

- **Označi pregledano** — skida komentar sa liste novih.
- **Vrati u nove** — ponovo ga označava kao nepregledan.
- **Obriši** — traži potvrdu i nepovratno briše komentar.

### Newsletter pretplatnici — `/admin/newsletter`

- **Filtriraj** — traži email.
- **Odjavi** — postavlja pretplatnika kao odjavljenog; zapis ostaje radi evidencije.
- **Obriši** — traži potvrdu i fizički briše pretplatnika.

### Stari URL-ovi koji se preusmeravaju

Aktuelna konfiguracija preusmerava:

- `/admin/proizvodi` → `/admin/erp/artikli`;
- `/admin/akcije` → `/admin/erp/akcijske-cene`;
- `/admin/heroji` → `/admin/erp/heroji-meseca`;
- `/admin/lager` → `/admin/erp/stanje-po-magacinima`;
- `/admin/narudzbine` → `/admin/erp/prodajni-nalozi`.

Detalji kao `/admin/proizvodi/{id}` i `/admin/narudzbine/{id}` i dalje se koriste.

## 24. Dugmad na koja posebno treba upozoriti klijenta

### Nemaju dodatni confirm prozor u aktuelnom interfejsu

- brisanje CMS teksta;
- brisanje promo poruke;
- `×` u Navigaciji;
- `×` u Kategorijama;
- brisanje Piktograma;
- `×` pravila dostave;
- `×` vaučera;
- brisanje pravila Preporuke kupovine;
- brisanje medija na detalju proizvoda.

Pre klika ručno proveriti da je u pitanju test zapis.

### Imaju potvrdu, ali mogu napraviti realnu poslovnu posledicu

- objava MP cena;
- knjiženje popisa, otpremnice, fakture ili prijemnice;
- slanje porudžbenice dobavljaču;
- kreiranje kurirskog naloga ili promena COD-a;
- izdavanje računa ili fiskalnog dokumenta;
- fiskalna refundacija i IPS povraćaj;
- stvarni XML/Rabalux import;
- rollback;
- slanje kampanje kada se omogući provider.

Potvrda je poslednja zaštita od pogrešnog klika, ali nije zamena za test okruženje.

## 25. Pedeset pitanja koja će klijent verovatno postaviti

### 1. Zašto ja ne vidim sve stavke koje ti vidiš?

Zato što meni zavisi od admin uloge. Super admin vidi sve; Sadržaj, Operativa i Marketing vide samo svoje oblasti.

### 2. Kako znam da je promena sačuvana?

Kod formi se pojavi zelena poruka o uspehu. U ERP inline uređivanju ćelija se snima na Enter, izlazak iz polja ili promenu checkboxa, a vrh tabele prikazuje broj snimljenih izmena.

### 3. Da li postoji jedno globalno dugme Sačuvaj?

Ne. Svaka kartica ili zapis se čuva posebno. To smanjuje mogućnost da slučajno promenite više nepovezanih stvari.

### 4. Mogu li da poništim poslednju izmenu?

Većina stranica nema univerzalni Undo. Izmenu treba vratiti ručnim unosom. Rabalux batch ima kontrolisani rollback, ali samo za posebne uvozne slučajeve.

### 5. Da li se svako brisanje može vratiti?

Ne. „Arhiviraj“ artikal je povratna poslovna radnja, ali mnoga dugmad „Obriši“ fizički brišu zapis. Zato se brisanje testira samo na test podacima.

### 6. Šta je najbezbednije da obrišemo i ponovo unesemo?

Test artikal preko „Arhiviraj“, pa isti SKU ponovo uvesti XLSX fajlom. To je bezbednije od brisanja stvarne kategorije, dobavljača, vaučera ili banera.

### 7. Da li „Arhiviraj“ stvarno briše artikal?

Ne. Postavlja status ARH, isključuje ga i upisuje datum arhiviranja. Zapis ostaje u bazi i audit tragu.

### 8. Šta se desi ako uvezem SKU koji već postoji?

Postojeći artikal se ažurira. Uvoz koristi SKU kao ključ za „upsert“.

### 9. Šta se desi ako uvezem novi SKU?

Kreira se novi artikal sa slugom izvedenim iz naziva i SKU-a.

### 10. Da li import može da upiše pola fajla, pa da stane?

Ne. Uvoz je atomski: ako jedan red ima grešku, nijedan red se ne upisuje.

### 11. Koje kolone su obavezne za import?

SKU ili Šifra, Naziv, Opis i MPC. Ostale podržane kolone su opcione.

### 12. Koliko veliki XLSX mogu da pošaljem?

Najviše 8 MB.

### 13. Da li mogu odmah da uvezem isti Excel koji sam izvezao?

Ne treba računati na to. ERP izvoz je izveštaj sa vidljivim kolonama, dok import očekuje precizna zaglavlja. Za test treba napraviti namenski import fajl.

### 14. Šta tačno izvozi dugme Excel?

Trenutnu pretragu, filtere, sortiranje i vidljive kolone, do 10.000 redova.

### 15. Zašto neki podaci nisu u Excelu?

Zato što je kolona skrivena ili je filter izbacio red. Uključite kolonu i očistite filter ako želite širi izvoz.

### 16. Da li filter menja podatke?

Ne. Filter samo menja šta trenutno vidite i šta ulazi u Excel izvoz.

### 17. Čemu služi Snimi pogled?

Čuva vašu omiljenu kombinaciju kolona, širina, filtera, sortiranja i pretrage da je kasnije vratite jednim klikom.

### 18. Da li Reset kolona briše podatke?

Ne. Vraća samo izgled tabele i sortiranje.

### 19. Zašto ne mogu da kliknem Arhiviraj ili Proknjiži?

Najčešće zato što nije izabran nijedan red. Prvo označite checkbox pored zapisa.

### 20. Zašto ne mogu da izmenim neku ćeliju?

Ili nije uključen režim „Uredi podržana polja“, ili je ta kolona namerno samo za čitanje jer nema bezbedno server mapiranje.

### 21. Kada se inline ćelija snima?

Na Enter ili kada izađete iz polja. Checkbox se snima odmah.

### 22. Šta znači UZ status artikla?

U aktuelnoj logici UZ se tretira kao neaktivan/neobjavljen status. Dobar je za test ili nedovršen artikal.

### 23. Šta znači ARH?

Arhiviran artikal. Ne prikazuje se kao aktivan proizvod, ali zapis ostaje.

### 24. Šta znači DTZ?

„Dok traju zalihe“. Koristi se za proizvode koji se prodaju do isteka količine.

### 25. Zašto se aktivan proizvod ipak ne vidi na sajtu?

„Aktivan“ nije jedini uslov. Proizvod može biti blokiran zbog statusa, obrisanog datuma, cene, zalihe, dimenzija, slike, opisa ili kategorije. Pogledajte QA objave.

### 26. Gde vidim tačan razlog zašto artikal nije objavljen?

U „QA objave / Neobjavljeni artikli“, u koloni „Razlog blokade“.

### 27. Može li XML import da prepiše moju ručnu izmenu?

Može, osim ako je konkretno polje označeno u „XML zaštita polja“ na detalju proizvoda.

### 28. Čemu služi XML zaštita?

Kaže importeru da određene ručno uređene podatke, na primer naziv ili cenu, ne sme automatski menjati.

### 29. Da li Rabalux Preview nešto menja?

Preview služi da izračuna i pokaže promene. Stvarno izvršenje se radi tek posebnim dugmetom, uz razlog, frazu i potvrdu.

### 30. Zašto Rabalux traži da prepišem frazu?

To je dodatna zaštita da administrator svesno izvršava tačan preview ili rollback, a ne slučajno staru ili pogrešnu akciju.

### 31. Šta radi rollback?

Pokušava da vrati promene određenog batch-a, ali samo tamo gde polja posle tog batch-a nisu ponovo menjana. Nije univerzalno vraćanje cele baze.

### 32. Da li promena banera odmah ide na sajt?

Posle čuvanja i osvežavanja javne stranice promena treba da bude dostupna, uz moguće kratko keširanje. Period i „Aktivan“ takođe moraju dozvoljavati prikaz.

### 33. Koja je razlika između Resetuj i Sačuvaj na baneru?

Resetuj vraća nesnimljena polja na trenutno učitane vrednosti. Sačuvaj upisuje promenu u bazu.

### 34. Zašto se pojedinačni baner ne prikazuje iako je aktivan?

Proverite poziciju, datum početka/kraja i da li na istoj pojedinačnoj poziciji postoji drugi aktivni zapis sa prioritetom prikaza.

### 35. Da li mogu da imam više promo poruka?

Da. Više aktivnih poruka frontend rotira. Jedna aktivna poruka daje stalnu poruku.

### 36. Zašto ne mogu da izaberem poziciju menija?

Pozicija je već zauzeta. Desktop navigacija ima deset jedinstvenih mesta.

### 37. Da li brisanje kategorije briše i proizvode?

Ne treba ga koristiti kao način za brisanje proizvoda. Zavisne veze mogu sprečiti brisanje, a posledice zavise od relacija u bazi. Za reorganizaciju je bezbednije promeniti roditelja ili kategoriju proizvoda.

### 38. Kada vaučer radi?

Mora biti aktivan, u važećem periodu, korpa mora ispuniti minimum i limiti korišćenja ne smeju biti potrošeni.

### 39. Mogu li da promenim kod postojećeg vaučera?

Ne kroz postojeći editor; kod je zaključan. Napravite novi kod ako je naziv pogrešan.

### 40. Zašto je način plaćanja zaključan?

Zato što provider ili poslovno prihvatanje nije potvrđeno u produkcijskoj konfiguraciji. Panel pokazuje koji je uslov potreban.

### 41. Da li promena načina plaćanja odmah utiče na kupce?

Da. Posle čuvanja promena je odmah deo checkout konfiguracije, zato dugme traži potvrdu.

### 42. Šta je napušten checkout?

Checkout koji nije pretvoren u porudžbinu i nije ažuriran dovoljno dugo, ili je izričito označen kao napušten.

### 43. Da li mogu iz Checkouta da otvorim porudžbinu?

Da, ako je checkout konvertovan. Broj porudžbine je link.

### 44. Da li promena statusa porudžbine šalje email?

Određeni statusi mogu pokrenuti obaveštenje i/ili kurirsku logiku. Zato pre čuvanja treba proveriti napomenu i izabrani status.

### 45. Šta se desi kada otkažem porudžbinu?

Logika vraća rezervisanu/prodatu robu na lager, uz audit trag. To treba proveravati na test porudžbini.

### 46. Da li Refundiraj u fiskalizaciji vraća i novac na karticu/IPS?

Fiskalna refundacija izdaje refundacioni fiskalni dokument i vraća artikle na lager. Finansijski povraćaj kroz payment provider je odvojena radnja, na primer „Izvrši IPS povraćaj“.

### 47. Zašto refundacija traži JMBG, PIB ili ličnu kartu?

Zato što fiskalni refundacioni dokument zahteva identifikaciju kupca u propisanom formatu.

### 48. Da li kreiranje kurirskog naloga odmah šalje podatke kuriru?

Da, kada je pravi provider konfigurisan. Može napraviti pošiljku, tracking i etiketu. Ne testirati na stvarnom kupcu bez sandboxa ili dogovora.

### 49. Gde mogu da vidim ko je promenio podatak?

U Audit logu, ako imate Super admin ulogu. Vide se korisnik, vreme, akcija, entitet, ID, IP i diff.

### 50. Kako znamo da je ceo panel spreman za puštanje?

Kada prođu: kontrolisani CRUD test na test zapisima, XLSX import i export, QA objave, checkout test, email test, provider sandbox testovi, fiskalizacija/refundacija u test režimu, kurirski test, monitoring bez grešaka i provera Audit loga. Samo „stranica se otvorila“ nije dovoljno za funkcije sa spoljnim sistemima.

## 26. Kratka završna rečenica za klijenta

> „Panel razdvaja pregled, uređivanje i rizične poslovne akcije. Svakodnevne stvari — sadržaj, filteri, Excel, proizvodi i pravila — možete raditi direktno. Sve što šalje podatke dobavljaču, kuriru, fiskalnom ili payment sistemu ima dodatnu potvrdu i testira se kontrolisano.“
