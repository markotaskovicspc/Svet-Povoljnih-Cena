# Executive summary — pre-launch audit

Datum preseka: **11. avgust 2026, Europe/Belgrade**  
Auditovani commit: `df65e52eac8a63e24daee4cc6336a6207f561898` (`main`, 0 ahead / 0 behind `origin/main`)  
Lokalni remediation retest: **11. avgust 2026, 11:43 Europe/Belgrade; izmene još nisu deploy-ovane**  
Konačna odluka: **NO-GO**

## Poslovni zaključak

Platforma ima široku i ozbiljno implementiranu funkcionalnu osnovu: produkcioni storefront radi, Rabalux katalog i lager se sveže sinhronizuju, kupiv artikal može da stigne do finalnog checkout pregleda, obračun proverene korpe je tačan, build/lint/573 unit testa prolaze, baza je migraciono i RLS/storage bezbednosno uredna. To ipak nije dovoljno za bezbedan launch.

Launch blokiraju tri neposredna rizika:

1. **Transakcioni email je produkciono neispravan.** U bazi je sada 38 `FAILED` slanja, a svež Resend odgovor je HTTP 403 jer domen `svetpovoljnihcena.rs` nije verifikovan. Pogođeni su potvrda naloga, reset lozinke, potvrda/status porudžbine, reklamacija, newsletter opt-in i urgentni admin alarmi.
2. **Fiskalizacija nije u produkcionom režimu niti prolazi env gate.** `check:production-env` pada zbog nepostavljenih `BADI_FISCAL_MODE` i `FISCAL_LOCATION_ID`; lokalno auditovano okruženje je Badi sandbox. Ne postoji aktuelan, kontrolisan produkcioni račun + storno + retry dokaz.
3. **Nema dokaza uspešne produkcione porudžbine.** Svih 7 postojećih porudžbina je otkazano; nema uspešnog settlement/refund lanca. Audit je bezbedno stao pre dugmeta „Potvrdi porudžbinu” i nije generisao stvaran posao, naplatu, kurira ili fiskalni dokument.

Zbog toga launch ne treba odobriti čak ni uz feature-flag obećanje. Minimalni uslov za ponovno odlučivanje je zatvaranje P0 gate-ova i kontrolisan end-to-end canary.

## Najvažniji rezultati

| Oblast | Rezultat | Ocena |
|---|---:|---|
| Lint | exit 0 | PASS |
| Unit testovi | 122 fajla / 573 testa | PASS |
| Next build | exit 0; 83 statičke stranice | PASS |
| Dependency audit | 0 poznatih npm ranjivosti | PASS |
| Produkcioni env gate | 2 greške + 4 upozorenja | FAIL |
| Runtime readiness | Sa `RABALUX_ENABLED=true`: PASS; 1.080 launch-spremnih supplier SKU-ova, 669 bez dimenzija | PASS/PARTIAL |
| Playwright default | 148 projekt-scenarija: 8 PASS, 140 namerno SKIP | PASS/PARTIAL |
| Funkcionalni inventar | 1.780 stavki: 13 PASS, 1.695 PARTIAL, 72 BLOCKED | PARTIAL |
| Test matrica | 35 launch scenarija: 14 PASS, 14 FAIL, 4 PARTIAL, 3 BLOCKED | FAIL |
| DB finansijski integritet | 0 u 6 provera odstupanja/duplikata | PASS |
| DB migracije i Supabase zaštita | 64/64, 0 pending/failed; RLS/grant/bucket pravila uredna | PASS |
| Produkcioni health | HTTP 200, DB up, 28 ms u uzorku | PASS |

Inventar je namerno konzervativan: `PARTIAL` znači da implementacija/build ili reprezentativni tok postoji, ali nisu dokazane sve grane, persistence i eksterni side-effect. Neodređena statusna kategorija nije korišćena. `BLOCKED` redovi navode konkretan safety, credentials, role ili isolated-DB blocker.

## P0 launch gate-ovi

