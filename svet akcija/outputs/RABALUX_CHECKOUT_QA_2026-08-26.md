# Rabalux checkout, poručivanje, kurir i fiskalizacija — QA izveštaj

Datum provere: 26. avgust 2026.

## Kratak zaključak

**Checkout i automatsko slanje Rabalux porudžbine rade, ali kompletan produkcioni tok trenutno nije spreman za rad bez ručne kontrole.**

Najvažniji produkcioni dokaz je porudžbina `SPC-2026-000033`:

- porudžbina je kreirana 20. avgusta;
- Rabalux fulfillment i dobavljački mejl su napravljeni praktično odmah;
- mejl dobavljaču ima status `DELIVERED`;
- fulfillment je i dalje `SENT`, bez potvrde i bez izabranog mesta preuzimanja;
- porudžbina je i dalje `KREIRANO`;
- nema pošiljke i nema fiskalnog dokumenta.

To znači da automatika dobro radi do Rabalux inboxa, ali dalji tok zavisi od toga da neko pročita njihov odgovor, u adminu evidentira potvrdu i odabere potpuno mesto preuzimanja. Bez toga aplikacija namerno ne dozvoljava kreiranje kurira.

**Preporuka za status:** uslovni `NO-GO` za rad bez nadzora; `GO` samo uz jasno zaduženu osobu, dnevnu kontrolu `SENT` porudžbina i definisan SLA/escalation prema Rabalux-u.

## Kako kupovina trenutno radi

1. Kupac otvori objavljen Rabalux artikal. Ne vidi tačnu količinu, već poruku „Dostupno kod dobavljača“ i rok „Isporuka 1–2 radnih dana“.
2. Artikal je kupiv samo ako je Rabalux integracija uključena, dobavljač aktivan, artikal odobren, postoji uspešno učitano XLSX zapažanje i sirovo stanje je najmanje 4 komada.
3. Raspoloživo za prodaju računa se kao: poslednje XLSX stanje minus aktivne rezervacije minus 1 sigurnosni komad.
4. Na checkout-u server ponovo učitava cenu i stanje. Ne veruje ceni ni količini iz browsera.
5. U transakciji se zaključava red proizvoda, proverava raspoloživa količina i uvećava `supplierReservedStock`. Time se istovremene kupovine serijalizuju i sprečava oversell.
6. Kreiraju se porudžbina, stavke, snapshot alokacije i `SupplierFulfillment` sa originalnom Rabalux šifrom i količinom.
7. Posle uspešne transakcije kreiraju se trajni poslovi za:
   - potvrdu/profakturu kupcu;
   - Rabalux porudžbeni mejl.
8. Rabalux dobija naslov `Porudžbina SPC-...` i tabelu sa Rabalux šiframa i količinama. Mejl ne sadrži ime kupca, adresu kupca, prodajnu cenu ni maržu. Nema priloženi formalni PDF purchase order.
9. Mejl traži da Rabalux potvrdi dostupnost i mesto preuzimanja. Njihov odgovor se ne pretvara automatski u potvrdu; operater to evidentira u adminu.
10. Kurirska pošiljka ne može da se kreira dok fulfillment nije potvrđen i mesto preuzimanja nema adresu i grad.
11. Kada se kreira kurir, paket ide na X Express ako je do 30 kg i nijedna stranica nije preko 60 cm; veći paket ide na MyGLS. Nepotpune dimenzije/težina blokiraju automatsko kreiranje pošiljke.
12. Fiskalni račun se ne izdaje na samom checkout-u. Kupac odmah dobija nefiskalnu potvrdu/profakturu.
13. Fiskalizacija se automatski pokreće:
   - posle potvrđene IPS uplate; ili
   - kada kurir prijavi status `PICKED_UP`.
14. Fiskalni račun uključuje stavke i dostavu, čuva se privatno i šalje kupcu mejlom. Logika je idempotentna i štiti od duplog računa.
15. Rabalux rezervacija se oslobađa kada porudžbina uđe u fizički tok isporuke ili se otkaže. Rabalux stavka ne skida DC stanje zato što je supplier-only alokacija.

## Šta je stvarno testirano

### Automatizovana provera

