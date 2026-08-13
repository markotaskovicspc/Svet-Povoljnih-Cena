# Command baseline — 2026-08-11

| Komanda | Rezultat |
|---|---|
| `npm run lint` | PASS, exit 0 |
| `npm run test:unit` | PASS, 122 test file, 573 tests |
| `npm run build` | PASS, compile/type/generate; 83 static pages |
| `npm ls --depth=0` | exit 0; 5 extraneous WASM/sharp paketa |
| `npm audit --omit=dev --json` | PASS, 0 vulnerabilities, 1.109 dependency total |
| `npm run check:production-env` | FAIL, exit 1: `BADI_FISCAL_MODE` i `FISCAL_LOCATION_ID`; 4 warning-a |
| `env RABALUX_ENABLED=true npm run check:runtime-readiness` | PASS: 2.253 active, 1.617 published, 1.558 checkout-sellable, 1.080 launch-spremnih; 669 missing dimensions ostaje vidljivo |
| `npm run test:e2e` | PASS: 148 project-scenarios = 8 PASS, 140 namerno SKIP |

Prvi Playwright pokušaj je sandbox reporter sprečio (`EPERM` za `test-results/.last-run.json`); zatim je ista komanda odobreno ponovljena. Početni aplikacioni rezultat bio je 1 PASS / 7 FAIL. Posle hydration-ready forme, serial-by-default Playwright radnika i dev-only CSP korekcije, puna ista komanda daje 8 PASS / 140 SKIP.

Readiness bez `RABALUX_ENABLED` ostaje očekivano crven jer lokalni `.env.local` ne predstavlja taj produkcioni feature flag. Read-only candidate proba ga postavlja samo za proces komande, ne menja fajl ili Vercel env. `ENFORCE_WEB_AUTO_AVAILABILITY` je ostao `false`.

`npm run test:e2e` podrazumevano aktivira samo dva newsletter testa kroz desktop/mobile/firefox/webkit; ostalih 140 project-scenario instanci su eksplicitno gate-ovane environment flag-ovima i većinom zahtevaju izolovanu E2E bazu.
