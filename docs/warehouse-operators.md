# Prostor za magacin

Odgovorna osoba sa ulogom OPS ili SUPER pravi naloge na `/admin/erp/operativci` i prosleđuje zaposlenom link `/admin/magacin/prijava`, e-poštu i lozinku. Svaki nalog ima ulogu WAREHOUSE; ona se ne bira u formi. Nalog se može isključiti i ponovo uključiti.

Na telefonu su dostupni samo Picking i Povrat. Picking prikazuje jedan artikal po koraku, uz Prethodni/Sledeći, unos ili skeniranje šifre i potvrdu količine. Nakon dovršetka artikla automatski prelazi na sledeći neodvojeni artikal. Završeni artikli su na kraju, po redosledu potvrda, označeni zelenom bojom i oznakom Odvojeno. Delimično odvojeni artikli ostaju među nezavršenima. Prikaz magacionera ne prikazuje pojedinačne brojeve porudžbina; potvrda Evidentiraj je desno. Puni ERP zadržava listu i svoje kontrole. Picking koristi postojeći plan i evidenciju odvajanja. Povrat koristi postojeći skener adresnica, povezivanje sadržaja paketa, potvrdu fizičkog dolaska i prijem na lager. Ponovljen sken ne knjiži robu dvaput. Za oštećenu robu bira se odgovarajući magacin za proveru. Fiskalna obrada ostaje u postojećem procesu prijema.

Uloga je dozvoljena samo eksplicitnim serverskim guardovima za ove funkcije. Omogućavanje i uloga se proveravaju ponovo pri svakom zahtevu; isključivanje naloga važi i za aktivnu sesiju.

## Objavljivanje i povratak

Produkcijski build primenjuje aditivnu migraciju `20261013120000_warehouse_operator_role` kroz `db:deploy`, uključujući hardening baze. Pre vraćanja verzije koja nema ograničavanje uloge WAREHOUSE, prvo isključiti sve naloge sa tom ulogom. ENUM vrednost ostaviti u bazi, bez brisanja naloga ili istorije.
