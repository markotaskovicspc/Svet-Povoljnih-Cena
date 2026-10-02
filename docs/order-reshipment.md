# Ponovno slanje nove robe

U detalju WEB porudžbine, u odeljku Kurir uz preuzetu/neisporučenu X Express ili MyGLS pošiljku, OPS/SUPER bira **Vrati u picking** i upisuje razlog. Zatim na izabranom picking nalogu bira **Učitaj porudžbine**.

Ako je X Express prihvatio najavu (postoji broj pošiljke i potvrda prijema), a status je ostao CREATED ili je naknadno označen FAILED / DELETED bez evidentiranog preuzimanja, ista akcija je dostupna uz obaveznu ručnu potvrdu da je roba fizički preuzeta. Potvrda, operater i razlog ostaju u istoriji porudžbine i revizionom zapisu; ne upisuje se izmišljeni kurirski status niti se kontaktira kurir. Lokalno pripremljena adresnica bez prihvaćene najave nije dovoljna. Ovo je ponovno slanje nove robe nakon preuzimanja, a ne obnova preuzimanja robe koja je još u magacinu.

- Jedna transakcija čuva očekivani povrat prethodne pošiljke, izdvaja novu robu sa slobodnog lagera i vraća porudžbinu u U_PRIPREMI. Picking nalog se ne kreira automatski; nova roba se učitava tek eksplicitnom akcijom na izabranom nalogu. Isti izvorni shipment može pokrenuti samo jedno ponovno slanje.
- Nova roba ima zaseban ADJUSTMENT izlaz, sa idempotentnim ključem. Ne menja se originalna količina prodate robe, prvobitna rezervacija niti fiskalni obračun. Roba je od tog trenutka izdvojena za pripremu i nije raspoloživa drugoj prodaji.
- Kopiraju se količine i fizički paketi izvornog picking naloga, ali se spremnost potvrđuje ponovo. Nova grupa i nova adresnica imaju sopstven identitet. Prethodni nalog i adresnica ostaju u istoriji.
- Pouzeće nove pošiljke preuzima iznos prethodne grupe; plaćena porudžbina nema novo pouzeće. Povrat stare pošiljke mora operater da dogovori sa kurirom: lokalna akcija ne otkazuje već preuzetu adresnicu niti garantuje prekid stare naplate.
- Kurirski događaji stare pošiljke ostaju u njenoj istoriji, ali ne menjaju status aktivne porudžbine, ne zatvaraju novi picking i ne šalju obaveštenja o novoj isporuci.
- **Povrati za prijem** ima poseban pregled starih pošiljki posle ponovnog slanja. OPS bira aktivan magacin i potvrđuje svaki fizički primljen i pregledan komad. Tek tada sledi ADJUSTMENT ulaz. Nema fiskalne/novčane refundacije; kupac i dalje dobija kupljenu robu.
- Obično brisanje/uklanjanje ovog picking naloga i obično otkazivanje porudžbine blokirani su jer zahtevaju zasebno usaglašavanje izdvojene robe. Nedovoljno slobodne robe, prethodna refundacija/prijem običnog povrata, nejasna količina ili odloženi/otkazani paketi blokiraju akciju.

## Puštanje

Potrebna je migracija `20260924000200_order_reshipment`, zatim postojeći `db:harden` i deploy aplikacije. Migracija uključuje RLS i uklanjanje prava Data API uloga. Ne menjati postojeću produkcijsku politiku dostupnosti.

Podrška za ručno potvrđeno preuzimanje bez skeniranja ne zahteva novu migraciju. Servisni testovi pokrivaju obaveznu potvrdu, odbijanje nepodobnih pošiljki, jedno izdvajanje robe i eksplicitno učitavanje u picking. Browser test `tests/e2e/order-unscanned-pickup.spec.ts` koristi privremenu baznu šemu i proverava i ponavljanje zahteva iz starog taba, očuvanje stare pošiljke i pouzeća i učitavanje nove grupe samo jednom. Pokreće se postojećim `test:e2e:client-feedback:isolated` runnerom uz `E2E_ORDER_RESHIPMENT=1` i `CLIENT_FEEDBACK_E2E_SPECS=tests/e2e/order-unscanned-pickup.spec.ts`. Stvarna najava kuriru nije deo te provere.