| Provera | Rezultat | Napomena |
|---|---:|---|
| Unit testovi | PASS | 199 fajlova, 996 testova prošlo. |
| Produkcioni build | PASS | Next build, TypeScript i generisanje ruta uspešni. |
| Lint | PASS sa 2 upozorenja | Dva nepovezana unused importa u ERP stranici. |
| Runtime readiness | PASS sa operativnim upozorenjima | Baza, migracije, checkout, skladišta, RLS i storage prošli. Postoje istorijski neuspešni mejlovi, kuriri, fiskalni dokumenti i poslovi koje treba trijažirati. |
| Rabalux DB integration suite | BLOCKED pravilno | Test zahteva eksplicitnu izolovanu test bazu; nije dozvoljeno da piše u produkcionu bazu. |
| Rabalux Playwright E2E sa upisom | BLOCKED pravilno | Zahteva `E2E_DATABASE_URL` za izolovanu QA bazu. |
| Commerce smoke | FAIL pre Rabalux koraka | Test traži zastareli canary proizvod `RELAX`; nije pronađen. To je problem test fixture-a, ne dokaz pada Rabalux checkout-a. |

Postojeći Rabalux integration testovi pokrivaju threshold, ponovljeni sync, mapiranje kategorija, approval/rollback, circuit breaker, mixed-stock porudžbinu, jedan dobavljački mejl, otkazivanje, reklamaciju, paralelni oversell i kill switch. Ti testovi nisu ponovo pušteni protiv baze jer izolovana QA baza nije bila dostupna.

### Browser provera bez pravljenja lažne produkcione porudžbine

- Na produkciji je otvoren Rabalux `Solar 1` (`RAB-8365`).
- Prikazane su poruke „Dostupno kod dobavljača“ i „Isporuka 1–2 radnih dana“.
- Dodavanje u korpu je uspelo; broj stavki se promenio sa 4 na 5.
- Test artikal je uklonjen i korisnička korpa je vraćena na početna 4 artikla.
- Na lokalnom checkout-u je testiran kontrolisan scenario u kome su svi mutation pozivi bili blokirani, tako da nisu nastali porudžbina, mejl, fiskalni dokument ni kurirski nalog.
- Provereni su izbor gost/prijava/registracija, fizičko/pravno lice, obavezna polja, autokomplet grada i zvanične ulice, plaćanje pouzećem i uplatom na račun, pregled porudžbine i obavezna saglasnost sa uslovima.
- Bez saglasnosti checkout ostaje na pregledu i prikazuje grešku „Saglasnost je obavezna pre porudžbine“.
- Za pravno lice trenutno su obavezni naziv i PIB; ne postoji polje za matični broj.
- Adresa bez kućnog broja prolazi, a X Express payload je šalje kao `bb`. To mora biti potvrđeno kao prihvatljiva poslovna politika.

### Read-only produkciona provera

- Rabalux dobavljač je aktivan i ima konfigurisan mejl.
- Postoji 2.868 proizvoda sa poslednjim stock zapažanjem; poslednji datum zapažanja je 16. avgust 2026.
- Poslednji catalog import 26. avgusta je uspešan, ali to nije isto što i novi Srbija stock XLSX.
- Sirovo stanje od najmanje 4 komada ima 192 proizvoda; 170 trenutno ispunjava i ostale uslove za kandidata dostupnosti.
- Aktivna je jedna Rabalux rezervacija od jednog komada.
- Postoji jedan Rabalux fulfillment i jedan dobavljački `supplier_order` mejl; mejl je isporučen.
- Produkciona porudžbina `SPC-2026-000033` potvrđuje da slanje dobavljaču radi, ali i da ručna potvrda nije završena šest dana.

Nisu čitani niti iznošeni podaci kupca.

## Test matrica i rezultat

Oznake: `PASS` = provereno; `COVERED` = pokriveno testovima/kodom; `BLOCKED` = potreban izolovan QA sistem ili eksterni sandbox; `RISK` = potrebna poslovna odluka ili operativna kontrola.

