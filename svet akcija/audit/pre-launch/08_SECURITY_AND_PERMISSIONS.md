# Security and permissions

## Rezime

Osnovna bezbednosna postura je dobra: anonimne privatne rute se preusmeravaju, admin backend radi enabled/role provere, session invalidation postoji, RLS/grant/bucket hardening je uredan, security header-i i negativna CORS proba prolaze, a `npm audit --omit=dev` nema poznatih ranjivosti. Najveće bezbednosne rupe nisu dokazani exploit-i, već nedovršena role acceptance, CSP `unsafe-inline`, OTP missing flow i nedostatak runtime audit/alert pouzdanosti zbog pokvarenog emaila.

## Auth i session

| Kontrola | Dokaz | Status |
|---|---|---|
| Customer password schema | min 8, max 200; credentials parsing | PASS |
| Login rate limit | DB-backed rate limit poziv u credentials provider-u | PASS |
| Phone OTP rate limit | authorize grana ima limit | PARTIAL |
| Phone OTP send/consume | nema send action/transport; verify ne briše token u helper-u | FAIL / P1 |
| Password reset | secure token digest, expiry i session revocation kod/test | PARTIAL — realan email pada |
| Email confirmation | token tok postoji | PARTIAL — realan email pada |
| Session invalidacija | `sessionVersion` i `deletedAt` provera | PASS |
| Account privacy | `/nalog` anonimno 307 na login sa callback | PASS |
| Admin privacy | `/admin` anonimno 307 na admin login | PASS |

## Admin permission model

- Role su `SUPER`, `CONTENT`, `OPS`, `ADS`.
- Server guard ponovo učitava admin nalog, proverava `enabled` i role allow-list; `SUPER` je eksplicitni override.
- UI navigacija deli module po rolama, ali zaključak se ne oslanja samo na skrivanje linkova.
- Unit `admin-authorization` pokrivenost prolazi u zbiru 573 testa.
- Produkciona DB ima 3 enabled SUPER naloga; nema enabled CONTENT/OPS/ADS test pokrića. Zbog toga role E2E i IDOR/forbidden side-effect matrica ostaju BLOCKED, ne PASS.

Pre launch-a dokazati za svaku rolu: dopušten GET, zabranjen GET, zabranjen POST/PATCH/DELETE sa 0 DB promena, export/download auth, audit actor/action/target i disabled-user session rejection.

## HTTP i browser zaštite

| Kontrola | Produkcioni rezultat | Status |
|---|---|---|
| HTTPS | HTTP→HTTPS 308; apex→www 308 | PASS |
| HSTS | `max-age=63072000` | PASS |
| Frame protection | CSP `frame-ancestors 'none'` + `X-Frame-Options: DENY` | PASS |
| MIME sniffing | `X-Content-Type-Options: nosniff` | PASS |
| Referrer | `strict-origin-when-cross-origin` | PASS |
| Permissions policy | camera/mic/geolocation/payment/USB/topics disabled | PASS |
| CORS | evil-origin GET/OPTIONS nije dobio ACAO za checkout probe | PASS |
| CSP | restriktivni allow-list, ali script/style `unsafe-inline` | PARTIAL / P2 |
| Browser console | 0 warning/error u auditovanim ključnim tokovima | PASS |

Napomena: jedan nepostojeći `/api/admin/orders` probe je dao 404 sa `Access-Control-Allow-Origin: *`; to je statička 404 površina, ne dokaz da stvarni admin API deli podatke. Stvarne admin handler-e treba obuhvatiti authenticated/anonymous contract testovima.

## Podaci, RLS i storage

- Sve `public` tabele imaju RLS.
- `anon` i `authenticated` API role nemaju grantove; app koristi Prisma `postgres` konekciju.
- `fiscal-receipts`, `order-receipts`, `reclamation-uploads`, `shipment-labels` su private.
- `product-media` je public po dizajnu.
- Reclamation fotografije moraju kroz signed URL; receipt PDF se čita server-side i šalje kao attachment.
- Migracije kroz project script chain-uju `db:harden`; direktna Prisma CLI operacija zahteva naknadni `npm run db:harden`.

Status: **PASS**, uz preporučeni periodični automated assertion i restore/revocation test.

## Secrets i environment hygiene

- Audit nije ispisivao tajne; poređena je samo konfigurisanost/režim/placeholder semantika.
- Truthy `GET_FROM_*` vrednosti moraju ostati tretirane kao unset.
- Root `.env.local` je runtime izvor; nested env ima mali Supabase subset i može zbuniti operativni postupak.
- Vercel Production env parity nije direktno pročitana; zato se ne tvrdi da lokalni ključ garantuje production ključ.
- Provider production prihvatanje je uglavnom fail-closed kroz `*_PRODUCTION_ACCEPTED`; to je pozitivan dizajn.

## Input, upload i injection površine

Pozitivno: Zod/server validacije su široko prisutne, Prisma parametrizuje standardne upite, upload-i imaju posebne storage servise i privatne bucket-e, iframe newsletter preview koristi `sandbox=""`.

Otvorena acceptance obaveza:

- XLSX/CSV/XML import formula injection, oversized row count, duplicate header, malformed encoding i rollback.
- Upload MIME/content mismatch, SVG/script payload, EXIF/PII, size/dimension limits, signed URL expiry.
- Search/filter/order-by allow-list i raw SQL audit za dynamic export/report upite.
- Webhook signature, replay window i canonical body testovi.
- CSRF/Origin zaštita svih cookie-auth server action/API mutacija.

Nije pronađen dokaz exploita; bez zasebnog DAST/fuzz i gated mutation suite-a ovi redovi su `PARTIAL`.

## Security prioriteti

1. Zatvoriti Resend P0, jer reset/confirm i urgent alert bez isporuke slabe incident i account recovery zaštitu.
2. Izvesti izolovanu role/IDOR/mutation matricu za sve četiri role.
3. Ili završiti OTP end-to-end sa one-time consume/hashing/rate limitom, ili ukloniti javni entrypoint.
4. CSP `unsafe-inline` prvo u report-only nonce/hash migraciji, pa enforced.
5. U CI dodati dependency audit, secret scan, SAST/raw-SQL/upload test i security header/CORS contract probe.
