# Telefonske publike i Viber slike

U Viber / SMS panelu: Nova kampanja → Publika → Dodaj kontakte iz Excel tabele.

- XLSX (prvi list) i CSV, do 4 MB. Kolona Telefon / Broj telefona se prepoznaje automatski; nakon prvog pregleda može se promeniti. Prihvata se i lista bez zaglavlja.
- Pregled prikazuje normalizovane brojeve, duplikate, neispravne redove i evidentirane odjave. Excel numeričke ćelije koje izgube početnu nulu mobilnog broja se popravljaju. Formule se ne koriste kao izvori telefona.
- Operator upisuje naziv liste, opciono spaja listu sa postojećim kupcima i potvrđuje zainteresovanost kontakata za izabrani kanal. Uvoz ne zapisuje niti menja saglasnosti na sajtu.
- Čuvanje kreira posebnu nepromenljivu publiku u postojećem privatnom ViberAudienceQuery filteru. Evidencija izvora sadrži naziv fajla, administratora, vreme i njegovu izjavu. Izvorni fajl se ne čuva. Ponavljanje istog uvoza ne stvara duplikate publike.
- SMS i Viber liste se čuvaju po kanalu. Evidentirane odjave i obrisani korisnici se proveravaju pri pregledu, pripremi kampanje i pre predaje svake poruke radniku. Jedan normalizovan broj dobija jednu poruku.
- Uvoz ne šalje poruke. Slanje ostaje u posebnom koraku Pregled i slanje; test na jedan broj je odvojen od publike.

## Logo i pregled

`public/viber-logo.jpg` je kvadratna JPEG verzija aktuelnog SVG logotipa SPC, sa celim logom u sredini i belim marginama. Dugme Koristi prilagođen SPC logo postavlja taj URL. Stari linkovi ka `/logo.svg`, `/logo.jpeg` i `/logo.webp` na SPC domenima se pri novom slanju NTH-u zamenjuju pripremljenim URL-om; već predate poruke se ne menjaju i ne šalju ponovo.

Novi upload slika takođe pravi kvadratnu JPEG sliku uklapanjem celog sadržaja na belu podlogu. Pregled prikazuje tekst, sliku i dugme; koristi postojeći data-admin-preview izuzetak za svetle boje poruke u tamnoj admin temi.

## Provera

42 ciljana testa obuhvataju pravi XLSX, CSV, mapiranje kolona, duplikate, neispravne ćelije i formule, pregled bez upisa, potvrdu uvoza, idempotentno čuvanje, spajanje publika, proveru odjava kod radnika, stvarnu obradu slika i payload zamenu logotipa, uz postojeće testove kampanja i pojedinačnog slanja. Lokalno je proverena komponenta u browseru pri desktop i mobilnoj širini 390 px; bez preliva i novih konzolnih grešaka. Nove poruke nisu slane tokom ove provere; prijem nove slike na pravom Viber telefonu ostaje za pojedinačni test operatora.
