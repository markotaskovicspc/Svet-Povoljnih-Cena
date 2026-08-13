# Production readiness

## Odluka

**NO-GO** na preseku 11.08.2026. Tehnički build je deployable, ali poslovni sistem nije launch-ready dok P0 email, fiskal i order E2E gate-ovi nisu zatvoreni.

## Readiness scorecard

| Gate | Stanje | Status | Launch uslov |
|---|---|---|---|
| Source/commit | HEAD = origin/main, Vercel status success | PASS | Zaključati tačan launch SHA i izložiti ga health/version endpointom |
| Lint/unit/build | 0 / 573 PASS / build PASS | PASS | Ponoviti na čistom launch commitu u CI |
| Dependency security | 0 npm audit vulnerability | PASS | CI check + lockfile review |
| DB schema | 64/64, 0 pending/failed | PASS | Backup/restore dokaz i `db:harden` posle deploy-a |
| DB security/storage | RLS/grants/private buckets uredni | PASS | Automated post-deploy assertion |
| Storefront availability | Rabalux radi; DC strict enforcement off | PARTIAL | DC import/audit pre bilo kakvog `true` flag-a |
| Canonical runtime readiness | PASS sa candidate Rabalux flagom; 1.080 launch-spremnih, 669 bez dimenzija | PASS/PARTIAL | Ponoviti unutar stvarnog deployment env-a; ne skrivati dimension/DC dug |
| Cart/checkout do review | realan produkcioni browser PASS | PASS/PARTIAL | Kompletan submit canary |
| Order/payment lifecycle | nema uspešnog lanca | BLOCKED / P0 | Odobren full E2E i reconciliation |
| Transactional email | Resend 403 | FAIL / P0 | Domain verified + canary matrica |
| Fiscal | env gate fail, sandbox | FAIL / P0 | Production config + sale/storno/retry |
| X Express | lokalni parameter-limit fix; istorijski partial cron + webhook failures | FAIL / P1 | Deploy fix-a, full sandbox acceptance i 2 cron success-a |
| MyGLS | controlled historical proof, no fresh full path | PARTIAL | Canary ili eksplicitno launch routing isključenje |
| Rabalux media | veliki stari retry backlog | FAIL / P1 | Stabilizovan queue/SLO |
| Roles | SUPER delimično; ostale blokirane | BLOCKED / P1 | Isolated 4-role E2E |
| Observability | health radi; integration status stale | FAIL / P1 | Real provider dashboard + alert canary |
| Performance/a11y | home heading i newsletter lokalno popravljeni; payload/PDP retest ostaju | PARTIAL | Production DOM retest, minimalni CWV/axe budget |
| Runbook/rollback | delimična dokumentacija postoji | PARTIAL | Dry-run incident, owner i rollback tabela |

## Hard go/no-go kriterijumi

Launch se može ponovo razmatrati samo ako su svi sledeći redovi PASS:

1. Tačan launch SHA prolazi lint, 573+ unit, build, npm audit i odabrane E2E suite-ove u CI.
2. `check:production-env` i ispravljeni canonical `check:runtime-readiness` daju PASS bez ignorisanih grešaka.
3. Resend domen je verifikovan i svi kritični template canary-i su prihvaćeni/isporučeni.
4. Fiskalni production režim je formalno potvrđen i sale/storno/retry dokazani.
5. Jedna odobrena kompletna porudžbina je reconciled kroz DB, email, payment/COD, inventory, shipment i fiscal.
6. X Express launch putanja je ili potpuno prihvaćena, ili feature/routing jasno isključen tako da kupac ne može ući u nedokazan tok.
7. Role matrica potvrđuje allow i deny ponašanje za SUPER/CONTENT/OPS/ADS sa 0 side-effect-a na forbidden akcijama.
8. Alerting za email/fiscal/order/job/cron radi kroz realan canary i ima imenovanog on-call owner-a.
9. Rollback je izvediv bez gubitka porudžbine; DB migracija je backward-compatible ili ima poseban forward-fix plan.
10. Poslovni owner odobrava payment, supplier availability label/policy, dostavu, fiskal i support copy.

## Deployment procedure

1. Freeze aplikacione izmene osim P0/P1 release fix-eva; označiti tačan commit i diff prema `df65e52...`.
2. Napraviti proverljiv DB backup i potvrditi vreme/odgovornu osobu za restore; ne oslanjati se samo na „backup enabled”.
3. Exportovati sanitizovanu Vercel env matricu i pokrenuti production checker nad stvarnim deployment env-om.
4. Pokrenuti migracije isključivo project scriptom koji chain-uje `db:harden`; posle toga proveriti 64+ migration parity, RLS, grants i bucket privacy.
5. Deploy preview/candidate, pa automated lint/unit/build/E2E/contract smoke.
6. Deploy production u kontrolisanom prozoru; potvrditi runtime SHA, `/api/health`, storefront, login/admin protection i key API GET.
7. Izvršiti jednu odobrenu canary porudžbinu i pratiti sve side-effect-e do reconciliation-a.
8. Aktivno pratiti prvih 60 minuta, zatim 4 h i 24 h: error rate, order/payment/fiscal/email/shipment/job backlog, Rabalux freshness i conversion.

## Feature flags i safe rollback

| Rizik | Safe rollback/containment |
|---|---|
| Web availability | `ENFORCE_WEB_AUTO_AVAILABILITY=false` + redeploy; ne uključivati strict pre DC audita |
| X Express/MyGLS auto-create | držati `*_AUTO_CREATE=false`; ručno/odobreno procesiranje dok acceptance ne prođe |
| IPS/RaiAccept | ne prikazivati/enable-ovati pre production acceptance-a; fallback na odobrene launch metode |
| Rabalux supplier | ako stock postane stale ili reconciliation pukne, fail closed supplier kupovinu; ne prikazivati tačnu količinu |
| Email | privremeno zaustaviti tok koji obećava email ako provider ne radi; urgentni manual kanal, ali launch ostaje NO-GO |
| Fiscal | stop order acceptance ako fiskalni failure/retry prelazi dogovoreni prag i nema zakonit recovery |

Rollback aplikacije ne sme automatski rollback-ovati migraciju ako bi to izgubilo nove porudžbine. Preferirati prethodni kompatibilan deployment ili forward fix; odluka mora biti u runbook-u po konkretnoj migraciji.

## Monitoring i alarmi

Minimalni SLO panel mora sadržati:

- checkout create success/error i idempotency conflict;
- porudžbine bez payment/shipment/fiscal/email side-effect-a duže od praga;
- Resend accepted/delivered/bounced/failed po kind-u;
- payment callback signature/duplicate/reconciliation/expiry;
- fiscal queued/retry/failed i najstariji job;
- courier create/status/webhook/dictionary last success i partial fail;
- Rabalux catalog/stock freshness, records read/ok/fail, reservation failure;
- background queue po kind/status, oldest age i dead-letter;
- DB connection latency/error, Vercel function error/duration, HTTP 5xx i CWV.

Trenutni `IntegrationHealth` nije dovoljan za ovaj gate.

## Go-live dežurstvo

Pre deploy-a imenovati: release commander, app/backend owner, DB owner, payments owner, fiscal owner, logistics owner, customer-support owner i business decision owner. Svaki dobija kontakt providera, dashboard link, stop/rollback ovlašćenje, decision timebox i unapred definisan prag za prekid launch-a.
