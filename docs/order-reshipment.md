# Ponovno slanje nove robe

U detalju WEB porudžbine, u odeljku Kurir uz preuzetu/neisporučenu X Express ili MyGLS pošiljku, OPS/SUPER bira **Pošalji novu robu / vrati u picking** i upisuje razlog.

- Jedna transakcija čuva očekivani povrat prethodne pošiljke, izdvaja novu robu sa slobodnog lagera, pravi novi picking nalog i vraća porudžbinu u U_PRIPREMI. Isti izvorni shipment može pokrenuti samo jedno ponovno slanje.
- Nova roba ima zaseban ADJUSTMENT izlaz, sa idempotentnim ključem. Ne menja se originalna količina prodate robe, prvobitna rezervacija niti fiskalni obračun. Roba je od tog trenutka izdvojena za pripremu i nije raspoloživa drugoj prodaji.
- Kopiraju se količine i fizički paketi izvornog picking naloga, ali se spremnost potvrđuje ponovo. Nova grupa i nova adresnica imaju sopstven identitet. Prethodni nalog i adresnica ostaju u istoriji.
- Pouzeće nove pošiljke preuzima iznos prethodne grupe; plaćena porudžbina nema novo pouzeće. Povrat stare pošiljke mora operater da dogovori sa kurirom: lokalna akcija ne otkazuje već preuzetu adresnicu niti garantuje prekid stare naplate.
- Kurirski događaji stare pošiljke ostaju u njenoj istoriji, ali ne menjaju status aktivne porudžbine, ne zatvaraju novi picking i ne šalju obaveštenja o novoj isporuci.
- **Povrati za prijem** ima poseban pregled starih pošiljki posle ponovnog slanja. OPS bira aktivan magacin i potvrđuje svaki fizički primljen i pregledan komad. Tek tada sledi ADJUSTMENT ulaz. Nema fiskalne/novčane refundacije; kupac i dalje dobija kupljenu robu.
- Obično brisanje/uklanjanje ovog picking naloga i obično otkazivanje porudžbine blokirani su jer zahtevaju zasebno usaglašavanje izdvojene robe. Nedovoljno slobodne robe, prethodna refundacija/prijem običnog povrata, nejasna količina ili odloženi/otkazani paketi blokiraju akciju.

## Puštanje

Potrebna je migracija `20260924000200_order_reshipment`, zatim postojeći `db:harden` i deploy aplikacije. Migracija uključuje RLS i uklanjanje prava Data API uloga. Ne menjati postojeću produkcijsku politiku dostupnosti.

Lokalno su provereni servisni testovi sa mock bazom, tracking, izbor adresnica i serverski prikaz povrata. Za završnu proveru na testnoj bazi: ponoviti zahtev istovremeno iz dva taba, proveriti jedan izlaz nove robe, novu adresnicu i COD, poslati stari RETURNED/DELIVERED callback, primiti deo pa ostatak stare robe i ponoviti isti prijem. Proveriti da nema refund job-a niti duplog ulaza. Produkcijska migracija, stvarno slanje kuriru i test stvarne baze nisu izvršeni u ovoj lokalnoj izmeni.
