# 48-hour action plan

Cilj plana nije da „ugura” launch za 48 sati, već da za 48 sati ili proizvede dokaziv GO kandidat, ili bez dileme zadrži NO-GO. Vremena su od trenutka formalnog starta i mogu teći paralelno samo kada nema zajedničkog provider/data rizika.

## 0–2 h — freeze, ownership, safety

| Akcija | Owner | Izlaz / dokaz | Stop uslov |
|---|---|---|---|
| Zaključati launch branch/SHA i listu dozvoljenih P0/P1 izmena | Release commander | release manifest i diff owner | nejasan scope/dirty overlap |
| Imenovati email, fiscal, logistics, DB i business owner-e | Business/Tech lead | kontakt i escalation tabela | nema dostupnog decision owner-a |
| Obezbediti isolated QA/test DB i fixture naloge za 4 admin role | DB + QA | URL čije ime sadrži qa/test; safety helper prihvata | ne koristiti production DB |
| Potvrditi backup/restore i migracioni rollback/forward-fix | DB owner | timestamp backup-a + rehearsal koraci | restore nije dokazan |
| Exportovati sanitizovanu Vercel Production env matricu | DevOps | prisustvo/režim/placeholder, bez tajni | local env se ne prihvata kao dokaz |

## 2–8 h — zatvaranje P0-01 i P0-02

### Email workstream

1. Verifikovati Resend domen/DNS i FROM identity.
2. Proveriti webhook secret i delivery event obradu.
3. Poslati jedinstvene canary poruke: email confirm, password reset, order confirmation, status, reclamation, newsletter opt-in, urgent alert.
4. Sačuvati provider ID + DB status + inbox dokaz; ne ponavljati stare customer poruke bez poslovnog odobrenja.

**Exit:** 0 novih 403; svi canary-i accepted i kritični transactional delivered.  
**Owner:** Email/DevOps + Support.

### Fiscal workstream

1. Fiskalni/business owner bira i potvrđuje `public` ili `vpfr` režim i location/cashier identitete.
2. Popuniti stvarni Vercel env i pokrenuti production checker.
3. Izvesti training SALE + storno + retry/idempotency.
4. Tek po formalnom odobrenju izvesti minimalni production canary.

**Exit:** checker PASS; iznosi/UI/DB/Badi dokument reconciled; retry ne duplira dokument.  
**Owner:** Fiscal/backend + računovodstvo.

## 2–12 h — P1 operativna stabilizacija

| Akcija | Owner | Acceptance |
|---|---|---|
| Deploy lokalnog X Express array-parametar fix-a | Logistics/backend | 2 puna dictionary run-a bez failed faze |
| Webhook replay/reconciliation | Logistics/backend | valid/invalid/duplicate/out-of-order test; backlog 0 |
| Rabalux media retry klasifikacija i backlog plan | Catalog/backend | permanent greške dead-letter; oldest actionable unutar SLO-a; backlog pada |
| Integration health rewrite/adapter | Observability/backend | stvarni last-success/fail/age za launch providere |
| Support phone i production retest payment trust copy-ja | Content/frontend/business | lokalni copy fix postoji; COD ne pominje IPS/3DS i business ga odobrava |
| SMS OTP odluka | Product/auth | lokalno je kontrola uklonjena; potvrditi deploy ili implementirati kompletan secure flow kasnije |

## 8–20 h — isolated acceptance

Na izolovanoj QA bazi pokrenuti postojeće gated suite-ove po prioritetu, sa write-and-cleanup i DB/audit assertion-ima:

1. `admin-roles.spec.ts` — SUPER/CONTENT/OPS/ADS allow/deny.
2. `checkout-confirmation-navigation.spec.ts` i commerce/cache/GA4 read-only suite.
3. `rabalux-checkout-admin.spec.ts` — supplier reservation/order/admin handoff.
4. purchase order, inbound invoice, sales order, warehouse/import, stocktake/dispatch, pickup batch.
5. partner API auth/scope/idempotency/concurrency.
6. password reset i newsletter isolated acceptance.

**Exit:** svi odabrani scenario-projekti PASS; cleanup dokaz; 0 otvorenih test zapisa/labela/emaila.  
**Owner:** QA automation + module owner.

## 12–24 h — application fixes i regression

- [x] Lokalno popravljen search normalization `SMD`↔`SMD-LED` i dodat unit regresioni test; production E2E posle deploy-a ostaje.
- [x] Home dobija jedan `h1`; PDP source ima jednu definiciju, production DOM retest ostaje.
- [x] Newsletter hydration/CSP tok stabilizovan; default Playwright je 8/8 PASS.
- [x] Canonical runtime readiness koristi DC/supplier engine kao checkout i daje read-only PASS sa candidate flagom.
- Dodati runtime SHA/version i provider/job freshness u health/admin status.
- Ponoviti lint, sve unit testove, build, dependency audit i production env check.

**Exit:** nema regresije; svaki fix ima reprodukciju koja prvo pada pa prolazi.  
**Owner:** frontend/backend + QA.

## 20–32 h — performance, accessibility i security smoke

| Oblast | Minimalni dokaz |
|---|---|
| Performance | 3 production-like Lighthouse run-a; dogovoren mobile budget; HTML/search payload smanjen ili business risk prihvaćen |
| Accessibility | axe critical/serious = 0 na home/search/PDP/cart/checkout/login/admin template-u; keyboard/zoom test |
| Security | anonymous/auth role contract, CORS/headers, upload/import negative test, npm audit/secret scan |
| Failure paths | provider timeout/5xx, DB transient, stale stock, double submit, duplicate webhook/callback, retry/backoff |

## 24–36 h — kontrolisani production canary

Preduslovi: P0 email i fiscal zatvoreni, candidate deploy na tačnom SHA, support/logistics/payment owner-i prisutni.

1. Odobrena minimalna porudžbina kupivog launch SKU-a.
2. Snimiti UI cene i payment/delivery izbor.
3. Potvrditi atomic DB order/items/reservation/payment.
4. Potvrditi email delivery.
5. Potvrditi supplier/DC reservation i shipment/label/status prema izabranoj launch putanji.
6. Potvrditi fiskalni dokument i iznose.
7. Izvršiti dogovoreni cancellation/refund/storno/cleanup, ili završiti realan fulfilment ako business tako odluči.

**Exit:** jedna audit trail linija bez ručnih neobjašnjenih DB intervencija.  
**Owner:** Release commander + business owner-i.  
**Stop:** bilo koji P0 failure odmah zadržava NO-GO.

## 36–44 h — soak i operativna proba

- 4 h pratiti error rate, queue age, email, fiscal, kurir, Rabalux freshness i DB latency.
- Simulirati provider fail i potvrditi fail-closed/fallback/alert/owner acknowledgement.
- Proći support scenario: kupac nema email, payment pending, kurir odbija adresu, fiskal retry.
- Proći rollback tabletop i, ako je bezbedno, preview/canary rollback rehearsal.

## 44–48 h — decision review

Release commander prezentuje samo dokaze, ne procene: checklist, candidate SHA, test rezultate, provider canary, DB reconciliation, SLO screenshot i preostale P2 rizike.

- **GO:** svi hard gate-ovi PASS; nema P0/P1 bez formalnog containment-a; owner-i i rollback aktivni.
- **CONDITIONAL GO:** samo P2 ili jasno izolovan ne-launch modul; feature je dokazivo isključen i nema zajedničku queue/data/provider putanju.
- **NO-GO:** bilo koji email/fiscal/order P0, nedokazan aktivni payment/courier path, nebezbedna migracija ili monitoring bez alarma.
