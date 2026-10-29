# SPCApp — ERP API v1

API za SPC Cash Flow / SPCApp, bez upisivanja poslovnih podataka u ERP. GET pozivi koriste serverski Bearer ključ sa dozvolom `spcapp:read`. ERP beleži korišćenje ključa, rate limit i audit pristupa. Nisu potrebni admin kolačići, ChatGPT prijava, Supabase ključ ni direktan pristup bazi.

## Povezivanje

Produkcioni origin ERP-a: `https://www.svetpovoljnihcena.rs`. Ovi endpointi rade tek kada je verzija sa API-jem objavljena; dostupnost proveriti manifest pozivom. Lokalno: `http://localhost:3000`.

U **serverske tajne SPCApp-a** upisati:

```dotenv
SPCAPP_ERP_BASE_URL=https://www.svetpovoljnihcena.rs
SPCAPP_ERP_API_KEY=<poseban ključ iz privatnog credentials fajla>
```

Ključ ne ide u frontend, `NEXT_PUBLIC_*`, URL, javni repozitorijum ili logove. Nema browser CORS pristupa; SPCApp poziva API sa svog servera i korisnicima prikazuje podatke iz svoje baze.

Prvi poziv otkriva resurse i pravila sinhronizacije:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $SPCAPP_ERP_API_KEY" \
  -H 'Accept: application/json' \
  "$SPCAPP_ERP_BASE_URL/api/partners/v1/spcapp"
```

Primer preuzimanja računa:

```bash
curl --fail-with-body --get \
  -H "Authorization: Bearer $SPCAPP_ERP_API_KEY" \
  --data-urlencode 'from=2025-05-01' \
  --data-urlencode 'to=2026-10-18' \
  --data-urlencode 'limit=100' \
  "$SPCAPP_ERP_BASE_URL/api/partners/v1/spcapp/fiscal-documents"
