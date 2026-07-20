# Admin mutation acceptance — 20. jul 2026.

Status: **PROŠAO**

Izvršen je izolovani browser test kroz stvarni admin panel, server actions,
konfigurisanu bazu i `product-media` storage. Svaki fixture je imao jedinstveni
`QA-ADMIN-*` tag, a cleanup je izvršen i pri uspehu i pri prethodnim neuspelim
pokušajima.

## Potvrđeni tokovi

- prijava privremenim `SUPER` nalogom;
- kreiranje i brisanje CMS stranice, uključujući otkazanu i prihvaćenu potvrdu;
- kreiranje kategorije;
- izmena naziva, cene, stanja i kategorije proizvoda;
- stvarni upload fotografije;
- otkazano i potvrđeno brisanje fotografije;
- brisanje storage objekta uz proveru audit rezultata cleanup-a;
- kreiranje i brisanje pravila dostave;
- kreiranje i brisanje vaučera;
- isključivanje i vraćanje načina plaćanja;
- kontrolisano otkazivanje test porudžbine;
- vraćanje rezervisanog stanja proizvoda i magacina;
- audit trag za svaku prihvaćenu mutaciju i odsustvo audit `.error` akcija.

Komanda za ponavljanje:

```bash
npm run test:e2e:admin-mutations
```

Test ne poziva MyGLS, X Express, BADI/lokalnu fiskalizaciju ili spoljne payment
providere. Ne obrađuje istorijske test email/pošiljka/fiskalne greške, ne menja
stvarni katalog i ne proverava backup/restore ili spoljašnji monitoring.

## Cleanup garancije

Test uklanja privremeni admin nalog, audit tragove tog naloga, rate-limit
zapise, proizvod, kategoriju, porudžbinu, stavke, pravilo dostave, vaučer,
stock movements, povezane background job zapise i uploadovane storage objekte.
Konfiguracija plaćanja se vraća na vrednost zatečenu pre testa.
