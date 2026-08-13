# Environment matrix

## Pravilo tumačenja

Lokalni `.env.local` je proveravan samo po prisustvu, režimu i placeholder semantici; tajne nisu ispisane. On **nije** dokaz Vercel Production vrednosti. Produkcioni redovi su potvrđeni samo tamo gde postoji HTTP/browser/DB/GitHub runtime dokaz. `GET_FROM_*` vrednosti su tretirane kao placeholder iako su truthy.

| Tema | Local/worktree | Test/sandbox | Production dokaz | Status | Rizik/akcija |
|---|---|---|---|---|---|
| App URL | `www.svetpovoljnihcena.rs` public base u root env-u | localhost vrednosti u Playwright scriptama | HTTP→HTTPS i apex→www daju 308; www 200 | PASS | Dodati runtime SHA/version endpoint |
| Database | `DATABASE_URL` i non-pooling na 5432; Prisma URL 6543 | Nema `E2E_DATABASE_URL` za ovaj audit | Read-only Prisma upit uspešan; health DB up | PASS | Zadržati 5432 za runtime/migrate po AGENTS pravilu |
| Migrations | Prisma schema + 64 lokalne migracije | Nema posebne QA baze | 64/64 completed, 0 pending/failed | PASS | `db:harden` posle svake direktne Prisma CLI operacije |
| Supabase | Isti project fingerprint u root/subdir env-u | Nije posebno izolovan | RLS/grants/bucket policy potvrđena DB/runtime proverom | PASS | Periodični hardening + restore test |
| Auth secrets | Potrebne auth/order/service tajne izgledaju postavljene | Playwright koristi posebne lokalne vrednosti u pojedinim scriptama | Login/customer/admin zaštita radi | PARTIAL | Dashboard env parity nije dostupan; rotacija/runbook dokaz nedostaje |
| Email | `EMAIL_PROVIDER=resend`, key/webhook prisutni | `EMAIL_PROVIDER=none` u izolovanim ERP testovima | Resend 403: domen nije verifikovan; 38 FAILED | FAIL / P0 | Verifikovati domen i izvršiti template canary matricu |
| Fiscal | `FISCAL_PROVIDER=badi`, `BADI_ENV=sandbox`; mode/location nedostaju | Sandbox | Nema aktuelnog production acceptance dokaza | FAIL / P0 | Popuniti mode/location, training + production račun/storno |
| IPS | Test PGW base, credentials placeholder, acceptance false/unset | Sandbox/test | Metoda nije ponuđena kupcu | BLOCKED | Provider acceptance i callback/cancel/reconciliation matrica |
| RaiAccept | Public base lokalno pokazuje localhost; credentials nisu potvrđeni | Dormant | Metoda nije ponuđena kupcu | BLOCKED | Ukloniti cross-env localhost rizik ili dovršiti sandbox/production konfiguraciju |
| COD/uplata | Enabled u DB/runtime-u | Unit pokrivenost | Tri metode vidljive u checkout-u | PARTIAL | Nema uspešne kompletne porudžbine |
| Rabalux | Credentials mogu dolaziti iz Supplier DB-a; env `RABALUX_ENABLED` nije jedini source | Integration test postoji | Catalog/stock cron uspešan; kupiv SKU | PASS za katalog/lager | Media queue je FAIL/P1 |
| X Express | enabled, `ENV=test`, auto-create false | Test nalog | Master sync delimično pada; webhook backlog | FAIL / P1 | Batch fix i pun sandbox order/webhook E2E |
| MyGLS | enabled, `ENV=production`, auto-create false, acceptance/config prisutni | Test endpoint podržan kodom | Istorijski controlled QA label dokaz; nije svež full E2E | PARTIAL | Produkcioni canary uz eksplicitno odobrenje |
| Viber | provider/token nisu postavljeni | none | Nema runtime dokaza | BLOCKED | Isključiti UI očekivanja ili dovršiti provider acceptance |
| eOtpremnica/SEF | nije konfigurisano/enabled | Mock/adapter kod | Nema provider acceptance | BLOCKED | Jasno izbaciti iz launch scope-a ili dovršiti sandbox |
| GA4 | GTM/GA hostovi u CSP; kod/unit postoji | GA4 E2E je gate-ovan | Browser bez console greške; stvarni hit/Measurement ID nije potvrđen | PARTIAL | GA DebugView consent-aware canary |
| Availability flag | `ENFORCE_WEB_AUTO_AVAILABILITY` unset ⇒ false | Unit politika pokrivena | AGENTS navodi Vercel Production `false`; storefront ipak kupuje svež Rabalux | PARTIAL | Ne uključivati `true` pre DC importa/audita |
| Static fallback | `ENABLE_STATIC_CATALOG_FALLBACK=1` | Lokalno aktivan | Runtime fallback događaj nije posmatran | PARTIAL | Alarmirati fallback i potvrditi da ne maskira DB kvar |
| Support phone | Public support phone nedostaje u env check-u | — | Merchant/returns kontakt nije potpuna zamena na svim površinama | FAIL / P1 | Postaviti i vizuelno proveriti footer/legal/checkout |
| Cron secrets | Relevantne cron tajne izgledaju prisutne | Lokalni testovi koriste mock/gates | Cron rezultati postoje u DB | PARTIAL | Rotacija, last-success i alert SLO po cron-u |

## Root vs nested env

Root `.env.local` ima 185 ključeva i predstavlja runtime konfiguraciju repozitorijuma. `svet akcija/.env.local` ima samo 16 Supabase ključeva i nije runtime root za Next aplikaciju; treba ga obeležiti kao pomoćni/legacy kako bi se izbeglo pogrešno auditovanje ili rotacija pogrešnog fajla.

## Produkcioni availability podsetnik

`ENFORCE_WEB_AUTO_AVAILABILITY=false` mora ostati bezbedni default dok DC lager nije importovan i auditovan. Analogija „dve kutije”: DC kutija se puni CSV/XLSX importom i ručno koriguje; Rabalux kutiji se veruje 30 minuta, drži jednu jedinicu u rezervi i kupcu pokazuje samo „Dostupno kod dobavljača” uz 5–8 dana. Ako strogo enforcement ponašanje napravi problem, rollback je `false` + redeploy. Klijent još može zahtevati drugačiju supplier-stock/customer-label politiku.