| # | Scenario | Status | Rezultat / očekivanje |
|---:|---|---:|---|
| 1 | Rabalux feature flag ugašen | COVERED | Rabalux nije operativan i porudžbeni mejl se ne šalje. |
| 2 | Dobavljač disabled | COVERED | Artikal nije dobavljački raspoloživ. |
| 3 | Artikal nije odobren | COVERED | Nije kupiv. |
| 4 | Nema XLSX zapažanja | COVERED | Nije kupiv. |
| 5 | Sirovo stanje 0–3 | COVERED | Nije kupiv. |
| 6 | Sirovo stanje 4+ | PASS/COVERED | Kupiv ako su ostali uslovi ispunjeni. |
| 7 | Sigurnosna rezerva | COVERED | Oduzima se jedan komad. |
| 8 | Aktivne rezervacije | PASS/COVERED | Oduzimaju se od poslednjeg XLSX stanja. |
| 9 | Paralelne kupovine poslednjih komada | COVERED | Zaključavanje reda sprečava oversell. |
| 10 | Neuspešan novi XLSX | COVERED | Poslednji uspešno primenjen ostaje autoritativan. |
| 11 | Artikal nestane iz novog XLSX | COVERED | Novi uspešni snapshot ga uklanja iz raspoloživog skupa. |
| 12 | Live PDP prikaz | PASS | Dobavljačka dostupnost i 1–2 dana prikazani. |
| 13 | Live dodavanje u korpu | PASS | Dodavanje i uklanjanje rade. |
| 14 | Tačna količina skrivena kupcu | PASS | Kupac vidi labelu, ne supplier količinu. |
| 15 | Server revalidira cenu | COVERED | Browser nije izvor istine. |
| 16 | Server revalidira stanje | COVERED | Ponovna provera pre i unutar transakcije. |
| 17 | Gost checkout | PASS | Opcija postoji i forma radi. |
| 18 | Prijava/registracija iz checkout-a | PASS UI | Opcije postoje; puna OAuth/login sesija nije ponovo testirana. |
| 19 | Fizičko lice | PASS | Obavezna kontakt i adresna polja rade. |
| 20 | Pravno lice | PASS UI | Naziv i PIB obavezni; nema matičnog broja. |
| 21 | Grad iz kurirskog adresara | PASS | Izabran zvanični grad/opština. |
| 22 | Ulica iz kurirskog adresara | PASS | Izabrana zvanična ulica. |
| 23 | Nema kućnog broja | RISK | Sistem pretvara u `bb`; treba potvrditi politiku. |
| 24 | Pouzeće gotovinom | PASS UI/COVERED | Vidljivo i ulazi u review. |
| 25 | Uplata na račun | PASS UI/COVERED | Vidljiva. |
| 26 | Kartica / pouzeće karticom | PASS kao isključeno | Trenutno nisu ponuđeni. |
| 27 | Obavezna saglasnost | PASS | Bez nje nema submit-a. |
| 28 | Kreiranje supplier rezervacije | COVERED | Nastaje u istoj transakciji kao porudžbina. |
| 29 | Supplier fulfillment snapshot | COVERED | Čuva originalnu Rabalux šifru i količinu. |
| 30 | Automatski mejl Rabalux-u | PASS produkcija | Jedan poslat i isporučen. |
| 31 | Sadržaj supplier mejla | PASS kod | Broj porudžbine, šifra i količina; bez PII/cene. |
| 32 | Duplo slanje istog mejla | COVERED | Idempotency ključ sprečava normalan duplikat. |
| 33 | Privremeni pad mejla | COVERED | Trajni background job pokušava ponovo. |
| 34 | Trajni pad mejla | RISK | Status postaje `FAILED`; potreban alert i vlasnik incidenta. |
| 35 | Rabalux potvrda dostupnosti | RISK | Ručni korak; trenutna produkciona porudžbina je zaglavljena ovde. |
| 36 | Nema mesta preuzimanja | PASS zaštita | Kurir je blokiran. |
| 37 | Potvrđeno mesto preuzimanja | COVERED | Tek tada je dozvoljen kurir. |
| 38 | Paket do 30 kg i strane do 60 cm | COVERED | X Express. |
| 39 | Veći/teži paket | COVERED | MyGLS. |
| 40 | Nedostaju dimenzije/težina | COVERED | Automatski kurir se blokira. |
| 41 | Mešovita DC + Rabalux korpa | COVERED | Alokacije se čuvaju po izvoru; treba poslovno potvrditi konsolidaciju. |
| 42 | Dupli COD kod split isporuke | COVERED | Logika sprečava duplo zaduženje pouzeća. |
| 43 | Potvrda/profaktura kupcu | PASS produkcija | Buyer mejl je isporučen; dokument nije fiskalni račun. |
| 44 | Fiskalni račun na checkout-u | PASS kao odsutan | Namerno se ne izdaje tada. |
| 45 | Fiskalizacija na IPS uplatu | COVERED, BLOCKED eksterno | Trigger postoji; nije izvedena stvarna IPS uplata. |
| 46 | Fiskalizacija na `PICKED_UP` | COVERED, BLOCKED eksterno | Trigger postoji; nije napravljen pravi test paket. |
| 47 | Dupla fiskalizacija | COVERED | Lock i idempotentnost blokiraju dupli račun. |
| 48 | Otkaz pre fiskalizacije | COVERED | Rezervacija se oslobađa i Rabalux dobija otkaz ako je prvobitni mejl poslat. |
| 49 | Otkaz posle SALE računa | COVERED | Direktno otkazivanje se blokira; potreban refund tok. |
| 50 | Reklamacija pre isporuke | COVERED | Nije dozvoljena. |
| 51 | Reklamacija posle isporuke | COVERED | Rabalux dobija šifru, količinu, opis i zaštićene linkove fotografija. |
| 52 | Privatnost reklamacionih slika | PASS konfiguracija | Bucket je privatan; potpisani linkovi važe 7 dana. |
| 53 | Privatnost računa | PASS konfiguracija | Fiskalni/porudžbeni PDF se čuva privatno i šalje server-side. |
| 54 | RLS / Data API | PASS readiness | Javne tabele su zaključane za anon/authenticated uloge. |
| 55 | Potpun write E2E | BLOCKED | Potrebni su izolovana QA baza, test kuriri, test fiskalizacija i test mejl sanduče. |

