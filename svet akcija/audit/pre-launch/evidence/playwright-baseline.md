# Playwright baseline

> Ovo je pre-fix istorijski baseline. Post-remediation rezultat je zabeležen u `command-baseline.md`: 8 PASS / 140 namerno SKIP.

Komanda: `npm run test:e2e`  
Rezultat: **FAIL** — 1 passed, 7 failed, 140 skipped, ~53,7 s.

Jedini default spec je `tests/e2e/newsletter.spec.ts`, dva testa × četiri projekta.

- Success scenario: 4/4 timeout čekajući `/api/newsletter`; native form putanja je završavala kao `/kontakt?` pre stabilnog React handler-a.
- Failure scenario: Firefox PASS; desktop/mobile/webkit FAIL; mobile je u jednom tragu prikazao lokalnu validacionu poruku, druga dva nisu našla expected alert.
- App regex prihvata `+`; problem nije statički dokaz da je plus alias zabranjen, već cold/hydration race između `domcontentloaded`, fill/Enter i React form handler-a.
- Dev server je upozorio da je `/logo.svg` LCP kandidat bez eager prioriteta.

Trace i error-context artefakti su u repo `test-results/`. Nisu kopirani kao duplikati u audit folder. Ovaj audit nije menjao test ili aplikaciju.
