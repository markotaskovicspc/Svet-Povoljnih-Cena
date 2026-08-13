# Local remediation update — 2026-08-11

Status: **lokalni kod i read-only retest završeni; nije deploy-ovano; konačna odluka ostaje NO-GO**.

## Zatvoreno lokalno

- Uklonjena je nefunkcionalna SMS OTP opcija iz checkout-a; email/password vodi na stvarnu auth rutu.
- Checkout trust poruka se bira prema metodi plaćanja; COD ne tvrdi IPS ili 3-D Secure.
- Newsletter forma je zaključana pre hydration-a, test čeka React handler, a development CSP više ne prebacuje localhost assete na HTTPS u WebKit-u.
- Početna strana ima jedan opisni sr-only `h1`.
- Search normalizuje punctuation, pa `SMD` može da kandiduje naziv `SMD-LED`.
- X Express deaktivacija velikog uličnog šifarnika koristi jedan parametrizovani PostgreSQL `integer[]`, ne prošireni `NOT IN`.
- Runtime readiness koristi DC/supplier raspoloživost, item-level freshness, approval, rezervacije, prag i safety buffer; izveštaj je sažet na count/source/canary.

## Dokazi

| Provera | Rezultat |
|---|---|
| `npm run lint` | PASS |
| `npm run test:unit` | 122 fajla / 573 testa PASS |
| `npm run build` | PASS; 83/83 statičke stranice |
| `npm run test:e2e` | 8 PASS / 140 namerno SKIP |
| Readiness sa process-only `RABALUX_ENABLED=true` | PASS; 1.617 published, 1.558 checkout-sellable, 1.080 launch-spremnih |
| X Express regresija | 40.000 jedinstvenih ID-jeva ostaje jedan array parametar |
| DB audit | 64/64 migracije; RLS/grants/bucket pravila uredna; finansijska odstupanja 0 |

Readiness je namerno pokrenut sa privremenim process flagom, jer lokalni `.env.local` nije dokaz Vercel Production vrednosti. Nijedan env fajl nije menjan. `ENFORCE_WEB_AUTO_AVAILABILITY` ostaje `false` dok DC lager ne bude uvezen i auditovan.

## Nije zatvoreno

1. **P0 email:** 38 Resend `FAILED`; domen i dalje nije verifikovan.
2. **P0 fiskal:** production env/mode/location i sale/storno/retry canary nedostaju.
3. **P0 order E2E:** nema odobrene kompletne produkcione porudžbine i reconciliation-a.
4. **X Express acceptance:** kodski fix zahteva deploy i dva uzastopna puna dictionary `SUCCESS` run-a; webhook backlog ostaje.
5. **Rabalux media:** 3.011 `RETRY`, 305 `FAILED`, 5 `QUEUED` ostaju.
6. **Data quality:** 669 aktivnih proizvoda nema kompletne dimenzije; DC stock import/audit nije završen.
7. **Production UI retest:** search, home/PDP headings, checkout copy i uklonjeni OTP moraju se potvrditi na deploy-ovanom candidate-u.

Bez promene sva tri P0 reda release odluka ostaje **NO-GO**.