## Ključni problemi i odluke

### P0 — ručni Rabalux confirmation nema SLA ni sigurnosnu mrežu

Jedina stvarna Rabalux porudžbina je šest dana u `SENT`. Nema evidentirane potvrde, mesta preuzimanja, pošiljke ni fiskalnog dokumenta. Sistem pravilno blokira kurira, ali nema dokazanu automatsku opomenu, eskalaciju ili obradu odgovora dobavljača.

Potrebno pre puštanja većeg prometa:

- vlasnik reda `SENT` porudžbina;
- prvi rok za proveru odgovora, npr. 2 sata;
- reminder/escalation posle npr. 4 sata i jednog radnog dana;
- procedura kada Rabalux odbije količinu;
- zamena/otkaz i obaveštenje kupcu;
- dashboard/alert za fulfillment bez potvrde.

### P0 — nema izolovanog full-write QA prolaza

Zaštite su ispravno sprečile integration i E2E testove da pišu u produkcionu bazu. Za pravi sign-off treba obezbediti izolovanu bazu i sandbox naloge i dokazati ceo tok:

`checkout → supplier email → manual confirmation → courier label → PICKED_UP → fiscal receipt → delivery → cancellation/refund/reclamation`.

### P1 — rok 1–2 dana mora biti ugovorno potvrđen

Storefront za svaki Rabalux artikal hardkodovano prikazuje 1–2 radna dana. U postojećim podacima proizvoda i starijoj dokumentaciji postoje tragovi roka 7–10 dana. Produkciona porudžbina koja šest dana nije potvrđena pokazuje da obećanje 1–2 dana trenutno nema dokazanu operativnu podršku.

### P1 — stock snapshot nema rok zastarelosti

Poslednji Rabalux Srbija stock snapshot je od 16. avgusta. Po sadašnjoj poslovnoj politici on ostaje autoritativan do sledećeg uspešnog XLSX-a. Ne postoji automatski „starije od N dana = nedostupno“. Klijent mora eksplicitno prihvatiti ili promeniti ovu politiku.

### P1 — faktura/mejl metadata nije potpuno usklađena

