# Obaveštenja o ponovnoj dostupnosti

Kartice proizvoda i PDP zadržavaju nedostupno dugme i prikazuju manji CTA za obaveštenje. Gost ostavlja email, prijavljeni kupac koristi email svog naloga. Saglasnost važi samo za konkretan SKU (i izabranu varijantu), odvojeno od newsletter saglasnosti.

`/admin/newsletter?view=restock` grupiše sve zainteresovane po proizvodu, uključujući postojeće wishlist obaveštenje. Prikazuje čekanje, goste/naloge, poslate mejlove i pokušaje za proveru. Dostupan proizvod može se poslati celoj grupi jednim klikom. Automatska provera koristi postojeći satni email-alerts cron. Oba načina dele jednu baznu evidenciju.

Postojeći newsletter kontakt dobija tag `interest:SKU` pri prijavi. U Publikama se taj tag može koristiti kao filter; newsletter i dalje zahteva sopstvenu saglasnost. Novi gost se čuva u listi čekanja, ne pretvara se automatski u aktivnog newsletter primaoca.

Pre slanja se proverava stvarna web dostupnost (DC/supplier politika), potisnute adrese, obrisan/promенjen nalog, odjavljena wishlist prijava i kupovina istog artikla posle prijave. Gost dobija potpisan link za odjavu bez adrese u URL-u. `PENDING → SENDING` je atomski claim; idempotency key uključuje prijavu i vreme te prijave. Nova prijava kada ponovo nestane zaliha ima novu generaciju.

Neizvestan odgovor provajdera ili istekao pokušaj završava u `REVIEW`, bez automatskog ponovnog slanja. Operativa proverava EmailMessage / događaje provajdera pre eventualnog ispravka statusa. Isključen email provider ne označava poruke kao poslate. Testovi ne šalju mejlove stvarnim kupcima.

Migracija je aditivna, sa RLS i bez anon/authenticated grants. Rollback aplikacije ne zahteva brisanje tabele; ostaju prijave i evidencija poslatih mejlova.
