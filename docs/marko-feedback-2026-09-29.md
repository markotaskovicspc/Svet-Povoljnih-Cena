# Markove prijave — 29. septembar 2026.

Izmene su lokalne; objavljivanje i otkazivanje kod kurira nisu obavljeni u ovom zadatku. Produkcioni podaci provereni su samo čitanjem.

1. **FLEX SEAT:** aktivna šifra je 110082. Poslednja dvoslovna reč u višerečnom upitu sada podržava prefiks (`flex se` → FLEX SEAT). Kratke reči na drugim mestima ostaju tačne (`TV sto` ne nalazi `Tvoj sto`). Provera stvarnog SQL toka nad katalogom prošla je uz read-only DB konekciju.
2. **X Express PDF:** grupna i pojedinačna adresnica vraćaju pravi `application/pdf` dokument sa `.pdf` nazivom, koristeći postojeći lokalni Chromium renderer. Autentikacija ostaje na preuzimanju; preuzeti PDF može da se prosledi drugom licu bez admin pristupa.
3. **SPC-2026-001098:** proizvod 110087 × 3 već ima dve kutije u PRE-2026-0052. `AAA0850301437` nosi 2 komada, `AAA0850301438` nosi 1. Fotografisane nalepnice `AAA0850301436` i `AAA0850301439` pripadaju drugim porudžbinama, SPC-2026-001096 i SPC-2026-001099 (po 1 komad). Nisu kreirane nove pošiljke niti menjana pakovanja.
4. **Ručni predračuni:** detalj porudžbine prikazuje sve povezane picking naloge sa direktnim linkovima i statusima. MP-2026-00006 trenutno nema vezu sa picking nalogom; prikazuje se jasna poruka o tome.
5. **Istorija statusa:** postojeći PRE brojevi u napomenama postaju linkovi ka odgovarajućem nalogu. Nepostojeći/obrisani brojevi ostaju tekst.
6. **SPC-2026-001106:** porudžbina sa 16 ELEGANCE SEAT stolica je otkazana. Osam paketa je i dalje evidentirano uz X Express nalog `26-0001319329`, barkodovi `AAA0850301447`–`AAA0850301454`; zatečeni lokalni status pošiljke je CREATED. Novi kod isključuje otkazanu isporuku iz aktivnog prikaza i štampe, zadržava je u zasebnom upozorenju sa referencom kurira i blokira ponovno kreiranje/slanje/štampu adresnica. Povrati i zamene imaju odvojen životni ciklus.

## Preostala operativna radnja

Trenutni X Express klijent nema implementiran ugovor/API za otkazivanje. Isključivanje iz pickinga nije potvrda otkazivanja kod kurira. Za nalog `26-0001319329` potrebno je zatražiti otkaz svih osam paketa direktno od X Express-a i sačuvati njihovu potvrdu. Nije slata poruka kuriru, niti je lokalno upisan izmišljeni status otkazivanja.

Predlog teksta za operatera: „Molim otkaz kurirskog naloga 26-0001319329, svih osam paketa AAA0850301447–AAA0850301454, vezano za porudžbinu SPC-2026-001106. Kupac je otkazao svih 16 stolica ELEGANCE SEAT. Robu ne preuzimati. Molim potvrdu otkazivanja.”

## Provere

- 112 ciljanih testova: pretraga, grupne i pojedinačne PDF adresnice, stvarno PDF renderovanje, pakovanja 2+1, isključenje otkazanih paketa, linkovi, zabrana pripreme i najave otkazane porudžbine, postojeći kurirski i cancellation tokovi.
- Dodatna jednokratna provera stvarne pretrage kroz read-only konekciju: FLEX SEAT 110082 pronađen za `flex se`.
- `npm run build` prošao, uključujući TypeScript, 11 checkout-isolation provera i proveru PDF runtime resursa. Ciljani ESLint i `git diff --check` prošli. Oba PDF endpointa uključuju Chromium i Playwright runtime u svojim produkcionim paketima.

Podsetnik: Vercel Production koristi `ENFORCE_WEB_AUTO_AVAILABILITY=false`; strogo pravilo ne uključivati pre uvoza i provere DC zaliha. Politika dobavljačkih zaliha i oznaka za kupca može se prilagoditi zahtevu klijenta.