Za produkcionu porudžbinu buyer mejl ima status `DELIVERED`, ali PROFORMA metadata i dalje nema `emailedAt` i nije označena kao poslata. Kupac je mejl dobio, ali je audit trag dokumenta nepotpun i treba ga uskladiti/reconciliovati.

### P1 — produkcioni provider readiness treba potvrditi direktno u Vercel-u

Lokalna `.env.local` provera prijavljuje BADI sandbox/missing production gate, X Express test nalog i IPS iza production acceptance-a. To nije dokaz da je Vercel pogrešno podešen; znači da se produkciona konfiguracija mora posebno proveriti bez čitanja/iznošenja tajni.

### P2 — zastareo smoke canary

Commerce smoke očekuje proizvod `RELAX` i pada pre Rabalux koraka. Fixture treba zameniti stabilnim seed proizvodom ili dinamičkim izborom kupivog artikla.

### Važna politika web dostupnosti

Vercel Production trenutno koristi `ENFORCE_WEB_AUTO_AVAILABILITY=false`. Ne treba ga prebaciti na `true` dok DC stanje nije importovano i auditovano. Trenutni model je kao dve kutije sa igračkama:

- DC kutija se puni CSV/XLSX-om i može ručno da se koriguje;
- Rabalux kutija čuva poslednji uspešno primenjeni Srbija XLSX do sledećeg, oduzima rezervacije i jedan sigurnosni komad, a kupcu prikazuje samo dobavljačku dostupnost i rok.

Ako se stroga automatska dostupnost kasnije uključi i napravi problem, bezbedan rollback je `ENFORCE_WEB_AUTO_AVAILABILITY=false` i redeploy. Klijent može tražiti drugačiju politiku stanja ili drugačiju kupčevu labelu.

## 50 pitanja koja će klijent verovatno postaviti

Kod svakog pitanja je navedeno šta treba spremiti kao odgovor ili odluku.

### Stanje, katalog i dostupnost

1. **Odakle dolazi Rabalux stanje?**  
   Spremi: poslednji uspešno primenjen Rabalux Srbija XLSX je izvor istine, ne njihov live ERP/API.

2. **Koliko često se stanje osvežava?**  
   Spremi: tačan operativni raspored i odgovornu osobu; poslednje zapažanje trenutno je od 16. avgusta.

3. **Šta ako novi XLSX ne stigne ili import padne?**  
   Spremi: stari uspešni snapshot ostaje aktivan; dogovoriti posle koliko dana se prodaja automatski gasi.

4. **Šta ako artikla nema u sledećem uspešnom XLSX-u?**  
   Spremi: tretira se kao nedostupan iz Rabalux izvora.

5. **Zašto kupac ne može da kupi kada Rabalux ima tri komada?**  
   Spremi: javni prag je 4; stanje 0–3 se skriva radi rizika i sigurnosne rezerve.

6. **Zašto se dodatno čuva jedan komad?**  
   Spremi: sigurnosni buffer protiv kašnjenja XLSX-a i paralelne prodaje drugim kanalima.

7. **Da li kupac vidi tačan Rabalux lager?**  
   Spremi: ne; vidi samo „Dostupno kod dobavljača“ i rok isporuke.

8. **Može li dva kupca kupiti poslednji komad u isto vreme?**  
   Spremi: checkout zaključava proizvod i ponovo računa rezervacije, pa drugi zahtev mora pasti ako nema količine.

9. **Da li DC stanje može da učini Rabalux artikal dostupnim kada XLSX kaže da nije?**  
   Spremi: po trenutnoj Rabalux politici ne; Rabalux web kupovina prati dobavljački XLSX. Ako klijent želi kombinovanu politiku, to je promena zahteva.

10. **Ko može ručno da uključi/isključi Rabalux artikal?**  
    Spremi: admin approval/manual web kontrole i feature flag; dokumentovati uloge i audit trag.

### Cena i checkout

11. **Ko određuje prodajnu cenu Rabalux artikla?**  
    Spremi: tačno pravilo marže/cenovnika/promocije i ko ga odobrava; server je konačni autoritet na checkout-u.

12. **Može li kupac izmenom browsera da plati staru ili lažnu cenu?**  
    Spremi: ne; cena i dostupnost se učitavaju ponovo na serveru.