| ID | Gate | Dokaz zatvaranja |
|---|---|---|
| P0-01 | Verifikovati Resend domen i transakcioni email | Realan canary za confirm, reset, order confirmation/status, reclamation i urgent alert; svi `SENT/DELIVERED`, nema 403 |
| P0-02 | Produkciona fiskalizacija | `check:production-env` PASS + kontrolisan račun, storno i retry u dogovorenom Badi režimu |
| P0-03 | End-to-end porudžbina | Jedna odobrena launch porudžbina: storefront → DB → email → plaćanje/COD → kurir → fiskalni dokument → status; cleanup/storno dokumentovan |

## P1 rizici odmah iza gate-a

- X Express parameter-limit uzrok je lokalno ispravljen jednim PostgreSQL array parametrom; produkcioni dokaz i dalje zahteva 2 puna cron `SUCCESS` run-a. Webhook ostaje neispravan: 1/2 događaja je neobrađen, drugi neuspešan.
- Rabalux katalog/lager radi, ali media queue ima 3.011 `RETRY`, 305 `FAILED` i 5 `QUEUED` poslova; najstariji retry je od 21. jula.
- Mrtva SMS OTP kontrola je lokalno uklonjena, a email/password vodi na stvarnu auth rutu; produkcioni deploy/retest još nije izveden.
- Checkout trust copy je lokalno mapiran po metodi, tako da COD više ne tvrdi IPS/3-D Secure; produkcioni deploy/retest još nije izveden.
- Nema enabled CONTENT/OPS/ADS test naloga za realnu role acceptance matricu; produkciono su enabled samo tri SUPER naloga.
- `IntegrationHealth` je stale od 18. jula, ne sadrži ključne aktivne providere i ne predstavlja stvarno stanje.
- Pretraga crtica/punctuation je lokalno normalizovana i regresiono pokrivena; produkcioni `SMD` retest čeka deploy.
- Home lokalno ima jedan sr-only `h1`. PDP source ima jednu `h1` definiciju; raniji produkcioni DOM sa dva naslova mora se ponovo proveriti posle deploy-a. Veliki HTML payload-i ostaju.

## Šta je već dobro

- Rabalux stock sync na 15 minuta je uspešan (`2.883/2.883`), dnevni katalog `2.884/2.884`; SKU RAB-79196 je stvarno dodat u produkcionu korpu.
- Korpa je preživela refresh; provereni zbir `130 + 299 = 429 RSD` je tačan.
- DB provera je dala 0 order-formula, payment/order, invoice/order i fiscal/order mismatch-a, kao i 0 duplikata provider reference/tracking broja.
- Anonimni `/admin` i `/nalog` pravilno vraćaju 307 ka prijavi; autentifikovana SUPER sesija otvara dashboard.
- Security headers, HTTPS redirect, HSTS, CORS negativna proba, RLS i privatni PII bucket-i su dobri.
- Produkcioni desktop i 390 px tokovi nisu pokazali horizontalni overflow ni broken images; browser konzola je bila čista.

## Scope i ograničenja

- Početni audit je izveden nad postojećim dirty worktree-om korisnika. Naknadni lokalni remediation paket menja samo ciljane nalaze navedene u ovom dokumentu; ostale postojeće izmene nisu resetovane niti pripisane auditu.
- Lokalni `.env.local` nije dokaz Vercel Production vrednosti. Produkcioni status je izveden iz HTTP/browser/DB ponašanja i GitHub Vercel statusa; Vercel dashboard env matrica je BLOCKED bez konektora/odobrenog pristupa.
- Nisu izvršene produkcione mutacije porudžbine, naplate, refund-a, kurira, fiskala, newsletter prijave ili admin ERP podataka.
- Stari zahtev od 5% prve kupovine je supersedovan potvrđenim client-launch pravilom od 15% u novijem commitu; nije prijavljen kao bug.

Detaljni nalazi, ownership i retest koraci su u [06_BUGS_AND_MISSING_FEATURES.md](./06_BUGS_AND_MISSING_FEATURES.md), a redosled zatvaranja u [11_48_HOUR_ACTION_PLAN.md](./11_48_HOUR_ACTION_PLAN.md).
