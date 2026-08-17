# Rabalux nedeljni lager za Srbiju

Rabalux stanje za prodavnicu dolazi isključivo iz kompletnog nedeljnog XLSX
izveštaja. XML/CSV feed ostaje izvor kataloga, cena, opisa, slika i tehničkih
podataka. Kombinovani stock feed više se ne izvršava iz cron-a i ne može da
prepiše stanje iz Srbije.

## Uvoz

1. Otvoriti `/admin/xml-import` i u Rabalux kartici izabrati XLSX.
2. Kliknuti **Proveri XLSX** i pregledati 0, 1–9, 10+, aktivacije,
   deaktivacije, trajna brisanja i šifre koje postoje samo u fajlu ili samo na sajtu.
3. Ponovo izabrati isti fajl, uneti razlog i potvrdu `RABALUX STANJE`.
4. Kliknuti **Primeni pregledani lager**.

Preview važi 10 minuta. Primena se odbija ako se promeni fajl, stanje proizvoda,
broj redova naglo padne ili je isti fajl već primenjen.

## Pravila

- Svaka šifra koja postoji u XLSX-u ostaje vidljiva kada je odobrena i ima
  kategoriju, aktivnu maloprodajnu cenu i spremnu sliku.
- `10+`: proizvod je dostupan za kupovinu.
- `0–9`: proizvod je vidljiv u katalogu, ali nije dostupan za kupovinu.
- Šifra koja uopšte ne postoji u kompletnom XLSX-u trajno se briše iz `Product`
  tabele. Povezani kataloški redovi brišu se kaskadno, istorijski dokumenti
  zadržavaju svoje SKU/naziv snapshot-e, a upravljani storage fajlovi odlaze u
  retry red za trajno brisanje.
- Svaka šifra iz XLSX-a koje još nema na sajtu povlači se iz kataloškog feeda,
  bez obzira na količinu. Nepoznata ili nemapirana šifra ostaje evidentirana za
  administrativnu obradu.
- Ако шифре више нема у каталошком feed-у, она се ипак креира у бази са називом
  и стањем из XLSX-а. Остаје необјављена док не добије цену, категорију и слике.
- Дневни каталошки sync не сме да уклони шифру која постоји у последњем
  недељном XLSX-у; само следећи комплетан XLSX мења allow-list.
- DC stanje ostaje ERP podatak, ali ne može da zaobiđe Rabalux prag: za web
  kupovinu i dalje je potrebno najmanje 10 komada u nedeljnom XLSX-u.
- Rabalux stanje važi osam dana. Posle toga dobavljačko stanje se smatra
  zastarelim i ne ulazi u kupovinu.

Svaka primena pravi `ImportRun`, stavke pre/posle u `SupplierSyncChange` i
snapshot promene količine. Trajno brisanje proizvoda je označeno kao
nereverzibilno; porudžbine, fiskalni i drugi istorijski redovi zadržavaju svoje
tekstualne snapshot podatke bez veze ka obrisanom proizvodu.