13. **Važe li akcije, kuponi i loyalty popust za Rabalux?**  
    Spremi: poslovnu matricu po tipu popusta; test je pokazao da aktivni loyalty može promeniti prikazanu cenu.

14. **Zašto piše isporuka 1–2 radna dana?**  
    Spremi: ugovorni dokaz/SLA Rabalux-a. Trenutno je to hardkodovana Rabalux poruka.

15. **Šta ako Rabalux ne potvrdi porudžbinu u roku 1–2 dana?**  
    Spremi: SLA eskalacije, poruka kupcu, alternativa i pravilo otkaza/refunda.

16. **Može li gost da kupi?**  
    Spremi: da; postoje i prijava i registracija.

17. **Šta mora da unese fizičko lice?**  
    Spremi: ime, prezime, email, telefon, adresa, grad i poštanski broj.

18. **Šta mora da unese pravno lice?**  
    Spremi: trenutno naziv i PIB plus kontakt/adresa; potvrditi da li je matični broj obavezan jer ga forma nema.

19. **Da li adresa mora biti iz zvaničnog kurirskog adresara?**  
    Spremi: grad i ulica koriste X Express autokomplet; objasniti fallback kada adresa nije pronađena.

20. **Može li porudžbina bez kućnog broja?**  
    Spremi: trenutno može i kuriru odlazi `bb`; klijent treba da potvrdi ili zahteva obavezan broj.

### Slanje porudžbine Rabalux-u

21. **Kada se Rabalux-u šalje porudžbina?**  
    Spremi: odmah posle uspešnog commit-a checkout transakcije, kroz trajni background job i best-effort trenutno slanje.

22. **Kako im se porudžbina šalje?**  
    Spremi: email na adresu dobavljača; trenutno nema API/EDI razmene.

23. **Šta tačno piše u mejlu?**  
    Spremi: naš broj porudžbine, originalna Rabalux šifra i količina, plus zahtev za potvrdu dostupnosti i mesta preuzimanja.

24. **Da li Rabalux dobija podatke kupca?**  
    Spremi: ne; porudžbeni mejl ne šalje ime, telefon ni adresu kupca.

25. **Da li Rabalux dobija našu prodajnu cenu ili maržu?**  
    Spremi: ne.

26. **Da li dobijaju formalni purchase order PDF?**  
    Spremi: ne; trenutni Rabalux tok je `SupplierFulfillment` email, odvojen od generičkog ERP PurchaseOrder modula.

27. **Može li isti mejl otići dvaput?**  
    Spremi: normalni retry je idempotentan; objasniti pravilo ručnog resend-a i kako se proverava provider delivery status.

28. **Šta se dešava ako email provider ne radi?**  
    Spremi: fulfillment ide u `FAILED`, background job pokušava ponovo; dodati ko dobija alarm i posle koliko pokušaja se zove Rabalux.

29. **Da li se Rabalux odgovor automatski čita?**  
    Spremi: ne u trenutnom potvrđenom toku; operater ručno evidentira potvrdu i mesto preuzimanja.

30. **Ko je odgovoran da potvrdi Rabalux odgovor u adminu?**  
    Spremi: ime/ulogu, zamenu, radno vreme i maksimalno dozvoljeno čekanje. Ovo je trenutno najveća rupa.

### Kurir, pakovanje i isporuka

31. **Ko šalje robu krajnjem kupcu — Rabalux ili naš kurir?**  
    Spremi: precizan ugovorni model; aplikacija očekuje Rabalux mesto preuzimanja pa zatim naš kurirski nalog.

32. **Zašto se kurir ne kreira odmah?**  
    Spremi: zbog bezbednosne kapije — Rabalux mora potvrditi robu i potpuno mesto preuzimanja.

33. **Kako se bira X Express ili MyGLS?**  
    Spremi: X Express do 30 kg i najviše 60 cm po stranici; iznad toga MyGLS.

34. **Šta ako proizvod nema težinu ili dimenzije?**  
    Spremi: automatsko kreiranje pošiljke se blokira; odrediti ko dopunjava podatke i u kom roku.

