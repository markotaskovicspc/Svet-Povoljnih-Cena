# Evidence index

Svi dokazi su sanitizovani: nema lozinki, API ključeva, connection stringova, punih email adresa ili telefona.

## Browser screenshot-i

- `production-home-desktop.jpg`
- `production-home-mobile-390x844.jpg`
- `production-search-suggestions.jpg`
- `production-full-search-smd.jpg`
- `production-pdp-available.jpg`
- `production-cart-after-add.jpg`
- `production-cart-mobile-390x844.jpg`
- `production-checkout-empty-validation.jpg`
- `production-checkout-delivery-empty.jpg`
- `production-checkout-final-no-submit.jpg`
- `production-checkout-mobile-390x844.jpg`

## Struktuirani dokazi

- `db-readonly-audit.mjs` — read-only agregatni Prisma audit; sanitizuje greške i ne ispisuje PII/tajne.
- `db-readonly-audit.json` — rezultat sa admin role, order/payment/refund, email, fiscal, shipment, job, supplier/courier i finansijskim agregatima.
- `production-route-protection.json` — browser rezultat za admin/customer/login rute; browser je imao postojeću SUPER sesiju za admin, zato anonimni 307 dokaz dolazi iz zasebnog curl zahteva.
- `generate-functional-inventory.mjs` — generator svih page/API/JSX control redova.
- `functional-inventory-stats.json` — zbir 1.780 inventarisanih stavki posle uklanjanja mrtve OTP kontrole.
- `command-baseline.md` — izvršeni command rezultati.
- `http-browser-baseline.md` — HTTP, header, timing i browser zapažanja.
- `playwright-baseline.md` — default E2E rezultat i tumačenje.

## Reproducibility

Auditovani commit je `df65e52eac8a63e24daee4cc6336a6207f561898`, ali je worktree već imao veliki skup korisničkih izmena. Rezultati zato predstavljaju upravo taj worktree u trenutku audita, ne čisti HEAD. Naknadni ciljani remediation paket dokumentovan je u `../13_LOCAL_REMEDIATION_UPDATE.md`; nepovezane postojeće izmene nisu resetovane.
