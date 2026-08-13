# Integration matrix

Legenda: **CONNECTED** = realan svež runtime dokaz; **PARTIAL** = deo toka radi, ali kompletan acceptance/SLO ne; **BROKEN** = svež dokaz greške; **BLOCKED** = konkretan gate/credential/safety nedostaje; **DORMANT** = kod postoji, launch površina nije aktivna.

| Integracija | Namena | Režim prema dostupnom dokazu | Runtime dokaz | Status | Launch odluka / acceptance test |
|---|---|---|---|---|---|
| Supabase PostgreSQL | Primarni podaci | Production | health DB up; read-only audit; 64/64 migracije | CONNECTED | Zadržati; dodati restore rehearsal |
| Supabase Storage | mediji, računi, reklamacije, etikete | Production | bucket privacy policy prolazi | CONNECTED | Canary signed URL i server-side receipt fetch |
| Rabalux katalog | artikli/cene/atributi | Production supplier | 11.08. katalog 2.884/2.884 SUCCESS | CONNECTED | Dva uzastopna dnevna success + reconciliation count |
| Rabalux lager | supplier availability | Production supplier | 15-min stock 2.883/2.883 SUCCESS; RAB-79196 kupiv | CONNECTED | Stale >30 min mora zaključati kupovinu; reservation conflict test |
| Rabalux mediji | slike/dokumenti | Production supplier | 23.682 completed, 3.011 retry, 305 failed, 5 queued | BROKEN / P1 | Fix retry/dead-letter pa dokaz opadajućeg backlog-a i 0 starih actionable jobova |
| Resend | transakcioni i marketing email | Production key, neverifikovan domen | 38 FAILED; svež HTTP 403 domain not verified | BROKEN / P0 | Verifikovati domen; canary svih kritičnih template-a i webhook delivery |
| X Express | adrese, shipment, status, webhook | Test account; auto-create false | lokalni parameter-limit fix postoji; poslednja 4 produkciona run-a ostaju partial; webhook 1 unprocessed/1 failed | BROKEN / P1 | Sandbox create-label-webhook-status-cancel/replay, oba crona 2x full SUCCESS |
| MyGLS | shipment/label/status | Production config + acceptance; auto-create false | QA label cleanup i istorijski sync; jedan stari Unauthorized | PARTIAL | Odobren produkcioni canary create/download/delete/status bez customer side-effect-a |
| COD/uplata na račun | launch payment | Enabled | checkout prikazuje 3 aktivne metode; payment redovi nisu settled | PARTIAL | Jedna uspešna porudžbina po launch metodi + cancellation/refund procedura |
| IPS | instant payment | Test PGW; acceptance gate zatvoren | adapter/callback testovi; metoda nije aktivna | BLOCKED | Banka/PGW whitelist, QR, return/callback duplicate/signature/expiry/reconciliation |
| RaiAccept | kartice/3DS | DORMANT; localhost public base u lokalnom env-u | adapter i PENDING istorijski payment; checkout metoda nije aktivna | DORMANT/BLOCKED | Ispravna public URL + sandbox 3DS success/fail/cancel/refund + production acceptance |
| Badi | fiskalizacija | Sandbox; mode/location nepotpuni | 2 istorijska ISSUED, 1 stari FAILED; env gate FAIL | BROKEN / P0 | Aktuelan training i production SALE+REFUND/storno+retry sa fiskalnim timom |
| Auth social Google/Apple/Facebook | identity | Provider-dependent | UI dinamički proverava `/api/auth/providers`; realan provider tok nije izveden | BLOCKED | Po provideru login/register/cancel/account-link E2E ili sakriti nekonfigurisane opcije |
| Phone OTP/SMS | identity | Nema transporta | issue/verify DB helper i credentials provider postoje; UI dugme ne šalje kod | BROKEN / P1 | SMS provider, masked response, rate limit, expiry, one-time consume, abuse test |
| Viber | marketing/obaveštenja | provider `none` | adapter postoji; nema token/production acceptance | DORMANT | Izbaciti iz launch obećanja ili dovršiti consent+send+unsubscribe acceptance |
| eOtpremnica | elektronske otpremnice | disabled/unconfigured | code gate i XML/API adapter postoje | BLOCKED | Sandbox credentials, XML validation, send/status/error replay |
| SEF | e-fakture | unconfigured | legacy IntegrationHealth NOT_CONFIGURED | BLOCKED | Eksplicitno van scope-a ili realan sandbox acceptance |
| GA4/GTM | analitika/e-commerce | verovatno production hostovi dozvoljeni CSP-om | unit testovi; browser bez console error; gated E2E nije pokrenut | PARTIAL | Consent izbori + DebugView za view_item/add_to_cart/begin_checkout/purchase |
| Google/Meta/TikTok feedovi | marketing katalozi | Endpoint kod postoji | Nije izvršen partnerski ingest niti validacija šeme | PARTIAL | Fetch endpointa, schema validator, sample diagnostics i freshness alarm |
| Partner API | eksterni lager/rezervacije | Kod + izolovani E2E postoji, gate nije aktiviran | 140 gated Playwright scenario-projekata preskočeno uključujući partner test | BLOCKED | Izolovana QA baza: auth/scope, idempotency, concurrency, reservation release |
| Vercel | deploy i cron | Production | trenutni GitHub status `Vercel success`; 11 cron schedule-a | PARTIAL | Runtime SHA, deploy rollback rehearsal, env parity export i cron SLO |

## Monitoring gap

Tabela `IntegrationHealth` nije autoritativna: ima samo šest stale `NOT_CONFIGURED` redova, nikada `checkedAt`, poslednju izmenu 18.07. i izostavlja Rabalux, Resend, MyGLS, Badi i druge stvarno aktivne tokove. Operativna konzola mora da računa stanje iz poslednjeg uspeha/neuspeha stvarnih job/payment/email/shipment/fiscal tabela i da prikazuje starost dokaza.

## Zaštita od lažno pozitivnog statusa

- „Configured” ne znači „radi”; npr. Resend key je prisutan, a sva realna slanja padaju.
- Istorijski `ISSUED` ili QA label nije aktuelan production acceptance.
- Provider koji nije prikazan u checkout-u nije launch-ready samo zato što adapter postoji.
- Success jednog sub-run-a ne poništava failure sledeće faze istog cron-a; X Express dictionary run je zato `BROKEN/PARTIAL`, ne PASS.