```

## Zajednički format i paginacija

```json
{
  "ok": true,
  "apiVersion": "1",
  "resource": "fiscal-documents",
  "generatedAt": "2026-10-18T19:00:00.000Z",
  "requestId": "uuid",
  "from": "2025-05-01",
  "to": "2026-10-18",
  "timezone": "Europe/Belgrade",
  "currency": "RSD",
  "count": 100,
  "hasMore": true,
  "nextCursor": "opaque-signed-value",
  "items": []
}
```

Primer je ilustracija omotača; `items` u stvarnom odgovoru sadrži tačno `count` zapisa.

- `limit`: 1–200, podrazumevano 100; za `sef-invoices` 1–10, podrazumevano 10.
- `cursor`: vratiti `nextCursor` u sledećem zahtevu. Kraj je `hasMore=false` i `nextCursor=null`.
- `from`, `to`: uključivi kalendarski datumi `YYYY-MM-DD`, zona Europe/Belgrade. Podrazumevano od 01.05.2025. do dana poziva, osim performansi gde je početni period poslednjih 30 dana. Za redovno povezivanje **uvek zadati oba datuma** i zadržati ih kroz sve stranice.
- Kursor je potpisan, vezan za resurs, period, filtere i ključ partnera. Ne menjati te parametre tokom prolaska. `limit` se može smanjiti.
- Nepoznati/ponovljeni parametri, nevažeći datumi i `updatedSince` vraćaju 400. Inkrementalni feed trenutno ne postoji.
- Novac je decimalni string (`"1234.56"`) ili `null`. Valutni izuzeci imaju sopstveno `currency` polje; ne sabirati EUR/USD sa RSD. Fizičke mere i kurs koje vraća Prisma takođe mogu biti decimalni stringovi.
- `null` znači nepoznato/nije primenljivo. `"0.00"` znači poznata nula. Količine su brojevi. Vremenske oznake su ISO UTC; bucket ID statistike je lokalno vreme.
- `id` je stabilan unutar resursa. Ključ u SPCApp bazi je **(resource, id)**, jer se isti ERP ID može pojaviti u različitim resursima.

## Resursi

Svi putevi su relativni na `/api/partners/v1/spcapp/`.

| Resurs | Sadržaj | Datum filtriranja / posebni parametri |
|---|---|---|
| `orders` | SPC/ERP porudžbine: `id, number, erpChannel, status, createdAt, updatedAt`, `items`, `shipping`, popusti, ukupno, `payments`, predračuni, fiskalni dokumenti, kurir i stvarne dimenzije paketa u `pickupBatchLines` | `createdAt`; `channel=SPC`, originalni WEB/MP/VP/IZVOZ u `erpChannel` |
| `ananas-orders` | Uvezene Ananas porudžbine: `id/number, createdAt, status, total`, stavke sa bruto/neto iznosom, dostava, provizija ako postoji, kurir/status pošiljke, fiskalne reference, `dataQuality` | Datum originalne porudžbine |
| `fiscal-documents` | SPC računi/refundacije: broj, datum, veza porudžbine, ukupan neto/bruto/PDV, artikli, roba/dostava/montaža, COGS, reference originala | `issuedAt`, samo `ISSUED` |
| `ananas-fiscal-documents` | Ananas računi/refundacije: `fiscalNumber/number`, datum, `reference`, porudžbina/potporudžbina, neto/bruto/PDV, stavke i COGS | `issuedAt` |
| `legacy-fiscal-receipts` | Stari SPC fiskalni headeri kojima nedostaje novi `FiscalDocument`; broj, datum i povezana porudžbina | `fiscalizedAt`; nisu potpuna istorija fiskalnih stavki |
| `products` | Šifra, nazivi/opis, prva slika u `media`, status, dobavljač (sa matičnim `deliveryDays` = rok isporuke i `transitDays` = period isporuke, u danima, `null` ako nije uneto), kategorije/grupa/kolekcija/boje, COGS, bruto težina, jedinično i transportno pakovanje, `containerQty` (komada u standardnom kontejneru od 69 m³, `null` ako nije uneto), `supplierProductName` (naziv artikla kod dobavljača, `null` ako nije unet), trenutne SPC/loyalty cene, `activeLoyaltyDiscountPct` (aktivni loyalty popust % za ceo katalog, kao na sajtu; `null` ako nema aktivnog pravila) | Ceo katalog, bez datumskog filtera; uključuje `deletedAt` |
| `inventory` | `physical, reserved, available, incoming`, stanje po aktivnim magacinima, zasebno dobavljačko stanje | Ceo trenutni lager; `catalogEligible` = fizički lager > 0 ili SP, uz isključenje obrisanih |
| `prices` | Cenovnici sa valutom i važenjem, nabavne cene sa važenjem, trenutne SPC cene i sačuvana istorija loyalty cena | Svi sačuvani zapisi po artiklu, bez datumskog filtera |
| `loyalty-rules` | Aktivna/neaktivna globalna i artikalska loyalty pravila, procenat, prioritet, početak/kraj i artikli | Sva sačuvana pravila |
| `promotions` | Akcije, tip, hero oznaka, period, šifre/cene u `actionPrices`, hero meseci | Akcije koje presecaju zadati period |
| `purchase-orders` | ID/broj/status, datumi, dobavljač, očekivana isporuka, valuta/kurs/vrednost, artikli, količine, nabavne cene, zapremine/carinske stope | `createdAt`; opciono `status=DRAFT` za **U obradi**; ostalo SENT/CONFIRMED/RECEIVED/CANCELLED |
| `inbound-invoices` | Proknjižene prijemnice, dobavljač, povezana PO, valuta/kurs, iznosi i troškovi | `invoiceDate`, ili `createdAt` ako datum nije unet; samo POSTED |
| `goods-receipts` | Iste proknjižene prijemnice i polja kao `inbound-invoices`; naziv za SEF → Prijemnice u SPCApp-u | `invoiceDate`, ili `createdAt` ako datum nije unet; samo POSTED |
| `shipments` | Pošiljka/kurir/status, tracking, datumi, COD iznos, paketi i dimenzije, veza porudžbine/predračuna/fiskalnog dokumenta i fiskalizovana dostava | `createdAt`; SPC pošiljke, Ananas kuriri su u `ananas-orders` |
| `courier-statements` | Uvezeni kurirski obračuni: dokument, stavke, tracking, knjiženje, neto/bruto trošak/doznaka, težina i shipment ID | Datum uvoza obračuna `createdAt`; pojedinačne stavke imaju poslovni `bookedOn` |
| `sef-invoices` | Ulazne SEF fakture: dobavljač/PIB, broj, datum/dospeće, neto/PDV/bruto, obračunski period kada postoji u XML-u, metapodaci priloga | `issueDate`; opciono `supplierPib=123456789`, ne pretpostavljati PIB X Express-a |
| `traffic` | `pageViews, uniqueVisitors, visits, eventsWithoutSession` | Događaji PAGE_VIEW; `granularity=hour/day/month/year`, početno day |
| `customers` | SPC `uniqueCustomers, newCustomers, returningCustomers, eventsWithoutIdentity` | `granularity=hour/day/month/year`; `basis=orders` ili `basis=fiscal` |
| `product-performance` | KOZ (`koz/estimatedKoz`), prosek cene, dnevna prodaja, raspoloživi dani, prosečna vrednost lagera, oznake potpunosti istorije | Period do 366 dana; koristi postojeći WEB obračun, ne uključuje Ananas prodaju |

### Porudžbine i popusti

`orders.items.grossBeforeOrderDiscounts` je prodajna cena × količina, pre dodatnih popusta na celoj porudžbini. `netBeforeOrderDiscountsEstimate` koristi 20% PDV i označen je kao procena. Za stvarne fiskalne iznose koristiti `fiscal-documents.lines`.

`firstPurchaseDiscount`, `savedCardDiscount`, `voucherDiscount` su popusti cele porudžbine. Ne sabirati ih ponovo za svaki artikal/fiskalni dokument. U fiskalnom izvozu je `orderFirstPurchaseDiscountGross` referenca na popust porudžbine, a `firstPurchaseDiscountAllocatedGross=null`: istorijska raspodela tog konkretnog popusta po parcijalnim računima nije sačuvana. Neto/bruto fiskalni iznosi već sadrže primenjene popuste.

Ananas ne čuva posebnu oznaku popusta za prvu kupovinu: vrednost je `null`, ne nula. Neki uvozi Ananas porudžbina nastali iz pošiljaka nemaju neto/PDV/dostavu; API to ne izmišlja. `dataQuality.skippedItems` označava JSON stavke koje nisu prošle proveru poznatog formata.

### Fiskalni iznosi i COGS

- `kind=SALE` daje pozitivne iznose; `REFUND` negativne. `quantity` je apsolutna, `signedQuantity` negativna kod refundacije. Ne množiti refund iznose ponovo sa -1.
- Stavke imaju `merchandiseGross/Net`, `shippingGross/Net`. SPC ima i `assemblyGross`; ugrađena montaža je izdvojena iz robe pomoću sačuvanog `serviceGross`.
- `unitCogsNet` je cena po komadu bez PDV-a; `totalCogsNet` već sadrži količinu i znak refundacije. Usluge nemaju COGS.
- Sačuvani SPC COGS ima prednost. Za ostalo se koriste proknjižene nabavke za datum prodaje, zatim važeća RSD nabavna cena, pa prva dostupna istorijska vrednost i trenutni COGS.
- Refundacija koristi datum originalne prodaje kada je dostupan, čak i kada original nije u izabranom periodu. Ananas označava `originalSaleDateMissing` ako referenca nije uvezena.
- `cogsEstimated`, `estimatedCogsQuantity`, `missingCogsQuantity` čuvaju kvalitet obračuna. Ako deo robe nema COGS, dokumentov `totalCogsNet=null`; poznati deo je `knownCogsSubtotalNet`.
- `merchandiseQuantity` i `multipleMerchandiseUnits` broje komade robe bez dostave/montaže. Broj računa računati po jedinstvenom dokumentu i kanalu, posebno SALE/REFUND.
- Naknadne fakture menjaju izvedeni COGS bez promene `FiscalDocument.updatedAt`. Zato se istorija mora ponovo čitati.

### Kupci i posete

`customers` vraća **SPC**, bez imena, adresa, telefona i emaila. Interno bira postojeći customerId/userId, a kada ih nema koristi normalizovan kontakt za agregaciju. To je identitet poznat ERP-u, ne garantovano jedna fizička osoba: duplikati master podataka i promenjeni kontakti mogu uticati na rezultat.

`basis=orders`: sve porudžbine osim OTKAZANO; datum kreiranja. `basis=fiscal`: izdati SALE dokumenti, datum izdavanja; REFUND ne stvara novog kupca i ne briše istorijski prvi datum prodaje. „Novi“ je prvi zabeleženi kvalifikujući događaj u bucketu, „ponovljeni“ je kupac sa ranijim događajem pre bucketa. Više kupovina novog kupca u istom bucketu i dalje čine jednog novog kupca. Prvi datum se računa i iz istorije pre `from`, koliko je sačuvana.

Ananas nema pouzdan zajednički identitet kupca: `ananasCustomerCoverage=ANANAS_IDENTITY_NOT_AVAILABLE`. Broj Ananas porudžbina nije broj jedinstvenih kupaca.

Posete su zabeleženi događaji uz saglasnost. `uniqueVisitors` = različiti anonymousId; `visits` = različite sesije (anonymousId kao fallback kad sessionId nedostaje). Ne sabirati dnevne jedinstvene posetioce/kupce za mesečni rezultat — zatražiti month/year. Lokalni ponovljeni sat pri promeni vremena pripada jednom lokalnom satnom bucketu. Sirovi analytics događaji imaju rok važenja 13 meseci; endpoint ne garantuje stariju istoriju.

### Lager, cene, nabavke i SEF

- Uvoziti ceo `products` i `inventory`, pa u SPCApp-u filtrirati `inventory.catalogEligible`. Ne brisati istorijske reference na artikle koji više nisu u prodaji. Produktov `catalogEligible` je samo hint na osnovu master `stock`; usaglašeni fizički lager je u `inventory`.
- Dobavljački lager nije fizički lager SPC-a. `available` već uzima rezervacije u obzir.
- Pakovanje artikla nije isto što i stvarni poslati paket: za drugo koristiti `pickupBatchLines`.
- `products.ananasCurrentPrice=null`: kompletan aktuelni Ananas cenovnik nije sinhronizovan. Sačuvani ANANAS cenovnici su u `prices`, ostvarene prodajne cene u Ananas dokumentima.
- Akcije/loyalty istorija obuhvataju sačuvane zapise; obrisane ili prepisane istorijske vrednosti nije moguće rekonstruisati ovim API-jem.
- Prijemnica ima `recordedInvoiceVat`; `importVat=null` i `importVatStatus=NOT_SEPARATELY_RECORDED`, jer uvozni PDV nije posebno klasifikovan u modelu.
- Za SEF → Prijemnice koristiti `GET /api/partners/v1/spcapp/goods-receipts` sa postojećim `spcapp:read` Bearer ključem i standardnim `from`, `to`, `limit`, `cursor` parametrima. `goods-receipts` i `inbound-invoices` predstavljaju iste zapise sa istim ID-ovima: uvoziti jedan od njih kako se prijemnice ne bi duplirale. Kursor važi samo za resurs za koji je izdat.
- `shipments.fiscalDocuments[].orderShippingGross/Net` je iznos za **celu porudžbinu**. Ako ima više pošiljaka, deduplikovati po fiskalnom document ID-u; to nije raspodeljeni prihod po paketu.
- SEF `specificationLines=null` i `courierStatementId=null`: automatsko parsiranje kurirskih specifikacija i formalno povezivanje sa uvezenim obračunom još nisu uvedeni. `courier-statements.lines` su već strukturisani podaci iz zasebnih uvoza.

Prilog SEF računa preuzima se preko `attachments[].downloadPath`, istim Bearer ključem:

```text
GET /api/partners/v1/spcapp/sef-attachment?documentId=<ID>&index=0
```

Odgovor je binary download (`application/octet-stream`), uz filename u `Content-Disposition`. Ne treba direktan pristup privatnom storage bucketu. `attachmentError` označava neuspešno čitanje starog/neispravnog XML-a. Neki prilozi mogu sadržati operativne podatke o isporuci; čuvati ih u privatnom skladištu SPCApp-a.

## Sinhronizacija koja ne gubi izmene

1. Pozvati manifest. Za svaki resurs izabrati fiksne parametre perioda i proći do `nextCursor=null`.
2. Svaki zapis UPSERT-ovati po `(resource,id)`. Ugnježdene stavke zameniti novom listom u istoj lokalnoj transakciji; prazna lista briše stare podstavke.
3. Prvi prenos istorije deliti na mesece za poslovne dokumente, bez preklapanja. Datum filtera proveriti u tabeli. Katalog/lager/cene/rules se preuzimaju u celini.
4. Redovno ponavljati kompletne relevantne prolaze, npr. lager na 5–15 minuta, poslovne dokumente u kratkom aktuelnom periodu, a potpunu istoriju noću. Dok se stare fakture intenzivno unose, pokretati potpunu istorijsku fiskalnu/COGS sinhronizaciju češće ili ručno odmah posle knjiženja. Ovo nije instant push promena.
5. Nedostajući zapis ukloniti iz **izvedenog rezultata tačno tog skupa/perioda** tek posle završenog uspešnog celog prolaza. Ne raditi masovno brisanje na osnovu jedne stranice, greške ili delimičnog prolaza. Pošto se datumi/statusi mogu menjati, periodične pune provere su obavezne.
6. API je živ prikaz, ne zamrznuti snapshot preko više HTTP zahteva. ID keyset ne koristi offset; paralelne izmene biće usaglašene sledećim punim prolazom. `generatedAt` nije inkrementalni watermark. Odsustvo iz nepotpunog/užeg resursa nije dokaz brisanja celog ERP entiteta.
7. COGS, kupci i performanse ponovo se računaju; ne oslanjati se samo na root `updatedAt`. API namerno odbija `updatedSince` da ne obeća nepotpun feed.

Primer potpunog Node server klijenta je `scripts/spcapp-client-example.mjs`. Ima timeout, ukupni deadline po stranici, ograničen retry sa backoff/jitter, Retry-After i detekciju ponovljenog kursora:

```javascript
import { readSpcappResource } from './spcapp-client-example.mjs';
for await (const document of readSpcappResource('ananas-fiscal-documents', {
  from: '2025-05-01', to: '2026-10-18'
})) {
  // Implementirati u SPCApp-u:
  await upsertByResourceAndId('ananas-fiscal-documents', document.id, document);
}
```

## Greške

| HTTP | Postupak |
|---|---|
| 401 | Nedostaje/nevažeći/opozvan Bearer ključ. Ne ponavljati bez ispravke. |
| 403 | Ključ nema `spcapp:read`. Postojeći inventory ključ sam po sebi nije dovoljan. |
| 400 | Parametri, kursor ili period nisu važeći. Ispraviti zahtev; ne retry-ovati isti. |
| 404 | Nepostojeći resurs ili prilog. |
| 429 | Početni limit ključa je 120 zahteva/minut; poštovati Retry-After. |
| 500 | Ograničen retry sa pauzom. Ako se ponavlja, poslati `requestId` održavanju; detalji baze se ne izlažu. |

Odgovori su `private, no-store`; ne keširati ih u javnom CDN-u. Pri retry-u slati isti cursor. Serverski ključ ne prati redirect na drugi origin (primer klijenta koristi `redirect:error`).

## Kreiranje ključa u ERP-u

Superadmin otvara `/admin/erp/spcapp` (u ERP meniju **SPCApp API**), upisuje naziv i bira **Napravi ključ**. Ključ se pojavljuje samo u tom odgovoru. Dugme **Kopiraj ključ** kopira vrednost za serversku tajnu SPCApp-a. Posle napuštanja stranice ključ nije moguće ponovo pročitati; po potrebi napraviti novi i opozvati stari. Lista prikazuje aktivnost i omogućava opoziv. Ostale ERP uloge nemaju pristup upravljanju ključevima.

## Kreiranje i opoziv ključa — alternativa za održavanje ERP-a

Ne traži se migracija baze; koristi se postojeća tabela PartnerApiClient. Tajna se čuva kao SHA-256 hash u bazi. Nova dozvola ne proširuje pristup postojećim partnerima.

Sa lokalnim privatnim env fajlom koji sadrži direktnu/session vezu baze:

```bash
ENV_FILE=/absolute/private/erp-production.env \
  node scripts/create-spcapp-key.mjs \
  --name SPCApp \
  --out /absolute/private/spcapp-credentials.env
```

Output fajl mora biti nov; skripta ga pravi sa dozvolama 0600 i nikad ne ispisuje token. Ne praviti ga u repozitorijumu ili iCloud-u. Sadržaj preneti samo u serverski secret store SPCApp-a. Skripta vraća clientId i putanju fajla. Podrazumevani limit je 120/min.

```bash
ENV_FILE=/absolute/private/erp-production.env \
  node scripts/create-spcapp-key.mjs --revoke <clientId>
```

Za rotaciju napraviti novi ključ, ažurirati SPCApp serversku tajnu, proveriti poziv, zatim opozvati stari. Ne davati dozvolu `reservations:write`.

## Šta SPCApp treba da implementira

Serverski konektor + privatno skladište + zakazani poslovi; nije potrebna promena ERP poslovnih tokova. Početi resursima `orders`, `ananas-orders`, `fiscal-documents`, `ananas-fiscal-documents`, `products`, `inventory`. Potom dodati ostale. Statistiku kupaca/poseta preuzimati u potrebnoj granularity; stvarne prilive čitati iz payments/doznaka, a promet iz fiskalnih dokumenata. Fiskalni promet nije isto što i primljen novac.