35. **Kako se isporučuje mešovita korpa sa DC i Rabalux robom?**  
    Spremi: odlučiti da li se konsoliduje, šalje u dva paketa ili čeka kompletiranje; definisati šta kupac vidi.

36. **Da li kupac plaća dostavu jednom ili po paketu?**  
    Spremi: cenovnu politiku za split fulfillment. Kod štiti od duplog COD iznosa, ali poslovna naknada mora biti eksplicitna.

37. **Ko prati kašnjenje i menja status porudžbine?**  
    Spremi: vlasnika dashboarda, courier webhook monitoring i ručni fallback.

38. **Šta ako Rabalux potvrdi samo deo količine?**  
    Spremi: partial fulfillment pravilo — zamena, smanjenje količine, čekanje, split ili otkaz uz saglasnost kupca.

### Plaćanje i fiskalizacija

39. **Koje metode plaćanja kupac trenutno ima?**  
    Spremi: pouzeće gotovinom i uplata na račun; kartica i pouzeće karticom trenutno nisu ponuđeni.

40. **Da li se fiskalni račun izdaje odmah po poručivanju?**  
    Spremi: ne; odmah ide nefiskalna potvrda/profaktura.

41. **Kada se izdaje fiskalni račun za pouzeće?**  
    Spremi: kada kurir prijavi `PICKED_UP`.

42. **Kada se izdaje fiskalni račun za IPS/uplatu unapred?**  
    Spremi: IPS callback automatski pokreće fiskalizaciju; za običnu uplatu na račun definisati ko potvrđuje uplatu i koji je trigger.

43. **Da li fiskalni račun sadrži dostavu?**  
    Spremi: da, dostava je posebna fiskalna stavka uz artikle.

44. **Može li se izdati dupli račun ako webhook stigne dvaput?**  
    Spremi: logika je idempotentna, zaključava porudžbinu i odbija nebezbedan ponovni dispatch.

45. **Šta ako BADI/fiskalizacija padne nakon preuzimanja paketa?**  
    Spremi: incident proceduru, alert, ručni retry, maksimalni rok i zabranu duplog računa; potvrditi stvarnu Vercel production konfiguraciju.

### Otkaz, refund i reklamacija

46. **Šta se dešava kada kupac otkaže pre slanja?**  
    Spremi: rezervacija se oslobađa; ako Rabalux mejl nije poslat, njima se ne šalje otkaz.

47. **Šta se dešava kada je Rabalux već dobio porudžbinu?**  
    Spremi: šalje se idempotentan email za otkaz sa brojem porudžbine, šifrom i količinom.

48. **Može li porudžbina da se otkaže posle fiskalnog SALE računa?**  
    Spremi: direktan otkaz je blokiran; ide kontrolisan refund/reference fiskalni tok i eventualna payment refund provera.

49. **Kada kupac može da uloži reklamaciju?**  
    Spremi: tek posle statusa `ISPORUCENO`, najviše do kupljene količine.

50. **Šta Rabalux dobija kod reklamacije i kako su slike zaštićene?**  
    Spremi: broj reklamacije/porudžbine, šifru, količinu, opis i očekivano rešenje; fotografije su u privatnom bucket-u, a Rabalux dobija potpisane linkove koji važe 7 dana.

## Minimalni plan za stvarni sign-off

1. Odmah razrešiti `SPC-2026-000033`: pronaći Rabalux odgovor, evidentirati potvrdu/mesto preuzimanja ili otkazati i obavestiti kupca.
2. Uvesti dashboard/alert za `SupplierFulfillment.status in (PENDING, SENT, FAILED)` sa starošću i vlasnikom.
3. Sa klijentom zaključati tri politike: rok 1–2 naspram 7–10 dana, staleness cutoff XLSX-a i adresa bez kućnog broja.
4. Proveriti Vercel production readiness za BADI, X Express, MyGLS, Resend i IPS bez prikazivanja tajni.
5. Obezbediti izolovanu QA bazu i provider sandbox-e.
6. Napraviti jednu kontrolisanu end-to-end test porudžbinu sa eksplicitnom saglasnošću svih uključenih strana i dokazima svakog statusa.
7. Ispraviti invoice email metadata reconciliation i zastareli `RELAX` smoke fixture.

